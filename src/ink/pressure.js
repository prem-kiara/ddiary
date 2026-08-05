/**
 * pressure — turn platform pressure into a usable 0..1 stroke-width factor.
 *
 * Three cases have to be handled, because DDiary is used on Apple Pencil,
 * Surface pen *and* bare fingers:
 *
 *  - **Real stylus pressure.** Apple Pencil / Surface report a genuine 0..1
 *    axis. Apply a floor (so a feather-light stroke still marks) and a user
 *    multiplier, then let the stabiliser smooth it alongside x/y.
 *
 *  - **No pressure axis.** Chrome reports a constant 0.5 for mice and many
 *    touchscreens; Safari reports 0. A constant value would give a dead,
 *    uniform line, so we synthesise pressure from *speed* instead: slow strokes
 *    are thick, fast strokes are thin. This is what makes finger-writing look
 *    like handwriting rather than marker scrawl.
 *
 *  - **Lift-off artefacts.** Some digitizers emit pressure exactly 0 on the
 *    final samples. Those points are dropped upstream rather than rendered as
 *    zero-width.
 *
 * The velocity→width curve is our own formulation (a decaying exponential with
 * an EMA), chosen for the same reason Xournal++ uses an arctan: it needs to
 * saturate smoothly at both ends so width never spikes or collapses.
 */

// Pressure below this is clamped up, so a light touch still leaves a mark.
const MIN_PRESSURE = 0.08;

// Speed (CSS px per ms) at which the synthesised stroke reaches its thinnest.
// Normal handwriting runs ~0.1–2 px/ms; 1.2 puts the interesting range in the
// middle of the curve.
const SPEED_SCALE = 1.2;

// Synthesised pressure range. Never reaches 0/1 — a stroke that tapers to
// nothing looks broken, and one that pins at max has no expression left.
const SYNTH_MIN = 0.35;
const SYNTH_MAX = 1.0;

// EMA weight for the new sample. Low = smoother width, higher = more responsive.
const SYNTH_SMOOTHING = 0.2;

/**
 * Decide whether a device's reported pressure is real.
 * Chrome hands back exactly 0.5 for pressure-less devices and 0 for some
 * touch surfaces — neither is a usable signal.
 */
export function hasRealPressure(sample) {
  if (sample.type !== 'pen') return false;
  return sample.pressure > 0 && sample.pressure !== 0.5;
}

/**
 * Is this sample *conclusive* about whether the device has a pressure axis?
 *
 * A pen reporting 0 at pen-down (common — iOS often has no force on the first
 * touch of a contact) or exactly 0.5 (Chrome's "no axis" placeholder) tells us
 * nothing. Deciding on such a sample and latching it would disable real Apple
 * Pencil / Surface pressure for the entire stroke.
 */
function isConclusive(sample) {
  if (sample.type !== 'pen') return true;                 // touch/mouse: never has pressure
  return sample.pressure > 0 && sample.pressure !== 0.5;  // a real reading
}

/**
 * Per-stroke pressure resolver. One instance per stroke — it carries the EMA
 * state and the "does this device have pressure" decision, which is latched at
 * pen-down (matching how Xournal++ picks a pressure mode once per stroke, so a
 * single dropped sample can't flip modes mid-stroke).
 */
export function createPressureResolver({ multiplier = 1 } = {}) {
  let real = null;             // null until a sample proves the case
  let lastPressure = 0;        // EMA state for the synthesised path
  let lastRealPressure = 0;    // last non-zero stylus reading, for drop-outs
  let prev = null;             // previous sample, for speed

  return {
    /** @returns {number} width factor in (0, ~1], or -1 to drop the sample */
    resolve(sample) {
      // Stay undecided until a sample actually proves the case, rather than
      // latching on sample 1 — see isConclusive().
      if (real === null && isConclusive(sample)) real = hasRealPressure(sample);

      if (real) {
        // A reported pressure of 0 mid-stroke says nothing about *where* the
        // pen is. This used to discard the whole sample, which deleted chunks
        // of the stroke path — the survivors were then joined by a straight
        // line, producing long sweeps across the page that read as lag or
        // "the letter didn't come out". The Apple Pencil reports 0 routinely
        // when writing fast or lightly, so this fired constantly.
        //
        // Position is never thrown away now; only the width falls back to the
        // last good reading. True lift-off is signalled by pointerup, not by a
        // zero here.
        const p = sample.pressure > 0 ? sample.pressure : (lastRealPressure || MIN_PRESSURE);
        if (sample.pressure > 0) lastRealPressure = sample.pressure;
        prev = sample;
        return clamp(Math.max(MIN_PRESSURE, p * multiplier), 0.01, 2);
      }

      // ── Synthesised from speed ──────────────────────────────────────────
      let target = SYNTH_MAX;
      if (prev) {
        const dt   = Math.max(sample.t - prev.t, 0.5); // guard against 0 / same-frame
        const dist = Math.hypot(sample.x - prev.x, sample.y - prev.y);
        const speed = dist / dt;
        // 1 at rest → 0 when fast, smoothly.
        const slowness = Math.exp(-speed / SPEED_SCALE);
        target = SYNTH_MIN + (SYNTH_MAX - SYNTH_MIN) * slowness;
      }
      // Ramp in from a mid weight so the stroke start isn't a blob. Seeding
      // from `target` put the first sample at SYNTH_MAX, producing exactly the
      // heavy dot this is meant to avoid (there is no velocity yet, so `target`
      // is always maximum on the first sample).
      lastPressure = prev
        ? lastPressure + (target - lastPressure) * SYNTH_SMOOTHING
        : (SYNTH_MIN + SYNTH_MAX) / 2;
      prev = sample;
      return clamp(lastPressure * multiplier, 0.01, 2);
    },
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
