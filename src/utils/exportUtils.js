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

import { INK_CLASS, INK_ATTR, decodeInk } from '../ink/inkHtml';
import { drawInkToPdf, measureInk } from '../ink/inkPdf';

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
    .replace(/&#8377;/g, 'Rs.')
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '--')
    .replace(/&ndash;/g, '-');
}

// ─── Normalise text for jsPDF (Windows-1252 safe) ────────────────────────────
// jsPDF's built-in fonts (helvetica, times) use Windows-1252 encoding.
// Characters outside that range render as boxes or cause cell overflow.
function normPdf(str) {
  return (str || '')
    .replace(/→/g, '->')    // → right arrow
    .replace(/←/g, '<-')   // ← left arrow
    .replace(/↔/g, '<->') // ↔ left-right arrow
    .replace(/[‘’]/g, "'")  // smart single quotes
    .replace(/[“”]/g, '"')  // smart double quotes
    .replace(/–/g, '-')    // en-dash
    .replace(/—/g, '--')   // em-dash
    .replace(/•/g, '*')    // bullet
    .replace(/×/g, 'x')    // multiplication sign ×
    .replace(/ /g, ' ')    // non-breaking space
    .replace(/[^\x00-\xFF]/g, ' '); // anything else outside Latin-1 → space
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
//
// UNIFORMITY RULE: All tables sharing the same column count receive identical
// column widths, computed in a pre-pass over the entire document. This ensures
// visual consistency across sections (e.g. every 6-column action-item table
// in a Minutes document uses the same proportions).
// ─────────────────────────────────────────────────────────────────────────────
function renderHtmlToPdf(htmlStr, doc, autoTable, layout) {
  const { ML, TW, MT, MB, PH } = layout;
  let y = layout.startY;

  // Parse the HTML once so we can (1) pre-scan tables and (2) render in one pass
  const parser  = new DOMParser();
  const htmlDoc = parser.parseFromString(htmlStr, 'text/html');

  // ── Pre-pass: build unified column widths grouped by column count ─────────
  // For each distinct column count we find across all tables in the document,
  // we measure every cell in every table with that count, then compute a single
  // shared columnStyles object.  That object is reused for every matching table
  // during the render pass below.
  const CELL_PAD_H = 10; // left(5) + right(5) mm padding (matches autoTable styles)
  doc.setFont('times', 'normal');
  doc.setFontSize(9); // must match autoTable font/size for accurate measurement

  const cleanCell = (el) => normPdf(nodeText(el));

  // colCount → { minWidths[], idealWidths[] }
  const globalMeasure = new Map();

  htmlDoc.body.querySelectorAll('table').forEach(tableNode => {
    const allRows = [...tableNode.querySelectorAll('tr')];
    if (!allRows.length) return;
    const firstRowHasTh = allRows[0].querySelectorAll('th').length > 0;
    const head = firstRowHasTh
      ? [[...allRows[0].querySelectorAll('th')].map(cleanCell)]
      : [];
    const bodyRows = firstRowHasTh ? allRows.slice(1) : allRows;
    const body = bodyRows.map(tr => [...tr.querySelectorAll('td, th')].map(cleanCell));
    const sampleRow = (head[0] ?? body[0]) || [];
    const colCount = sampleRow.length;
    if (!colCount) return;

    if (!globalMeasure.has(colCount)) {
      globalMeasure.set(colCount, {
        minWidths:   new Array(colCount).fill(0),
        idealWidths: new Array(colCount).fill(0),
      });
    }
    const { minWidths, idealWidths } = globalMeasure.get(colCount);
    const allData = [...(head[0] ? [head[0]] : []), ...body];
    allData.forEach(row => {
      (row || []).forEach((cell, ci) => {
        if (ci >= colCount) return;
        const text = normPdf(String(cell || ''));
        idealWidths[ci] = Math.max(idealWidths[ci], doc.getTextWidth(text) + CELL_PAD_H);
        text.split(/\s+/).filter(Boolean).forEach(w => {
          minWidths[ci] = Math.max(minWidths[ci], doc.getTextWidth(w) + CELL_PAD_H);
        });
      });
    });
  });

  // Convert measurements → columnStyles map (colCount → columnStyles object)
  // Cap any single column's ideal at 55% of TW so one column can't dominate
  const globalColumnStyles = new Map();
  for (const [colCount, { minWidths, idealWidths }] of globalMeasure.entries()) {
    const maxColW      = TW * 0.55;
    const clampedIdeal = idealWidths.map(w => Math.min(w, maxColW));
    const idealTotal   = clampedIdeal.reduce((a, b) => a + b, 0);
    const totalMin     = minWidths.reduce((a, b) => a + b, 0);

    const styles = {};
    if (colCount > 1) {
      if (totalMin >= TW) {
        // minimums alone exceed page width — scale down proportionally
        const scale = TW / totalMin;
        for (let i = 0; i < colCount; i++) {
          styles[i] = { cellWidth: Math.max(minWidths[i] * scale, 6) };
        }
      } else {
        // distribute remaining space proportionally by ideal width
        const slack = TW - totalMin;
        for (let i = 0; i < colCount; i++) {
          const bonus = idealTotal > 0 ? slack * (clampedIdeal[i] / idealTotal) : slack / colCount;
          styles[i] = { cellWidth: minWidths[i] + bonus };
        }
      }
    }
    globalColumnStyles.set(colCount, styles);
  }
  // ── End pre-pass ──────────────────────────────────────────────────────────

  function ensureSpace(needed = 10) {
    if (y + needed > PH - MB) {
      doc.addPage();
      y = MT;
    }
  }

  function addText(text, opts = {}) {
    const { bold = false, italic = false, size = 11, color = [30, 41, 59], indent = 0 } = opts;
    if (!text) return;
    // Use 'times' for elegant professional look; normalise to Windows-1252 safe chars
    const safeText = normPdf(text);
    doc.setFont('times', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const maxW = TW - indent;
    const wrapped = doc.splitTextToSize(safeText, maxW);
    wrapped.forEach(line => {
      ensureSpace(size * 0.5 + 2);
      doc.text(line, ML + indent, y);
      y += size * 0.45 + 2;
    });
  }

  // ── Render a <table> node using autoTable ────────────────────────────────
  function renderTable(tableNode) {
    y += 3;
    ensureSpace(25);

    const allRows = [...tableNode.querySelectorAll('tr')];
    if (!allRows.length) return;

    const firstRowHasTh = allRows[0].querySelectorAll('th').length > 0;

    // Normalise all cell text to Windows-1252 safe characters so jsPDF
    // doesn't hit unrenderable glyphs (→, smart quotes, etc.) that cause
    // characters to bleed outside cell boundaries.
    const head = firstRowHasTh
      ? [[...allRows[0].querySelectorAll('th')].map(cleanCell)]
      : [];
    const bodyRows = firstRowHasTh ? allRows.slice(1) : allRows;
    const body = bodyRows.map(tr =>
      [...tr.querySelectorAll('td, th')].map(cleanCell)
    );

    if (!head.length && !body.length) return;

    const sampleRow    = (head[0] ?? body[0]) || [];
    const colCount     = sampleRow.length;

    // Use the pre-computed global column widths for this column count so that
    // all tables with the same number of columns share identical proportions.
    const columnStyles = globalColumnStyles.get(colCount) || {};

    autoTable(doc, {
      head,
      body,
      startY: y,
      margin:       { left: ML, right: ML },
      tableWidth:   TW,
      columnStyles,
      styles: {
        fontSize:    9,
        cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
        overflow:    'linebreak',
        font:        'times',       // Times — elegant, professional
        textColor:   [30, 41, 59],
        lineColor:   [203, 213, 225],
        lineWidth:   0.25,
        valign:      'top',
      },
      headStyles: {
        fillColor:  [30, 58, 95],   // dark navy (professional, not purple)
        textColor:  [255, 255, 255],
        fontStyle:  'bold',
        font:       'times',
        fontSize:   9,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      theme: 'grid',
      didDrawPage: () => { y = MT; },
    });

    y = doc.lastAutoTable.finalY + 6;
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

    // ── Handwriting block ───────────────────────────────────────────────────
    // Must be checked before the switch: an ink block is a <div>, so the 'div'
    // case would otherwise recurse into it and emit nothing (the vector lives
    // in an attribute, and its <canvas> child has no text).
    if (node.classList?.contains(INK_CLASS) && node.hasAttribute(INK_ATTR)) {
      const inkDoc = decodeInk(node.getAttribute(INK_ATTR));
      if (inkDoc) {
        const { height } = measureInk(inkDoc, TW);
        ensureSpace(height + 4);
        y += 2;
        drawInkToPdf(doc, inkDoc, { x: ML, y, maxWidthMm: TW });
        y += height + 4;
      }
      return;
    }

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

  // Render using the already-parsed htmlDoc (no second DOMParser call needed)
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
  const ML  = 18,  MR = 18, MT = 8, MB = 20;   // MT reduced: less top padding
  const TW  = PW - ML - MR;
  let   y   = MT;

  function ensureSpace(needed = 10) {
    if (y + needed > PH - MB) { doc.addPage(); y = MT; }
  }

  // ── Brand colours ─────────────────────────────────────────────────────────
  const GOLD = [180, 137, 40];  // dark gold matching Dhanam brand

  // ── Header: Dhanam Logo (left) + Company Name (right of logo) ────────────
  const HEADER_H = 22;  // total header block height in mm
  const LOGO_H   = 18;  // logo rendered height in mm (taller = bigger logo)

  let logoW = 0;  // track actual rendered width so company name can be positioned beside it

  // Attempt to load the logo from the public folder
  try {
    const logoImg = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = '/logo-header.png';
    });
    const aspect = logoImg.naturalWidth / Math.max(logoImg.naturalHeight, 1);
    logoW = Math.min(LOGO_H * aspect, 50);  // proportional width, max 50 mm
    const canvas = document.createElement('canvas');
    canvas.width  = logoImg.naturalWidth;
    canvas.height = logoImg.naturalHeight;
    canvas.getContext('2d').drawImage(logoImg, 0, 0);
    // Vertically centre the logo within the header block
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', ML, y + (HEADER_H - LOGO_H) / 2, logoW, LOGO_H);
  } catch {
    /* logo unavailable — company name will start from left margin */
  }

  // Company name — positioned to the right of the logo, vertically centred
  const nameX = ML + logoW + (logoW > 0 ? 4 : 0);  // 4 mm gap after logo
  const nameY = y + HEADER_H / 2 + 1.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...GOLD);
  doc.text('Dhanam Investment and Finance Private Limited', nameX, nameY);

  y += HEADER_H;

  // ── Thin gold border line ─────────────────────────────────────────────────
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(ML, y, ML + TW, y);
  y += 7;  // breathing room between the line and the document title

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
