/**
 * exportUtils.js
 *
 * Client-side download helpers for sheets (Excel) and diary entries (PDF).
 * Both functions use dynamic import() so xlsx, jspdf, and jspdf-autotable
 * are loaded on demand and don't inflate the main bundle.
 *
 * Required npm packages:
 *   npm install xlsx jspdf jspdf-autotable
 */

// ─── Column letter helpers (mirrors SpreadsheetGrid) ─────────────────────────
const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
function ck(col, row) { return `${LETTERS[col] ?? '?'}${row + 1}`; }

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

// ─── Decode common HTML entities ─────────────────────────────────────────────
function decodeEntities(str) {
  return (str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8377;/g, '₹')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

// ─── Get clean text content of a node (decodes entities, collapses whitespace)
function nodeText(node) {
  return decodeEntities((node.textContent || '').replace(/\s+/g, ' ').trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML → PDF renderer
//
// Walks the parsed DOM tree and calls jsPDF drawing methods directly.
// Tables use jspdf-autotable for proper column sizing and borders.
// ─────────────────────────────────────────────────────────────────────────────
function renderHtmlToPdf(htmlStr, doc, autoTable, layout) {
  const { ML, TW, MT, MB, PH } = layout;
  let y = layout.startY;

  function ensureSpace(needed = 10) {
    if (y + needed > PH - MB) {
      doc.addPage();
      y = MT;
    }
  }

  function addText(text, opts = {}) {
    const { bold = false, italic = false, size = 11, color = [30, 41, 59], indent = 0 } = opts;
    if (!text) return;
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const maxW = TW - indent;
    const wrapped = doc.splitTextToSize(text, maxW);
    wrapped.forEach(line => {
      ensureSpace(size * 0.5 + 2);
      doc.text(line, ML + indent, y);
      y += size * 0.45 + 1.5;
    });
  }

  // ── Render a <table> node using autoTable ────────────────────────────────
  function renderTable(tableNode) {
    y += 3;
    ensureSpace(25);

    const allRows  = [...tableNode.querySelectorAll('tr')];
    if (!allRows.length) return;

    // Determine if first row is a header row (contains <th> cells)
    const firstRowHasTh = allRows[0].querySelectorAll('th').length > 0;

    const head = firstRowHasTh
      ? [[...allRows[0].querySelectorAll('th')].map(th => nodeText(th))]
      : [];
    const bodyRows = firstRowHasTh ? allRows.slice(1) : allRows;
    const body = bodyRows.map(tr =>
      [...tr.querySelectorAll('td, th')].map(td => nodeText(td))
    );

    if (!head.length && !body.length) return;

    autoTable(doc, {
      head,
      body,
      startY: y,
      margin:  { left: ML, right: ML },
      tableWidth: TW,
      styles: {
        fontSize:    9,
        cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
        overflow:    'linebreak',
        font:        'helvetica',
        textColor:   [30, 41, 59],
        lineColor:   [203, 213, 225],
        lineWidth:   0.25,
      },
      headStyles: {
        fillColor:  [109, 40, 217],
        textColor:  [255, 255, 255],
        fontStyle:  'bold',
        fontSize:   9,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      theme: 'grid',
      didDrawPage: (_data) => {
        // After a page break inside a table, reset y to margin
        y = MT;
      },
    });

    y = doc.lastAutoTable.finalY + 5;
  }

  // ── Recursively render a DOM node ────────────────────────────────────────
  function renderNode(node) {
    // Text node
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = decodeEntities((node.textContent || '').replace(/\s+/g, ' '));
      if (text.trim()) addText(text.trim());
      return;
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case 'table':
        renderTable(node);
        return;

      case 'h1':
        y += 5;
        ensureSpace(12);
        addText(nodeText(node), { bold: true, size: 16, color: [15, 23, 42] });
        y += 3;
        return;

      case 'h2':
        y += 4;
        ensureSpace(10);
        addText(nodeText(node), { bold: true, size: 13, color: [15, 23, 42] });
        y += 2;
        return;

      case 'h3':
      case 'h4':
        y += 3;
        ensureSpace(9);
        addText(nodeText(node), { bold: true, size: 11, color: [30, 41, 59] });
        y += 1;
        return;

      case 'strong':
      case 'b': {
        const t = nodeText(node);
        if (t) addText(t, { bold: true, size: 11 });
        return;
      }

      case 'em':
      case 'i': {
        const t = nodeText(node);
        if (t) addText(t, { italic: true, size: 11 });
        return;
      }

      case 'u': {
        const t = nodeText(node);
        if (t) {
          addText(t, { size: 11 });
          // underline: draw a line below the text
          const tw = doc.getTextWidth(t);
          doc.setDrawColor(30, 41, 59);
          doc.setLineWidth(0.2);
          doc.line(ML, y - 0.5, ML + tw, y - 0.5);
        }
        return;
      }

      case 'br':
        y += 4;
        return;

      case 'hr':
        y += 3;
        ensureSpace(5);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.3);
        doc.line(ML, y, ML + TW, y);
        y += 4;
        return;

      case 'li': {
        const isOrdered = node.parentElement?.tagName?.toLowerCase() === 'ol';
        const idx = isOrdered
          ? [...node.parentElement.children].indexOf(node) + 1
          : null;
        const bullet = isOrdered ? `${idx}.` : '•';
        const text   = nodeText(node);
        if (text) {
          ensureSpace(7);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(30, 41, 59);
          doc.text(bullet, ML + 2, y);
          const wrapped = doc.splitTextToSize(text, TW - 10);
          wrapped.forEach((line, idx2) => {
            ensureSpace(7);
            doc.text(line, ML + 8, y);
            if (idx2 < wrapped.length - 1) y += 6;
          });
          y += 6;
        }
        return;
      }

      case 'p':
      case 'div': {
        // If this node contains a table, recurse into children individually
        if (node.querySelector('table')) {
          [...node.childNodes].forEach(renderNode);
          return;
        }

        // Check for alignment / heading-like divs
        const style     = node.getAttribute('style') || '';
        const isCentre  = style.includes('text-align: center') || style.includes('text-align:center');
        const isBold    = style.includes('font-weight: bold') || style.includes('font-weight:bold') ||
                          style.includes('font-weight: 700');

        const text = nodeText(node);
        if (!text) {
          // Still might have meaningful children (e.g. nested spans/bolds)
          [...node.childNodes].forEach(renderNode);
          y += 2;
          return;
        }

        const hasBoldChild = node.querySelector('strong, b');
        const opts = {
          bold:   isBold || !!hasBoldChild,
          size:   11,
          color:  isBold || hasBoldChild ? [15, 23, 42] : [30, 41, 59],
          indent: 0,
        };

        if (isCentre) {
          ensureSpace(8);
          doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
          doc.setFontSize(opts.size);
          doc.setTextColor(...opts.color);
          doc.text(text, ML + TW / 2, y, { align: 'center' });
          y += 7;
        } else {
          addText(text, opts);
          y += 2;
        }
        return;
      }

      case 'span': {
        const text = nodeText(node);
        if (!text) return;
        const style   = node.getAttribute('style') || '';
        const isBold  = style.includes('font-weight');
        addText(text, { bold: isBold, size: 11 });
        return;
      }

      case 'ul':
      case 'ol':
      case 'thead':
      case 'tbody':
      case 'tfoot':
        // handled by children or renderTable
        [...node.childNodes].forEach(renderNode);
        return;

      case 'tr':
      case 'td':
      case 'th':
        // these are handled inside renderTable; if they appear outside a table, just show text
        addText(nodeText(node));
        return;

      case 'script':
      case 'style':
      case 'head':
        return; // skip

      default:
        // For anything else, recurse into children
        [...node.childNodes].forEach(renderNode);
    }
  }

  const parser  = new DOMParser();
  const htmlDoc = parser.parseFromString(htmlStr, 'text/html');
  [...htmlDoc.body.childNodes].forEach(renderNode);

  return y;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SHEET → EXCEL (.xlsx)
// ─────────────────────────────────────────────────────────────────────────────
export async function downloadSheetAsExcel(sheet) {
  const { title = 'Sheet', data = {}, cols = 10, rows = 50 } = sheet;
  const XLSX = await import('xlsx');

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = [];
    for (let c = 0; c < cols; c++) {
      const cell = data[ck(c, r)];
      rowArr.push(cell?.v !== undefined && cell?.v !== '' ? cell.v : null);
    }
    grid.push(rowArr);
  }

  while (grid.length > 1 && grid[grid.length - 1].every(v => v === null)) grid.pop();

  const ws = XLSX.utils.aoa_to_sheet(grid);

  for (let c = 0; c < cols; c++) {
    const cellKey = ck(c, 0);
    const cell    = data[cellKey];
    if (!cell) continue;
    const wsKey = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[wsKey]) ws[wsKey].s = { font: { bold: !!cell.b } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, `${title}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DIARY ENTRY → PDF
// ─────────────────────────────────────────────────────────────────────────────
export async function downloadEntryAsPDF(entry) {
  const { jsPDF }    = await import('jspdf');
  const autoTable    = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW  = 210, PH = 297;
  const ML  = 18,  MR = 18, MT = 20, MB = 20;
  const TW  = PW - ML - MR;
  let   y   = MT;

  function ensureSpace(needed = 10) {
    if (y + needed > PH - MB) { doc.addPage(); y = MT; }
  }

  // ── Purple accent bar ────────────────────────────────────────────────────
  doc.setFillColor(109, 40, 217);
  doc.rect(ML, y, TW, 1.2, 'F');
  y += 6;

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(entry.title || 'Untitled', TW);
  titleLines.forEach(line => { ensureSpace(12); doc.text(line, ML, y); y += 9; });

  // ── Tag badge ────────────────────────────────────────────────────────────
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

  // ── Date ─────────────────────────────────────────────────────────────────
  ensureSpace(7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(fmtDate(entry.createdAt), ML, y);
  y += 8;

  // ── Divider ──────────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML + TW, y);
  y += 7;

  // ── Content ──────────────────────────────────────────────────────────────
  const isHtml = entry.content && /<[a-zA-Z]/.test(entry.content);

  if (isHtml) {
    y = renderHtmlToPdf(entry.content, doc, autoTable, { ML, TW, MT, MB, PH, startY: y });
  } else {
    // Legacy plain-text fallback
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    const paragraphs = (entry.content || '').split(/\n\n+/);
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      for (const line of para.split('\n')) {
        if (!line.trim()) continue;
        const wrapped = doc.splitTextToSize(line.trim(), TW);
        wrapped.forEach(wline => { ensureSpace(7); doc.text(wline, ML, y); y += 6; });
      }
      y += 3;
    }
  }

  // ── Footer (all pages) ───────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Dhanam Diary', ML, PH - 10);
    doc.text(`Page ${p} of ${pageCount}`, PW - MR, PH - 10, { align: 'right' });
  }

  const safeName = (entry.title || 'entry').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'entry';
  doc.save(`${safeName}.pdf`);
}
