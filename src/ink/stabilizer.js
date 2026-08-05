/**
 * stabilizer — the handwriting-quality core.
 *
 * Raw pointer samples are noisy: hand tremor, digitizer quantisation and
 * finger contact-patch drift all show up as visible wobble. Naive fixes make it
 * worse — a plain moving average lags the pen badly and rounds off every corner.
 *
 * The approach here (independently implemented, modelled on the technique
 * Xournal++ calls "velocity gaussian") solves both at once:
 *
 *   **Weight past samples by how fast the pen was moving.**
 *
 * Each older sample's weight is exp(-S² / 2σ²), where S is the *accumulated
 * speed* between it and the newest sample. Consequences:
 *
 *   - Writing fast → S grows immediately → the window collapses to ~1 sample →
 *     almost no smoothing, so deliberate fast strokes stay crisp and lag-free.
 *   - Writing slowly / hovering → S grows slowly → a long window → heavy
 *     smoothing, which is exactly where tremor lives.
 *
 * Two more pieces make it feel right:
 *
 *   - **Deadzone** (optional): movement under a few pixels emits no point at
 *     all. Kills micro-jitter and decimates redundant samples for free. Cusp
 *     detection keeps deliberate sharp corners from being rounded off.
 *   - **Finalize spline**: every smoother trails the true pen position. On
 *     pen-up we close that gap with a tangent-continuous quadratic Bézier, so
 *     the stroke ends exactly where the pen lifted. Without this, stabilised
 *     ink feels laggy and strokes end short. It is the single most-missed
 *     detail in naive implementations.
 *
 * Timestamps are sub-millisecond `event.timeStamp`, so velocity is materially
 * more accurate here than in the desktop original (which is stuck with integer
 * millisecond ticks and has to floor dt at 1 ms).
 */

// Weight below which an older sample stops contributing (and is discarded).
const WEIGHT_CUTOFF = 0.01;

// Hard cap on window length. Only reachable when the pen is nearly stationary;
// prevents unbounded memory on a very slow stroke.
const MAX_WINDOW = 64;

// Minimum distance (CSS px) between committed points. Sub-pixel moves add file
// size and rendering cost without adding visible detail.
const MIN_POINT_DISTANCE = 0.35;

export const STABILIZER_PRESETS = {
  off:    { sigma: 0,    deadzone: 0   },
  light:  { sigma: 0.35, deadzone: 0.8 },
  medium: { sigma: 0.6,  deadzone: 1.3 },
  strong: { sigma: 1.1,  deadzone: 2.0 },
};

/**
 * @param {object}  opts
 * @param {number}  opts.sigma     smoothing strength; 0 disables averaging
 * @param {number}  opts.deadzone  jitter radius in CSS px; 0 disables
 * @param {boolean} [opts.cuspDetection=true]
 */
