/**
 * renderer — draws vector ink to a 2D canvas.
 *
 * The old DrawingCanvas stroked a polyline at a fixed `lineWidth`. That can
 * never look like a pen, because a real nib lays down a ribbon whose width
 * varies along its length. Instead each stroke is converted into a **closed
 * outline polygon** and filled — the boundary of the union of discs centred on
 * each sample. That is the same model Xournal++ fills with Cairo; here
 * `perfect-freehand` (MIT) generates the outline, which saves us hand-rolling
 * the tangent-line/arc/concave-join maths.
 *
 * Rendering notes:
 *  - Ink is stored in authoring pixels; `scale` maps it to the current canvas.
 *  - Highlighter uses `multiply` so overlapping passes darken like a real
 *    marker instead of flatly overwriting.
 *  - The background is drawn to its own layer and never erased, which fixes the
 *    old bug where the pixel eraser punched holes through the ruled lines.
 */

import getStroke from 'perfect-freehand';
import { TOOL, densify } from './strokeModel.js';

// How strongly pressure modulates width (0 = uniform, 1 = extreme taper).
const THINNING = 0.6;

// perfect-freehand's own smoothing. Kept low because stabilizer.js has already
// done the real work — smoothing twice just adds lag.
const STREAMLINE = 0.12;
const SMOOTHING  = 0.4;

const HIGHLIGHTER_ALPHA = 0.4;
const HIGHLIGHTER_SCALE = 6;   // highlighters are much fatter than pens

/** Build the fill outline for one stroke as a Path2D. */
export function strokeToPath2D(stroke, scale = 1) {
  const pts = stroke.points;
  if (!pts.length) return null;

  const size = (stroke.tool === TOOL.HIGHLIGHTER
    ? stroke.size * HIGHLIGHTER_SCALE
    : stroke.size) * scale;

  // Fill in points before outlining: widely-spaced samples (a fast pen on a
  // 60 Hz event stream) make perfect-freehand's ribbon collapse and break up.
  const input = densify(pts, 6 / Math.max(scale, 0.05))
    .map(p => [p.x * scale, p.y * scale, p.p]);

  const outline = getStroke(input, {
    size,
    thinning:   stroke.tool === TOOL.HIGHLIGHTER ? 0 : THINNING,
    smoothing:  SMOOTHING,
    streamline: STREAMLINE,
    simulatePressure: false,   // we supply real (or already-synthesised) pressure
    last: true,
  });
  if (!outline.length) return null;

  const path = new Path2D();
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1]);
  }
  path.closePath();
  return path;
}

/** Draw a single stroke with the right compositing for its tool. */
export function drawStroke(ctx, stroke, scale = 1) {
  const path = strokeToPath2D(stroke, scale);
  if (!path) return;

  ctx.save();
  if (stroke.tool === TOOL.HIGHLIGHTER) {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.fillStyle = stroke.color;
  ctx.fill(path);
  ctx.restore();
}

/** Full redraw of an ink layer. Clears first — background lives elsewhere. */
export function renderStrokes(ctx, strokes, { scale = 1, width, height } = {}) {
  ctx.clearRect(0, 0, width, height);
  for (const stroke of strokes) drawStroke(ctx, stroke, scale);
}

// ─── Backgrounds ────────────────────────────────────────────────────────────
// Config-string driven, mirroring the elegant little system Xournal++ uses for
// page templates: one small set of primitives covers every ruling people ask
// for, and new ones are data, not code.

export const BACKGROUNDS = {
  blank:     { label: 'Blank' },
  ruled:     { label: 'Ruled',        line: 32 },
  rule_marg: { label: 'Ruled + margin', line: 32, margin: 60 },
  grid:      { label: 'Grid',         grid: 24 },
  dotted:    { label: 'Dotted',       dot: 24 },
};

export function drawBackground(ctx, type, width, height, dpr = 1) {
  const cfg = BACKGROUNDS[type] || BACKGROUNDS.blank;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (cfg.line) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = cfg.line; y < height; y += cfg.line) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }
  if (cfg.grid) {
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cfg.grid; x < width; x += cfg.grid) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
    for (let y = cfg.grid; y < height; y += cfg.grid) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
    ctx.stroke();
  }
  if (cfg.dot) {
    ctx.fillStyle = '#cbd5e1';
    for (let x = cfg.dot; x < width; x += cfg.dot) {
      for (let y = cfg.dot; y < height; y += cfg.dot) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (cfg.margin) {
    ctx.strokeStyle = '#f0c8c8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cfg.margin + 0.5, 0);
    ctx.lineTo(cfg.margin + 0.5, height);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Largest backing store we will allocate per canvas layer.
 *
 * A full A4 page at 900 CSS px wide on a 2× display is 1800×2546 ≈ 4.6 M
 * pixels, i.e. ~18 MB — and the engine keeps three layers (visible, background,
 * committed ink), so ~55 MB that the browser must re-composite whenever
 * anything changes. On an iPad that is the dominant cost of writing, no matter
 * how small a region we actually repaint.
 *
 * Capping the total resolves it. Ink is antialiased vector art, so a slightly
 * lower device ratio costs very little visible sharpness; the alternative —
 * a smaller page — costs writing space, which is worse.
 */
const MAX_BACKING_PIXELS = 2.6e6;

/** Device ratio to use for a page of this size, reduced if it would be huge. */
export function effectiveDpr(cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const area = Math.max(1, cssWidth * cssHeight);
  const capped = Math.sqrt(MAX_BACKING_PIXELS / area);
  // Never go below 1 — that would be blurrier than the CSS size itself.
  return Math.max(1, Math.min(dpr, capped));
}

/**
 * Size a canvas for the device pixel ratio and return the context, pre-scaled
 * so all drawing can be done in CSS pixels.
 */
export function setupCanvas(canvas, cssWidth, cssHeight) {
  const dpr = effectiveDpr(cssWidth, cssHeight);
  canvas.width  = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width  = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';

  // `desynchronized` asks the browser to bypass a step of its normal
  // compositing for this canvas — the low-latency path added specifically for
  // stylus drawing. It is the one lever that targets pen-to-ink delay itself
  // rather than how fast we draw, which measurement showed was never the
  // problem. Harmless where unsupported: the option is simply ignored.
  let ctx = null;
  try { ctx = canvas.getContext('2d', { desynchronized: true }); } catch { /* older engines */ }
  if (!ctx) ctx = canvas.getContext('2d');

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, dpr };
}
