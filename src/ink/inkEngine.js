/**
 * inkEngine — orchestrates capture → pressure → stabilise → store → render.
 *
 * This is the shared core behind every inking surface in the app (inline diary
 * blocks, full-page notes, PDF/document markup). Surfaces supply a canvas and a
 * tool; the engine owns stroke state, undo and painting.
 *
 * Performance model: committed strokes are rendered once into an offscreen
 * canvas and blitted each frame, so cost per frame is one drawImage plus the
 * single in-progress stroke — not a full re-render of every stroke ever drawn.
 *
 * Undo is a **command stack**, not bitmap snapshots. The old DrawingCanvas kept
 * 30 full PNG data-URLs in memory, which was both heavy and lossy (it could not
 * restore vector state). Commands are tiny and exact.
 */

import { attachPointerCapture, DEVICE_POLICY } from './pointerCapture.js';
import { createPressureResolver } from './pressure.js';
import { createStabilizer, STABILIZER_PRESETS } from './stabilizer.js';
import {
  TOOL, createStroke, addPoint, serialize, deserialize,
  hitTestStroke, splitStrokeAt, estimateSize, strokeBounds,
} from './strokeModel.js';
import { drawStroke, renderStrokes, drawBackground, setupCanvas } from './renderer.js';
import { recognizeShape } from './shapeRecognition.js';

export const ERASER_MODE = {
  STROKE: 'stroke',  // remove whole strokes — fast, predictable
  SPLIT:  'split',   // erase just the touched part, splitting strokes in two
};

