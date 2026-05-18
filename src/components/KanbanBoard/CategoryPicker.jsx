import { useState } from 'react';
import { Folder } from 'lucide-react';
import {
  addWorkspaceCategory, addWorkspaceSubcategory,
  moveWorkspaceTaskCategory,
} from '../../hooks/useWorkspace';

// ── Category Picker (visible inside TaskDetailModal, creator-only) ────────────
//
// Lets the workspace creator move a task between categories/subcategories and
// create new ones inline. Writes an activity-log entry on every move.
//
// Props:
//   task       — current task doc (reads task.categoryId / task.subcategoryId)
//   workspace  — workspace doc (reads workspace.categories)
//   user       — current Firebase user (for the activity log actor)
//   showToast  — optional toast callback (status feedback)
function CategoryPicker({ task, workspace, user, showToast }) {
  const categories = workspace?.categories || [];
  const currentCat = categories.find(c => c.id === task.categoryId) || null;
  const currentSub = currentCat?.subcategories?.find(s => s.id === task.subcategoryId) || null;

  const [newCatMode,  setNewCatMode]  = useState(false);
  const [newCatName,  setNewCatName]  = useState('');
  const [newSubMode,  setNewSubMode]  = useState(false);
  const [newSubName,  setNewSubName]  = useState('');
  const [busy,        setBusy]        = useState(false);

  const toastError = (msg, err) => {
    const detail = err?.code === 'permission-denied'
      ? 'Permission denied — Firestore rules may be stale. Redeploy them.'
      : (err?.message || '');
    if (showToast) showToast(`${msg}${detail ? ` (${detail})` : ''}`, 'warning');
  };

  const move = async ({ categoryId, subcategoryId, categoryName, subcategoryName }) => {
    setBusy(true);
    try {
      await moveWorkspaceTaskCategory(
        workspace.id,
        task.id,
        { categoryId, subcategoryId, categoryName, subcategoryName },
        user
      );
      if (showToast) {
        const label = !categoryId
          ? 'Uncategorized'
          : subcategoryName ? `${categoryName} / ${subcategoryName}` : categoryName;
        showToast(`Moved to ${label}`, 'success');
      }
    } catch (e) { toastError('Failed to move task', e); }
    finally { setBusy(false); }
  };

  const handleCategorySelect = async (value) => {
    if (value === '__new__') { setNewCatMode(true); return; }
    if (value === '__uncat__') {
      if (!task.categoryId) return;              // already uncategorised
      await move({ categoryId: null, subcategoryId: null });
      return;
    }
    if (value === task.categoryId) return;       // no-op
    const cat = categories.find(c => c.id === value);
    if (!cat) return;
    // Moving to a new category clears any existing subcategory (it wouldn't apply)
    await move({
      categoryId:    cat.id,
      subcategoryId: null,
      categoryName:  cat.name,
      subcategoryName: null,
    });
  };

  const handleSubcategorySelect = async (value) => {
    if (value === '__new__') { setNewSubMode(true); return; }
    if (!currentCat) return;
    const newSubId = value === '__none__' ? null : value;
    if ((task.subcategoryId || null) === newSubId) return; // no-op
    const sub = newSubId ? currentCat.subcategories?.find(s => s.id === newSubId) : null;
    await move({
      categoryId:      currentCat.id,
      subcategoryId:   newSubId,
      categoryName:    currentCat.name,
      subcategoryName: sub?.name || null,
    });
  };

  const saveNewCategory = async () => {
    const name = newCatName.trim();
    if (!name) { setNewCatMode(false); setNewCatName(''); return; }
    setBusy(true);
    try {
      const newId = await addWorkspaceCategory(workspace.id, name, { uid: user.uid, displayName: user.displayName, email: user.email });
      await moveWorkspaceTaskCategory(
        workspace.id,
        task.id,
        { categoryId: newId, subcategoryId: null, categoryName: name, subcategoryName: null },
        user
      );
      if (showToast) showToast(`Category "${name}" created and task moved.`, 'success');
      setNewCatMode(false); setNewCatName('');
    } catch (e) { toastError('Failed to create category', e); }
    finally { setBusy(false); }
  };

  const saveNewSubcategory = async () => {
    const name = newSubName.trim();
    if (!name || !currentCat) { setNewSubMode(false); setNewSubName(''); return; }
    setBusy(true);
    try {
      const newSubId = await addWorkspaceSubcategory(workspace.id, currentCat.id, name, { uid: user.uid, displayName: user.displayName, email: user.email });
      await moveWorkspaceTaskCategory(
        workspace.id,
        task.id,
        { categoryId: currentCat.id, subcategoryId: newSubId, categoryName: currentCat.name, subcategoryName: name },
        user
      );
      if (showToast) showToast(`Sub-category "${name}" created and task moved.`, 'success');
      setNewSubMode(false); setNewSubName('');
    } catch (e) { toastError('Failed to create sub-category', e); }
    finally { setBusy(false); }
  };

  const selectStyle = {
    fontSize: 13, padding: '7px 10px', borderRadius: 8,
    border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a',
    outline: 'none', cursor: busy ? 'wait' : 'pointer',
    minWidth: 140, flex: 1,
  };
  const inputStyle = {
    fontSize: 13, padding: '7px 10px', borderRadius: 8,
    border: '1px solid #7c3aed', background: '#ffffff', color: '#0f172a',
    outline: 'none', flex: 1, minWidth: 140,
  };

  return (
    <div style={{ padding: '12px 18px', borderBottom: '1px solid #ede0c8', background: '#faf7ff' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Folder size={12} /> Move to category
      </div>

      {/* Category row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 600, minWidth: 72 }}>Category</span>
        {newCatMode ? (
          <>
            <input
              autoFocus
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="New category name…"
              style={inputStyle}
              onKeyDown={e => {
                if (e.key === 'Enter') saveNewCategory();
                if (e.key === 'Escape') { setNewCatMode(false); setNewCatName(''); }
              }}
            />
            <button onClick={saveNewCategory} disabled={busy || !newCatName.trim()} className="btn btn-sm btn-teal">
              {busy ? '…' : 'Create'}
            </button>
            <button onClick={() => { setNewCatMode(false); setNewCatName(''); }} disabled={busy} className="btn btn-sm btn-outline">
              Cancel
            </button>
          </>
        ) : (
          <select
            value={task.categoryId || '__uncat__'}
            onChange={e => handleCategorySelect(e.target.value)}
            disabled={busy}
            style={selectStyle}
          >
            <option value="__uncat__">Uncategorized</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="__new__">+ New category…</option>
          </select>
        )}
      </div>

      {/* Subcategory row — only meaningful when a real category is selected */}
      {currentCat && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 600, minWidth: 72 }}>Sub-category</span>
          {newSubMode ? (
            <>
              <input
                autoFocus
                value={newSubName}
                onChange={e => setNewSubName(e.target.value)}
                placeholder="New sub-category name…"
                style={inputStyle}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveNewSubcategory();
                  if (e.key === 'Escape') { setNewSubMode(false); setNewSubName(''); }
                }}
              />
              <button onClick={saveNewSubcategory} disabled={busy || !newSubName.trim()} className="btn btn-sm btn-teal">
                {busy ? '…' : 'Create'}
              </button>
              <button onClick={() => { setNewSubMode(false); setNewSubName(''); }} disabled={busy} className="btn btn-sm btn-outline">
                Cancel
              </button>
            </>
          ) : (
            <select
              value={task.subcategoryId || '__none__'}
              onChange={e => handleSubcategorySelect(e.target.value)}
              disabled={busy}
              style={selectStyle}
            >
              <option value="__none__">— None —</option>
              {(currentCat.subcategories || []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value="__new__">+ New sub-category…</option>
            </select>
          )}
        </div>
      )}

      {/* Small helper text */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
        {currentCat
          ? `Currently in ${currentCat.name}${currentSub ? ` / ${currentSub.name}` : ''}.`
          : 'This task is currently uncategorized.'}
      </div>
    </div>
  );
}

export default CategoryPicker;
