/**
 * shapeRecognition — snap a rough freehand stroke to a clean geometric shape.
 *
 * Approach (independently implemented, modelled on the technique Xournal++
 * uses): compute the stroke's **second moments of area**, treating it as a wire
 * of uniform density, and derive one scale- and rotation-invariant scalar:
 *
 *     roundness = 4·(Ixx·Iyy − Ixy²) / (Ixx + Iyy)²
 *
 * It is **0 for a perfect straight line and 1 for a perfect circle**, with
 * everything else in between — so a single cheap number does the initial
 * triage, independent of how big the shape is or which way up it was drawn.
 *
 *   roundness ≈ 0  → straight line       (fit the principal axis)
 *   roundness ≈ 1  → circle              (verify radial deviation, then snap)
 *   in between     → polygon             (split into straight runs, then
 *                                         classify by side count and angles)
 *
 * Everything returns plain point arrays, so a recognised shape is just another
 * stroke — it renders, erases, exports to PDF and undoes exactly like freehand
 * ink, with no special cases anywhere downstream.
 */

// ─── Tuning ─────────────────────────────────────────────────────────────────

/** Below this diagonal (CSS px) a stroke is a scribble, not a shape. */
const MIN_SIZE = 40;

/** Max roundness still considered a straight line. */
const LINE_MAX_ROUNDNESS = 0.02;

/** Min roundness before a circle is even considered. */
const CIRCLE_MIN_ROUNDNESS = 0.88;

/** Max length-weighted mean radial deviation, as a fraction of the radius. */
const CIRCLE_MAX_DEVIATION = 0.14;

/**
 * The safety net, and the most important constant here.
 *
 * A candidate is only accepted if **every** original sample lies within this
 * fraction of the stroke's diagonal of the idealised shape. Cheap scalars like
 * `roundness` describe a stroke's mass distribution, not its outline, so on
 * their own they cannot tell a square from a circle (both are perfectly
 * isotropic), an arrow from its own shaft, or a capital "U" from a triangle.
 * Checking the residual directly is what makes recognition conservative:
 * anything that does not genuinely look like the primitive stays freehand.
 */
const MAX_RESIDUAL_FRACTION = 0.075;

/** Snap a near-horizontal / near-vertical line to exactly axis-aligned. */
const AXIS_SNAP_DEG = 6;

/** How far a rectangle's corners may deviate from 90°. */
const RECT_ANGLE_TOL_DEG = 18;

/** Corner-splitting tolerance, as a fraction of the shape's diagonal. */
const SPLIT_TOL_FRACTION = 0.045;

/** Endpoints closer than this fraction of the diagonal mean "closed shape". */
const CLOSURE_FRACTION = 0.28;

const DEG = Math.PI / 180;

// ─── Geometry helpers ───────────────────────────────────────────────────────

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Length-weighted second moments about the centroid, treating the polyline as
 * a uniform wire. Segment midpoints carry the mass.
 */
function moments(pts) {
  let m = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    m += len;
    sx += len * mx;      sy += len * my;
    sxx += len * mx * mx; syy += len * my * my; sxy += len * mx * my;
  }
  if (!m) return null;
  const cx = sx / m, cy = sy / m;
  const Ixx = sxx / m - cx * cx;
  const Iyy = syy / m - cy * cy;
  const Ixy = sxy / m - cx * cy;
  return { m, cx, cy, Ixx, Iyy, Ixy };
}

/**
 * 0 = perfectly straight, 1 = perfectly isotropic.
 *
 * NOTE this is isotropy, not circularity: a square, a diamond and a regular
 * pentagon all score exactly 1.0, the same as a circle. It is only ever a
 * cheap first pass — the residual check is what actually decides.
 *
 * Returns null for a degenerate tensor (all samples coincident). Previously
 * this returned 0, which routed straight into the *destructive* line branch and
 * replaced the stroke with a zero-length or wrongly-oriented line.
 */
