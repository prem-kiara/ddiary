import { ChevronLeft, Edit3, Trash2, Archive, RotateCcw } from 'lucide-react';
import { TagBadge } from './shared/Pills';
import { parseDate } from '../utils/dates';

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

/** Renders entry content with each line/paragraph on its own line. */
function renderContent(content) {
  if (!content) return null;

  // Split into paragraphs (double newline) or lines (single newline)
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="text-[15px] leading-[1.75] text-slate-700">
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').filter(l => l.length > 0);

        // Detect numbered list (lines starting with 1. or 1))
        const isNumbered = lines.length > 0 && lines.every(l => /^\d+[.)]\s/.test(l.trim()));
        // Detect bullet list (lines starting with - * or •)
        const isBulleted = lines.length > 0 && lines.every(l => /^[-*•]\s/.test(l.trim()));

        if (isNumbered) {
          return (
            <ol key={pi} className="pl-6 mb-4 list-decimal">
              {lines.map((line, li) => (
                <li key={li} className="mb-1.5">
                  {line.replace(/^\d+[.)]\s/, '').trim()}
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
                  {line.replace(/^[-*•]\s/, '').trim()}
                </li>
              ))}
            </ul>
          );
        }

        // Plain paragraphs / lines — each on its own line
        return (
          <div key={pi} className="mb-3">
            {lines.map((line, li) => (
              <p key={li} className="mb-1">{line}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function DiaryView({ entry, onBack, onEdit, onDelete, onArchive, onUnarchive }) {
  return (
    <div className="fade-in">
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
