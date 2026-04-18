import { useState, useEffect, useMemo } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, User, Calendar, Send,
  Circle, Clock, Eye, CheckCircle, Trash2, Copy, Check as CheckIcon,
  Users, Edit2, Briefcase, UserPlus, AlertTriangle, MessageSquare,
  Folder, FolderPlus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspaces, useWorkspace, useWorkspaceTasks,
  addWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask,
  createWorkspace, renameWorkspace, addWorkspaceMember,
  deleteWorkspace,
  createWorkspaceInvite, getExistingInvite,
  addWorkspaceCategory, renameWorkspaceCategory, deleteWorkspaceCategory,
  addWorkspaceSubcategory, renameWorkspaceSubcategory, deleteWorkspaceSubcategory,
  promoteUncategorizedToCategory,
  useWorkspaceComments,
} from '../hooks/useWorkspace';
import { logError } from '../utils/errorLogger';
import WorkspaceCollabPanel from './WorkspaceCollabPanel';
import WorkspaceInvitePrompt from './WorkspaceInvitePrompt';
import { notifyWorkspaceInvite, notifyTaskAssigned } from '../utils/emailNotifications';
import { fetchAllOrgUsers, searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';
import Avatar from './shared/Avatar';
import { StatusPill, PriorityPill } from './shared/Pills';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#475569', bg: '#f1f5f9', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2563eb', bg: '#eff6ff', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#7c3aed', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#15803d', bg: '#eafaf1', Icon: CheckCircle  },
];
const PRIORITY_COLORS = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

const formatDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Task Detail Modal ─────────────────────────────────────────────────────────
function TaskDetailModal({ task, workspaceId, members, onDelete, currentUid, isAdmin, onClose }) {
  const priority  = PRIORITY_COLORS[task.priority] || '#d97706';
  const statusCfg = STATUSES.find(s => s.value === (task.status || 'open')) || STATUSES[0];
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee  = members.find(m => m.uid === task.assigneeUid);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(30,20,10,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 540,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #ede0c8', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 4, borderRadius: 2, background: priority, alignSelf: 'stretch', flexShrink: 0, minHeight: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' }}>{task.text}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {/* Status badge */}
              <span style={{ background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.color}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>
                {statusCfg.label}
              </span>
              {/* Priority badge */}
              <span style={{ background: `${priority}18`, color: priority, border: `1px solid ${priority}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize' }}>
                {task.priority || 'medium'}
              </span>
              {/* Due date */}
              {task.dueDate && (
                <span style={{ fontSize: 12, color: isOverdue ? '#dc2626' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Calendar size={11} />
                  {formatDate(task.dueDate)}
                  {isOverdue && <span style={{ background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>OVERDUE</span>}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {(assignee || task.assigneeName) && (
                <span style={{ fontSize: 12, color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {assignee?.displayName || task.assigneeName}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Created by {task.createdByName || 'someone'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {task.createdBy === currentUid && (
              <button
                onClick={() => { onDelete(task.id); onClose(); }}
                title="Delete task"
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Notes (if any) */}
        {task.notes && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #ede0c8', background: '#fdf8ee' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.notes}</div>
          </div>
        )}

        {/* Collaboration panel (comments, activity, status updates) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <WorkspaceCollabPanel
            workspaceId={workspaceId}
            task={task}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

// ── Task comment count (tiny hook-wrapper used by TaskCard) ───────────────────
function CommentCountBadge({ workspaceId, taskId }) {
  const { comments } = useWorkspaceComments(workspaceId, taskId);
  if (!comments || comments.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
      <MessageSquare size={11} /> {comments.length}
    </span>
  );
}

// ── Uniform Task Card ─────────────────────────────────────────────────────────
// Fixed height (~78px). Title clamped to 1 line. Click opens full detail modal.
function TaskCard({ task, workspaceId, members, onDelete, currentUid, isAdmin }) {
  const [open, setOpen] = useState(false);
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee  = members.find(m => m.uid === task.assigneeUid);
  const assigneeName = assignee?.displayName || task.assigneeName || null;
  const assigneeId   = assignee?.uid || task.assigneeEmail || assigneeName || 'unassigned';

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="group relative bg-white border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:shadow-sm hover:border-slate-300 transition"
        style={{
          height: 78,
          opacity: task.status === 'done' ? 0.7 : 1,
          boxSizing: 'border-box',
        }}
      >
        {/* Title row: title (truncated) + assignee avatar */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 text-[14px] font-semibold text-slate-900 leading-snug truncate">
            {task.text}
          </div>
          {assigneeName ? (
            <Avatar id={assigneeId} name={assigneeName} email={task.assigneeEmail} size="sm" title={assigneeName} />
          ) : (
            <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0" title="Unassigned">
              <User size={13} />
            </span>
          )}
        </div>

        {/* Meta row: status + priority pills (left) — due date + comment count (right) */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <StatusPill status={task.status || 'open'} />
            <PriorityPill priority={task.priority || 'medium'} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {task.dueDate && (
              <span className={`text-[11px] inline-flex items-center gap-1 ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                <Calendar size={11} />
                Due {formatDate(task.dueDate)}
              </span>
            )}
            <CommentCountBadge workspaceId={workspaceId} taskId={task.id} />
          </div>
        </div>
      </div>

      {open && (
        <TaskDetailModal
          task={task}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
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
  category, subcategory, tasks, workspaceId, members,
  onDelete, currentUid, isAdmin,
  onAddTaskHere, onRename, onDeleteSub,
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
                workspaceId={workspaceId}
                members={members}
                onDelete={onDelete}
                currentUid={currentUid}
                isAdmin={isAdmin}
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
  category, allTasks, workspaceId, members,
  onDelete, currentUid, isAdmin, user, showToast,
  onAddTaskHere, // (categoryId, subcategoryId) => void
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
        await promoteUncategorizedToCategory(workspaceId, name);
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
        await promoteUncategorizedToCategory(workspaceId, parentName, sub);
        if (showToast) showToast(`Sub-category "${sub}" created under "${parentName}".`, 'success');
      } else {
        await addWorkspaceSubcategory(workspaceId, category.id, sub);
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
                    workspaceId={workspaceId}
                    members={members}
                    onDelete={onDelete}
                    currentUid={currentUid}
                    isAdmin={isAdmin}
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
                  workspaceId={workspaceId}
                  members={members}
                  onDelete={onDelete}
                  currentUid={currentUid}
                  isAdmin={isAdmin}
                  onAddTaskHere={() => onAddTaskHere(category.id, sub.id)}
                  onRename={handleRenameSubcategory(sub.id)}
                  onDeleteSub={() => handleDeleteSubcategory(sub.id)}
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
            {isAdmin && !addingSub && (
              <button
                onClick={() => setAddingSub(true)}
                className="text-left text-xs font-semibold text-violet-600 hover:text-violet-800 px-1 py-1"
              >
                + Sub-category
              </button>
            )}
            {isAdmin && addingSub && (
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
}) {
  const categories = (workspace?.categories || []);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName,     setNewCatName]     = useState('');
  const [savingCat,      setSavingCat]      = useState(false);

  // Include an 'Uncategorized' bucket only if there are uncategorized tasks
  const hasUncategorized = tasks.some(t => !t.categoryId);

  const saveNewCategory = async () => {
    const name = newCatName.trim();
    if (!name) { setAddingCategory(false); return; }
    setSavingCat(true);
    try {
      await addWorkspaceCategory(workspaceId, name);
      if (showToast) showToast(`Category "${name}" added.`, 'success');
      setNewCatName('');
      setAddingCategory(false);
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
      {/* ── Filter bar (compact single row: avatars left, statuses right) ─── */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
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
          <div className="flex items-center gap-2 flex-wrap ml-auto justify-end">
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
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          user={user}
          showToast={showToast}
          onAddTaskHere={onAddTaskHere}
        />
      ))}

      {hasUncategorized && (
        <CategorySection
          category={{ id: '__uncat__', name: 'Uncategorized', subcategories: [] }}
          allTasks={tasks}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          user={user}
          showToast={showToast}
          onAddTaskHere={onAddTaskHere}
        />
      )}

      {/* + Add category */}
      {isAdmin && (
        <div className="mt-2">
          {addingCategory ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-2">
              <FolderPlus size={16} className="text-violet-600" />
              <input
                autoFocus
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNewCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCatName(''); } }}
                placeholder="Category name (e.g. Credit & Underwriting)…"
                className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
              />
              <button onClick={saveNewCategory} disabled={savingCat || !newCatName.trim()} className="btn btn-sm btn-teal">
                {savingCat ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => { setAddingCategory(false); setNewCatName(''); }} disabled={savingCat} className="btn btn-sm btn-outline">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingCategory(true)}
              className="w-full bg-white border-2 border-dashed border-slate-200 rounded-2xl px-5 py-4 text-sm font-semibold text-violet-600 hover:border-violet-300 hover:bg-violet-50/30 transition-colors flex items-center justify-center gap-2"
            >
              <FolderPlus size={16} /> Add Category
            </button>
          )}
        </div>
      )}

      {/* Empty state when workspace has no tasks at all */}
      {tasks.length === 0 && categories.length === 0 && (
        <div className="text-center py-10 text-slate-400 text-sm">
          <Folder size={32} className="mx-auto mb-2 opacity-50" />
          No tasks yet. Add a category or click "New Task" to start.
        </div>
      )}
    </div>
  );
}

