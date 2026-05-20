import { useState, useEffect, useContext } from 'react';
import { User, ChevronDown, ChevronRight, Edit2, Trash2, FolderPlus, Folder } from 'lucide-react';
import {
  addWorkspaceCategory, addWorkspaceSubcategory,
  renameWorkspaceCategory, deleteWorkspaceCategory,
  renameWorkspaceSubcategory, deleteWorkspaceSubcategory,
  promoteUncategorizedToCategory,
} from '../../hooks/useWorkspace';
import Avatar from '../shared/Avatar';
import DeepLinkContext from '../../contexts/DeepLinkContext';
import { STATUSES } from './constants';
import TaskCard from './TaskCard';

// ── Creator resolution (with legacy-data fallback) ───────────────────────────
// Categories/sub-categories created BEFORE the createdBy stamp was added don't
// carry that field. For those legacy items we fall back to the workspace
// creator (the most reasonable assumption — the workspace owner almost always
// seeded the early structure). Returns { name, exact } so callers can choose
// to mark inferred attributions if desired.
function _resolveCreator(item, workspace, members) {
  if (item?.createdByName) return { name: item.createdByName, exact: true };
  const wc = members?.find(m => m.uid === workspace?.createdBy);
  const name = wc?.displayName || wc?.email;
  if (name) return { name, exact: false };
  return null;
}

// ── Status-distribution dots (shown on collapsed category/subcategory) ────────
function StatusDots({ tasks }) {
  if (!tasks || tasks.length === 0) return null;
  // Only show dots for statuses that have at least one task; preserves order
  return (
    <span className="inline-flex items-center gap-1">
      {STATUSES.map(s => {
        const count = tasks.filter(t => (t.status || 'open') === s.value).length;
        if (count === 0) return null;
        return (
          <span
            key={s.value}
            className="w-2 h-2 rounded-full"
            style={{ background: s.color }}
            title={`${count} ${s.label}`}
          />
        );
      })}
    </span>
  );
}

