/**
 * cursorUtils.js — pure cursor / indent helpers for the DiaryEditor.
 * No React imports; safe to call from anywhere.
 */

export function getIndentLevel(block) {
  return parseInt(block?.dataset?.indent || '0');
}

export function setIndentLevel(block, level) {
  if (!block) return;
  level = Math.max(0, Math.min(3, level));
  if (level === 0) {
    delete block.dataset.indent;
  } else {
    block.dataset.indent = String(level);
  }
}

/**
 * Returns true when `range` is collapsed at the very beginning of `block`
 * (before any text or child elements).
 */
export function isAtBlockStart(range, block) {
  if (!range || !range.collapsed || !block) return false;
  if (range.startContainer === block && range.startOffset === 0) return true;
  if (range.startOffset !== 0) return false;
  let node = range.startContainer;
  while (node && node !== block) {
    if (node.previousSibling) return false;
    node = node.parentNode;
  }
  return node === block;
}

/**
 * Place the cursor at the very end of a block.
 * Walks into the deepest last child so the cursor lands inside the final
 * text node — making the next Backspace delete a character, not an element.
 */
export function placeCursorAtEnd(block, sel) {
  if (!block || !sel) return;
  function deepLast(node) {
    return node.lastChild ? deepLast(node.lastChild) : node;
  }
  const target = deepLast(block);
  const r = document.createRange();
  if (target.nodeType === Node.TEXT_NODE) {
    r.setStart(target, target.length);
    r.setEnd(target, target.length);
  } else if (target.nodeName === 'BR') {
    r.setStartBefore(target);
    r.collapse(true);
  } else {
    r.selectNodeContents(block);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}