// ── Add Task Modal ────────────────────────────────────────────────────────────
function AddTaskModal({
  onClose, onAdd, members, workspaces, currentWorkspaceId, showToast,
  categories = [],  // categories of the CURRENT workspace, for the picker
  initialCategoryId = null, initialSubcategoryId = null, categoryContextLabel = null,
  hideWorkspacePicker = false, // true when opened from inside a workspace
}) {
  const [text,          setText]          = useState('');
  const [notes,         setNotes]         = useState('');
  const [status,        setStatus]        = useState('open');
  const [priority,      setPriority]      = useState('high');
  const [dueDate,       setDueDate]       = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [saving,        setSaving]        = useState(false);
  const [categoryId,    setCategoryId]    = useState(initialCategoryId || '');
  const [subcategoryId, setSubcategoryId] = useState(initialSubcategoryId || '');

  const [wsMode,       setWsMode]       = useState(workspaces.length ? 'existing' : 'new');
  const [selectedWsId, setSelectedWsId] = useState(currentWorkspaceId || workspaces[0]?.id || '');
  const [newWsName,    setNewWsName]    = useState('');

  // ── Fetch M365 org users ────────────────────────────────────────────────
  const [orgUsers, setOrgUsers] = useState([]);
  useEffect(() => {
    fetchAllOrgUsers().then(u => setOrgUsers(u || [])).catch(() => {});
  }, []);

  // Merged assignee list: workspace members (have UIDs) first, then org users, deduped by email
  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); list.push({ email: m.email, name: m.displayName || m.email, uid: m.uid || null }); }
    }
    for (const u of orgUsers) {
      const key = u.email?.toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); list.push({ email: u.email, name: u.displayName || u.email, uid: null }); }
    }
    return list;
  }, [members, orgUsers]);

  const switchToNewWsMode = () => {
    setWsMode('new');
    setNewWsName(prev => prev.trim() ? prev : text.trim().slice(0, 60));
  };

  const handleAdd = async () => {
    if (!text.trim()) return;
    if (wsMode === 'new' && !newWsName.trim()) return;
    setSaving(true);
    try {
      const person = assigneeOptions.find(p => p.email?.toLowerCase() === assigneeEmail.toLowerCase());
      // Hard timeout so the button can never freeze forever. If Firestore is
      // slow or the write is stuck behind an offline queue, we surface it.
      const ADD_TIMEOUT_MS = 25000;
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out after 25s. Check your connection or Firestore rules and try again.')), ADD_TIMEOUT_MS)
      );
      await Promise.race([
        onAdd(
          {
            text: text.trim(),
            notes: notes.trim() || null,
            status,
            priority,
            dueDate:       dueDate ? new Date(dueDate).toISOString() : null,
            assigneeUid:   person?.uid   || null,
            assigneeEmail: person?.email?.toLowerCase() || null,
            assigneeName:  person?.name  || null,
            categoryId:    categoryId    || null,
            subcategoryId: subcategoryId || null,
          },
          {
            targetWorkspaceId: wsMode === 'existing' ? selectedWsId : null,
            newWorkspaceName:  wsMode === 'new'      ? newWsName.trim() : null,
          }
        ),
        timeout,
      ]);
      onClose();
    } catch (e) {
      logError(e, { location: 'KanbanBoard:AddTaskModal', action: 'addTask' });
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied — Firestore rules may be out of date. Redeploy with `firebase deploy --only firestore:rules`.'
        : (e?.message || 'Unknown error');
      if (showToast) showToast(`Failed to add task. ${detail}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: 17, fontWeight: 700 }}>New Task</h3>
            {categoryContextLabel && (
              <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Folder size={11} /> Adding to <strong style={{ marginLeft: 2 }}>{categoryContextLabel}</strong>
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Task description */}
          <div>
            <label style={labelStyle}>Task *</label>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Describe the task…" rows={3} autoFocus style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Workspace picker — hidden when opened from inside a workspace */}
          {!hideWorkspacePicker && (
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px' }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>
              <Briefcase size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Workspace
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: wsMode === 'new' ? 10 : 0 }}>
              {workspaces.map(ws => (
                <button key={ws.id} type="button"
                  onClick={() => { setWsMode('existing'); setSelectedWsId(ws.id); }}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                    background: wsMode === 'existing' && selectedWsId === ws.id ? '#7c3aed' : '#e2e8f0',
                    color:      wsMode === 'existing' && selectedWsId === ws.id ? '#fff'     : '#0f172a',
                    transition: 'all 0.15s',
                  }}
                >{ws.name}</button>
              ))}
              <button type="button" onClick={switchToNewWsMode}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px dashed ${wsMode === 'new' ? '#7c3aed' : '#7c3aed'}`,
                  background: wsMode === 'new' ? '#7c3aed' : 'transparent',
                  color:      wsMode === 'new' ? '#fff'     : '#7c3aed',
                  transition: 'all 0.15s',
                }}
              >+ New workspace</button>
            </div>
            {wsMode === 'new' && (
              <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                placeholder="Workspace name…" style={{ ...inputStyle, fontSize: 13, marginTop: 2 }} autoFocus={workspaces.length === 0} />
            )}
          </div>
          )}

          {/* Category + Sub-category — always shown for existing workspaces */}
          {(() => {
            const activeCats = wsMode === 'existing'
              ? (workspaces.find(w => w.id === selectedWsId)?.categories || categories || [])
              : [];
            if (wsMode !== 'existing') return null;
            const activeSubs = activeCats.find(c => c.id === categoryId)?.subcategories || [];
            return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select
                  value={categoryId}
                  onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }}
                  style={inputStyle}
                >
                  <option value="">Uncategorized</option>
                  {activeCats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Sub-category</label>
                <select
                  value={subcategoryId}
                  onChange={e => setSubcategoryId(e.target.value)}
                  style={inputStyle}
                  disabled={!categoryId || activeSubs.length === 0}
                >
                  <option value="">—</option>
                  {activeSubs.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            );
          })()}

          {/* Status + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          {/* Assign to + Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Assign to</label>
              <select value={assigneeEmail} onChange={e => setAssigneeEmail(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {assigneeOptions.map(p => (
                  <option key={p.email} value={p.email}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional context, links, or details…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-teal" onClick={handleAdd}
            disabled={saving || !text.trim() || (wsMode === 'new' && !newWsName.trim())}
            style={{ flex: 2, justifyContent: 'center' }}
          >
            {saving
              ? (wsMode === 'new' ? 'Creating workspace…' : 'Adding…')
              : <><Plus size={15} /> {wsMode === 'new' ? 'Create Workspace & Add Task' : 'Add Task'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Workspace Setup (first workspace creation) ────────────────────────────────
function WorkspaceSetup({ onCreated, onCancel, showToast, title }) {
  const { user } = useAuth();
  const [name,     setName]     = useState('');
  const [taskText, setTaskText] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [step,     setStep]     = useState(1);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErrorMsg('');
    try {
      const id = await createWorkspace(user.uid, user.email, user.displayName || user.email, name.trim());
      if (taskText.trim()) {
        await addWorkspaceTask(id, {
          text: taskText.trim(), status: 'open', priority: 'high',
          dueDate: null, assigneeUid: null, assigneeEmail: null, assigneeName: null,
        }, { uid: user.uid, displayName: user.displayName || user.email, email: user.email });
      }
      if (showToast) showToast(`Workspace "${name.trim()}" created!`, 'success');
      await onCreated(id);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceSetup', action: 'createWorkspace' }, user.uid);
      const msg = e.message || 'Failed to create workspace. Please try again.';
      setErrorMsg(msg);
      if (showToast) showToast(msg, 'warning');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card" style={{ padding: 32, maxWidth: 480, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={18} color="#7c3aed" />
          <span style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{title || 'New Workspace'}</span>
        </div>
        {onCancel && (
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
            <X size={18} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
        {[{ n: 1, label: 'Name workspace' }, { n: 2, label: 'First task (optional)' }].map(({ n, label }) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              background: step >= n ? '#7c3aed' : '#e2e8f0',
              color: step >= n ? '#fff' : '#475569',
            }}>{n}</div>
            <span style={{ fontSize: 12, color: step >= n ? '#7c3aed' : '#94a3b8', fontWeight: step === n ? 700 : 400 }}>{label}</span>
            {n < 2 && <div style={{ width: 20, height: 1, background: step > n ? '#7c3aed' : '#e2e8f0', margin: '0 2px' }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          <input className="input" placeholder="e.g. KMCL Operations, Collections Team…"
            value={name} onChange={e => { setName(e.target.value); setErrorMsg(''); }}
            onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
            autoFocus style={{ marginBottom: 12 }}
          />
          {errorMsg && (
            <div style={{ background: '#fdf0f0', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 10, display: 'flex', gap: 8 }}>
              <span>⚠️</span><span>{errorMsg}</span>
            </div>
          )}
          <button className="btn btn-teal" onClick={() => name.trim() && setStep(2)} disabled={!name.trim()} style={{ justifyContent: 'center', width: '100%' }}>
            Continue →
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <textarea className="input" placeholder="e.g. Review pending loan applications… (optional)"
            value={taskText} onChange={e => setTaskText(e.target.value)}
            rows={3} autoFocus style={{ marginBottom: 16, resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
            <button className="btn btn-teal" onClick={handleCreate} disabled={creating} style={{ flex: 2, justifyContent: 'center' }}>
              {creating ? 'Creating…' : <><Plus size={15} /> {taskText.trim() ? 'Create & Add Task' : 'Create Workspace'}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── WorkspaceBoardContent ─────────────────────────────────────────────────────
// The actual kanban board — rendered only when a workspace is expanded.
function WorkspaceBoardContent({ workspaceId, members, showToast, user, workspaces, onWorkspaceCreated, showAddTaskInitial, onAddTaskClose, isAdmin }) {
  const { workspace } = useWorkspace(workspaceId);
  const { tasks, loading: tasksLoading, error } = useWorkspaceTasks(workspaceId);
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterStatus,   setFilterStatus]   = useState('all');
  const [showAddTask, setShowAddTask]       = useState(showAddTaskInitial || false);
  // When "+ Add task" is clicked inside a category/subcategory, remember where
  // so AddTaskModal can pre-fill categoryId/subcategoryId.
  const [addTaskContext, setAddTaskContext] = useState({ categoryId: null, subcategoryId: null });

  // Sync with parent-triggered add (e.g. WorkspaceItem header "Task" button)
  useEffect(() => {
    if (showAddTaskInitial) {
      setAddTaskContext({ categoryId: null, subcategoryId: null });
      setShowAddTask(true);
    }
  }, [showAddTaskInitial]);

  const handleAddTask = async (taskData, wsOptions = {}) => {
    let targetWsId = workspaceId;
    try {
      if (wsOptions.newWorkspaceName) {
        let newId;
        try {
          newId = await createWorkspace(
            user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName
          );
        } catch (err) {
          err.message = `Could not create workspace: ${err?.message || err}`;
          throw err;
        }
        if (onWorkspaceCreated) {
          try { await onWorkspaceCreated(newId); } catch { /* non-fatal */ }
        }
        if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
        targetWsId = newId;
      } else if (wsOptions.targetWorkspaceId && wsOptions.targetWorkspaceId !== workspaceId) {
        targetWsId = wsOptions.targetWorkspaceId;
      }

      await addWorkspaceTask(targetWsId, taskData, {
        uid: user.uid, email: user.email, displayName: user.displayName || user.email,
      });

      if (taskData.assigneeEmail) {
        notifyTaskAssigned({
          assigneeEmail: taskData.assigneeEmail,
          assigneeName:  taskData.assigneeName,
          taskText:      taskData.text,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(() => {});
      }
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceBoardContent', action: 'addWorkspaceTask' }, user.uid);
      throw e;
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('Delete this task from the workspace?')) return;
    try {
      await deleteWorkspaceTask(workspaceId, taskId);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:handleDelete', action: 'deleteWorkspaceTask' }, user.uid);
      if (showToast) showToast('Failed to delete task.', 'warning');
    }
  };

  const closeAddTask = () => {
    setShowAddTask(false);
    if (onAddTaskClose) onAddTaskClose();
  };

  // Apply both assignee AND status filters.
  const filteredTasks = tasks.filter(t => {
    if (filterAssignee !== 'all') {
      if (filterAssignee === 'unassigned') {
        if (t.assigneeUid || t.assigneeEmail) return false;
      } else if (t.assigneeUid !== filterAssignee) {
        return false;
      }
    }
    if (filterStatus !== 'all' && (t.status || 'open') !== filterStatus) return false;
    return true;
  });

  // "+ Add task in X" handler — opens modal pre-filled with category context
  const handleAddTaskHere = (categoryId, subcategoryId) => {
    setAddTaskContext({ categoryId, subcategoryId });
    setShowAddTask(true);
  };

  // Build a human label for the category context shown in the modal header
  const categoryContextLabel = (() => {
    if (!addTaskContext.categoryId) return null;
    const cat = (workspace?.categories || []).find(c => c.id === addTaskContext.categoryId);
    if (!cat) return null;
    const sub = (cat.subcategories || []).find(s => s.id === addTaskContext.subcategoryId);
    return sub ? `${cat.name} › ${sub.name}` : cat.name;
  })();

  return (
    <div style={{ paddingTop: 14 }}>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #dc262644', color: '#dc2626', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Nested-accordion category board (replaces the 4-column Kanban) */}
      {tasksLoading
        ? <div style={{ padding: '20px 0', color: '#475569', fontSize: 13 }}>Loading tasks…</div>
        : (
          <CategoryBoard
            workspace={workspace}
            workspaceId={workspaceId}
            tasks={filteredTasks}
            members={members}
            onDelete={handleDelete}
            currentUid={user.uid}
            isAdmin={isAdmin}
            user={user}
            showToast={showToast}
            onAddTaskHere={handleAddTaskHere}
            filterAssignee={filterAssignee}
            setFilterAssignee={setFilterAssignee}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
          />
        )
      }

      {showAddTask && (
        <AddTaskModal
          onClose={closeAddTask}
          onAdd={handleAddTask}
          members={members}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          categories={workspace?.categories || []}
          showToast={showToast}
          initialCategoryId={addTaskContext.categoryId}
          initialSubcategoryId={addTaskContext.subcategoryId}
          categoryContextLabel={categoryContextLabel}
          hideWorkspacePicker={true}
        />
      )}
    </div>
  );
}