export function createInkEngine({
  canvas,
  width,
  height,
  background = 'ruled',
  onChange,          // (strokes) => void, fired after each committed edit
}) {
  const { ctx, dpr } = setupCanvas(canvas, width, height);

  // Offscreen layers: background never changes; committed ink changes on edit.
  const bgCanvas = document.createElement('canvas');
  const inkCanvas = document.createElement('canvas');
  for (const c of [bgCanvas, inkCanvas]) {
    c.width = canvas.width;
    c.height = canvas.height;
  }
  const bgCtx = bgCanvas.getContext('2d');
  const inkCtx = inkCanvas.getContext('2d');
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let strokes = [];
  let undoStack = [];
  let redoStack = [];

  let tool = { type: TOOL.PEN, color: '#1a1a2e', size: 2 };
  let eraser = { active: false, mode: ERASER_MODE.SPLIT, size: 12 };
  let policy = DEVICE_POLICY.AUTO;
  let stabilizerCfg = STABILIZER_PRESETS.medium;
  let shapeMode = false;
  let prediction = true;   // latency hiding — see liveRenderStroke()

  // In-progress stroke state
  let live = null;
  let stabilizer = null;
  let pressureResolver = null;
  let rafPending = false;
  // Time from the pen touching down to the frame that first shows its ink.
  // This is the number that actually corresponds to "it feels laggy".
  let strokeDownAt = 0;
  let lastInkLatency = 0;
  let rafHandle = 0;
  let destroyed = false;

  drawBackground(bgCtx, background, width, height, dpr);
  repaint();

  // ─── Painting ─────────────────────────────────────────────────────────────

  function redrawInkLayer() {
    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    inkCtx.restore();
    for (const s of strokes) drawStroke(inkCtx, s, 1);
  }

  /**
   * Repaint the whole surface.
   *
   * This deliberately does NOT do dirty-rectangle painting any more. That
   * optimisation clipped the live stroke to a computed region each frame and
   * left white gaps through fast strokes — the background showing through where
   * a region had been cleared but not fully redrawn. It was also solving a
   * problem that measurement showed did not exist: on the target device this
   * runs at 60 fps with ~18 ms pen-to-ink latency, full repaint and all, once
   * the backing store is capped (see effectiveDpr).
   *
   * Correct ink matters more than a saved millisecond. If profiling ever shows
   * the full repaint is genuinely too slow, the safe route is a separate
   * overlay canvas for the live stroke, not clipping.
   */
  function repaint() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.drawImage(inkCanvas, 0, 0);
    ctx.restore();
    const shown = liveRenderStroke();
    if (shown) drawStroke(ctx, shown, 1);
  }

  /**
   * The stroke as it should appear *right now*, including a catch-up tail to
   * the pen's true position.
   *
   * Stabilisation inherently trails the nib, and the velocity-weighted averager
   * smooths hardest at low speed — which is exactly what the beginning of every
   * stroke is. So the ink lagged most just after the pen was put down, which
   * reads as "it lags when I lift and start the next word" even at a perfect
   * 60 fps: the problem was never frame rate, it was input-to-ink distance.
   *
   * finalize() already computes a tangent-continuous spline from the last
   * smoothed point to the true raw one — it was only being used at pen-up.
   * Running it per frame for *rendering* keeps the nib and the ink together
   * while the committed geometry stays exactly as smooth as before.
   */
  function liveRenderStroke() {
    if (!live || !live.points.length) return null;
    if (!stabilizer) return live;
    let tail = [];
    try {
      // Aim the tail at where the pen is heading, not where it last reported.
      // Even a perfect pipeline holds a sample that is already a frame old, so
      // without this the ink trails further the faster you write. Prediction
      // returns null through corners and at low speed, and the tail then ends
      // at the true position as before.
      const aim = prediction ? stabilizer.predict() : null;
      tail = stabilizer.finalize(live.points, aim) || [];
    } catch { tail = []; }
    return tail.length ? { ...live, points: live.points.concat(tail) } : live;
  }

  /**
   * Request a repaint on the next frame.
   *
   * Callers may still pass a region for readability; it is ignored. Region
   * painting is gone — see repaint() for why.
   */
  function scheduleRepaint() {
    if (destroyed || rafPending) return;
    rafPending = true;
    rafHandle = requestAnimationFrame(() => {
      rafPending = false;
      if (destroyed) return;
      repaint();
      if (strokeDownAt) { lastInkLatency = performance.now() - strokeDownAt; strokeDownAt = 0; }
    });
  }

  // ─── Edits (all undoable) ─────────────────────────────────────────────────

  function apply(cmd) {
    undoStack.push(cmd);
    redoStack.length = 0;
    runCommand(cmd, false);
    // Committing a stroke only *adds* ink, so draw it straight onto the layer
    // rather than re-rendering every stroke on the page. Redrawing everything
    // made each new stroke cost more than the last, so a page slowed down as
    // it filled up — exactly when writing needs to stay responsive.
    if (cmd.added?.length && !cmd.removed?.length) {
      for (const s of cmd.added) drawStroke(inkCtx, s, 1);
      scheduleRepaint();
    } else {
      redrawInkLayer();
      scheduleRepaint();
    }
    onChange?.(strokes);
  }

  function runCommand(cmd, invert) {
    const add = invert ? cmd.removed : cmd.added;
    const remove = invert ? cmd.added : cmd.removed;
    if (remove?.length) strokes = strokes.filter(s => !remove.includes(s));
    if (add?.length) strokes = strokes.concat(add);
  }

  // ─── Eraser ───────────────────────────────────────────────────────────────

  function eraseAt(x, y) {
    const r = eraser.size / 2;
    const removed = [];
    const added = [];

    for (const s of strokes) {
      if (!hitTestStroke(s, x, y, r)) continue;
      if (eraser.mode === ERASER_MODE.SPLIT) {
        const pieces = splitStrokeAt(s, x, y, r);
        // splitStrokeAt returns the original reference when nothing was cut.
        // Treating that as a hit would remove and re-append the same stroke,
        // churning z-order for no visual change.
        if (pieces.length === 1 && pieces[0] === s) continue;
        added.push(...pieces);
      }
      removed.push(s);
    }
    if (!removed.length) return null;
    return { added, removed };
  }

  // ─── Stroke lifecycle ─────────────────────────────────────────────────────

  // A single eraser swipe fires many erase steps, and each one can split a
  // stroke that a later step splits again. Recording every intermediate would
  // make undo restore fragments that no longer exist, so instead we snapshot
  // the stroke list at swipe start and record only the *net* diff on release.
  let eraseSnapshot = null;

  function eraseStep(x, y) {
    const hit = eraseAt(x, y);
    if (!hit) return;
    strokes = strokes.filter(s => !hit.removed.includes(s)).concat(hit.added);
  }

  function onStart(sample) {
    if (eraser.active) {
      eraseSnapshot = strokes.slice();
      eraseStep(sample.x, sample.y);
      redrawInkLayer();
      scheduleRepaint();
      return;
    }

    strokeDownAt = performance.now();
    stabilizer = createStabilizer(stabilizerCfg);
    pressureResolver = createPressureResolver({});
    live = createStroke({ tool: tool.type, color: tool.color, size: tool.size });

    const p = pressureResolver.resolve(sample);
    if (p < 0) return;
    const out = stabilizer.push({ ...sample, p });
    if (out) addPoint(live, out);
    scheduleRepaint();
  }

  function onMove(batch) {
    if (eraser.active) {
      for (const s of batch) eraseStep(s.x, s.y);
      redrawInkLayer();
      scheduleRepaint();
      return;
    }
    if (!live) return;

    for (const sample of batch) {
      const p = pressureResolver.resolve(sample);
      if (p < 0) continue;
      const out = stabilizer.push({ ...sample, p });
      if (out) addPoint(live, out);
    }
    scheduleRepaint();
  }

  function onEnd() {
    if (eraser.active) {
      if (eraseSnapshot) {
        // Net diff only — see the note on eraseSnapshot above.
        const before  = eraseSnapshot;
        const removed = before.filter(s => !strokes.includes(s));
        const added   = strokes.filter(s => !before.includes(s));
        if (removed.length || added.length) {
          undoStack.push({ added, removed });
          redoStack.length = 0;
          onChange?.(strokes);
        }
      }
      eraseSnapshot = null;
      return;
    }
    if (!live) return;

    // Close the lag gap left by stabilisation.
    for (const pt of stabilizer.finalize(live.points)) addPoint(live, pt);

    // Shape mode: snap to a clean primitive if the stroke clearly is one.
    // Recognition returning null means "keep the freehand stroke", so an
    // unrecognised scribble is never damaged.
    if (shapeMode && live.points.length > 3) {
      const shape = recognizeShape(live);
      if (shape) {
        live.points = shape.points;
        live.shape = shape.kind;
      }
    }

    const committed = live;
    live = null;
    stabilizer = null;
    pressureResolver = null;

    if (committed.points.length) {
      apply({ added: [committed], removed: [] });
    } else {
      scheduleRepaint();
    }
  }

  function onCancel() {
    // Only the discarded stroke's area needs restoring. This path runs on every
    // palm-then-pen handover — i.e. potentially each time the hand is
    // repositioned for a new word — so a full-page repaint here showed up as a
    // stutter exactly when lifting the pen.
    live = null;
    stabilizer = null;
    pressureResolver = null;
    // Roll the swipe back — a cancelled gesture must not erase anything.
    if (eraseSnapshot) {
      strokes = eraseSnapshot;
      eraseSnapshot = null;
      redrawInkLayer();
      scheduleRepaint();
      return;
    }
    scheduleRepaint();
  }

  const capture = attachPointerCapture(canvas, {
    onStart, onMove, onEnd, onCancel,
    getPolicy: () => policy,
  });

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    setTool(next)      { tool = { ...tool, ...next }; eraser.active = false; },
    setEraser(next)    { eraser = { ...eraser, ...next }; },
    setPolicy(p)       { policy = p; },
    setShapeMode(on)   { shapeMode = !!on; },
    setPrediction(on)  { prediction = !!on; },
    setStabilizer(cfg) { stabilizerCfg = typeof cfg === 'string' ? STABILIZER_PRESETS[cfg] : cfg; },
    setBackground(type) {
      drawBackground(bgCtx, type, width, height, dpr);
      scheduleRepaint();
    },

    undo() {
      const cmd = undoStack.pop();
      if (!cmd) return;
      redoStack.push(cmd);
      runCommand(cmd, true);
      redrawInkLayer();
      scheduleRepaint();
      onChange?.(strokes);
    },
    redo() {
      const cmd = redoStack.pop();
      if (!cmd) return;
      undoStack.push(cmd);
      runCommand(cmd, false);
      redrawInkLayer();
      scheduleRepaint();
      onChange?.(strokes);
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    clear() {
      if (!strokes.length) return;
      apply({ added: [], removed: [...strokes] });
    },

    /** Diagnostics for the ?perf=1 readout. */
    getStats: () => ({ ...capture.stats, inkLatencyMs: Math.round(lastInkLatency) }),

    getStrokes:  () => strokes,
    isEmpty:     () => strokes.length === 0,
    toJSON:      () => serialize(strokes, width, height),
    estimateSize:() => estimateSize(strokes),
    loadJSON(doc) {
      strokes = deserialize(doc).strokes;
      undoStack = []; redoStack = [];
      redrawInkLayer();
      scheduleRepaint();
    },
    /** Flattened raster, for email embedding and legacy-style previews. */
    toPNG() { return canvas.toDataURL('image/png'); },

    /**
     * Tear everything down. Cancelling the pending frame matters: rAF callbacks
     * do not run while a tab is hidden, so a frame queued at unmount would pin
     * the whole engine closure — including two offscreen canvases, ~10 MB each
     * at 3× DPR — until the tab was foregrounded again.
     */
    destroy() {
      destroyed = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      capture.detach();
      bgCanvas.width = bgCanvas.height = 0;
      inkCanvas.width = inkCanvas.height = 0;
    },
  };
}

export { TOOL, DEVICE_POLICY, STABILIZER_PRESETS };
