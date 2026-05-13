/**
 * SpreadsheetList — shows the user's saved sheets with soft-delete and archive,
 * matching the Diary workflow: archive keeps items reachable, trash soft-deletes,
 * and purge permanently removes.
 *
 * v2: adds Share Sheet feature — share button per card, "Shared with me" section.
 */
import { useState } from 'react';
import {
  Plus, Table2, Trash2, FileSpreadsheet,
  Archive, RotateCcw, ChevronRight, ChevronDown,
  Share2, Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { shareSheet, useMySharedSheets } from '../hooks/useSharedSheets';
import ShareSheetModal from './ShareSheetModal';

const formatDate = (ts) => {
  if (!ts) return '';
  const ms = ts?.seconds ? ts.seconds * 1000 : ts?.toMillis?.() ?? new Date(ts).getTime();
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
};

export default function SpreadsheetList({
  sheets, archivedSheets = [], trashedSheets = [],
  loading, onOpen, onNew,
  onTrash, onRestore, onPurge,
  onArchive, onUnarchive,
  onOpenShared,
}) {
  const { user } = useAuth();
  const { sharedSheets: collaboratedSheets } = useMySharedSheets(user?.uid);

  const [newTitle,     setNewTitle]     = useState('');
  const [creating,     setCreating]     = useState(false);
  const [myOpen,       setMyOpen]       = useState(true);
  const [sharedOpen,   setSharedOpen]   = useState(true);
  const [archiveOpen,  setArchiveOpen]  = useState(false);
  const [trashOpen,    setTrashOpen]    = useState(false);
  const [sharingSheet, setSharingSheet] = useState(null); // { id, title }
  const [sharingBusy,  setSharingBusy]  = useState(null); // sheetId being shared

  const handleCreate = async () => {
    const t = newTitle.trim() || 'Untitled Sheet';
    setCreating(true);
    try {
      const ref = await onNew(t);
      setNewTitle('');
      if (ref?.id) onOpen({ id: ref.id, title: t, data: {}, cols: 10, rows: 50 });
    } finally {
      setCreating(false);
    }
  };

  const handleShare = async (e, sheet) => {
    e.stopPropagation();
    if (sheet.isShared) {
      setSharingSheet({ id: sheet.id, title: sheet.title });
      return;
    }
    setSharingBusy(sheet.id);
    try {
      await shareSheet(sheet, user);
      setSharingSheet({ id: sheet.id, title: sheet.title });
    } catch (err) {
      console.error('Failed to share sheet:', err);
    } finally {
      setSharingBusy(null);
    }
  };

  // Sheets shared with me (I'm a member but not the owner)
  const sharedWithMe = collaboratedSheets.filter(s => s.ownerId !== user?.uid);

  return (
    <div className="fade-in">
      {/* ── Page header ── */}
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileSpreadsheet size={22} style={{ color: 'var(--gold)' }} />
          <div>
            <h2 className="section-title mb-0">My Sheets</h2>
            <p className="text-sm text-slate-500 mt-0.5">Spreadsheets stored in your workspace.</p>
          </div>
        </div>
        <div className="page-actions">
          <input
            className="input"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Sheet name…"
            style={{ marginBottom: 0, width: 180 }}
          />
          <button className="btn btn-gold" onClick={handleCreate} disabled={creating}>
            <Plus size={15} />
            {creating ? 'Creating…' : 'New Sheet'}
          </button>
        </div>
      </div>

      {/* ── My Sheets section (collapsible) ── */}
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={() => setMyOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 10px',
            textAlign: 'left' }}
        >
          <Table2 size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink-light)',
            textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            My Sheets ({sheets.length})
          </span>
          <span style={{ color: 'var(--ink-lighter)' }}>
            {myOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>

        {myOpen && (loading ? (
          <div className="empty-state fade-in"><p>Loading sheets…</p></div>
        ) : sheets.length === 0 ? (
          <div className="card empty-state">
            <Table2 size={36} className="text-violet-400" />
            <p>No sheets yet.</p>
            <p className="text-sm mt-1 text-slate-500">Create your first sheet above.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {sheets.map(sheet => (
              <div
                key={sheet.id}
                className="card"
                style={{ cursor: 'pointer', padding: '16px 18px', position: 'relative' }}
                onClick={() => onOpen(sheet)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Table2 size={20} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 100 }}>
                    <p style={{
                      margin: '0 0 4px', fontWeight: 600, fontSize: 15,
                      fontFamily: 'var(--font-heading)', color: 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {sheet.title || 'Untitled Sheet'}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-lighter)', fontFamily: 'var(--font-body)' }}>
                      Updated {formatDate(sheet.updatedAt)}
                    </p>
                    {sheet.isShared && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                        background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                        display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                        <Users size={9} /> Shared
                      </span>
                    )}
                  </div>
                </div>

                {/* Share + Archive + Trash buttons */}
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4 }}>
                  <button
                    className="btn-icon"
                    title={sheet.isShared ? 'Manage sharing' : 'Share this sheet'}
                    disabled={sharingBusy === sheet.id}
                    onClick={e => handleShare(e, sheet)}
                    style={{ color: sheet.isShared ? '#16a34a' : undefined }}
                  >
                    {sharingBusy === sheet.id
                      ? <span style={{ fontSize: 11 }}>…</span>
                      : <Share2 size={14} />
                    }
                  </button>
                  <button
                    className="btn-icon"
                    title="Archive this sheet"
                    onClick={e => {
                      e.stopPropagation();
                      if (window.confirm('Archive this sheet? You can restore it from the Archived section below.')) {
                        onArchive(sheet.id);
                      }
                    }}
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    title="Move to trash"
                    onClick={e => {
                      e.stopPropagation();
                      if (window.confirm(`Move "${sheet.title || 'Untitled Sheet'}" to trash?`)) {
                        onTrash(sheet.id);
                      }
                    }}
                  >
                    <Trash2 size={14} style={{ color: '#dc2626' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Shared with me section (collapsible) ── */}
      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => setSharedOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 10px',
            textAlign: 'left' }}
        >
          <Users size={14} style={{ color: '#0891b2', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink-light)',
            textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Shared with me ({sharedWithMe.length})
          </span>
          <span style={{ color: 'var(--ink-lighter)' }}>
            {sharedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>

        {sharedOpen && (sharedWithMe.length === 0 ? (
          <div style={{ padding: '12px 0', color: 'var(--ink-lighter)', fontSize: 13,
            fontStyle: 'italic' }}>
            No sheets shared with you yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {sharedWithMe.map(s => (
              <div
                key={s.id}
                className="card"
                style={{ cursor: 'pointer', padding: '16px 18px',
                  border: '1px solid #bae6fd', background: '#f0f9ff' }}
                onClick={() => onOpenShared?.(s)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: '#0891b222',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Users size={18} style={{ color: '#0891b2' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: '0 0 4px', fontWeight: 600, fontSize: 15,
                      fontFamily: 'var(--font-heading)', color: 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.title || 'Untitled Sheet'}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#0891b2', fontFamily: 'var(--font-body)' }}>
                      Shared by {s.ownerName || s.ownerEmail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Archived Sheets ── */}
      {archivedSheets.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setArchiveOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-2 w-full text-left"
          >
            <Archive size={14} />
            <span className="flex-1">Archived ({archivedSheets.length})</span>
            <span className="text-slate-400 flex">
              {archiveOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {archiveOpen && (
            <div className="card bg-slate-50 border-slate-200">
              <p className="text-xs text-slate-500 mb-3">
                These sheets are archived for reference. Unarchive to bring them back.
              </p>
              {archivedSheets.map(sheet => (
                <div key={sheet.id} className="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-b-0">
                  <Archive size={16} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(sheet)}>
                    <div className="font-semibold text-sm text-slate-700 truncate">
                      {sheet.title || 'Untitled Sheet'}
                    </div>
                    <div className="text-xs text-slate-500">{formatDate(sheet.updatedAt)}</div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline flex-shrink-0"
                    title="Unarchive sheet"
                    onClick={() => onUnarchive(sheet.id)}
                  >
                    <RotateCcw size={13} /> Unarchive
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recently Deleted ── */}
      {trashedSheets.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setTrashOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-2 w-full text-left"
          >
            <Trash2 size={14} />
            <span className="flex-1">Recently Deleted ({trashedSheets.length})</span>
            <span className="text-slate-400 flex">
              {trashOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {trashOpen && (
            <div className="card bg-slate-50 border-slate-200">
              <p className="text-xs text-slate-500 mb-3">
                These sheets have been deleted. Restore them or permanently remove them.
              </p>
              {trashedSheets.map(sheet => (
                <div key={sheet.id} className="flex items-center gap-3 py-2.5 border-b border-slate-200 last:border-b-0">
                  <FileSpreadsheet size={16} className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-700 truncate">
                      {sheet.title || 'Untitled Sheet'}
                    </div>
                    <div className="text-xs text-slate-500">{formatDate(sheet.updatedAt)}</div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline flex-shrink-0"
                    title="Restore sheet"
                    onClick={() => onRestore(sheet.id)}
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className="btn-icon"
                    title="Delete permanently"
                    onClick={() => {
                      if (window.confirm('Permanently delete this sheet? This cannot be undone.')) {
                        onPurge(sheet.id);
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

      {/* ── Share Sheet Modal ── */}
      {sharingSheet && (
        <ShareSheetModal
          sheetId={sharingSheet.id}
          sheetTitle={sharingSheet.title}
          currentUser={user}
          onClose={() => setSharingSheet(null)}
        />
      )}
    </div>
  );
}