function roundness(mo) {
  const tr = mo.Ixx + mo.Iyy;
  if (tr <= 1e-9) return null;
  const r = (4 * (mo.Ixx * mo.Iyy - mo.Ixy * mo.Ixy)) / (tr * tr);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** Principal axis direction of the moment tensor. */
function principalAngle(mo) {
  return 0.5 * Math.atan2(2 * mo.Ixy, mo.Ixx - mo.Iyy);
}

function perpDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Intersection of two lines given as (point, angle). Null if near-parallel.
 *
 * The threshold is angular, not epsilon: rejecting only *exactly* parallel
 * sides let nearly-parallel ones (the two strokes of a capital "U", a
 * strikethrough doubling back) produce a finite but enormous intersection —
 * measured thousands of pixels outside the stroke, which then got written to
 * the document as a spike across the page.
 */
const MIN_INTERSECT_SIN = Math.sin(12 * Math.PI / 180);

function lineIntersect(p1, a1, p2, a2) {
  const d1x = Math.cos(a1), d1y = Math.sin(a1);
  const d2x = Math.cos(a2), d2y = Math.sin(a2);
  const den = d1x * d2y - d1y * d2x;      // = sin(angle between the lines)
  if (Math.abs(den) < MIN_INTERSECT_SIN) return null;
  const t = ((p2.x - p1.x) * d2y - (p2.y - p1.y) * d2x) / den;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** Largest distance from any original sample to the candidate outline. */
function maxResidual(pts, shapePts) {
  if (shapePts.length < 2) return Infinity;
  let worst = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 1; i < shapePts.length; i++) {
      const d = pointSegmentDist(p, shapePts[i - 1], shapePts[i]);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

function pointSegmentDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Split a polyline into straight runs at points of maximum deviation
 * (Ramer–Douglas–Peucker style). Returns indices of the corners, inclusive of
 * the first and last point.
 */
function findCorners(pts, tol) {
  const keep = [0, pts.length - 1];
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let worst = -1, worstD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(pts[i], pts[s], pts[e]);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst > 0) {
      keep.push(worst);
      stack.push([s, worst], [worst, e]);
    }
  }
  return keep.sort((a, b) => a - b);
}

/** Total-least-squares fit of one index range → { point, angle, from, to }. */
function fitSide(pts, from, to) {
  const seg = pts.slice(from, to + 1);
  const mo = moments(seg);
  if (!mo) return null;
  const angle = principalAngle(mo);
  return { c: { x: mo.cx, y: mo.cy }, angle, from, to };
}

const meanPressure = (pts) => {
  if (!pts.length) return 0.5;
  return pts.reduce((a, p) => a + (p.p || 0.5), 0) / pts.length;
};

const normAngle = (a) => {
  // into (-π/2, π/2] — sides are undirected
  while (a <= -Math.PI / 2) a += Math.PI;
  while (a > Math.PI / 2) a -= Math.PI;
  return a;
};

// ─── Shape builders ─────────────────────────────────────────────────────────

/**
 * How much the stroke doubles back along its own principal axis, as a fraction
 * of its span.
 *
 * This is the signal that separates a genuine straight line from the things
 * that merely *measure* straight: an arrow reverses at the head, a bracket
 * reverses at both arms, a word written in a flat hand reverses on every
 * letter. Residual alone cannot catch these — a proportionally small arrowhead
 * stays inside any tolerance loose enough to accept an honestly wobbly line.
 */
function backtrackRatio(pts, angle, c) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let prev = null, back = 0, lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const t = (p.x - c.x) * dx + (p.y - c.y) * dy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
    if (prev !== null && t < prev) back += prev - t;
    prev = t;
  }
  const span = hi - lo;
  if (span < 1e-6) return Infinity;
  // A stroke drawn right-to-left backtracks by definition; measure against
  // whichever direction it actually travelled.
  return Math.min(back, span * 2 - back) / span;
}

/** Max fraction of its own span a stroke may double back and still be a line. */
const LINE_MAX_BACKTRACK = 0.05;

