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
