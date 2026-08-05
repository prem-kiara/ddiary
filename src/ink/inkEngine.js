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

  // In-progress stroke state
  let live = null;
  let stabilizer = null;
  let pressureResolver = null;
  let rafPending = false;
  let partialPending = false;
  let pendingFull = false;
  let pendingBox = null;
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
   * Repaint, optionally only within `region` (CSS px).
   *
   * A full repaint clears and blits two canvases the size of the page — on an
   * A4 sheet at 2× DPR that is ~14 MB of pixel traffic *per frame*, which is
   * what made writing lag on a tablet. While a stroke is in progress only the
   * area that stroke covers can have changed, and for a handwritten letter
   * that is a small box, so the per-frame cost becomes negligible.
   */
  function repaint(region) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (region) {
      const pad = 3;   // cover the stroke's own width and antialiasing
      const x = Math.max(0, Math.floor((region.minX - pad) * dpr));
      const y = Math.max(0, Math.floor((region.minY - pad) * dpr));
      const w = Math.min(canvas.width  - x, Math.ceil((region.maxX - region.minX + pad * 2) * dpr));
      const h = Math.min(canvas.height - y, Math.ceil((region.maxY - region.minY + pad * 2) * dpr));
      if (w <= 0 || h <= 0) { ctx.restore(); return; }

      ctx.clearRect(x, y, w, h);
      ctx.drawImage(bgCanvas,  x, y, w, h, x, y, w, h);
      ctx.drawImage(inkCanvas, x, y, w, h, x, y, w, h);
      ctx.restore();

      if (live && live.points.length) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x / dpr, y / dpr, w / dpr, h / dpr);
        ctx.clip();
        drawStroke(ctx, live, 1);
        ctx.restore();
      }
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.drawImage(inkCanvas, 0, 0);
    ctx.restore();
    if (live && live.points.length) drawStroke(ctx, live, 1);
  }

  function unionBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    };
  }

  /**
   * Request a repaint.
   *
   * @param {'live'|{minX,minY,maxX,maxY}} [arg]
   *   'live'  — only the in-progress stroke's area
   *   a box   — only that area (used when a finished stroke is committed)
   *   omitted — the whole page (undo, erase, load, background change)
   *
   * Getting this right matters at stroke *boundaries*: pen-down and pen-up used
   * to force full-page repaints, so lifting the pen to dot an "i" cost two
   * page-sized blits even though only a few pixels had changed. Continuous
   * writing felt fine because only onMove was optimised.
   */
  function scheduleRepaint(arg) {
    if (destroyed) return;
    if (arg === 'live') partialPending = true;
    else if (arg && typeof arg === 'object') pendingBox = unionBox(pendingBox, arg);
    else pendingFull = true;

    if (rafPending) return;
    rafPending = true;
    rafHandle = requestAnimationFrame(() => {
      rafPending = false;
      if (destroyed) return;

      let region = null;
      if (!pendingFull) {
        region = pendingBox;
        // Union in the live stroke's *current* extent — more points may have
        // arrived since the request was made.
        if (partialPending && live) region = unionBox(region, strokeBounds(live));
        if (!region) region = null;
      }
      const full = pendingFull || !region;
      pendingFull = false; pendingBox = null; partialPending = false;
      repaint(full ? null : region);
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
      let box = null;
      for (const s of cmd.added) {
        drawStroke(inkCtx, s, 1);
        box = unionBox(box, strokeBounds(s));
      }
      // Committing only changes the area the new stroke covers — repainting the
      // whole page here is what made lifting the pen (to dot an i, or start a
      // new letter) lag even though writing itself was smooth.
      scheduleRepaint(box || undefined);
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

    stabilizer = createStabilizer(stabilizerCfg);
    pressureResolver = createPressureResolver({});
    live = createStroke({ tool: tool.type, color: tool.color, size: tool.size });

    const p = pressureResolver.resolve(sample);
    if (p < 0) return;
    const out = stabilizer.push({ ...sample, p });
    if (out) addPoint(live, out);
    // Pen-down only puts one point on screen — no reason to repaint the page.
    scheduleRepaint('live');
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
    // Only the in-progress stroke changed — repaint just its area.
    scheduleRepaint('live');
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
    live = null;
    stabilizer = null;
    pressureResolver = null;
    // Roll the swipe back — a cancelled gesture must not erase anything.
    if (eraseSnapshot) {
      strokes = eraseSnapshot;
      eraseSnapshot = null;
      redrawInkLayer();
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
