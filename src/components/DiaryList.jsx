import { useState } from 'react';
import { BookOpen, Plus, Trash2, RotateCcw, Archive, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { formatDateTime, formatTime } from '../utils/dates';
import { TagBadge } from './shared/Pills';

// Rotating accent for the entry's left border. Stable per-entry via hash.
const ENTRY_ACCENTS = [
  'border-l-violet-400',
  'border-l-amber-400',
  'border-l-teal-400',
  'border-l-blue-400',
  'border-l-rose-400',
  'border-l-emerald-400',
  'border-l-indigo-400',
];

function pickAccent(id = '') {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return ENTRY_ACCENTS[h % ENTRY_ACCENTS.length];
}

export default function DiaryList({
  entries, trashedEntries = [], archivedEntries = [],
  loading, onView, onNew, onRestore, onPurge, onArchive, onUnarchive,
}) {
  const [trashOpen, setTrashOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const toggleExpand = (id) => setExpandedId(prev => (prev === id ? null : id));

  if (loading) {
    return <div className="empty-state fade-in"><p>Loading your entries...</p></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="section-title mb-0">Your Entries</h2>
          <p className="text-sm text-slate-500 mt-0.5">Your thoughts, meetings, and ideas in one place.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-gold" onClick={onNew}>
            <Plus size={16} /> New Entry
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="card empty-state">
          <BookOpen size={40} className="text-violet-400" />
          <p>Your diary is empty.</p>
          <p className="text-sm mt-1 text-slate-500">Start writing your first entry.</p>
        </div>
      ) : (
        entries.map(entry => {
          const isExpanded = expandedId === entry.id;
          const accent = pickAccent(entry.id);
          return (
            <div
              key={entry.id}
              className={`card overflow-hidden border-l-4 ${accent}`}
              style={{ padding: 0, cursor: 'default' }}
            >
              {/* ── Header row (always visible) ── */}
              <div
                className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
                onClick={() => toggleExpand(entry.id)}
              >
                <div className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                  <FileText size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <h3 className="entry-title truncate m-0">{entry.title || 'Untitled'}</h3>
                    {entry.tag && <TagBadge tag={entry.tag} />}
                  </div>
                  <p className="entry-date m-0">
                    {formatDateTime(entry.createdAt)} · {formatTime(entry.createdAt)}
                  </p>
                </div>
                <button
                  className="btn-icon flex-shrink-0"
                  title="Archive this entry"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Archive this entry? Find it anytime in the Archived section below.')) {
                      onArchive(entry.id);
                    }
                  }}
                >
                  <Archive size={16} />
                </button>
                <button
                  className="btn-icon flex-shrink-0"
                  title={isExpanded ? 'Collapse' : 'Expand'}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id); }}
                  style={{ color: 'var(--gold)' }}
                >
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
              </div>

              {/* ── Expanded content ── */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-4 pt-3 pb-4">
                  <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap mb-3">
                    {entry.content || <em className="text-slate-400">No content</em>}
                  </p>
                  <button className="btn btn-sm btn-outline" onClick={() => onView(entry)}>
                    <ChevronRight size={14} /> Open Full Entry
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ── Archived Entries ─────────────────────────────────────────── */}
      {archivedEntries.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setArchiveOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-2 w-full text-left"
          >
            <Archive size={14} />
            <span className="flex-1">Archived ({archivedEntries.length})</span>
            <span className="text-slate-400 flex">
              {archiveOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {archiveOpen && (
            <div className="card bg-slate-50 border-slate-200">
              <p className="text-xs text-slate-500 mb-3">
                These entries are archived for reference. Unarchive to bring them back to your main diary.
              </p>
              {archivedEntries.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-b-0">
                  <Archive size={16} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onView(entry)}>
                    <div className="font-semibold text-sm text-slate-700 truncate">
                      {entry.title || 'Untitled'}
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</div>
                    {entry.content && (
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{entry.content}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-outline flex-shrink-0"
                    title="Unarchive entry"
                    onClick={() => onUnarchive(entry.id)}
                  >
                    <RotateCcw size={13} /> Unarchive
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recently Deleted ─────────────────────────────────────────── */}
      {trashedEntries.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setTrashOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-2 w-full text-left"
          >
            <Trash2 size={14} />
            <span className="flex-1">Recently Deleted ({trashedEntries.length})</span>
            <span className="text-slate-400 flex">
              {trashOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {trashOpen && (
            <div className="card bg-slate-50 border-slate-200">
              <p className="text-xs text-slate-500 mb-3">
                These entries have been deleted. Restore them or permanently remove them.
              </p>
              {trashedEntries.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-b-0">
                  <FileText size={16} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-700 truncate">
                      {entry.title || 'Untitled'}
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline flex-shrink-0"
                    title="Restore entry"
                    onClick={() => onRestore(entry.id)}
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className="btn-icon"
                    title="Delete permanently"
                    onClick={() => {
                      if (window.confirm('Permanently delete this entry? This cannot be undone.')) {
                        onPurge(entry.id);
                      }
                    }}
                  >
                    <Trash2 size={15} color="#dc2626" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
