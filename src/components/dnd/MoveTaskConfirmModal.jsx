/**
 * Confirm modal for cross-workspace task drag-and-drop.
 *
 * Lets the user pick the destination category/subcategory before commit.
 * Default destination is "Uncategorized" — keeps the path short and matches
 * the lowest-friction case (just drop on the workspace tile).
 */
import { useState } from 'react';
import { X } from 'lucide-react';

export default function MoveTaskConfirmModal({
  task, srcWorkspace, destWorkspace, onConfirm, onCancel,
}) {
  const [destCategoryId, setDestCategoryId] = useState(null);
  const [destSubcategoryId, setDestSubcategoryId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const cats = destWorkspace?.categories || [];
  const selectedCat = cats.find(c => c.id === destCategoryId);
  const subs = selectedCat?.subcategories || [];

  const handleConfirm = async () => {
    setError('');
    setSubmitting(true);
    try {
      await onConfirm({ destCategoryId, destSubcategoryId });
    } catch (e) {
      setError(e?.message || 'Move failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-body" style={{ maxWidth: 460, width: 'min(460px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Move task</h3>
          <button className="btn-icon" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>

        <p style={{ color: '#475569', fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
          Move <strong style={{ color: '#0f172a' }}>{task?.text || '(untitled task)'}</strong>
          {srcWorkspace?.name && <> from <em>{srcWorkspace.name}</em></>}
          {' '}to <em>{destWorkspace?.name || 'destination'}</em>?
        </p>

        <label className="label">Category in destination</label>
        <select
          value={destCategoryId || ''}
          onChange={(e) => { setDestCategoryId(e.target.value || null); setDestSubcategoryId(null); }}
          className="input"
        >
          <option value="">Uncategorized</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {subs.length > 0 && (
          <>
            <label className="label" style={{ marginTop: 8 }}>Sub-category</label>
            <select
              value={destSubcategoryId || ''}
              onChange={(e) => setDestSubcategoryId(e.target.value || null)}
              className="input"
            >
              <option value="">— none —</option>
              {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}

        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>
          Comments and activity history are not migrated.
        </p>

        {error && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 8, borderRadius: 6, fontSize: 13, marginTop: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-outline" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-teal" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Moving…' : 'Move task'}
          </button>
        </div>
      </div>
    </div>
  );
}
