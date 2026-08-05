/**
 * strokeModel — vector ink representation and (de)serialisation.
 *
 * Why vector and not a PNG (which is what the legacy DrawingCanvas saved):
 *
 *   - **Editable.** Individual strokes can be erased, restyled, moved and
 *     undone after the fact. A flattened bitmap can only be painted over.
 *   - **Resolution independent.** Renders crisp at any zoom and exports to PDF
 *     as real vectors rather than a blurry upscaled raster.
 *   - **Small.** A dense page of handwriting is tens of KB of JSON versus
 *     hundreds of KB of base64 PNG — which matters because a Firestore document
 *     is capped at 1 MiB and `entry.content` already lives in that budget.
 *   - **Searchable later.** Stroke geometry is what a handwriting-recognition
 *     service wants; a screenshot is a lossy second best.
 *
 * Wire format is deliberately terse — flat coordinate arrays and short keys,
 * the same shape Xournal++ uses in its file format, which turns out to be both
 * compact and trivially JSON-able:
 *
 *   { v:1, w:800, h:600, s:[ { t:0, c:'#1a1a2e', z:2, p:[x,y,pr, x,y,pr, …] } ] }
 *
 * Coordinates are stored in *authoring* pixels alongside the canvas size they
 * were drawn at, so the same ink can be re-rendered at any display size.
 */

export const TOOL = { PEN: 0, HIGHLIGHTER: 1 };

/** Rounding used on save. 2dp on position is well below visible precision. */
const XY_DP = 2;
const P_DP  = 3;

const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * Create an in-memory stroke.
 * @param {object} opts
 * @param {number} opts.tool   TOOL.*
 * @param {string} opts.color  CSS hex
 * @param {number} opts.size   base width in CSS px
 */
export function createStroke({ tool = TOOL.PEN, color = '#1a1a2e', size = 2 }) {
  return { tool, color, size, points: [] /* {x,y,p} */ };
}

/** Append a point, mutating the stroke. */
export function addPoint(stroke, pt) {
  stroke.points.push(pt);
}

/** Axis-aligned bounds, padded by the stroke's max rendered half-width. */
export function strokeBounds(stroke) {
  if (!stroke.points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxP = 0;
  for (const pt of stroke.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
    if (pt.p > maxP) maxP = pt.p;
  }
  const pad = (stroke.size * Math.max(maxP, 0.5)) / 2 + 1;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** True if (x,y) lies within `radius` of any segment of the stroke. */
export function hitTestStroke(stroke, x, y, radius) {
  const b = strokeBounds(stroke);
  if (!b) return false;
  if (x < b.minX - radius || x > b.maxX + radius ||
      y < b.minY - radius || y > b.maxY + radius) return false;

  const pts = stroke.points;
  const r2 = radius * radius;
  if (pts.length === 1) {
    return (pts[0].x - x) ** 2 + (pts[0].y - y) ** 2 <= r2;
  }
  for (let i = 1; i < pts.length; i++) {
    if (pointSegmentDist2(x, y, pts[i - 1], pts[i]) <= r2) return true;
  }
  return false;
}

/** Squared distance from a point to a segment. */
function pointSegmentDist2(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (px - a.x) ** 2 + (py - a.y) ** 2;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/**
 * Split a stroke around an eraser hit, returning the surviving pieces.
 * This is what makes erasing feel like erasing rather than painting white:
 * a swipe through the middle of a line yields two real strokes.
 *
 * @returns {object[]} 0, 1 or 2+ strokes replacing the original
 */
export function splitStrokeAt(stroke, x, y, radius) {
  const pts = stroke.points;
  const r2 = radius * radius;
  const keep = pts.map(p => (p.x - x) ** 2 + (p.y - y) ** 2 > r2);

  // A vertex-only test misses the common case of the eraser crossing the middle
  // of a long segment whose *endpoints* are both outside the disc — which made
  // the eraser silently no-op on fast strokes, where samples are far apart.
  // Segments passing through the disc are cut even when both ends survive.
  const cut = new Array(Math.max(pts.length - 1, 0)).fill(false);
  for (let i = 1; i < pts.length; i++) {
    if (keep[i - 1] && keep[i] && pointSegmentDist2(x, y, pts[i - 1], pts[i]) <= r2) {
      cut[i - 1] = true;
    }
  }

  if (keep.every(Boolean) && !cut.some(Boolean)) return [stroke];  // untouched
  if (keep.every(k => !k)) return [];                              // fully erased

  const out = [];
  let run = [];
  const flush = () => {
    // A single leftover point renders as a dot; usually undesirable debris.
    if (run.length > 1) out.push({ ...stroke, points: run });
    run = [];
  };
  for (let i = 0; i < pts.length; i++) {
    if (!keep[i]) { flush(); continue; }
    run.push(pts[i]);
    if (cut[i]) flush();               // segment i→i+1 passes through the eraser
  }
  flush();
  return out;
}

// ─── Serialisation ──────────────────────────────────────────────────────────

/** @returns {object} compact, JSON-safe document */
export function serialize(strokes, width, height) {
  return {
    v: 1,
    w: round(width, 1),
    h: round(height, 1),
    s: strokes.map(st => {
      const p = [];
      for (const pt of st.points) {
        p.push(round(pt.x, XY_DP), round(pt.y, XY_DP), round(pt.p, P_DP));
      }
      return { t: st.tool, c: st.color, z: st.size, p };
    }),
  };
}

/** Inverse of serialize(). Tolerates missing/blank input. */
export function deserialize(doc) {
  if (!doc || !Array.isArray(doc.s)) return { strokes: [], width: 0, height: 0 };
  const strokes = doc.s.map(st => {
    const points = [];
    const p = st.p || [];
    // Strict bound: a trailing partial triple is discarded rather than emitted
    // as a point with an undefined pressure, which would round-trip to null and
    // permanently corrupt the stored payload on the next save.
    for (let i = 0; i + 2 < p.length; i += 3) {
      points.push({ x: p[i], y: p[i + 1], p: p[i + 2] });
    }
    return { tool: st.t ?? TOOL.PEN, color: st.c || '#1a1a2e', size: st.z || 2, points };
  });
  return { strokes, width: doc.w || 0, height: doc.h || 0 };
}

/**
 * Longest gap allowed between points when building a stroke outline.
 *
 * Safari delivers pointermove at roughly display rate, so a fast scribble lands
 * samples 50–120 px apart. perfect-freehand cannot build a clean outline from
 * points that sparse: the ribbon collapses and breaks up, which rendered as
 * thin, faded, dashed strokes — while slow handwriting on the same page looked
 * perfect, because its samples are close together.
 *
 * Proven by drawing one shape twice with identical pressure: at 92 px spacing
 * it broke up, at 5.8 px it was solid.
 */
const MAX_POINT_SPACING = 6;

/**
 * Insert interpolated points wherever consecutive samples are too far apart.
 *
 * Applied only when *rendering* (screen and PDF), never to what is stored, so
 * saved documents stay compact and the recorded geometry remains exactly what
 * the pen reported.
 */
export function densify(points, maxSpacing = MAX_POINT_SPACING) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > maxSpacing) {
      const steps = Math.min(Math.ceil(dist / maxSpacing), 200); // cap pathological jumps
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          p: a.p + (b.p - a.p) * t,
        });
      }
    }
    out.push(b);
  }
  return out;
}

/** Rough serialised size in bytes — used to warn before hitting Firestore limits. */
export function estimateSize(strokes) {
  let n = 0;
  for (const st of strokes) n += st.points.length * 18 + 40;
  return n;
}
