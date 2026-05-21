/**
 * listUtils.js — list detection, renumbering, and text normalization.
 *
 * All pure DOM utilities — no React imports.  Import these wherever list
 * logic is needed so the behaviour is defined in ONE place and every caller
 * gets the same rules.
 */

import { getIndentLevel } from './cursorUtils';

// ── List prefix detection ──────────────────────────────────────────────────────

/**
 * Detect a list prefix at the start of a block's text content.
 *
 * Supports:
 *   - Nested numbered:  "1. "  /  "1.1. "  /  "1.1.1. "  etc.
 *   - Loose numbered:   "2.4LAP" (no trailing ". " separator)
 *   - Bullets:          "- text"  /  "* text"  /  "• text"
 *
 * Returns null if no list prefix is found.
 */
export function detectListPrefix(text) {
  // Standard: prefix ends with ". " (optional space so mid-prefix cursors work)
  const numbered = text.match(/^([\d]+(?:\.[\d]+)*\. ?)(.*)/s);
  if (numbered) {
    const rawPrefix = numbered[1];
    const prefix    = rawPrefix.trimEnd() + '. '; // normalise to exactly one space
    const nums      = (prefix.match(/\d+/g) || []).map(Number);
    const num       = nums[nums.length - 1] || 1;
    return { type: 'numbered', prefix, nums, num, sep: '. ', body: numbered[2] };
  }
  const bullet = text.match(/^([-*•]\s+)(.*)/s);
  if (bullet) {
    return { type: 'bullet', prefix: bullet[1], body: bullet[2] };
  }
  return null;
}

// ── DOM normalization ──────────────────────────────────────────────────────────

/**
 * Wrap bare text-node direct children of the editor in <p> elements.
 *
 * Chrome inserts the first keystrokes as a raw text node (not in a <p>) when
 * a contentEditable is cleared.  Raw text nodes are invisible to
 * `element.children`, so fixNumberedListsInDOM never sees them and counters
 * start at 0 for the first real <p>.
 */
export function normalizeBareTextNodes(editorEl) {
  if (!editorEl) return;
  Array.from(editorEl.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
      const p = document.createElement('p');
      editorEl.insertBefore(p, node);
      p.appendChild(node);
    }
  });
}

// ── Renumbering ────────────────────────────────────────────────────────────────

/**
 * Walk every direct-child block in the contentEditable and rewrite sequential
 * numbered prefixes across all indent levels.
 *
 * Counters per level: [level0, level1, level2, level3]
 * Prefix format:      1. / 2.1. / 2.1.3. etc.
 *
 * Cursor is saved before any DOM mutation and restored afterwards so
 * renumbering can run on every keystroke without moving the caret.
 *
 * Special dataset attributes on blocks:
 *   data-indent="N"     — indent level (0–3)
 *   data-empty-new      — freshly-created empty item (Enter key); count it
 *   data-restart="true" — force counter reset at this level
 *   data-continue="true"— resume counters from before the last non-list break
 */
