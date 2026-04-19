import { useMemo, useState } from 'react';
import { BookOpen, Download, ChevronDown, ChevronRight } from 'lucide-react';
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

/* ── Component ──────────────────────────────────────────────────────────── */
export default function UserManual() {
  const [open, setOpen] = useState(false);
  const body = useMemo(() => renderMarkdown(manualSource), []);

  const download = () => {
    const blob = new Blob([manualSource], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href      = url;
    a.download  = `digital-diary-user-manual-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
            title="Download the manual as a Markdown file"
          >
            <Download size={14} /> Download .md
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
