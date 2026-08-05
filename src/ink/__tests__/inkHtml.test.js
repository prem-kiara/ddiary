/**
 * Tests for embedding ink in diary content HTML and exporting it to PDF.
 *
 * The property that matters most: a drawing must survive the full storage
 * round trip — encode → content HTML → Firestore string → parse → decode —
 * byte-for-byte, because `content` is the only place the vector is kept.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  encodeInk, decodeInk, inkBlockHtml, extractInkBlocks,
  contentInkBytes, hydratePendingInkBlocks, INK_CLASS, INK_ATTR,
} from '../inkHtml.js';
import { measureInk, drawInkToPdf } from '../inkPdf.js';
import { createStroke, addPoint, serialize, TOOL } from '../strokeModel.js';

function sampleDoc() {
  const s = createStroke({ tool: TOOL.PEN, color: '#1a1a2e', size: 2.2 });
  for (let i = 0; i < 40; i++) {
    addPoint(s, { x: i * 6, y: 60 + Math.sin(i / 4) * 20, p: 0.4 + (i % 5) * 0.1 });
  }
  const h = createStroke({ tool: TOOL.HIGHLIGHTER, color: '#fde047', size: 3 });
  for (let i = 0; i < 10; i++) addPoint(h, { x: i * 20, y: 100, p: 0.7 });
  return serialize([s, h], 640, 220);
}

describe('ink ⇄ content HTML', () => {
  it('round-trips a document through base64 exactly', () => {
    const doc = sampleDoc();
    expect(decodeInk(encodeInk(doc))).toEqual(doc);
  });

  it('decodeInk returns null on corrupt input rather than throwing', () => {
    expect(decodeInk('not-base64!!')).toBeNull();
    expect(decodeInk('')).toBeNull();
    expect(decodeInk(btoa('{"broken":'))).toBeNull();
  });

  it('produces a block that survives an innerHTML round trip', () => {
    const doc = sampleDoc();
    const host = document.createElement('div');
    host.innerHTML = `<p>before</p>${inkBlockHtml(doc)}<p>after</p>`;

    // Simulate the save path: read innerHTML back out, as handleSave does.
    const saved = host.innerHTML;
    const reloaded = document.createElement('div');
    reloaded.innerHTML = saved;

    const el = reloaded.querySelector(`.${INK_CLASS}`);
    expect(el).toBeTruthy();
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(decodeInk(el.getAttribute(INK_ATTR))).toEqual(doc);
  });

  it('extracts every block from a content string', () => {
    const doc = sampleDoc();
    const html = `<p>a</p>${inkBlockHtml(doc)}<p>b</p>${inkBlockHtml(doc)}`;
    const found = extractInkBlocks(html);
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual(doc);
  });

  it('reports payload size so callers can warn near the 1 MiB doc limit', () => {
    const html = inkBlockHtml(sampleDoc());
    const bytes = contentInkBytes(html);
    expect(bytes).toBeGreaterThan(100);
    expect(contentInkBytes('<p>no ink here</p>')).toBe(0);
  });

  it('hydrate only touches blocks without a canvas (so the observer terminates)', () => {
    const doc = sampleDoc();
    const host = document.createElement('div');
    host.innerHTML = inkBlockHtml(doc);
    document.body.appendChild(host);

    const el = host.querySelector(`.${INK_CLASS}`);
    // jsdom has no 2D context, so renderInkInto throws internally and is
    // swallowed; what we assert is the *selection* behaviour.
    hydratePendingInkBlocks(host);

    // Give it a canvas and confirm a second pass reports nothing pending.
    el.appendChild(document.createElement('canvas'));
    expect(hydratePendingInkBlocks(host)).toBe(0);

    host.remove();
  });

  it('a malformed block never breaks hydration of the page', () => {
    const host = document.createElement('div');
    host.innerHTML =
      `<div class="${INK_CLASS}" ${INK_ATTR}="garbage"></div>` + inkBlockHtml(sampleDoc());
    expect(() => hydratePendingInkBlocks(host)).not.toThrow();
  });
});

describe('ink → PDF', () => {
  it('measures to the available width without upscaling past natural size', () => {
    const doc = sampleDoc();                      // authored 640 × 220 px
    const wide = measureInk(doc, 500);            // 500 mm of room
    // 640px ≈ 169mm at 96dpi — must not stretch to 500mm.
    expect(wide.width).toBeLessThan(200);
    expect(wide.height / wide.width).toBeCloseTo(220 / 640, 3);

    const narrow = measureInk(doc, 80);           // constrained column
    expect(narrow.width).toBe(80);
    expect(narrow.height).toBeCloseTo(80 * 220 / 640, 3);
  });

  it('emits filled vector paths (not a raster image)', () => {
    const doc = sampleDoc();
    const calls = { lines: [], fills: [], images: 0 };
    const mockPdf = {
      setFillColor: (...a) => calls.fills.push(a),
      lines: (deltas, x, y, scale, style, closed) =>
        calls.lines.push({ n: deltas.length, x, y, style, closed }),
      addImage: () => { calls.images++; },
      GState: function GState(o) { return o; },
      setGState: () => {},
    };

    const h = drawInkToPdf(mockPdf, doc, { x: 18, y: 40, maxWidthMm: 170 });

    expect(h).toBeGreaterThan(0);
    expect(calls.images).toBe(0);                 // must NOT rasterise
    expect(calls.lines.length).toBe(2);           // one path per stroke
    for (const l of calls.lines) {
      expect(l.style).toBe('F');                  // filled
      expect(l.closed).toBe(true);                // closed outline
      expect(l.n).toBeGreaterThan(3);
    }
    // Colour is applied per stroke.
    expect(calls.fills[0]).toEqual([26, 26, 46]); // #1a1a2e
  });

  it('survives a stroke that jsPDF rejects', () => {
    const doc = sampleDoc();
    const mockPdf = {
      setFillColor: () => {},
      lines: () => { throw new Error('bad path'); },
      GState: function GState(o) { return o; },
      setGState: () => {},
    };
    expect(() => drawInkToPdf(mockPdf, doc, { x: 0, y: 0, maxWidthMm: 170 })).not.toThrow();
  });

  it('renders nothing but still reserves height for an empty drawing', () => {
    const empty = { v: 1, w: 640, h: 220, s: [] };
    const mockPdf = { setFillColor: vi.fn(), lines: vi.fn() };
    const h = drawInkToPdf(mockPdf, empty, { x: 0, y: 0, maxWidthMm: 170 });
    expect(mockPdf.lines).not.toHaveBeenCalled();
    expect(h).toBeGreaterThan(0);
  });
});
