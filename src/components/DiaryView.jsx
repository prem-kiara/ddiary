import { ChevronLeft, Edit3, Trash2, Archive, ArchiveRestore } from 'lucide-react';

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

/** Renders entry content with each line/paragraph on its own line. */
function renderContent(content) {
  if (!content) return null;

  // Split into paragraphs (double newline) or lines (single newline)
  const paragraphs = content.split(/\n\n+/);

  return (
    <div style={{ fontSize: 16, lineHeight: 2, fontFamily: 'var(--font-body)' }}>
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').filter(l => l.length > 0);

        // Detect numbered list (lines starting with 1. or 1))
        const isNumbered = lines.length > 0 && lines.every(l => /^\d+[.)]\s/.test(l.trim()));
        // Detect bullet list (lines starting with - * or •)
        const isBulleted = lines.length > 0 && lines.every(l => /^[-*•]\s/.test(l.trim()));

        if (isNumbered) {
          return (
            <ol key={pi} style={{ paddingLeft: 24, marginBottom: 16 }}>
              {lines.map((line, li) => (
                <li key={li} style={{ marginBottom: 6 }}>
                  {line.replace(/^\d+[.)]\s/, '').trim()}
                </li>
              ))}
            </ol>
          );
        }

        if (isBulleted) {
          return (
            <ul key={pi} style={{ paddingLeft: 24, marginBottom: 16 }}>
              {lines.map((line, li) => (
                <li key={li} style={{ marginBottom: 6 }}>
                  {line.replace(/^[-*•]\s/, '').trim()}
                </li>
              ))}
            </ul>
          );
        }

        // Plain paragraphs / lines — each on its own line
        return (
          <div key={pi} style={{ marginBottom: 12 }}>
            {lines.map((line, li) => (
              <p key={li} style={{ marginBottom: 4 }}>{line}</p>
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
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>
        <ChevronLeft size={18} /> Back to Diary
      </button>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ fontFamily: "'Caveat', cursive", fontSize: 32, marginBottom: 4 }}>
              {entry.title || 'Untitled'}
            </h2>
            <p style={{ color: '#8a7a6a', fontSize: 14 }}>
              {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
              {entry.updatedAt && entry.updatedAt !== entry.createdAt && (
                <span style={{ marginLeft: 8, fontStyle: 'italic' }}>
                  (edited {formatDate(entry.updatedAt)})
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-gold" onClick={() => onEdit(entry)}>
              <Edit3 size={14} /> Edit
            </button>
            {entry.archived ? (
              <button className="btn btn-sm btn-outline" onClick={() => onUnarchive(entry.id)}>
                <ArchiveRestore size={14} /> Unarchive
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

        <div style={{
          borderTop: '1px solid #e8d5b7',
          paddingTop: 16,
          backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, #e8d5b7 31px, #e8d5b7 32px)',
          backgroundPosition: '0 4px',
          paddingBottom: 8,
        }}>
          {renderContent(entry.content)}
        </div>

        {/* Legacy drawings from old entries */}
        {entry.drawings?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h4 style={{ color: '#8a7a6a', marginBottom: 10, fontSize: 14 }}>Attached Drawings</h4>
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
