/**
 * inkHtml — embedding vector ink inside the diary's contentEditable HTML.
 *
 * Design: an ink block is a single element carrying its own vector payload.
 *
 *   <div class="ddiary-ink" contenteditable="false"
 *        data-ink="<base64 json>" data-w="640" data-h="220"><canvas/></div>
 *
 * Storing the vector *in the content string* rather than in a separate field
 * is deliberate — `entry.content` is already the unit that version history
 * snapshots, shared diaries sync, autosave persists and drafts cache. Ink
 * therefore inherits all of that for free, with no new Firestore field, no
 * migration, and no way for ink and text to drift out of sync.
 *
 * The `<canvas>` child is the reason this stays cheap: `innerHTML` serialises a
 * canvas as an empty tag and *never* its bitmap, so a hydrated block costs ~40
 * extra bytes in storage while still rendering. No strip-before-save step is
 * needed anywhere in the save path.
 *
 * Size: ~1–3 KB for a signature, ~9 KB for a dense scribble, against
 * Firestore's 1 MiB per-document budget which `content` shares with the text.
 * `contentInkBytes()` lets callers warn before that becomes a problem.
 */

import { deserialize } from './strokeModel.js';
import { drawStroke } from './renderer.js';

export const INK_CLASS = 'ddiary-ink';
export const INK_ATTR  = 'data-ink';

// ─── payload encoding ───────────────────────────────────────────────────────
// base64 so the JSON can live in an HTML attribute without quote-escaping
// hazards through innerHTML round-trips.

export function encodeInk(doc) {
  const json = JSON.stringify(doc);
  const bytes = new TextEncoder().encode(json);   // UTF-8 safe
  // Convert in chunks. Spreading the whole array into String.fromCharCode puts
  // one argument on the stack per byte and throws RangeError past ~100 KB on
  // V8 — and lower on JavaScriptCore, i.e. exactly the iPad + Pencil case this
  // feature exists for. A dense page of handwriting clears that easily, and the
  // throw happened on the insert path, losing the entire drawing.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeInk(b64) {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Build the HTML string for a new ink block, ready for insertHTML. */
export function inkBlockHtml(doc) {
  const w = doc.w || 640;
  const h = doc.h || 220;
  return (
    `<div class="${INK_CLASS}" contenteditable="false" ` +
    `${INK_ATTR}="${encodeInk(doc)}" data-w="${w}" data-h="${h}"></div>`
  );
}

// ─── rendering ──────────────────────────────────────────────────────────────

// Below this, a measured width is assumed to be a not-yet-laid-out element
// rather than a genuinely narrow column.
const MIN_SENSIBLE_WIDTH = 50;

/**
 * Find a usable width by walking up to the first laid-out ancestor.
 *
 * Necessary because hydration can run from a MutationObserver, whose callback
 * is a microtask that fires before the browser has laid out the nodes just
 * inserted — at which point the block's own clientWidth is meaningless (it
 * measured 24px in practice, rendering handwriting as a sliver).
 */
function measureAvailableWidth(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    // clientWidth includes padding; the space actually available to a child is
    // the content box, so strip it or the canvas overflows its container.
    let w = node.clientWidth;
    if (w >= MIN_SENSIBLE_WIDTH) {
      try {
        const cs = getComputedStyle(node);
        w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      } catch { /* non-rendered node — use clientWidth as-is */ }
      // Leave room for the block's own 1px borders.
      if (w >= MIN_SENSIBLE_WIDTH) return w - 2;
    }
    node = node.parentElement;
  }
  return 0;
}

/**
 * Draw one ink block's strokes into a canvas sized to the element's width,
 * preserving the authored aspect ratio.
 */
