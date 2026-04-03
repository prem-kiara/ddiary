import { ChevronLeft, Edit3, Trash2 } from 'lucide-react';

const MOODS = {
  happy: '😊', sad: '😢', neutral: '😐',
  excited: '🤩', thoughtful: '🤔', tired: '😴',
  grateful: '🙏', anxious: '😰', calm: '🧘',
};

const formatDate = (d) => {
  if (!d) return '';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const formatTime = (d) => {
  if (!d) return '';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

export default function DiaryView({ entry, onBack, onEdit, onDelete }) {
  return (
    <div className="fade-in">
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>
        <ChevronLeft size={18} /> Back to Diary
      </button>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 28 }}>{MOODS[entry.mood] || '📝'}</span>
              <h2 style={{ fontFamily: "'Caveat', cursive", fontSize: 32 }}>{entry.title || 'Untitled'}</h2>
            </div>
            <p style={{ color: '#8a7a6a', fontSize: 14 }}>
              {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
              {entry.updatedAt && entry.updatedAt !== entry.createdAt && (
                <span style={{ marginLeft: 8, fontStyle: 'italic' }}>
                  (edited {formatDate(entry.updatedAt)})
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-gold" onClick={() => onEdit(entry)}>
              <Edit3 size={14} /> Edit
            </button>
            <button className="btn btn-sm btn-red" onClick={() => {
              if (window.confirm('Are you sure you want to delete this entry?')) {
                onDelete(entry.id);
              }
            }}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>

        <div className="reading-content">{entry.content}</div>

        {entry.drawings?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h4 style={{ color: '#8a7a6a', marginBottom: 10, fontSize: 14 }}>Drawings & Sketches</h4>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {entry.drawings.map((d, i) => (
                <img
                  key={i}
                  src={d}
                  alt={`Drawing ${i + 1}`}
                  style={{
                    borderRadius: 8,
                    border: '1px solid #e8d5b7',
                    maxWidth: '100%',
                    maxHeight: 400,
                    cursor: 'pointer'
                  }}
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
