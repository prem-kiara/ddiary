import { useState } from 'react';
import { BookOpen, Plus, Trash2, RotateCcw, Archive, ChevronRight, ChevronDown } from 'lucide-react';
import { formatDateTime, formatTime } from '../utils/dates';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 className="section-title">Your Entries</h2>
        <button className="btn btn-gold" onClick={onNew}>
          <Plus size={18} /> New Entry
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="card empty-state">
          <BookOpen size={48} color="#c9a96e" />
          <p>Your diary is empty.</p>
          <p style={{ fontSize: 14, marginTop: 4 }}>Start writing your first entry!</p>
        </div>
      ) : (
        entries.map(entry => {
          const isExpanded = expandedId === entry.id;
          return (
            <div key={entry.id} className="card" style={{ cursor: 'default', padding: 0, overflow: 'hidden' }}>
              {/* ── Header row (always visible) ── */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '14px 16px', cursor: 'pointer',
                }}
                onClick={() => toggleExpand(entry.id)}
              >
                <span style={{ fontSize: 20, flexShrink: 0 }}>📝</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="entry-title" style={{ margin: 0 }}>{entry.title || 'Untitled'}</h3>
                  <p className="entry-date" style={{ margin: 0 }}>
                    {formatDateTime(entry.createdAt)} · {formatTime(entry.createdAt)}
                  </p>
                </div>
                {/* Archive button */}
                <button
                  className="btn-icon"
                  title="Archive this entry"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Archive this entry? Find it anytime in the Archived section below.')) {
                      onArchive(entry.id);
                    }
                  }}
                  style={{ flexShrink: 0 }}
                >
                  <Archive size={16} />
                </button>
                {/* Expand/collapse chevron */}
                <button
                  className="btn-icon"
                  title={isExpanded ? 'Collapse' : 'Expand'}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id); }}
                  style={{ color: '#8B6914', flexShrink: 0 }}
                >
                  {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
              </div>

              {/* ── Expanded content ── */}
              {isExpanded && (
                <div style={{
                  borderTop: '1px solid #f0e6d2',
                  padding: '12px 16px 16px',
                  background: '#fffdf8',
                }}>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 15,
                    lineHeight: 1.8,
                    color: '#4a3728',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    marginBottom: 14,
                  }}>
                    {entry.content || <em style={{ color: '#b5a898' }}>No content</em>}
                  </p>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => onView(entry)}
                    style={{ fontSize: 13 }}
                  >
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
        <div style={{ marginTop: 32 }}>
          <button
            onClick={() => setArchiveOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              color: '#8a7a6a', fontSize: 14, padding: '4px 0', marginBottom: 8,
            }}
          >
            <Archive size={14} />
            Archived ({archivedEntries.length})
            <span style={{ fontSize: 11 }}>{archiveOpen ? '▲' : '▼'}</span>
          </button>

          {archiveOpen && (
            <div className="card" style={{ background: '#f5f0e8' }}>
              <p style={{ fontSize: 12, color: '#b5a898', marginBottom: 12 }}>
                These entries are archived for reference. Unarchive to bring them back to your main diary.
              </p>
              {archivedEntries.map(entry => (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)',
                }}>
                  <Archive size={16} color="#b5a898" />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onView(entry)}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#6b5a4a' }}>
                      {entry.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize: 12, color: '#b5a898' }}>
                      {formatDateTime(entry.createdAt)}
                    </div>
                    {entry.content && (
                      <div style={{ fontSize: 13, color: '#b5a898', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                        {entry.content}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    title="Unarchive entry"
                    onClick={() => onUnarchive(entry.id)}
                    style={{ padding: '4px 10px', flexShrink: 0 }}
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
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setTrashOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              color: '#8a7a6a', fontSize: 14, padding: '4px 0', marginBottom: 8,
            }}
          >
            <Trash2 size={14} />
            Recently Deleted ({trashedEntries.length})
            <span style={{ fontSize: 11 }}>{trashOpen ? '▲' : '▼'}</span>
          </button>

          {trashOpen && (
            <div className="card" style={{ background: '#f5f0e8' }}>
              <p style={{ fontSize: 12, color: '#b5a898', marginBottom: 12 }}>
                These entries have been deleted. Restore them or permanently remove them.
              </p>
              {trashedEntries.map(entry => (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)',
                }}>
                  <span style={{ fontSize: 20 }}>📝</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#6b5a4a' }}>
                      {entry.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize: 12, color: '#b5a898' }}>
                      {formatDateTime(entry.createdAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    title="Restore entry"
                    onClick={() => onRestore(entry.id)}
                    style={{ padding: '4px 10px' }}
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
                    <Trash2 size={15} color="#c0392b" />
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