export function fixNumberedListsInDOM(editorEl) {
  if (!editorEl) return;

  normalizeBareTextNodes(editorEl);

  // ── Save cursor before any text-node mutations ──────────────────────────
  const sel = window.getSelection();
  let savedStart = null, savedStartOff = 0;
  let savedEnd   = null, savedEndOff   = 0;
  let hadSelection = false;
  if (sel?.rangeCount) {
    const r       = sel.getRangeAt(0);
    savedStart    = r.startContainer;
    savedStartOff = r.startOffset;
    savedEnd      = r.endContainer;
    savedEndOff   = r.endOffset;
    hadSelection  = true;
  }

  const blocks         = Array.from(editorEl.children);
  const counters       = [0, 0, 0, 0];
  let preResetCounters = [0, 0, 0, 0]; // saved before the last non-numbered reset

  blocks.forEach(block => {
    // Tables are a structural break but don't reset the numeric sequence.
    // Save preResetCounters here so a data-continue block AFTER a table
    // (e.g. "4. Heading" → table → "5. Next heading") resumes correctly.
    if (block.nodeName === 'TABLE') {
      if (counters.some(c => c > 0)) preResetCounters = [...counters];
      return;
    }

    const level = getIndentLevel(block);
    const text  = block.textContent;

    // Empty / whitespace-only blocks (including &nbsp;) don't reset counters
    if (!text.replace(/ /g, ' ').trim()) return;

    // Standard prefix: "1. " / "2.4. "
    const isNumberedStandard = /^[\d]+(?:\.[\d]+)*\. ?/.test(text);
    // Loose prefix: "2.4LAP" (≥2 numeric components, no ". " separator)
    const isNumberedLoose    = !isNumberedStandard && /^[\d]+(?:\.[\d]+)+[^\s.]/.test(text);
    const isNumbered         = isNumberedStandard || isNumberedLoose;

    if (isNumbered) {
      const body = isNumberedLoose
        ? text.replace(/^[\d]+(?:\.[\d]+)+/, '').trim()
        : text.replace(/^[\d]+(?:\.[\d]+)*\. ?/, '').trim();

      // Prefix-only blocks only count if freshly created by Enter
      if (!body && !block.dataset.emptyNew) return;

      // Restore pre-break counters if marked to continue
      if (block.dataset.continue === 'true') {
        for (let i = 0; i < counters.length; i++) counters[i] = preResetCounters[i];
      }

      // Restart this level (and deeper) if marked
      if (block.dataset.restart === 'true') {
        counters[level] = 0;
        for (let i = level + 1; i < counters.length; i++) counters[i] = 0;
      }

      counters[level]++;
      for (let i = level + 1; i < counters.length; i++) counters[i] = 0;

      const expectedPrefix = counters.slice(0, level + 1).join('.') + '. ';

      const walker   = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      const firstTxt = walker.nextNode();
      if (firstTxt) {
        const updated = firstTxt.nodeValue.replace(
          /^[\d]+(?:\.[\d]+)*\.? ?/, // matches both "2.4. " and loose "2.4"
          expectedPrefix
        );
        if (updated !== firstTxt.nodeValue) {
          const oldLen  = (firstTxt.nodeValue.match(/^[\d]+(?:\.[\d]+)*\.? ?/) || [''])[0].length;
          const newLen  = expectedPrefix.length;
          const delta   = newLen - oldLen;
          if (delta !== 0) {
            if (savedStart === firstTxt)
              savedStartOff = Math.max(newLen, savedStartOff + delta);
            if (savedEnd === firstTxt)
              savedEndOff   = Math.max(newLen, savedEndOff + delta);
          }
          firstTxt.nodeValue = updated;
        }
      }

      if (body && block.dataset.emptyNew) delete block.dataset.emptyNew;
    } else {
      // Non-empty non-numbered block: snapshot counters before reset
      if (counters.some(c => c > 0)) preResetCounters = [...counters];
      counters[level] = 0;
      for (let i = level + 1; i < counters.length; i++) counters[i] = 0;
    }
  });

  // ── Restore cursor ────────────────────────────────────────────────────────
  if (hadSelection && savedStart?.isConnected) {
    try {
      const clamp = (node, off) =>
        node.nodeType === Node.TEXT_NODE
          ? Math.min(off, node.length)
          : Math.min(off, node.childNodes.length);
      const newRange = document.createRange();
      newRange.setStart(savedStart, clamp(savedStart, savedStartOff));
      newRange.setEnd(
        savedEnd?.isConnected ? savedEnd : savedStart,
        clamp(savedEnd?.isConnected ? savedEnd : savedStart, savedEndOff)
      );
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch { /* node detached — leave cursor where browser placed it */ }
  }
}

// ── Legacy content conversion ─────────────────────────────────────────────────

/**
 * Convert a legacy plain-text (or markdown-marker) entry to HTML so it can
 * be loaded into the contentEditable editor.  Already-HTML content is passed
 * through unchanged.
 */
export function legacyTextToHtml(text) {
  if (!text) return '';
  if (/<[a-zA-Z]/.test(text)) return text; // already HTML

  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<u>$1</u>')
    .replace(/~~(.+?)~~/g,     '<s>$1</s>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>');

  return s
    .split('\n')
    .map(line => (line ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}
