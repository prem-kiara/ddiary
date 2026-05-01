/**
 * "Ask each time" modal for the workspace → task drag-and-drop.
 *
 * Three modes for handling the source workspace's existing tasks:
 *   - siblings  — each src task becomes a separate task in the destination
 *   - checklist — src tasks become a checklist in the new task's notes
 *   - block     — proceed only if the src workspace has zero tasks
 *
 * In all modes the source workspace is deleted after the conversion.
 */
import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { countWorkspaceTasks } from '../../utils/dndMutations';

const MODES = [
  {
    id:    'siblings',
    label: 'Migrate tasks as siblings',
    desc:  'Each task in the source workspace becomes a separate task in the destination, alongside the new converted task.',
  },
  {
    id:    'checklist',
    label: 'Convert tasks to checklist',
    desc:  'Source tasks become a checklist in the new task’s notes. Loses status, assignee, and due dates per task.',
  },
  {
    id:    'block',
    label: 'Only if source is empty',
    desc:  'Convert only if the source workspace has no tasks. Safest if you’re sure it was created by accident.',
  },
];

export default function ConvertWorkspaceModal({
  srcWorkspace, destWorkspace, onConfirm, onCancel,
}) {
  const [mode, setMode] = useState('siblings');
  const [destCategoryId, setDestCategoryId] = useState(null);
  const [destSubcategoryId, setDestSubcategoryId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [srcTaskCount, setSrcTaskCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    countWorkspaceTasks(srcWorkspace?.id).then(n => {
      if (!cancelled) setSrcTaskCount(n);
    });
    return () => { cancelled = true; };
  }, [srcWorkspace?.id]);

  const cats = destWorkspace?.categories || [];
  const selectedCat = cats.find(c => c.id === destCategoryId);
  const subs = selectedCat?.subcategories || [];

  const handleConfirm = async () => {
    setError('');
    setSubmitting(true);
    try {
      await onConfirm({ mode, destCategoryId, destSubcategoryId });
    } catch (e) {
      setError(e?.message || 'Conversion failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-body" style={{ maxWidth: 540, width: 'min(540px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Convert workspace to task</h3>
          <button className="btn-icon" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>

        <div style={{ background: '#fef3c7', border: '1px solid #fde68a', padding: 10, borderRadius: 8, marginBottom: 14, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
            This will <strong>delete</strong> the workspace <em>{srcWorkspace?.name}</em>
            {srcTaskCount !== null && srcTaskCount > 0 && (
              <> (currently has <strong>{srcTaskCount}</strong> task{srcTaskCount === 1 ? '' : 's'})</>
            )}
            {' '}and create a new task in <em>{destWorkspace?.name}</em>. Comments, activity, and member assignments are not migrated.
          </div>
        </div>

        <label className="label">How to handle source tasks</label>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {MODES.map(m => (
            <label
              key={m.id}
              style={{
                border:       mode === m.id ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                borderRadius: 8,
                padding:      10,
                cursor:       'pointer',
                display:      'flex',
                gap:          10,
                background:   mode === m.id ? '#f5f3ff' : '#fff',
              }}
            >
              <input
                type="radio" name="convertMode" value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{m.desc}</div>
              </div>
            </label>
          ))}
        </div>

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

        {error && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 8, borderRadius: 6, fontSize: 13, marginTop: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-outline" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-teal" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Converting…' : 'Convert workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