// ── Subcategory Section (collapsible, nested under category) ──────────────────
function SubcategorySection({
  category, subcategory, tasks, workspace, workspaceId, members,
  onDelete, currentUid, isAdmin, user, showToast,
  onAddTaskHere, onRename, onDeleteSub,
  highlightTaskId, onHighlightTaskConsumed,
}) {
  const storageKey = `ddiary_sub_${workspaceId}_${category.id}_${subcategory.id}_expanded`;
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const toggleExpanded = () => {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  // Auto-expand when the Dashboard deep-linked to a task in this subcategory,
  // OR when the email deep-link prop matches a task in this subcategory.
  const { openSubcategoryId } = useContext(DeepLinkContext);
  const hasHighlightedTask = highlightTaskId && tasks.some(t => t.id === highlightTaskId);
  useEffect(() => {
    if ((openSubcategoryId && openSubcategoryId === subcategory.id) || hasHighlightedTask) {
      setExpanded(true);
    }
  }, [openSubcategoryId, subcategory.id, hasHighlightedTask]);

  const [renaming,   setRenaming]   = useState(false);
  const [renameText, setRenameText] = useState(subcategory.name);

  const handleRename = async () => {
    if (!renameText.trim() || renameText.trim() === subcategory.name) { setRenaming(false); return; }
    try { await onRename(renameText.trim()); } catch { /* toast handled upstream */ }
    setRenaming(false);
  };

  return (
    <div className="border-t border-slate-100">
      {/* ── Subcategory header (collapsible — chevron on right, like category) ── */}
      <div
        onClick={renaming ? undefined : toggleExpanded}
        className={`flex items-center gap-2 px-4 py-2.5 bg-slate-50 select-none
          ${renaming ? '' : 'cursor-pointer hover:bg-slate-100 transition-colors'}`}
        style={{ paddingLeft: 28 /* visual nesting under category */ }}
      >
        {/* Label cluster — takes remaining space */}
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          {renaming ? (
            <input
              autoFocus
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onClick={e => e.stopPropagation()}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
              className="text-xs font-bold uppercase tracking-wider text-slate-900 bg-white border border-violet-400 rounded px-2 py-0.5 outline-none"
            />
          ) : (
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {subcategory.name}
            </span>
          )}
          <span className="text-xs text-slate-500 font-medium">({tasks.length})</span>
          {/* Creator badge — same treatment as the category badge.
              Falls back to the workspace creator for legacy sub-categories. */}
          {(() => {
            const c = _resolveCreator(subcategory, workspace, members);
            if (!c) return null;
            return (
              <span
                title={c.exact ? `Created by ${c.name}` : `Inferred — workspace owner ${c.name}`}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{
                  background:    '#f5f3ff',
                  color:         '#6d28d9',
                  border:        '1px solid #ddd6fe',
                  textDecoration: c.exact ? 'none' : 'underline dotted',
                }}
              >
                <User size={9} /> by {c.name.split(' ')[0]}
              </span>
            );
          })()}
          {!expanded && <StatusDots tasks={tasks} />}
        </div>

        {/* Action cluster — edit/delete admin tools */}
        {isAdmin && !renaming && (
          <span className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setRenameText(subcategory.name); setRenaming(true); }}
              title="Rename sub-category"
              className="text-slate-400 hover:text-violet-600 p-0.5"
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete sub-category "${subcategory.name}"? Tasks inside will be moved to the category root.`)) onDeleteSub();
              }}
              title="Delete sub-category"
              className="text-slate-400 hover:text-red-500 p-0.5"
            >
              <Trash2 size={12} />
            </button>
          </span>
        )}

        {/* Chevron — always right-aligned, matching CategorySection + SectionHeader */}
        <span className="text-slate-400 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>

      {/* ── Expanded body (task cards) ──────────────────────────────────── */}
      {expanded && (
        <div className="px-4 pt-3 pb-3 flex flex-col gap-2" style={{ paddingLeft: 28 }}>
          {tasks.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-xl px-3 text-center text-slate-400 text-xs flex items-center justify-center"
                 style={{ height: 78 }}>
              No tasks here
            </div>
          ) : (
            tasks.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                workspace={workspace}
                workspaceId={workspaceId}
                members={members}
                onDelete={onDelete}
                currentUid={currentUid}
                isAdmin={isAdmin}
                user={user}
                showToast={showToast}
                highlightTaskId={highlightTaskId}
                onHighlightTaskConsumed={onHighlightTaskConsumed}
              />
            ))
          )}

          {/* Add task in this subcategory */}
          <button
            onClick={onAddTaskHere}
            className="text-left text-xs font-semibold text-violet-600 hover:text-violet-800 px-1 py-1"
          >
            + Add task{subcategory.name ? ` in ${subcategory.name}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Category Section (collapsible) ────────────────────────────────────────────
function CategorySection({
  category, allTasks, workspace, workspaceId, members,
  onDelete, currentUid, isAdmin, user, showToast,
  onAddTaskHere, // (categoryId, subcategoryId) => void
  highlightTaskId, onHighlightTaskConsumed,
}) {
  const [expanded, setExpanded] = useState(false);

  const [renaming,   setRenaming]   = useState(false);
  const [renameText, setRenameText] = useState(category.name || '');
  const [addingSub,  setAddingSub]  = useState(false);
  const [newSubName, setNewSubName] = useState('');

  // Virtual "category" for uncategorized bucket
  const isUncategorized = category.id === '__uncat__';

  const catTasks  = isUncategorized
    ? allTasks.filter(t => !t.categoryId)
    : allTasks.filter(t => t.categoryId === category.id);

  // Auto-expand when the Dashboard deep-linked to a task in this category,
  // OR when the email deep-link prop matches any task in this category.
  // catTasks MUST be declared before this line (temporal dead zone fix).
  const { openCategoryId } = useContext(DeepLinkContext);
  const hasHighlightedTask = highlightTaskId && catTasks.some(t => t.id === highlightTaskId);
  useEffect(() => {
    if ((openCategoryId && openCategoryId === category.id) || hasHighlightedTask) {
      setExpanded(true);
    }
  }, [openCategoryId, category.id, hasHighlightedTask]);

  const subs = category.subcategories || [];
  const tasksNoSub = isUncategorized
    ? catTasks
    : catTasks.filter(t => !t.subcategoryId || !subs.some(s => s.id === t.subcategoryId));

  const toastError = (msg, err) => {
    const detail = err?.code === 'permission-denied'
      ? 'Permission denied — Firestore rules may be out of date. Redeploy rules.'
      : (err?.message || '');
    if (showToast) showToast(`${msg}${detail ? ` (${detail})` : ''}`, 'warning');
  };

  const saveRename = async () => {
    const name = renameText.trim();
    if (!name || name === category.name) { setRenaming(false); return; }
    try {
      if (isUncategorized) {
        // Promote: creates a real category + moves all uncategorized tasks into it
        await promoteUncategorizedToCategory(workspaceId, name, null, { uid: user.uid, displayName: user.displayName, email: user.email });
        if (showToast) showToast(`Category "${name}" created — uncategorized tasks moved in.`, 'success');
      } else {
        await renameWorkspaceCategory(workspaceId, category.id, name);
      }
    } catch (e) { toastError(isUncategorized ? 'Failed to create category' : 'Failed to rename category', e); }
    setRenaming(false);
  };

  const saveNewSub = async () => {
    const sub = newSubName.trim();
    if (!sub) { setAddingSub(false); return; }
    try {
      if (isUncategorized) {
        // Promote: creates a new category named "Uncategorized Items" (or keeps the prior label if present)
        // plus the sub-category, and moves all uncategorized tasks into it.
        const parentName = category.name && category.name !== 'Uncategorized' ? category.name : 'General';
        await promoteUncategorizedToCategory(workspaceId, parentName, sub, { uid: user.uid, displayName: user.displayName, email: user.email });
        if (showToast) showToast(`Sub-category "${sub}" created under "${parentName}".`, 'success');
      } else {
        await addWorkspaceSubcategory(workspaceId, category.id, sub, { uid: user.uid, displayName: user.displayName, email: user.email });
      }
    } catch (e) { toastError('Failed to add sub-category', e); }
    setNewSubName('');
    setAddingSub(false);
  };

  const handleDeleteCategory = async () => {
    if (!window.confirm(`Delete category "${category.name}"? Tasks inside will become uncategorized.`)) return;
    try { await deleteWorkspaceCategory(workspaceId, category.id); }
    catch (e) { toastError('Failed to delete category', e); }
  };

  const handleDeleteSubcategory = async (subId) => {
    try { await deleteWorkspaceSubcategory(workspaceId, category.id, subId); }
    catch (e) { toastError('Failed to delete sub-category', e); }
  };

  const handleRenameSubcategory = (subId) => async (newName) => {
    await renameWorkspaceSubcategory(workspaceId, category.id, subId, newName);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-3">
      {/* ── Category header ────────────────────────────────────────────────── */}
      <div
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors select-none"
      >
        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
          {renaming ? (
            <input
              autoFocus
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onClick={e => e.stopPropagation()}
              onBlur={saveRename}
              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false); }}
              className="text-base font-bold text-slate-900 border border-violet-400 rounded px-2 py-0.5 outline-none"
            />
          ) : (
            <span className="text-base font-bold text-slate-900">
              {category.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
            {catTasks.length} task{catTasks.length === 1 ? '' : 's'}
          </span>
          {/* Creator badge — explicit when stamped at create time, else falls
              back to the workspace creator. Inferred attributions get a subtle
              dotted underline so they're visually distinguishable. */}
          {(() => {
            const c = _resolveCreator(category, workspace, members);
            if (!c) return null;
            return (
              <span
                title={c.exact ? `Created by ${c.name}` : `Inferred — workspace owner ${c.name}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background:    '#f5f3ff',
                  color:         '#6d28d9',
                  border:        '1px solid #ddd6fe',
                  textDecoration: c.exact ? 'none' : 'underline dotted',
                }}
              >
                <User size={10} /> by {c.name.split(' ')[0]}
              </span>
            );
          })()}
          <StatusDots tasks={catTasks} />
        </div>

        {isAdmin && !renaming && (
          <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setRenameText(isUncategorized ? '' : category.name); setRenaming(true); }}
              title={isUncategorized ? 'Promote to category' : 'Rename category'}
              className="text-slate-400 hover:text-violet-600 p-1.5"
            >
              <Edit2 size={14} />
            </button>
            {!isUncategorized && (
              <button
                onClick={handleDeleteCategory}
                title="Delete category"
                className="text-slate-400 hover:text-red-500 p-1.5"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}

        <span className="text-slate-400 flex-shrink-0">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
      </div>

      {/* ── Expanded body ──────────────────────────────────────────────────── */}
      {expanded && (
        <div>
          {/* Tasks directly under the category (no subcategory), shown only if there are none or there are some. */}
          {tasksNoSub.length > 0 && (
            <div className="group/sub">
              <div className="px-5 pt-3 pb-3 flex flex-col gap-2 border-t border-slate-100">
                {tasksNoSub.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    workspace={workspace}
                    workspaceId={workspaceId}
                    members={members}
                    onDelete={onDelete}
                    currentUid={currentUid}
                    isAdmin={isAdmin}
                    user={user}
                    showToast={showToast}
                    highlightTaskId={highlightTaskId}
                    onHighlightTaskConsumed={onHighlightTaskConsumed}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Subcategories */}
          {!isUncategorized && subs.map(sub => {
            const subTasks = allTasks.filter(t => t.categoryId === category.id && t.subcategoryId === sub.id);
            return (
              <div key={sub.id} className="group/sub">
                <SubcategorySection
                  category={category}
                  subcategory={sub}
                  tasks={subTasks}
                  workspace={workspace}
                  workspaceId={workspaceId}
                  members={members}
                  onDelete={onDelete}
                  currentUid={currentUid}
                  isAdmin={isAdmin}
                  user={user}
                  showToast={showToast}
                  onAddTaskHere={() => onAddTaskHere(category.id, sub.id)}
                  onRename={handleRenameSubcategory(sub.id)}
                  onDeleteSub={() => handleDeleteSubcategory(sub.id)}
                  highlightTaskId={highlightTaskId}
                  onHighlightTaskConsumed={onHighlightTaskConsumed}
                />
              </div>
            );
          })}

          {/* Add task (for category root, when it has no subcategories yet) */}
          {tasksNoSub.length === 0 && subs.length === 0 && !isUncategorized && (
            <div className="px-5 py-4 border-t border-slate-100 text-center">
              <p className="text-xs text-slate-500 mb-2">No tasks or sub-categories yet.</p>
            </div>
          )}

          {/* + Add a task directly under the category (or into the Uncategorized bucket) */}
          <div className="px-5 pb-3 pt-1 border-t border-slate-100">
            <button
              onClick={() => onAddTaskHere(isUncategorized ? null : category.id, null)}
              className="text-left text-xs font-semibold text-violet-600 hover:text-violet-800 px-1 py-1 mr-3"
            >
              + Add task{isUncategorized ? '' : ` in ${category.name}`}
            </button>
            {/* Adding a sub-category is open to every workspace member.
                Rename / delete of existing sub-categories remain admin-only. */}
            {!addingSub && (
              <button
                onClick={() => setAddingSub(true)}
                className="text-left text-xs font-semibold text-violet-600 hover:text-violet-800 px-1 py-1"
              >
                + Sub-category
              </button>
            )}
            {addingSub && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={newSubName}
                  onChange={e => setNewSubName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNewSub(); if (e.key === 'Escape') { setAddingSub(false); setNewSubName(''); } }}
                  placeholder={isUncategorized ? 'Sub-category name (promotes Uncategorized)…' : 'Sub-category name…'}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 flex-1 max-w-xs"
                />
                <button onClick={saveNewSub} className="btn btn-sm btn-teal">Add</button>
                <button onClick={() => { setAddingSub(false); setNewSubName(''); }} className="btn btn-sm btn-outline">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category Board (replaces the 4-column Kanban) ─────────────────────────────
function CategoryBoard({
  workspace, workspaceId, tasks, members,
  onDelete, currentUid, isAdmin, user, showToast,
  onAddTaskHere, // (categoryId, subcategoryId) => void
  filterAssignee, setFilterAssignee,
  filterStatus,   setFilterStatus,
  showAddCategoryInitial, onAddCategoryClose,
  highlightTaskId, onHighlightTaskConsumed,
}) {
  const categories = (workspace?.categories || []);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName,     setNewCatName]     = useState('');
  const [savingCat,      setSavingCat]      = useState(false);

  // Trigger the inline input panel when the header "Add Category" button fires
  useEffect(() => {
    if (showAddCategoryInitial) setAddingCategory(true);
  }, [showAddCategoryInitial]);

  // Include an 'Uncategorized' bucket only if there are uncategorized tasks.
  // Applies to every workspace that renders through this component — there is
  // no other render path for the __uncat__ bucket anywhere in the app.
  const hasUncategorized = tasks.some(t => !t.categoryId);

  const closeAdd = () => {
    setAddingCategory(false);
    setNewCatName('');
    if (onAddCategoryClose) onAddCategoryClose();
  };

  const saveNewCategory = async () => {
    const name = newCatName.trim();
    if (!name) { closeAdd(); return; }
    setSavingCat(true);
    try {
      await addWorkspaceCategory(workspaceId, name, { uid: user.uid, displayName: user.displayName, email: user.email });
      if (showToast) showToast(`Category "${name}" added.`, 'success');
      setNewCatName('');
      setAddingCategory(false);
      if (onAddCategoryClose) onAddCategoryClose();
    } catch (e) {
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied — Firestore rules may be out of date. Redeploy rules.'
        : (e?.message || 'Unknown error');
      if (showToast) showToast(`Failed to add category. ${detail}`, 'warning');
    } finally {
      setSavingCat(false);
    }
  };

  const filterMembers = members.slice(0, 8); // limit to 8 avatars in filter bar

  return (
    <div>
      {/* ── Inline "Add Category" panel (top of board, triggered from header) ─
           Available to any workspace member (rename/delete stay admin-only). */}
      {addingCategory && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-3 flex items-center gap-2">
          <FolderPlus size={16} className="text-violet-600 flex-shrink-0" />
          <input
            autoFocus
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveNewCategory(); if (e.key === 'Escape') closeAdd(); }}
            placeholder="Category name (e.g. Credit & Underwriting)…"
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
          />
          <button onClick={saveNewCategory} disabled={savingCat || !newCatName.trim()} className="btn btn-sm btn-teal">
            {savingCat ? 'Adding…' : 'Add'}
          </button>
          <button onClick={closeAdd} disabled={savingCat} className="btn btn-sm btn-outline">Cancel</button>
        </div>
      )}

      {/* ── Filter bar (compact single row: avatars left, statuses right) ─── */}
      <div className="k-filter-bar">
        <div className="k-filter-row">
          {/* Left cluster — member avatars */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs text-slate-500 font-medium mr-1 shrink-0">Filter:</span>
            {filterMembers.map(m => {
              const active = filterAssignee === m.uid;
              return (
                <button
                  key={m.uid}
                  onClick={() => setFilterAssignee(active ? 'all' : m.uid)}
                  title={m.displayName || m.email}
                  className={`relative rounded-full transition shrink-0 ${active ? 'ring-2 ring-violet-500 ring-offset-2' : 'opacity-80 hover:opacity-100'}`}
                >
                  <Avatar id={m.uid} name={m.displayName} email={m.email} size="sm" />
                </button>
              );
            })}
            {filterAssignee !== 'all' && (
              <button
                onClick={() => setFilterAssignee('all')}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Clear
              </button>
            )}
          </div>

          {/* Right cluster — status pills, pushed to the right with ml-auto */}
          <div className="k-filter-right flex items-center gap-2 flex-wrap ml-auto justify-end">
            {STATUSES.map(s => {
              const active = filterStatus === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => setFilterStatus(active ? 'all' : s.value)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold transition shrink-0
                    ${active ? 'ring-1 ring-offset-1' : 'opacity-90 hover:opacity-100'}`}
                  style={{
                    background: s.bg,
                    color: s.color,
                    borderColor: active ? s.color : 'transparent',
                    borderWidth: 1,
                    borderStyle: 'solid',
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </button>
              );
            })}
            {filterStatus !== 'all' && (
              <button
                onClick={() => setFilterStatus('all')}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Categories ─────────────────────────────────────────────────────── */}
      {categories.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          allTasks={tasks}
          workspace={workspace}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          user={user}
          showToast={showToast}
          onAddTaskHere={onAddTaskHere}
          highlightTaskId={highlightTaskId}
          onHighlightTaskConsumed={onHighlightTaskConsumed}
        />
      ))}

      {hasUncategorized && (
        <CategorySection
          category={{ id: '__uncat__', name: 'Uncategorized', subcategories: [] }}
          allTasks={tasks}
          workspace={workspace}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          user={user}
          showToast={showToast}
          onAddTaskHere={onAddTaskHere}
          highlightTaskId={highlightTaskId}
          onHighlightTaskConsumed={onHighlightTaskConsumed}
        />
      )}

      {/* Empty state when workspace has no tasks at all — the "Add Category"
          trigger lives in the workspace header, not at the bottom of the board */}
      {tasks.length === 0 && categories.length === 0 && (
        <div className="text-center py-10 text-slate-400 text-sm">
          <Folder size={32} className="mx-auto mb-2 opacity-50" />
          No tasks yet. Click <strong>Add Category</strong> or <strong>+ Task</strong> in the header above to start.
        </div>
      )}
    </div>
  );
}

export default CategoryBoard;
