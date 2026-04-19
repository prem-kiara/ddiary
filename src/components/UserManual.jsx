import { useMemo, useState } from 'react';
import { BookOpen, FileDown, ChevronDown, ChevronRight } from 'lucide-react';
import manualSource from '../content/user-manual.md?raw';

/**
 * UserManual
 * -----------
 * Renders the in-app User Manual sourced from `src/content/user-manual.md`.
 * The markdown file is the single source of truth — edit it whenever a
 * user-facing change ships, and the Settings page picks the new content up
 * on the next build automatically (via Vite's `?raw` import).
 *
 * We hand-roll a tiny Markdown → React renderer for the subset the manual
 * actually uses (headings, paragraphs, ul/ol, blockquotes, horizontal rules,
 * inline bold/italic/code). This avoids adding a new runtime dependency just
 * for a single help page.
 */

/* ── Inline formatting: **bold**, *italic*, `code`, [link](url) ─────────── */
function renderInline(text, keyPrefix = '') {
  const out = [];
  let remaining = text;
  let idx = 0;
  // Order matters — code fences first so we don't accidentally bold inside them.
  const patterns = [
    { re: /`([^`]+)`/,                  tag: 'code'   },
    { re: /\*\*([^*]+)\*\*/,            tag: 'strong' },
    { re: /\*([^*]+)\*/,                tag: 'em'     },
    { re: /\[([^\]]+)\]\(([^)]+)\)/,    tag: 'a'      },
  ];
  while (remaining.length) {
    let earliest = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && (earliest === null || m.index < earliest.match.index)) {
        earliest = { match: m, p };
      }
    }
    if (!earliest) {
      out.push(remaining);
      break;
    }
    const { match, p } = earliest;
    if (match.index > 0) out.push(remaining.slice(0, match.index));
    const key = `${keyPrefix}-${idx++}`;
    if (p.tag === 'a') {
      out.push(
        <a key={key} href={match[2]} target="_blank" rel="noreferrer" className="text-violet-600 underline">
          {match[1]}
        </a>
      );
    } else if (p.tag === 'code') {
      out.push(
        <code key={key} className="bg-slate-100 text-[13px] px-1.5 py-0.5 rounded font-mono text-slate-800">
          {match[1]}
        </code>
      );
    } else if (p.tag === 'strong') {
      out.push(<strong key={key} className="font-semibold text-slate-900">{renderInline(match[1], key)}</strong>);
    } else if (p.tag === 'em') {
      out.push(<em key={key} className="italic">{renderInline(match[1], key)}</em>);
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return out;
}

/* ── Block renderer ─────────────────────────────────────────────────────── */
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  const flushList = (items, ordered, key) => {
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-6 my-3 space-y-1 text-slate-700`}>
        {items.map((it, ii) => (
          <li key={ii} className="leading-relaxed">{renderInline(it, `${key}-${ii}`)}</li>
        ))}
      </Tag>
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr key={i} className="my-6 border-slate-200" />);
      i++; continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm'];
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={i} className={`${sizes[level - 1]} font-semibold text-slate-900 mt-6 mb-2`}>
          {renderInline(h[2], `h-${i}`)}
        </Tag>
      );
      i++; continue;
    }

    // Blockquote (>)
    if (/^>\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`q-${i}`} className="border-l-4 border-violet-300 bg-violet-50 text-slate-700 px-4 py-2 my-4 rounded-r">
          {qLines.map((ql, qi) => (
            <p key={qi} className="text-[14px] leading-relaxed my-1">{renderInline(ql, `q-${i}-${qi}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      flushList(items, true, `ol-${i}`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      flushList(items, false, `ul-${i}`);
      continue;
    }

    // Blank line → paragraph break
    if (!line.trim()) { i++; continue; }

    // Paragraph (gather consecutive non-special lines)
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${i}`} className="text-slate-700 leading-relaxed my-3">
        {renderInline(pLines.join(' '), `p-${i}`)}
      </p>
    );
  }

  return blocks;
}

/* ── Markdown → HTML (used only for PDF export) ─────────────────────────── */
// A parallel HTML-emitting pass so the printed page doesn't carry React
// runtime overhead. Kept intentionally small — same subset as renderMarkdown.
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function renderInlineHtml(text) {
  let t = escapeHtml(text);
  // Order matters: links first, then code, then bold, then italics.
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}
function renderMarkdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^---+\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${renderInlineHtml(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^>\s?/.test(line)) {
      const qs = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { qs.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${qs.map(q => `<p>${renderInlineHtml(q)}</p>`).join('')}</blockquote>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      out.push(`<ol>${items.map(it => `<li>${renderInlineHtml(it)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      out.push(`<ul>${items.map(it => `<li>${renderInlineHtml(it)}</li>`).join('')}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const pLines = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i])
    ) { pLines.push(lines[i]); i++; }
    out.push(`<p>${renderInlineHtml(pLines.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* ── Print-to-PDF via hidden iframe ─────────────────────────────────────── */
// We open a hidden iframe containing a print-styled rendering of the manual
// and call print() on it. Every modern browser's print dialog defaults to
// "Save as PDF", which produces a proper paginated document with zero extra
// runtime dependencies.
function printManualAsPdf() {
  const date = new Date().toISOString().split('T')[0];
  const title = `Digital Diary — User Manual (${date})`;
  const bodyHtml = renderMarkdownToHtml(manualSource);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    :root { color-scheme: light; }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #0f172a; background: #fff; margin: 0; padding: 0;
      font-size: 11pt; line-height: 1.55;
    }
    h1 { font-size: 22pt; margin: 0 0 12pt; color: #6d28d9; }
    h2 { font-size: 15pt; margin: 18pt 0 8pt; color: #0f172a; page-break-after: avoid; }
    h3 { font-size: 12pt; margin: 12pt 0 6pt; color: #334155; page-break-after: avoid; }
    p  { margin: 6pt 0; }
    ul, ol { margin: 6pt 0 8pt; padding-left: 22pt; }
    li { margin: 2pt 0; }
    strong { color: #0f172a; }
    code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
           background: #f1f5f9; padding: 0 3pt; border-radius: 3pt; font-size: 10pt; }
    blockquote {
      border-left: 3pt solid #a78bfa; background: #f5f3ff; color: #334155;
      padding: 6pt 10pt; margin: 10pt 0; page-break-inside: avoid;
    }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 14pt 0; }
    a  { color: #6d28d9; text-decoration: underline; }
    .cover { border-bottom: 2pt solid #7c3aed; padding-bottom: 10pt; margin-bottom: 18pt; }
    .cover .meta { font-size: 10pt; color: #64748b; margin-top: 4pt; }
    .page-footer {
      position: fixed; bottom: 8mm; left: 16mm; right: 16mm;
      display: flex; justify-content: space-between;
      font-size: 9pt; color: #94a3b8;
    }
    h2, h3 { page-break-after: avoid; }
    ul, ol, blockquote { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>Digital Diary — User Manual</h1>
    <div class="meta">Exported ${escapeHtml(date)} · App version 1.0.0</div>
  </div>
  ${bodyHtml}
  <div class="page-footer">
    <span>Digital Diary User Manual</span>
    <span>${escapeHtml(date)}</span>
  </div>
</body>
</html>`;

  // Hidden iframe — survives across platforms better than window.open, which
  // pop-up blockers tend to intercept.
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Give the iframe a tick to lay out, then trigger the native print dialog.
  // The user picks "Save as PDF" as the destination (default on Chrome/Edge/
  // Safari); cancelling is harmless.
  const trigger = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('Print dialog failed', e);
    }
    // Cleanup shortly after the dialog closes. Safari sometimes fires
    // afterprint late, so also remove defensively on a timer.
    const cleanup = () => { try { document.body.removeChild(iframe); } catch {} };
    iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 60_000);
  };

  if (iframe.contentDocument.readyState === 'complete') trigger();
  else iframe.addEventListener('load', trigger, { once: true });
}

/* ── Component ──────────────────────────────────────────────────────────── */
export default function UserManual() {
  const [open, setOpen] = useState(false);
  const body = useMemo(() => renderMarkdown(manualSource), []);

  const download = () => {
    printManualAsPdf();
  };

  return (
    <div className="card">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setOpen(v => !v)}
      >
        <h3 className="flex items-center gap-2 m-0 text-[16px] font-semibold text-slate-900">
          <BookOpen size={20} color="#6d28d9" /> User Manual
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm btn-outline"
            onClick={(e) => { e.stopPropagation(); download(); }}
            title="Download the manual as a PDF (opens your browser's Save-as-PDF dialog)"
          >
            <FileDown size={14} /> Download PDF
          </button>
          {open ? <ChevronDown size={18} color="#475569" /> : <ChevronRight size={18} color="#475569" />}
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-200 max-h-[60vh] overflow-y-auto pr-2">
          <div className="prose-user-manual">
            {body}
          </div>
        </div>
      )}
    </div>
  );
}