export function renderInkInto(el, { maxWidth, _retry = false } = {}) {
  const payload = el.getAttribute(INK_ATTR);
  if (!payload) return;
  const doc = decodeInk(payload);
  if (!doc) return;

  const { strokes, width: aw, height: ah } = deserialize(doc);
  const authorW = aw || Number(el.dataset.w) || 640;
  const authorH = ah || Number(el.dataset.h) || 220;

  let available = maxWidth || measureAvailableWidth(el);
  if (!available) {
    // Nothing is laid out yet (block inserted this microtask). Draw at the
    // authored size now so it is never invisible, and re-measure next frame.
    available = authorW;
    if (!_retry && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        try { renderInkInto(el, { _retry: true }); } catch { /* ignore */ }
      });
    }
  }

  const cssW  = Math.min(available, authorW);
  const scale = cssW / authorW;
  const cssH  = authorH * scale;

  let canvas = el.querySelector('canvas');
  const dpr = window.devicePixelRatio || 1;

  // Get a context BEFORE attaching anything. If context creation fails (iOS
  // Safari's per-page canvas memory cap, or context loss), we must not leave an
  // empty canvas behind — it would look like a blank drawing and, worse, mark
  // the block as rendered so it never retried.
  const probe = canvas || document.createElement('canvas');
  probe.width  = Math.max(1, Math.round(cssW * dpr));
  probe.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = probe.getContext('2d');
  if (!ctx) return;

  if (!canvas) {
    canvas = probe;
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    el.appendChild(canvas);
  }
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  for (const s of strokes) drawStroke(ctx, s, scale);

  // Record what was drawn as a JS property, deliberately NOT an attribute:
  // properties do not survive an innerHTML round trip, so after a reload,
  // undo/redo, history restore or remote sync the block is correctly treated as
  // needing a redraw — while during ordinary typing it is skipped as already
  // current. Keying on canvas *presence* instead left every reopened entry
  // showing a blank box, because the canvas element survives serialisation
  // (only its bitmap does not).
  el.__inkRenderedFor = payload;
  el.__inkRenderedWidth = cssW;
}

/**
 * Hydrate every ink block inside `root`. Safe to call repeatedly — it reuses
 * an existing canvas rather than stacking new ones.
 */
export function hydrateInkBlocks(root) {
  if (!root) return;
  root.querySelectorAll(`.${INK_CLASS}[${INK_ATTR}]`).forEach(el => {
    try { renderInkInto(el); } catch { /* a bad block must not break the page */ }
  });
}

/**
 * Hydrate blocks whose drawn output is missing or out of date.
 *
 * Safe to call from a MutationObserver. Re-rendering an existing canvas only
 * touches attributes, and the observer watches `childList` only, so the single
 * canvas append is the one mutation that re-triggers it — and on that second
 * pass the block is already current, so the loop terminates.
 *
 * This covers every path that assigns innerHTML (initial load, version-history
 * restore, undo/redo, live collaborative sync) without patching each one.
 */
export function hydratePendingInkBlocks(root) {
  if (!root) return 0;
  let n = 0;
  root.querySelectorAll(`.${INK_CLASS}[${INK_ATTR}]`).forEach(el => {
    const payload = el.getAttribute(INK_ATTR);
    // Already drawn for this exact payload at this width → nothing to do.
    if (el.__inkRenderedFor === payload && el.querySelector('canvas')) return;
    try { renderInkInto(el); n++; } catch { /* never break the editor */ }
  });
  return n;
}

// ─── inspection ─────────────────────────────────────────────────────────────

/** Total bytes of ink payload in a content string — for size warnings. */
export function contentInkBytes(html) {
  if (!html) return 0;
  let total = 0;
  const re = new RegExp(`${INK_ATTR}="([^"]*)"`, 'g');
  let m;
  while ((m = re.exec(html))) total += m[1].length;
  return total;
}

/** Extract every ink block from a content string (used by PDF export). */
export function extractInkBlocks(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return [...doc.querySelectorAll(`.${INK_CLASS}[${INK_ATTR}]`)]
    .map(el => decodeInk(el.getAttribute(INK_ATTR)))
    .filter(Boolean);
}
