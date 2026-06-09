/**
 * tableUtils.js — pure DOM helpers for table operations in the DiaryEditor.
 * No React imports.
 */

/** Get the <td> or <th> ancestor of a node within the editor, if any. */
export function getCurrentCell(node, editorEl) {
  let n = node;
  while (n && n !== editorEl) {
    if (n.nodeName === 'TD' || n.nodeName === 'TH') return n;
    n = n.parentNode;
  }
  return null;
}

/** Select all content in a cell and move cursor to end. */
export function selectCell(cell) {
  if (!cell) return;
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Set all cells in the table to equal fractional widths so columns are
 * uniform after adding or removing a column.
 */
export function equalizeColumns(table) {
  const firstRow = table.querySelector('tr');
  if (!firstRow) return;
  const colCount = firstRow.children.length;
  if (colCount === 0) return;
  const pct = `${(100 / colCount).toFixed(2)}%`;
  Array.from(table.querySelectorAll('td, th')).forEach(cell => {
    cell.style.width = pct;
  });
}

/**
 * Returns true if the given table's first-column header contains only "#".
 * Used to identify auto-numbering tables.
 */
export function isHashTable(table) {
  const firstRow = table.querySelector('tr');
  if (!firstRow) return false;
  const firstCell = firstRow.cells[0];
  return !!(firstCell && firstCell.textContent.trim() === '#');
}

/**
 * For every table in the editor whose first column header is exactly "#",
 * auto-number the first column of data rows (rows 2+) as 1, 2, 3 …
 *
 * The cursor is saved and restored around any DOM mutation so this can be
 * called on every keystroke without moving the caret.
 *
 * Returns true if any cell was changed.
 */
export function renumberHashColumns(editorEl) {
  if (!editorEl) return false;

  const tables = Array.from(editorEl.querySelectorAll('table')).filter(isHashTable);
  if (tables.length === 0) return false;

  // Save cursor before touching any text nodes
  const sel = window.getSelection();
  let savedStart = null, savedStartOff = 0;
  let savedEnd   = null, savedEndOff   = 0;
  let hadSel = false;
  if (sel?.rangeCount) {
    const r       = sel.getRangeAt(0);
    savedStart    = r.startContainer;
    savedStartOff = r.startOffset;
    savedEnd      = r.endContainer;
    savedEndOff   = r.endOffset;
    hadSel        = true;
  }

  let changed = false;
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (let i = 1; i < rows.length; i++) {
      const cell = rows[i].cells[0];
      if (!cell) continue;
      const num = String(i);
      if (cell.textContent.trim() !== num) {
        cell.textContent = num;
        changed = true;
      }
    }
  }

  // Restore cursor (best-effort — skip if saved nodes were detached by the rename)
  if (hadSel && savedStart?.isConnected) {
    try {
      const clamp = (node, off) =>
        node.nodeType === Node.TEXT_NODE
          ? Math.min(off, node.length)
          : Math.min(off, node.childNodes.length);
      const r2 = document.createRange();
      r2.setStart(savedStart, clamp(savedStart, savedStartOff));
      r2.setEnd(
        savedEnd?.isConnected ? savedEnd : savedStart,
        clamp(savedEnd?.isConnected ? savedEnd : savedStart, savedEndOff),
      );
      sel.removeAllRanges();
      sel.addRange(r2);
    } catch { /* node detached — leave cursor wherever the browser put it */ }
  }

  return changed;
}
