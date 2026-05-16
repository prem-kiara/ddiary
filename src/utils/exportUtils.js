/**
 * exportUtils.js
 *
 * Client-side download helpers for sheets (Excel) and diary entries (PDF).
 * Both functions use dynamic import() so xlsx and jspdf are loaded on demand
 * and don't inflate the main bundle.
 *
 * Required npm packages (install once):
 *   npm install xlsx jspdf
 */

// ─── Column letter helpers (mirrors SpreadsheetGrid) ─────────────────────────
const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
function ck(col, row) { return `${LETTERS[col] ?? '?'}${row + 1}`; }

// ─── HTML → plain text (for PDF body) ────────────────────────────────────────
function htmlToPlain(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  • ')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Format a Firestore timestamp or Date into a readable string ──────────────
function fmtDate(ts) {
  if (!ts) return '';
  const ms = ts?.seconds
    ? ts.seconds * 1000
    : ts?.toMillis?.() ?? (typeof ts === 'string' || ts instanceof Date ? new Date(ts).getTime() : NaN);
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SHEET → EXCEL (.xlsx)
//
//   sheet  — object with { title, data, cols, rows }
//            data keys are like "A1", "B3"; values are { v: rawValue, b, i }
// ─────────────────────────────────────────────────────────────────────────────
export async function downloadSheetAsExcel(sheet) {
  const { title = 'Sheet', data = {}, cols = 10, rows = 50 } = sheet;

  // Dynamically import SheetJS (only when user clicks download)
  const XLSX = await import('xlsx');

  // Build a 2-D array [row][col] of raw values
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = [];
    for (let c = 0; c < cols; c++) {
      const cell = data[ck(c, r)];
      rowArr.push(cell?.v !== undefined && cell?.v !== '' ? cell.v : null);
    }
    grid.push(rowArr);
  }

  // Trim trailing empty rows
  while (grid.length > 1 && grid[grid.length - 1].every(v => v === null)) {
    grid.pop();
  }

  // Build worksheet
  const ws = XLSX.utils.aoa_to_sheet(grid);

  // Apply bold formatting for header row (row 0) cells that have b:true
  for (let c = 0; c < cols; c++) {
    const cellKey = ck(c, 0);
    const cell    = data[cellKey];
    if (!cell) continue;
    const wsKey   = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[wsKey]) {
      ws[wsKey].s = { font: { bold: !!cell.b } };
    }
  }

  // Build workbook and trigger download
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31)); // sheet name max 31 chars
  XLSX.writeFile(wb, `${title}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DIARY ENTRY → PDF
//
//   entry — { title, content, createdAt, updatedAt, tag }
//   content may be HTML (new editor) or plain text (legacy)
// ─────────────────────────────────────────────────────────────────────────────
export async function downloadEntryAsPDF(entry) {
  const { jsPDF } = await import('jspdf');

  const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW    = 210;  // page width  (A4 mm)
  const PH    = 297;  // page height (A4 mm)
  const ML    = 20;   // left  margin
  const MR    = 20;   // right margin
  const MT    = 20;   // top margin
  const MB    = 20;   // bottom margin
  const TW    = PW - ML - MR;  // text width
  let   y     = MT;

  // ── Helper: add a new page when nearing the bottom ───────────────────────
  function ensureSpace(needed = 10) {
    if (y + needed > PH - MB) {
      doc.addPage();
      y = MT;
    }
  }

  // ── Purple accent bar at top ──────────────────────────────────────────────
  doc.setFillColor(124, 58, 237);
  doc.rect(ML, y, TW, 1.2, 'F');
  y += 6;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(entry.title || 'Untitled', TW);
  titleLines.forEach(line => {
    ensureSpace(12);
    doc.text(line, ML, y);
    y += 9;
  });

  // ── Tag badge (if present) ────────────────────────────────────────────────
  if (entry.tag) {
    ensureSpace(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(109, 40, 217);
    const tagW = doc.getTextWidth(`  ${entry.tag.toUpperCase()}  `) + 4;
    doc.setFillColor(237, 233, 254);
    doc.roundedRect(ML, y - 5, tagW, 6, 1, 1, 'F');
    doc.text(`  ${entry.tag.toUpperCase()}`, ML + 2, y);
    y += 8;
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  ensureSpace(7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(fmtDate(entry.createdAt), ML, y);
  y += 8;

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML + TW, y);
  y += 7;

  // ── Content ───────────────────────────────────────────────────────────────
  const isHtml = entry.content && /<[a-zA-Z]/.test(entry.content);
  const plain  = isHtml ? htmlToPlain(entry.content) : (entry.content || '');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);

  const paragraphs = plain.split(/\n\n+/);
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    const lines = para.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const wrapped = doc.splitTextToSize(line.trim(), TW);
      for (const wline of wrapped) {
        ensureSpace(7);
        doc.text(wline, ML, y);
        y += 6;
      }
    }
    y += 3; // paragraph spacing
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Dhanam Diary', ML, PH - 10);
    doc.text(`Page ${p} of ${pageCount}`, PW - MR, PH - 10, { align: 'right' });
  }

  // ── Save file ─────────────────────────────────────────────────────────────
  const safeName = (entry.title || 'entry').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'entry';
  doc.save(`${safeName}.pdf`);
}