function buildLine(pts, mo, pressure) {
  let angle = principalAngle(mo);
  const c = { x: mo.cx, y: mo.cy };
  // Project every point onto the axis and take the extremes.
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const t = (p.x - c.x) * dx + (p.y - c.y) * dy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  let a = { x: c.x + lo * dx, y: c.y + lo * dy, p: pressure };
  let b = { x: c.x + hi * dx, y: c.y + hi * dy, p: pressure };

  // Snap to exactly horizontal / vertical when close — a hand-drawn "straight"
  // line is almost always meant to be one or the other.
  const deg = Math.abs(normAngle(angle)) / DEG;
  if (deg < AXIS_SNAP_DEG) {
    const y = (a.y + b.y) / 2;
    a = { ...a, y }; b = { ...b, y };
  } else if (Math.abs(deg - 90) < AXIS_SNAP_DEG) {
    const x = (a.x + b.x) / 2;
    a = { ...a, x }; b = { ...b, x };
  }
  return { kind: 'line', points: [a, b] };
}

function buildCircle(pts, mo, pressure) {
  // Length-weighted mean radius and the deviation from it.
  let m = 0, sr = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    m += len;
    sr += len * Math.hypot(mx - mo.cx, my - mo.cy);
  }
  if (!m) return null;
  const r = sr / m;
  if (r < MIN_SIZE / 4) return null;

  let dev = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    dev += len * Math.abs(Math.hypot(mx - mo.cx, my - mo.cy) - r);
  }
  // Scale-invariant: a wobbly small circle scores like a wobbly big one.
  if (dev / (m * r) > CIRCLE_MAX_DEVIATION) return null;

  const n = Math.max(32, Math.round(r));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: mo.cx + r * Math.cos(t), y: mo.cy + r * Math.sin(t), p: pressure });
  }
  return { kind: 'circle', points: out };
}

/**
 * Build a polygon from fitted sides by intersecting consecutive side lines.
 * `forceRight` rewrites every side to the average orientation ± 90°, which is
 * what turns a wobbly hand-drawn box into an exactly square-cornered rectangle.
 */
function buildPolygon(sides, pressure, { forceRight = false, closed = true } = {}) {
  let angles = sides.map(s => s.angle);

  if (forceRight) {
    // Unwrap each side into a common frame, average, then re-impose ±90°.
    const base = normAngle(angles[0]);
    let sum = 0;
    for (let i = 0; i < angles.length; i++) {
      let a = normAngle(angles[i]) - base;
      while (a < -Math.PI / 4) a += Math.PI / 2;
      while (a > Math.PI / 4) a -= Math.PI / 2;
      sum += a;
    }
    let avg = base + sum / angles.length;
    const deg = Math.abs(normAngle(avg)) / DEG;
    if (deg < AXIS_SNAP_DEG) avg = 0;                       // snap upright
    else if (Math.abs(deg - 90) < AXIS_SNAP_DEG) avg = Math.PI / 2;
    angles = sides.map((_, i) => avg + (i % 2) * (Math.PI / 2));
  }

  const corners = [];
  const n = sides.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!closed && j === 0) break;
    const p = lineIntersect(sides[i].c, angles[i], sides[j].c, angles[j]);
    if (!p) return null;
    corners.push({ x: p.x, y: p.y, p: pressure });
  }
  if (corners.length < 2) return null;

  // Corners come out as side[i]∩side[i+1]; rotate so the path starts at the
  // corner *before* the first side, then close it.
  const ordered = [corners[corners.length - 1], ...corners.slice(0, -1)];
  return closed ? [...ordered, { ...ordered[0] }] : ordered;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Try to recognise a shape.
 *
 * @param {{points: {x,y,p}[]}} stroke
 * @returns {{kind: string, points: {x,y,p}[]} | null} null = keep freehand
 */
