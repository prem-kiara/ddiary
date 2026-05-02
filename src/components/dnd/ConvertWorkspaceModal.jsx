/**
 * Modal shown when a user drags a workspace and drops it on another workspace.
 *
 * Behavior: the source workspace becomes a CATEGORY (or SUB-CATEGORY) inside
 * the destination, and all of its tasks land under that new bucket. The source
 * workspace is then deleted.
 *
 * Choices:
 *   - Bucket type: top-level category, or sub-category under a chosen parent
 *   - Bucket name: defaults to the source workspace's name, but editable
 *
 * Caveat: any category/sub-category structure inside the source workspace is
 * flattened — every source task lands directly under the new bucket. (Nested
 * preservation can be added later if needed.)
 */
import { useEffect, useState } from 'react';
import { X, AlertTriangle, Folder, FolderTree } from 'lucide-react';
import { countWorkspaceTasks } from '../../utils/dndMutations';

export default function ConvertWorkspaceModal({
  srcWorkspace, destWorkspace, onConfirm, onCancel,
}) {
  const [bucketName, setBucketName] = useState(srcWorkspace?.name || '');
  const [asSubcategory, setAsSubcategory] = useState(false);
  const [parentCategoryId, setParentCategoryId] = useState(null);
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

  const destCats = destWorkspace?.categories || [];
  const canSubcategory = destCats.length > 0;

  // Auto-pick first parent when switching to sub-category
  useEffect(() => {
    if (asSubcategory && !parentCategoryId && destCats.length > 0) {
      setParentCategoryId(destCats[0].id);
    }
  }, [asSubcategory, parentCategoryId, destCats]);

  const handleConfirm = async () => {
    setError('');
    const trimmed = (bucketName || '').trim();
    if (!trimmed) {
      setError('Give the new bucket a name.');
      return;
    }
    if (asSubcategory && !parentCategoryId) {
      setError('Pick a parent category to nest the new sub-category under.');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        bucketName:       trimmed,
        asSubcategory,
        parentCategoryId: asSubcategory ? parentCategoryId : null,
      });
    } catch (e) {
      setError(e?.message || 'Conversion failed.');
      setSubmitting(false);
    }
  };

  const parentName = destCats.find(c => c.id === parentCategoryId)?.name || '';
  const previewPath = asSubcategory
    ? `${destWorkspace?.name} › ${parentName} › ${bucketName.trim() || '(name)'}`
    : `${destWorkspace?.name} › ${bucketName.trim() || '(name)'}`;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-body"
        style={{ maxWidth: 540, width: 'min(540px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Move workspace into <em style={{ color: '#7c3aed', fontStyle: 'normal' }}>{destWorkspace?.name}</em>
          </h3>
          <button className="btn-icon" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>

        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', padding: 10, borderRadius: 8, marginBottom: 14, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="#6d28d9" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: '#5b21b6', lineHeight: 1.5 }}>
            <strong>{srcWorkspace?.name}</strong>
            {srcTaskCount !== null && srcTaskCount > 0 && (
              <> ({srcTaskCount} task{srcTaskCount === 1 ? '' : 's'})</>
            )}
            {' '}will become a {asSubcategory ? 'sub-category' : 'category'} in <strong>{destWorkspace?.name}</strong>, and the workspace itself will be deleted. Comments, activity, and member assignments don't carry over.
          </div>
        </div>

        {/* Bucket type radio */}
        <label className="label">Convert as</label>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label
            style={{
              border:       !asSubcategory ? '2px solid #7c3aed' : '1px solid #e2e8f0',
              borderRadius: 8, padding: 10, cursor: 'pointer',
              display: 'flex', gap: 10, alignItems: 'flex-start',
              background:   !asSubcategory ? '#f5f3ff' : '#fff',
            }}
          >
            <input
              type="radio" name="bucketType"
              checked={!asSubcategory}
              onChange={() => setAsSubcategory(false)}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Folder size={14} /> Category (top level)
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Becomes a new category in {destWorkspace?.name}.
              </div>
            </div>
          </label>

          <label
            style={{
              border:       asSubcategory ? '2px solid #7c3aed' : '1px solid #e2e8f0',
              borderRadius: 8, padding: 10,
              cursor:       canSubcategory ? 'pointer' : 'not-allowed',
              display: 'flex', gap: 10, alignItems: 'flex-start',
              background:   asSubcategory ? '#f5f3ff' : '#fff',
              opacity:      canSubcategory ? 1 : 0.55,
            }}
          >
            <input
              type="radio" name="bucketType"
              checked={asSubcategory}
              disabled={!canSubcategory}
              onChange={() => canSubcategory && setAsSubcategory(true)}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FolderTree size={14} /> Sub-category
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {canSubcategory
                  ? `Nested under one of ${destWorkspace?.name}'s existing categories.`
                  : `${destWorkspace?.name} has no categories yet — create one first.`}
              </div>
              {asSubcategory && canSubcategory && (
                <select
                  value={parentCategoryId || ''}
                  onChange={(e) => setParentCategoryId(e.target.value || null)}
                  className="input"
                  style={{ marginTop: 8 }}
                >
                  {destCats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </label>
        </div>

        {/* Editable bucket name */}
        <label className="label">{asSubcategory ? 'Sub-category' : 'Category'} name</label>
        <input
          type="text"
          value={bucketName}
          onChange={(e) => setBucketName(e.target.value)}
          placeholder={srcWorkspace?.name}
          className="input"
          autoFocus
        />

        {/* Live preview */}
        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
          Preview: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#0f172a' }}>
            {previewPath}
          </code>
          {srcTaskCount > 0 && <> · {srcTaskCount} task{srcTaskCount === 1 ? '' : 's'} will land here</>}
        </div>

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