// ── WorkspaceItem ─────────────────────────────────────────────────────────────
// A single collapsible workspace card with header, invite panel, and board.
function WorkspaceItem({ workspace, showToast, user, workspaces, onWorkspaceCreated, isFirst }) {
  // Persist expanded state per workspace
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(`ddiary_ws_${workspace.id}_expanded`);
      return stored !== null ? stored === 'true' : isFirst;
    } catch { return isFirst; }
  });
  const [showInvite,    setShowInvite]    = useState(false);
  const [showAddTask,   setShowAddTask]   = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Members are always loaded (shown in header chip row)
  const { members, loading: membersLoading } = useWorkspace(workspace.id);

  // Invite state
  const [inviteEmail,       setInviteEmail]       = useState('');
  const [inviteSending,     setInviteSending]     = useState(false);
  const [inviteEmailSent,   setInviteEmailSent]   = useState(false);
  const [inviteError,       setInviteError]       = useState('');
  const [copied,            setCopied]            = useState(false);
  const [inviteSuggestions, setInviteSuggestions] = useState([]);

  const handleInviteInputChange = (val) => {
    setInviteEmail(val);
    setInviteError('');
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(results => setInviteSuggestions(results || []));
    } else {
      setInviteSuggestions([]);
    }
  };

  const selectInviteSuggestion = (person) => {
    setInviteEmail(person.email);
    setInviteSuggestions([]);
  };

  // Rename state
  const [renaming,     setRenaming]     = useState(false);
  const [renameText,   setRenameText]   = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const inviteUrl = `${window.location.origin}?workspace=${workspace.id}`;

  const toggleExpanded = () => {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem(`ddiary_ws_${workspace.id}_expanded`, String(next)); } catch {}
      return next;
    });
  };

  const handleRename = async () => {
    if (!renameText.trim() || renameText.trim() === workspace.name) { setRenaming(false); return; }
    setRenameSaving(true);
    try { await renameWorkspace(workspace.id, renameText.trim()); } catch (e) {
      logError(e, { location: 'WorkspaceItem:handleRename' }, user.uid);
    }
    setRenaming(false);
    setRenameSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      if (showToast) showToast(`Workspace deleted.`, 'success');
    } catch (e) {
      logError(e, { location: 'WorkspaceItem:handleDelete' }, user.uid);
      if (showToast) showToast('Failed to delete workspace.', 'warning');
      setDeleting(false);
      setShowDelete(false);
    }
  };

  const handleEmailInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteError('');
    try {
      const email = inviteEmail.trim().toLowerCase();

      // Guard: already a real member?
      if (members.some(m => m.email?.toLowerCase() === email)) {
        setInviteError('This person is already a member of this workspace.');
        return;
      }

      // Guard: pending invite already exists?
      const existing = await getExistingInvite(workspace.id, email);
      if (existing?.status === 'pending') {
        setInviteError('An invite is already pending — waiting for them to respond.');
        return;
      }

      // Create invite doc (overwrites any prior 'rejected' invite)
      await createWorkspaceInvite({
        workspaceId:   workspace.id,
        workspaceName: workspace.name,
        inviterUid:    user.uid,
        inviterEmail:  user.email,
        inviterName:   user.displayName || user.email,
        inviteeEmail:  email,
      });

      // Also pre-create pending member doc as fallback for claimPendingMemberships
      await addWorkspaceMember(workspace.id, {
        uid:         `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email,
        displayName: email.split('@')[0],
        role:        'member',
      });

      // Send email — non-fatal if it fails
      try {
        await notifyWorkspaceInvite({
          inviteeEmail:  email,
          inviteeName:   email.split('@')[0],
          inviterName:   user.displayName || user.email,
          workspaceName: workspace.name,
          inviteUrl,
        });
      } catch { /* email failure is non-fatal — the invite doc is already created */ }

      if (showToast) showToast(`Invite sent to ${email}!`, 'success');
      setInviteEmailSent(true);
      setInviteEmail('');
      setTimeout(() => setInviteEmailSent(false), 3000);
    } catch {
      setInviteError('Failed to send invite — please try again.');
    } finally {
      setInviteSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isAdmin = workspace.role === 'admin' || workspace.createdBy === user.uid;

  return (
    <div
      className="card"
      style={{
        marginBottom:  10,
        padding:       0,
        overflow:      'hidden',
        // Lighter chrome — the workspace reads as a section header in the tree,
        // not a heavy outer box. Categories inside inherit this look.
        border:        '1px solid #e2e8f0',
        transition:    'border-color 0.2s',
        boxShadow:     'none',
      }}
    >
      {/* ── Header row ───────────────────────────────────────────────────────── */}
      <div
        onClick={toggleExpanded}
        style={{
          padding:       '14px 18px',
          cursor:        'pointer',
          display:       'flex',
          alignItems:    'center',
          gap:           10,
          background:    expanded ? '#f1f5f9' : '#ffffff',
          borderBottom:  expanded || showInvite ? '1px solid #e2e8f0' : 'none',
          transition:    'background 0.2s',
          userSelect:    'none',
        }}
      >
        {/* Workspace name / rename */}
        {renaming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }} onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
              style={{
                fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
                color: '#0f172a', border: 'none', borderBottom: '2px solid #7c3aed',
                background: 'transparent', outline: 'none', minWidth: 160, flex: 1,
              }}
            />
            <button onClick={handleRename} disabled={renameSaving}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {renameSaving ? '…' : 'Save'}
            </button>
            <button onClick={() => setRenaming(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workspace.name}
            </span>
            {isAdmin && (
              <button onClick={e => { e.stopPropagation(); setRenameText(workspace.name); setRenaming(true); }}
                title="Rename workspace"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', padding: 2, display: 'flex', flexShrink: 0 }}>
                <Edit2 size={12} />
              </button>
            )}
            {/* Member count */}
            {!membersLoading && (
              <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <Users size={11} /> {members.length}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {/* Invite */}
          <button
            onClick={() => setShowInvite(v => !v)}
            className="btn btn-sm btn-outline"
            style={{ gap: 5 }}
          >
            <UserPlus size={13} /> Invite
          </button>

          {/* New task */}
          <button
            onClick={() => { setExpanded(true); setShowAddTask(true); }}
            className="btn btn-sm btn-teal"
            style={{ gap: 5 }}
          >
            <Plus size={13} /> Task
          </button>

          {/* Delete workspace (admin only) */}
          {isAdmin && (
            <button
              onClick={() => setShowDelete(true)}
              title="Delete workspace"
              style={{ background: 'none', border: '1px solid #e0c8c8', borderRadius: 6, cursor: 'pointer', color: '#dc262677', padding: '4px 6px', display: 'flex' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Expand / collapse chevron — always right-aligned for consistency */}
        <div style={{ color: '#475569', flexShrink: 0, display: 'flex', marginLeft: 4 }}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </div>

      {/* ── Invite panel ──────────────────────────────────────────────────────── */}
      {showInvite && (
        <div style={{ padding: '14px 18px', background: '#eff6ff', borderBottom: expanded ? '1px solid #e2e8f0' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={14} /> Invite to <strong>{workspace.name}</strong>
            </div>
            <button onClick={() => { setShowInvite(false); setInviteError(''); setInviteEmail(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
              <X size={16} />
            </button>
          </div>

          {/* Email input with org autocomplete */}
          <div style={{ position: 'relative', marginBottom: inviteError ? 6 : 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={inviteEmail}
                onChange={e => handleInviteInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setInviteSuggestions([]); handleEmailInvite(); } if (e.key === 'Escape') setInviteSuggestions([]); }}
                onBlur={() => setTimeout(() => setInviteSuggestions([]), 150)}
                placeholder="Search by name or email…"
                autoComplete="off"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${inviteError ? '#dc262666' : '#2563eb44'}`, background: '#fff', fontSize: 13, fontFamily: 'var(--font-body)', color: '#0f172a', outline: 'none' }}
              />
              <button className="btn btn-sm btn-teal" onClick={() => { setInviteSuggestions([]); handleEmailInvite(); }}
                disabled={inviteSending || !inviteEmail.trim()} style={{ flexShrink: 0, minWidth: 80 }}>
                {inviteEmailSent ? <><CheckIcon size={13} /> Sent!</>
                  : inviteSending ? '…'
                  : <><Send size={13} /> Send</>}
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {inviteSuggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 90, zIndex: 200,
                background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
              }}>
                {inviteSuggestions.map(person => (
                  <div
                    key={person.id || person.email}
                    onMouseDown={() => selectInviteSuggestion(person)}
                    style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{person.displayName}</span>
                    <span style={{ fontSize: 11, color: '#475569' }}>{person.email}</span>
                    {person.jobTitle && <span style={{ fontSize: 11, color: '#94a3b8' }}>{person.jobTitle}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inline error */}
          {inviteError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626', marginBottom: 10 }}>
              <AlertTriangle size={13} /> {inviteError}
            </div>
          )}

          {/* Help text */}
          <p style={{ fontSize: 11, color: '#6a9fd4', marginBottom: 10, marginTop: 0 }}>
            They'll receive an invite they can accept or decline.
          </p>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#c4dff5' }} />
            <span style={{ fontSize: 11, color: '#8ab8d6', fontWeight: 600 }}>or share link</span>
            <div style={{ flex: 1, height: 1, background: '#c4dff5' }} />
          </div>

          {/* Copy link */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={inviteUrl} onClick={e => e.target.select()}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #2563eb44', background: '#fff', fontSize: 11, fontFamily: 'monospace', color: '#2563eb', outline: 'none' }} />
            <button className="btn btn-sm btn-teal" onClick={handleCopy} style={{ flexShrink: 0 }}>
              {copied ? <><CheckIcon size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
            They open the link, sign in with Microsoft, and join automatically as a fallback.
          </p>
        </div>
      )}

      {/* ── Delete confirmation ───────────────────────────────────────────────── */}
      {showDelete && (
        <div style={{ padding: '14px 18px', background: '#fff5f5', borderBottom: expanded ? '1px solid #e2e8f0' : 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} color="#dc2626" />
          <span style={{ flex: 1, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
            Delete "{workspace.name}"? This removes it for all members and cannot be undone.
          </span>
          <button onClick={() => setShowDelete(false)} disabled={deleting}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={handleDelete} disabled={deleting}
            style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {deleting ? 'Deleting…' : 'Yes, Delete'}
          </button>
        </div>
      )}

      {/* ── Expanded board content ────────────────────────────────────────────── */}
      {/* Categories are nested inside the workspace — a small left indent makes
          the tree hierarchy visually legible without another card wrapper. */}
      {expanded && (
        <div style={{ padding: '0 14px 14px 18px', background: '#ffffff' }}>
          <WorkspaceBoardContent
            workspaceId={workspace.id}
            members={members}
            showToast={showToast}
            user={user}
            workspaces={workspaces}
            onWorkspaceCreated={onWorkspaceCreated}
            showAddTaskInitial={showAddTask}
            onAddTaskClose={() => setShowAddTask(false)}
            isAdmin={isAdmin}
          />
        </div>
      )}
    </div>
  );
}

// ── Main KanbanBoard ──────────────────────────────────────────────────────────
export default function KanbanBoard({ onWorkspaceCreated, showToast }) {
  const { user } = useAuth();
  const { workspaces, loading: wsListLoading } = useMyWorkspaces();
  const [showNewTask, setShowNewTask] = useState(false);

  if (wsListLoading) {
    return <div className="empty-state fade-in"><p>Loading workspaces…</p></div>;
  }

  // Handler for AddTaskModal when creating from the header or empty state.
  // Each async step is wrapped so a hang/denial bubbles up with a clear label.
  const handleTopLevelAdd = async (taskData, wsOptions) => {
    let wsId = wsOptions.targetWorkspaceId || workspaces[0]?.id || null;
    try {
      if (wsOptions.newWorkspaceName) {
        wsId = await createWorkspace(user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName);
        if (onWorkspaceCreated) {
          try { await onWorkspaceCreated(wsId); } catch { /* non-fatal */ }
        }
        if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
      }
    } catch (e) {
      e.message = `Could not create workspace: ${e?.message || e}`;
      throw e;
    }
    if (wsId) {
      try {
        await addWorkspaceTask(wsId, taskData, {
          uid: user.uid, email: user.email, displayName: user.displayName || user.email,
        });
      } catch (e) {
        e.message = `Workspace created, but task add failed: ${e?.message || e}`;
        throw e;
      }
      if (taskData.assigneeEmail) {
        notifyTaskAssigned({
          assigneeEmail: taskData.assigneeEmail,
          assigneeName:  taskData.assigneeName,
          taskText:      taskData.text,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(() => {});
      }
    }
  };

  return (
    <div className="fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={20} color="#7c3aed" /> Team Board
        </h2>
        <button className="btn btn-teal" onClick={() => setShowNewTask(true)} style={{ gap: 5 }}>
          <Plus size={14} /> New Task
        </button>
      </div>

      {/* New Task modal */}
      {showNewTask && (
        <AddTaskModal
          onClose={() => setShowNewTask(false)}
          onAdd={handleTopLevelAdd}
          members={[]}
          workspaces={workspaces}
          showToast={showToast}
        />
      )}

      {/* Pending invite banners (auto-dismiss on accept/decline) */}
      <WorkspaceInvitePrompt showToast={showToast} />

      {/* Empty state when no workspaces */}
      {!workspaces.length && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <Briefcase size={40} color="#7c3aed" style={{ opacity: 0.5 }} />
          <p style={{ marginTop: 12, color: '#475569', fontSize: 15, fontWeight: 600 }}>No team board yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 340, lineHeight: 1.6, marginTop: 6 }}>
            Click <strong>New Task</strong> above to create your first task and workspace.
          </p>
        </div>
      )}

      {/* Collapsible workspace list */}
      {workspaces.map((ws, i) => (
        <WorkspaceItem
          key={ws.id}
          workspace={ws}
          showToast={showToast}
          user={user}
          workspaces={workspaces}
          onWorkspaceCreated={onWorkspaceCreated}
          isFirst={i === 0}
        />
      ))}
    </div>
  );
}
