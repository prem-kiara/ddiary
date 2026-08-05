/**
 * inkPdf — draw vector ink into a jsPDF document.
 *
 * Ink is emitted as real filled vector paths, not a rasterised screenshot, so
 * handwriting stays crisp at any zoom and print resolution and adds only a few
 * KB to the file. This is the payoff for storing strokes as vectors rather than
 * the PNGs the legacy drawing feature produced.
 *
 * Coordinates: strokes are authored in CSS pixels; jsPDF here works in mm.
 */

import getStroke from 'perfect-freehand';
import { deserialize, TOOL, densify } from './strokeModel.js';

const PX_TO_MM = 25.4 / 96;

/** '#rrggbb' → [r, g, b]; falls back to near-black. */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return [26, 26, 46];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Measure the rendered size of an ink document without drawing it.
 * @returns {{ width: number, height: number }} in mm
 */
export function measureInk(inkDoc, maxWidthMm) {
  const { width: aw, height: ah } = deserialize(inkDoc);
  const authorW = aw || 640;
  const authorH = ah || 220;
  // Fit the available width, but never upscale past the natural on-screen size.
  const width = Math.min(maxWidthMm, authorW * PX_TO_MM);
  return { width, height: authorH * (width / authorW) };
}

/**
 * Draw an ink document at (x, y) in mm.
 * @returns {number} height consumed, in mm
 */
export function drawInkToPdf(doc, inkDoc, { x, y, maxWidthMm }) {
  const { strokes, width: aw, height: ah } = deserialize(inkDoc);
  const authorW = aw || 640;
  const authorH = ah || 220;
  const targetW = Math.min(maxWidthMm, authorW * PX_TO_MM);
  const scale   = targetW / authorW;          // mm per authoring px
  const targetH = authorH * scale;

  if (!strokes.length) return targetH;

  const hasGState = typeof doc.GState === 'function' && typeof doc.setGState === 'function';

  for (const stroke of strokes) {
    const isHl = stroke.tool === TOOL.HIGHLIGHTER;
    const size = isHl ? stroke.size * 6 : stroke.size;

    const outline = getStroke(
      // Same densification as on screen — a sparse fast stroke would otherwise
      // export as a broken-up ribbon.
      densify(stroke.points).map(p => [p.x, p.y, p.p]),
      {
        size,
        thinning:   isHl ? 0 : 0.6,
        smoothing:  0.4,
        streamline: 0.12,
        simulatePressure: false,
        last: true,
      }
    );
    if (outline.length < 3) continue;

    // Outline is in authoring px → convert to mm and make relative for doc.lines
    const first = [x + outline[0][0] * scale, y + outline[0][1] * scale];
    const deltas = [];
    for (let i = 1; i < outline.length; i++) {
      deltas.push([
        (outline[i][0] - outline[i - 1][0]) * scale,
        (outline[i][1] - outline[i - 1][1]) * scale,
      ]);
    }

    const [r, g, b] = hexToRgb(stroke.color);
    doc.setFillColor(r, g, b);

    if (isHl && hasGState) doc.setGState(new doc.GState({ opacity: 0.4 }));
    try {
      doc.lines(deltas, first[0], first[1], [1, 1], 'F', true);
    } catch { /* a malformed stroke must never abort the export */ }
    if (isHl && hasGState) doc.setGState(new doc.GState({ opacity: 1 }));
  }

  return targetH;
}
