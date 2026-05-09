import { useState } from 'react';
import { ChevronLeft, Edit3, Trash2, Archive, RotateCcw, Share2 } from 'lucide-react';
import { TagBadge } from './shared/Pills';
import { parseDate } from '../utils/dates';
import ShareEntryModal from './ShareEntryModal';

// Long-form date — "Monday, April 3, 2026" — used in the entry header.
const formatDate = (d) => {
  const date = parseDate(d);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const formatTime = (d) => {
  const date = parseDate(d);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

// True when updatedAt represents a meaningfully-later time than createdAt.
// Serialized Firestore Timestamps lose object-identity, so we compare parsed
// millisecond values with a small 1-second tolerance instead.
const wasEdited = (createdAt, updatedAt) => {
  const c = parseDate(createdAt);
  const u = parseDate(updatedAt);
  if (!c || !u) return false;
  return u.getTime() - c.getTime() > 1000;
};

/**
 * Renders entry content.
 *
 * New entries saved by the contentEditable editor are stored as HTML and
 * rendered directly with dangerouslySetInnerHTML (safe — this is user's own
 * private diary content, never injected from another user).
 *
 * Legacy entries stored as plain text (possibly with markdown markers) are
 * rendered by the original line-by-line parser below so old data is unaffected.
 */
function renderContent(content) {
  if (!content) return null;

  // ── HTML content (new editor) ──────────────────────────────────────────────
  if (/<[a-zA-Z]/.test(content)) {
    return (
      <div
        className="diary-html-content text-[15px] leading-[1.75] text-slate-700"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  // ── Legacy plain-text rendering ────────────────────────────────────────────
  // Parse inline markdown markers into React elements
  function renderInline(text, keyBase) {
    const pattern = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*/g;
    const nodes = [];
    let last = 0; let m; let k = 0;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) nodes.push(text.slice(last, m.index));
      if      (m[1] !== undefined) nodes.push(<strong key={`${keyBase}-${k++}`}>{m[1]}</strong>);
      else if (m[2] !== undefined) nodes.push(<u      key={`${keyBase}-${k++}`}>{m[2]}</u>);
      else if (m[3] !== undefined) nodes.push(<s      key={`${keyBase}-${k++}`}>{m[3]}</s>);
      else if (m[4] !== undefined) nodes.push(<em     key={`${keyBase}-${k++}`}>{m[4]}</em>);
      last = pattern.lastIndex;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  }

  const paragraphs = content.split(/\n\n+/);
  return (
    <div className="text-[15px] leading-[1.75] text-slate-700">
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').filter(l => l.length > 0);
        const isNumbered = lines.length > 0 && lines.every(l => /^\d+[.)]\s/.test(l.trim()));
        const isBulleted = lines.length > 0 && lines.every(l => /^[-*•]\s/.test(l.trim()));

        if (isNumbered) {
          return (
            <ol key={pi} className="pl-6 mb-4 list-decimal">
              {lines.map((line, li) => (
                <li key={li} className="mb-1.5">
                  {renderInline(line.replace(/^\d+[.)]\s/, '').trim(), `${pi}-${li}`)}
                </li>
              ))}
            </ol>
          );
        }
        if (isBulleted) {
          return (
            <ul key={pi} className="pl-6 mb-4 list-disc">
              {lines.map((line, li) => (
                <li key={li} className="mb-1.5">
                  {renderInline(line.replace(/^[-*•]\s/, '').trim(), `${pi}-${li}`)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={pi} className="mb-3">
            {lines.map((line, li) => (
              <p key={li} className="mb-1">{renderInline(line, `${pi}-${li}`)}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function DiaryView({ entry, onBack, onEdit, onDelete, onArchive, onUnarchive, showToast }) {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="fade-in">
      {shareOpen && (
        <ShareEntryModal
          entry={entry}
          onClose={() => setShareOpen(false)}
          showToast={showToast || (() => {})}
        />
      )}

      <button className="btn btn-ghost mb-3" onClick={onBack}>
        <ChevronLeft size={18} /> Back to Diary
      </button>

      <div className="card">
        <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
          <div className="flex-1 min-w-[60%]" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="entry-title m-0" style={{ fontSize: 'clamp(20px, 5vw, 26px)', wordBreak: 'break-word' }}>
                {entry.title || 'Untitled'}
              </h2>
              {entry.tag && <TagBadge tag={entry.tag} />}
            </div>
            <p className="text-sm text-slate-500 m-0">
              {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
              {wasEdited(entry.createdAt, entry.updatedAt) && (
                <span className="ml-2 italic">
                  (edited {formatDate(entry.updatedAt)})
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap entry-actions">
            <button className="btn btn-sm btn-gold" onClick={() => onEdit(entry)}>
              <Edit3 size={14} /> Edit
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setShareOpen(true)}
              title="Email this entry to one or more people"
            >
              <Share2 size={14} /> Share
            </button>
            {entry.archived ? (
              <button className="btn btn-sm btn-outline" onClick={() => onUnarchive(entry.id)}>
                <RotateCcw size={14} /> Unarchive
              </button>
            ) : (
              <button className="btn btn-sm btn-outline" onClick={() => {
                if (window.confirm('Archive this entry? You can find it in the Archived section anytime.')) {
                  onArchive(entry.id);
                }
              }}>
                <Archive size={14} /> Archive
              </button>
            )}
            <button className="btn btn-sm btn-red" onClick={() => {
              if (window.confirm('Are you sure you want to delete this entry?')) {
                onDelete(entry.id);
              }
            }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4 pb-2">
          {renderContent(entry.content)}
        </div>

        {/* Legacy drawings from old entries */}
        {entry.drawings?.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm text-slate-500 mb-2.5 font-semibold">Attached Drawings</h4>
            <div className="flex gap-3 flex-wrap">
              {entry.drawings.map((d, i) => (
                <img
                  key={i}
                  src={d}
                  alt={`Drawing ${i + 1}`}
                  className="rounded-lg border border-slate-200 max-w-full cursor-pointer"
                  style={{ maxHeight: 400 }}
                  onClick={() => window.open(d, '_blank')}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
