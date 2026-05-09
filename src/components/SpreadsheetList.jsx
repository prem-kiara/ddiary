/**
 * SpreadsheetList — shows the user's saved sheets and lets them
 * create, open, rename (inline), or delete sheets.
 */
import { useState } from 'react';
import { Plus, Table2, Trash2, FileSpreadsheet } from 'lucide-react';

const formatDate = (ts) => {
  if (!ts) return '';
  // Firestore Timestamp or plain object with .seconds
  const ms = ts?.seconds ? ts.seconds * 1000 : ts?.toMillis?.() ?? new Date(ts).getTime();
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
};

export default function SpreadsheetList({ sheets, loading, onOpen, onNew, onDelete }) {
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const t = newTitle.trim() || 'Untitled Sheet';
    setCreating(true);
    try {
      const ref = await onNew(t);
      setNewTitle('');
      // onNew returns the Firestore DocumentReference — navigate to it
      if (ref?.id) onOpen({ id: ref.id, title: t, data: {}, cols: 10, rows: 50 });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fade-in">
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileSpreadsheet size={22} style={{ color: 'var(--gold)' }} />
          <h2 style={{ margin: 0, fontSize: 'clamp(18px, 4vw, 22px)', fontFamily: 'var(--font-heading)', color: 'var(--ink)' }}>
            My Sheets
          </h2>
        </div>

        {/* New sheet input */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Sheet name…"
            style={{ marginBottom: 0, width: 180 }}
          />
          <button
            className="btn btn-gold btn-sm"
            onClick={handleCreate}
            disabled={creating}
          >
            <Plus size={15} />
            {creating ? 'Creating…' : 'New Sheet'}
          </button>
        </div>
      </div>

      {/* ── Sheet list ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-lighter)', fontFamily: 'var(--font-body)' }}>
          Loading sheets…
        </div>
      ) : sheets.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px', color: 'var(--ink-lighter)',
          border: '2px dashed var(--paper-line)', borderRadius: 12,
          fontFamily: 'var(--font-body)',
        }}>
          <Table2 size={36} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
          <p style={{ margin: '0 0 4px', fontWeight: 600 }}>No sheets yet</p>
          <p style={{ margin: 0, fontSize: 13 }}>Create your first sheet above.</p>
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
                <div style={{ flex: 1, minWidth: 0 }}>
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
                </div>
              </div>

              {/* Delete button */}
              <button
                className="btn btn-sm btn-red"
                style={{ position: 'absolute', top: 10, right: 10, padding: '3px 7px' }}
                onClick={e => {
                  e.stopPropagation();
                  if (window.confirm(`Delete "${sheet.title || 'Untitled Sheet'}"? This cannot be undone.`)) {
                    onDelete(sheet.id);
                  }
                }}
                title="Delete sheet"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