export function recognizeShape(stroke) {
  const pts = stroke?.points;
  if (!pts || pts.length < 4) return null;

  const bb = bounds(pts);
  const diag = Math.hypot(bb.w, bb.h);
  if (diag < MIN_SIZE) return null;

  const mo = moments(pts);
  if (!mo) return null;

  const pressure = meanPressure(pts);
  const round = roundness(mo);
  if (round === null) return null;   // degenerate tensor — keep the freehand stroke

  const tol = diag * MAX_RESIDUAL_FRACTION;
  /** Accept a candidate only if it genuinely traces what the user drew. */
  const accept = (kind, shapePts) =>
    (shapePts && maxResidual(pts, shapePts) <= tol) ? { kind, points: shapePts } : null;

  // ── Straight line ────────────────────────────────────────────────────────
  if (round < LINE_MAX_ROUNDNESS) {
    // A long thin stroke has a tiny roundness even when it is an arrow, a
    // bracket or a flat-written word, and collapsing those to two points
    // silently deletes the arrowhead / arms / writing. Require both that the
    // stroke tracks the fitted axis (residual) and that it never doubles back
    // along it — the reversal is what those cases all have in common.
    if (backtrackRatio(pts, principalAngle(mo), { x: mo.cx, y: mo.cy }) > LINE_MAX_BACKTRACK) {
      return null;
    }
    return accept('line', buildLine(pts, mo, pressure).points);
  }

  const closed =
    Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
      < diag * CLOSURE_FRACTION;

  // ── Circle ───────────────────────────────────────────────────────────────
  // The residual gate is essential here: `roundness` is 1.0 for a square, a
  // diamond and a regular pentagon just as much as for a circle, and a square's
  // *mean* radial deviation also slips under CIRCLE_MAX_DEVIATION. Only
  // measuring how far the corners actually sit from the fitted circle
  // distinguishes them.
  if (round > CIRCLE_MIN_ROUNDNESS && closed) {
    const circle = buildCircle(pts, mo, pressure);
    const ok = circle && accept('circle', circle.points);
    if (ok) return ok;
  }

  // ── Polygon ──────────────────────────────────────────────────────────────
  if (!closed) return null;   // an open squiggle is not a polygon

  const corners = findCorners(pts, diag * SPLIT_TOL_FRACTION);
  // Drop the duplicate closing corner so sides are counted once.
  const idx = corners.slice();
  const sides = [];
  for (let i = 1; i < idx.length; i++) {
    const s = fitSide(pts, idx[i - 1], idx[i]);
    // Bail rather than silently dropping a side: a dropped side turns a
    // 4-sided shape into a 3-sided one and then intersects sides that were
    // never adjacent.
    if (!s) return null;
    sides.push(s);
  }
  if (sides.length < 3 || sides.length > 5) return null;

  // A closed shape drawn in one stroke usually yields one extra tiny side
  // where the pen returned to the start; drop the shortest if we have 5.
  let use = sides;
  if (sides.length === 5) {
    const lengths = sides.map(s =>
      Math.hypot(pts[s.to].x - pts[s.from].x, pts[s.to].y - pts[s.from].y));
    const min = lengths.indexOf(Math.min(...lengths));
    if (lengths[min] < diag * 0.18) use = sides.filter((_, i) => i !== min);
  }

  if (use.length === 4) {
    // Rectangle if every corner is near 90°.
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const d = Math.abs(normAngle(use[i].angle - use[(i + 1) % 4].angle)) / DEG;
      if (Math.abs(d - 90) > RECT_ANGLE_TOL_DEG) { ok = false; break; }
    }
    if (ok) {
      const rect = accept('rectangle', buildPolygon(use, pressure, { forceRight: true }));
      if (rect) return rect;
    }
    return accept('quadrilateral', buildPolygon(use, pressure));
  }

  if (use.length === 3) {
    return accept('triangle', buildPolygon(use, pressure));
  }

  return null;
}

export const SHAPE_TUNING = {
  MIN_SIZE, LINE_MAX_ROUNDNESS, CIRCLE_MIN_ROUNDNESS,
  CIRCLE_MAX_DEVIATION, RECT_ANGLE_TOL_DEG,
};

// Exported for tests — the scalar the whole classifier hinges on.
export const _internal = { moments, roundness, findCorners };
