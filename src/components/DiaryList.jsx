import { BookOpen, Plus } from 'lucide-react';

const formatDate = (d) => {
  if (!d) return '';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
};

const formatTime = (d) => {
  if (!d) return '';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const MOODS = {
  happy: '😊', sad: '😢', neutral: '😐',
  excited: '🤩', thoughtful: '🤔', tired: '😴',
  grateful: '🙏', anxious: '😰', calm: '🧘',
};

export default function DiaryList({ entries, loading, onView, onNew }) {
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
                  {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
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
    </div>
  );
}