export function createStabilizer({ sigma = 0.6, deadzone = 1.3, cuspDetection = true } = {}) {
  const twoSigmaSq = 2 * sigma * sigma;

  /** @type {{x:number,y:number,p:number,v:number}[]} newest first */
  let window = [];
  let prevRaw = null;       // previous raw sample, for velocity
  let lastPainted = null;   // last emitted point (deadzone centre)
  let lastLive = null;      // last raw sample that escaped the deadzone
  let lastDir = null;       // direction that took us out of the deadzone
  let lastRaw = null;       // most recent raw sample, for finalize()

  /** Deadzone stage. Returns a point to feed onward, or null to swallow. */
  function applyDeadzone(s) {
    if (!deadzone || !lastPainted) return s;

    const dx = s.x - lastPainted.x;
    const dy = s.y - lastPainted.y;
    const dist = Math.hypot(dx, dy);

    // Inside the disc → no point. Reset the averaging window to the current
    // centre so a direction change after a pause starts clean rather than
    // being dragged by stale history.
    if (dist <= deadzone) {
      window = [{ x: lastPainted.x, y: lastPainted.y, p: lastPainted.p, v: 0 }];
      return null;
    }

    // Cusp: the pen reversed by more than 90°. Draw the actual corner instead
    // of letting the smoother round it away.
    if (cuspDetection && lastDir && (dx * lastDir.x + dy * lastDir.y) < 0 && lastLive) {
      const rx = s.x - lastLive.x;
      const ry = s.y - lastLive.y;
      const rlen = Math.hypot(rx, ry) || 1;
      const coeff = deadzone / rlen;
      lastDir = { x: rx * coeff, y: ry * coeff };
      const out = {
        x: s.x - lastDir.x,
        y: s.y - lastDir.y,
        p: coeff * lastLive.p + (1 - coeff) * s.p,
      };
      lastLive = s;
      window = [{ x: out.x, y: out.y, p: out.p, v: 0 }];
      return out;
    }

    const ratio = deadzone / dist;
    lastDir = { x: dx * ratio, y: dy * ratio };
    lastLive = s;
    // The point on [lastPainted, s] that sits exactly `deadzone` short of s.
    return { x: s.x - lastDir.x, y: s.y - lastDir.y, p: s.p };
  }

  /** Velocity-weighted Gaussian average. */
  function applyAverage(s, velocity) {
    if (!sigma) return s;

    window.unshift({ x: s.x, y: s.y, p: s.p, v: velocity });

    let sumW = 0, sx = 0, sy = 0, sp = 0;
    let accumulated = 0;

    for (let i = 0; i < window.length; i++) {
      // Gaussian argument is the accumulated speed back to this sample — a
      // proxy for how far the pen has travelled since it was recorded.
      const w = Math.exp(-(accumulated * accumulated) / twoSigmaSq);
      if (w < WEIGHT_CUTOFF || i >= MAX_WINDOW) {
        window.length = i;         // self-trimming window
        break;
      }
      const pt = window[i];
      sumW += w; sx += w * pt.x; sy += w * pt.y; sp += w * pt.p;
      accumulated += pt.v;
    }

    if (!sumW) return s;
    return { x: sx / sumW, y: sy / sumW, p: sp / sumW };
  }

  return {
    /**
     * Feed one raw sample.
     * @returns {{x,y,p}|null} a point to append, or null if swallowed
     */
    push(s) {
      lastRaw = s;

      let velocity = 0;
      if (prevRaw) {
        const dt = Math.max(s.t - prevRaw.t, 0.1); // sub-ms timestamps
        velocity = Math.hypot(s.x - prevRaw.x, s.y - prevRaw.y) / dt;
      }
      prevRaw = s;

      // First point of the stroke: seed everything, emit as-is.
      if (!lastPainted) {
        const first = { x: s.x, y: s.y, p: s.p };
        lastPainted = first;
        lastLive = s;
        window = [{ x: s.x, y: s.y, p: s.p, v: 0 }];
        return first;
      }

      const dz = applyDeadzone(s);
      if (!dz) return null;

      const out = applyAverage(dz, velocity);

      // Drop sub-pixel movement — no visible benefit, real storage cost.
      if (Math.hypot(out.x - lastPainted.x, out.y - lastPainted.y) < MIN_POINT_DISTANCE) {
        return null;
      }
      lastPainted = out;
      return out;
    },

    /**
     * Close the gap between the smoothed stroke and where the pen actually
     * lifted, with a tangent-continuous quadratic Bézier (flattened to points).
     *
     * @param {{x,y,p}[]} pts  points committed so far
     * @returns {{x,y,p}[]}    extra points to append (possibly empty)
     */
    finalize(pts) {
      const C = lastRaw && { x: lastRaw.x, y: lastRaw.y, p: lastRaw.p };
      if (!C || pts.length === 0) return [];
      const B = pts[pts.length - 1];
      const bc = Math.hypot(C.x - B.x, C.y - B.y);
      if (bc < 0.1) return [];
      if (pts.length === 1) return [C];

      const A = pts[pts.length - 2];
      const abx = B.x - A.x, aby = B.y - A.y;
      const ab = Math.hypot(abx, aby);
      if (ab < 1e-6) return [C];

      // Control point continues the incoming tangent, so the join at B is
      // G1-continuous (no visible kink).
      const bcx = C.x - B.x, bcy = C.y - B.y;
      const dot = abx * bcx + aby * bcy;
      let d;
      if (dot > 1e-6) {
        // Symmetric-spline distance, clamped so the curve can't overshoot past C.
        d = Math.min((bc * bc * ab) / (2 * dot), bc);
      } else {
        d = bc * 0.5; // reversing at the very end — keep it short
      }
      const Q = { x: B.x + (abx / ab) * d, y: B.y + (aby / ab) * d };

      // Flatten the quadratic. Step count scales with length; capped for sanity.
      const steps = Math.min(Math.max(Math.ceil(bc / 1.5), 2), 24);
      const out = [];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        out.push({
          x: u * u * B.x + 2 * u * t * Q.x + t * t * C.x,
          y: u * u * B.y + 2 * u * t * Q.y + t * t * C.y,
          p: u * B.p + t * C.p,
        });
      }
      return out;
    },

    reset() {
      window = [];
      prevRaw = lastPainted = lastLive = lastDir = lastRaw = null;
    },
  };
}
