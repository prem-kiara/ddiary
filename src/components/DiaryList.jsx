import { useState } from 'react';
import { useConfirm } from '../contexts/ConfirmContext';
import { BookOpen, Plus, Trash2, RotateCcw, Archive, ChevronRight, ChevronDown, FileText, Download, Users, Share2 } from 'lucide-react';
import { formatDateTime, formatTime } from '../utils/dates';
import { TagBadge } from './shared/Pills';
import { downloadEntryAsPDF } from '../utils/exportUtils';
import { useMySharedDiaries } from '../hooks/useSharedDiaries';
import { useAuth } from '../contexts/AuthContext';
import ShareEntryModal from './ShareEntryModal';

/** Returns true when content is HTML (new editor format). */
const isHtml = (s) => s && /<[a-zA-Z]/.test(s);

/** Strip HTML tags for single-line plain-text previews (archive/trash). */
function stripHtml(html) {
  if (!html) return '';
  if (!isHtml(html)) return html;
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const { user } = useAuth();
  const confirm = useConfirm();
  const { sharedDiaries } = useMySharedDiaries(user?.uid);

  // Entries shared with me = shared diaries where I'm NOT the owner
  const sharedWithMe = sharedDiaries.filter(d => d.ownerId !== user?.uid);

  const [entriesOpen,   setEntriesOpen]   = useState(true);
  const [trashOpen,     setTrashOpen]     = useState(false);
  const [archiveOpen,   setArchiveOpen]   = useState(false);
  const [sharedOpen,    setSharedOpen]    = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);
  const [sharingEntry,  setSharingEntry]  = useState(null);

  if (loading) {
    return <div className="empty-state fade-in"><p>Loading your entries...</p></div>;
  }

  return (
    <div className="fade-in">
      {sharingEntry && (
        <ShareEntryModal
          entry={sharingEntry}
          onClose={() => setSharingEntry(null)}
          showToast={() => {}}
        />
      )}
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setEntriesOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
          >
            <h2 className="section-title mb-0" style={{ margin: 0 }}>Your Entries</h2>
            <span style={{ color: 'var(--ink-lighter)', display: 'flex', alignItems: 'center' }}>
              {entriesOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-lighter)', fontFamily: 'var(--font-body)', marginLeft: 2 }}>
              {entries.length}
            </span>
          </button>
          {entriesOpen && (
            <p className="text-sm text-slate-500 mt-0.5">Your thoughts, meetings, and ideas in one place.</p>
          )}
        </div>
        <div className="page-actions">
          <button className="btn btn-gold" onClick={onNew}>
            <Plus size={16} /> New Entry
          </button>
        </div>
      </div>

      {entriesOpen && (entries.length === 0 ? (
        <div className="card empty-state">
          <BookOpen size={40} className="text-violet-400" />
          <p>Your diary is empty.</p>
          <p className="text-sm mt-1 text-slate-500">Start writing your first entry.</p>
        </div>
      ) : (
        entries.map(entry => {
          const accent = pickAccent(entry.id);
          return (
            <div
              key={entry.id}
              className={`card overflow-hidden border-l-4 ${accent}`}
              style={{ padding: 0, cursor: 'default' }}
            >
              <div
                className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
                onClick={() => onView(entry)}
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
                  title="Download as PDF"
                  disabled={downloadingId === entry.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDownloadingId(entry.id);
                    downloadEntryAsPDF(entry)
                      .catch(err => console.error('PDF download failed:', err))
                      .finally(() => setDownloadingId(null));
                  }}
                  style={{ color: '#7c3aed', opacity: downloadingId === entry.id ? 0.5 : 1 }}
                >
                  {downloadingId === entry.id
                    ? <span style={{ fontSize: 10 }}>…</span>
                    : <Download size={15} />
                  }
                </button>
                <button
                  className="btn-icon flex-shrink-0"
                  title="Share this entry via email"
                  onClick={(e) => { e.stopPropagation(); setSharingEntry(entry); }}
                >
                  <Share2 size={15} />
                </button>
                <button
                  className="btn-icon flex-shrink-0"
                  title="Archive this entry"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirm('Archive this entry? Find it anytime in the Archived section below.', { okText: 'Archive' })) {
                      onArchive(entry.id);
                    }
                  }}
                >
                  <Archive size={16} />
                </button>
              </div>
            </div>
          );
        })
      ))}

      {/* ── Shared with me ───────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => setSharedOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 10px',
            textAlign: 'left' }}
        >
          <Users size={14} style={{ color: '#7c3aed', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink-light)',
            textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Shared with me ({sharedWithMe.length})
          </span>
          <span style={{ color: 'var(--ink-lighter)' }}>
            {sharedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>

        {sharedOpen && (sharedWithMe.length === 0 ? (
          <div style={{ padding: '6px 0', color: 'var(--ink-lighter)', fontSize: 13, fontStyle: 'italic' }}>
            No diary entries shared with you yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sharedWithMe.map(d => (
              <div
                key={d.id}
                className="card"
                style={{ cursor: 'pointer', padding: '14px 18px',
                  border: '1px solid #ddd6fe', background: '#faf5ff' }}
                onClick={() => onView({ ...d, isSharedWithMe: true })}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: '#7c3aed22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Users size={18} style={{ color: '#7c3aed' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 3px', fontWeight: 600, fontSize: 15,
                      fontFamily: 'var(--font-heading)', color: 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.title || 'Untitled Entry'}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#7c3aed', fontFamily: 'var(--font-body)' }}>
                      Shared by {d.ownerName || d.ownerEmail}
                    </p>
                  </div>
                  {d.tag && (
                    <div style={{ flexShrink: 0 }}>
                      <TagBadge tag={d.tag} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

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
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                        {stripHtml(entry.content)}
                      </div>
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
                    onClick={async () => {
                      if (await confirm('Permanently delete this entry? This cannot be undone.', { danger: true, okText: 'Delete' })) {
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
