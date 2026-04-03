import { useState } from 'react';
import { BookOpen, Plus, Trash2, RotateCcw } from 'lucide-react';
import { formatDateTime, formatTime } from '../utils/dates';

const MOODS = {
  happy: '😊', sad: '😢', neutral: '😐',
  excited: '🤩', thoughtful: '🤔', tired: '😴',
  grateful: '🙏', anxious: '😰', calm: '🧘',
};

export default function DiaryList({ entries, trashedEntries = [], loading, onView, onNew, onRestore, onPurge }) {
  const [trashOpen, setTrashOpen] = useState(false);

  if (loading) {
    return (
      <div className="empty-state fade-in">
        <p>Loading your entries...</p>
      </div>
    );
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
        entries.map(entry => (
          <div key={entry.id} className="card card-interactive" onClick={() => onView(entry)}>
            <div className="entry-card">
              <span className="entry-mood">{MOODS[entry.mood] || '📝'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className="entry-title">{entry.title || 'Untitled'}</h3>
                <p className="entry-date">
                  {formatDateTime(entry.createdAt)} · {formatTime(entry.createdAt)}
                </p>
                <p className="entry-preview">{entry.content}</p>
              </div>
              {entry.drawings?.length > 0 && (
                <img src={entry.drawings[0]} alt="Drawing" className="entry-drawing-thumb" />
              )}
            </div>
          </div>
        ))
      )}

      {/* ── Recently Deleted ─────────────────────────────────────────── */}
      {trashedEntries.length > 0 && (
        <div style={{ marginTop: 32 }}>
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
                  <span style={{ fontSize: 20 }}>{MOODS[entry.mood] || '📝'}</span>
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
