/**
 * Dashboard — super-admin-only platform overview.
 *
 * Six tiles, each clickable to drill down into a task list with the full
 * Workspace › Category › Subcategory path on each row.
 *
 *   Total tasks       all tasks (any status)
 *   Outstanding       not done
 *   Due today         due in current local day, not done
 *   Overdue           past due, not done
 *   By assignee       breakdown of outstanding tasks by assignee
 *   By due date       outstanding tasks bucketed: Overdue / Today / This week / Later / No due date
 *
 * Toggle at the top includes/excludes personal-diary tasks
 * (users/{uid}/tasks) alongside workspace tasks.
 */
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, AlertTriangle, Clock, Users, Calendar,
  ArrowLeft, ChevronRight, ChevronUp, ChevronDown, Folder, Plus, User,
  Globe, UserCircle, Check, X as XIcon,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePlatformTasks } from '../hooks/usePlatformTasks';
import { addWorkspaceTask } from '../hooks/useWorkspace';
import { notifyTaskAssigned } from '../utils/emailNotifications';
import { logError } from '../utils/errorLogger';

// ─── Date helpers (local timezone) ─────────────────────────────────────────
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfToday   = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const dueDateMs    = (t) => (t.dueDate ? new Date(t.dueDate).getTime() : null);
const isDoneTask   = (t) => t.completed === true || t.status === 'done';
const assigneeKey  = (t) => t.assigneeName || t.assigneeEmail || 'Unassigned';

const formatDue = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

// ─── Tile primitive ────────────────────────────────────────────────────────
function Tile({ icon: Icon, label, count, accent, onClick, active, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl border bg-white p-5 transition shadow-sm hover:shadow-md hover:border-violet-300 ${active ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-200'}`}
      style={{ minHeight: 130 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{count}</div>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon size={20} />
        </div>
      </div>
      {children && <div className="mt-3 text-xs text-slate-600 space-y-1">{children}</div>}
    </button>
  );
}

// ─── Sortable column header ────────────────────────────────────────────────
// Click to sort by this column. Clicking the active column toggles direction.
function SortHeader({ column, label, sort, setSort, className = '' }) {
  const active = sort.column === column;
  const Arrow  = active && sort.direction === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button
      onClick={() => setSort(s => s.column === column
        ? { column, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
      )}
      className={`text-left text-xs font-medium uppercase tracking-wide flex items-center gap-1 ${active ? 'text-violet-700' : 'text-slate-500 hover:text-slate-700'} ${className}`}
    >
      {label}
      {active && <Arrow size={12} />}
    </button>
  );
}

// ─── Drill-down list row ───────────────────────────────────────────────────
const ownerKey = (t) => t.createdByName || t.createdByEmail || t.ownerName || '—';

function TaskRow({ task, onOpen }) {
  const overdue = (() => {
    const d = dueDateMs(task);
    return d && d < startOfToday() && !isDoneTask(task);
  })();
  const StatusPill = (
    <span className={`inline-flex px-2 py-0.5 rounded-full font-medium text-xs whitespace-nowrap ${
      isDoneTask(task)              ? 'bg-emerald-50 text-emerald-700'
      : task.status === 'review'    ? 'bg-blue-50 text-blue-700'
      : task.status === 'in_progress' ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-700'
    }`}>
      {(task.status || 'open').replace('_', ' ')}
    </span>
  );

  const dash = <span className="text-slate-400">—</span>;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(task)}
      className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-violet-50/40 focus:bg-violet-50 focus:outline-none transition-colors cursor-pointer"
      title="Open this task in the Team Board"
    >
      {/* ── Mobile (< md): stacked card with explicit field labels ─────── */}
      <div className="md:hidden">
        <div className="font-medium text-slate-900 break-words">{task.text || '(no title)'}</div>
        <div className="text-xs text-slate-500 mt-1 truncate" title={task._workspaceName}>
          {task._workspaceName}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="truncate">
            <span className="text-slate-400">Category: </span>
            <span className="text-slate-700 font-medium">{task._categoryName}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-400">Sub-category: </span>
            <span className="text-slate-700 font-medium">{task._subcategoryName || '—'}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-400">Owner: </span>
            <span className="text-slate-700 font-medium">{ownerKey(task)}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-400">Assignee: </span>
            <span className="text-slate-700 font-medium">{assigneeKey(task)}</span>
          </div>
          <div className="truncate">
            <span className="text-slate-400">Due: </span>
            <span className={`tabular-nums font-medium ${overdue ? 'text-red-600' : 'text-slate-700'}`}>
              {formatDue(task.dueDate)}
            </span>
          </div>
          <div className="truncate">{StatusPill}</div>
        </div>
      </div>

      {/* ── Desktop (md+): 12-col grid with Category + Sub-category broken
            out into their own columns. Workspace name sits as a small
            subtitle under the task title. */}
      <div className="hidden md:grid grid-cols-12 gap-3 items-center">
        <div className="col-span-3 min-w-0">
          <div className="font-medium text-slate-900 truncate">{task.text || '(no title)'}</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate" title={task._workspaceName}>
            {task._workspaceName}
          </div>
        </div>
        <div className="col-span-2 text-sm text-slate-700 truncate" title={task._categoryName}>
          {task._categoryName}
        </div>
        <div className="col-span-2 text-sm text-slate-700 truncate" title={task._subcategoryName || ''}>
          {task._subcategoryName || dash}
        </div>
        <div className="col-span-1 text-sm text-slate-700 truncate" title={`Created by ${ownerKey(task)}`}>
          {ownerKey(task)}
        </div>
        <div className="col-span-1 text-sm text-slate-700 truncate" title={assigneeKey(task)}>
          {assigneeKey(task)}
        </div>
        <div className={`col-span-1 text-sm tabular-nums ${overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
          {formatDue(task.dueDate)}
        </div>
        <div className="col-span-2">{StatusPill}</div>
      </div>
    </button>
  );
}

// ─── Inline "add task" row ─────────────────────────────────────────────────
// Excel-style row that appears at the top of the drill-down list when the
// user clicks + New Task. Workspace selection cascades to category +
// sub-category options, and members of the chosen workspace populate the
// assignee dropdown.
//
// Keyboard:
//   Enter — save (input clears, row stays for the next task)
//   Esc   — cancel and remove the row
function InlineTaskRow({ workspaces, defaultWorkspaceId, onSave, onCancel, currentUserName }) {
  const [workspaceId,   setWorkspaceId]   = useState(defaultWorkspaceId || workspaces[0]?.id || '');
  const [text,          setText]          = useState('');
  const [categoryId,    setCategoryId]    = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [assigneeUid,   setAssigneeUid]   = useState('');
  const [dueDate,       setDueDate]       = useState('');
  const [status,        setStatus]        = useState('open');
  const [members,       setMembers]       = useState([]);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  // Live members for the chosen workspace (drives the Assignee dropdown).
  useEffect(() => {
    setMembers([]);
    setAssigneeUid('');
    if (!workspaceId) return;
    const unsub = onSnapshot(
      collection(db, 'workspaces', workspaceId, 'members'),
      (snap) => setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    );
    return unsub;
  }, [workspaceId]);

  const ws   = workspaces.find(w => w.id === workspaceId);
  const cats = ws?.categories || [];
  const cat  = cats.find(c => c.id === categoryId);
  const subs = cat?.subcategories || [];

  const canSave = !!text.trim() && !!workspaceId && !saving;

  const handleSave = async (keepOpen = true) => {
    if (!canSave) return;
    setError('');
    setSaving(true);
    try {
      const assignee = members.find(m => m.uid === assigneeUid);
      await onSave({
        workspaceId,
        text:           text.trim(),
        categoryId:     categoryId    || null,
        subcategoryId:  categoryId ? (subcategoryId || null) : null,
        assigneeUid:    assigneeUid   || null,
        assigneeEmail:  assignee?.email?.toLowerCase() || null,
        assigneeName:   assignee?.displayName || assignee?.email || null,
        dueDate:        dueDate       || null,
        status,
      });
      // Clear the title + due so the user can keep adding rows quickly.
      // Workspace / category / subcategory / assignee stay so batch entry
      // into the same bucket is one Enter per task.
      setText('');
      setDueDate('');
      if (!keepOpen) onCancel();
    } catch (e) {
      setError(e?.message || 'Failed to add task.');
    } finally {
      setSaving(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleSave(true); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  if (workspaces.length === 0) {
    return (
      <div className="px-4 py-4 border-b border-violet-200 bg-violet-50/50 text-sm text-slate-600">
        You're not a member of any workspace yet.
        <button onClick={onCancel} className="ml-2 text-violet-700 hover:underline">Cancel</button>
      </div>
    );
  }

  const cellSelect = "w-full text-xs border border-slate-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200";

  return (
    <div className="border-b-2 border-violet-200 bg-violet-50/40">
      {/* ── Mobile: stacked form ───────────────────────────────────────── */}
      <div className="md:hidden p-4 space-y-2">
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Task title (required)"
          className="w-full px-2 py-1.5 text-sm border border-violet-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); setCategoryId(''); setSubcategoryId(''); }} className={cellSelect}>
            <option value="">Pick workspace…</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }} className={cellSelect} disabled={!workspaceId}>
            <option value="">Uncategorized</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)} className={cellSelect} disabled={!categoryId || subs.length === 0}>
            <option value="">— none —</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)} className={cellSelect} disabled={!workspaceId}>
            <option value="">Unassigned</option>
            {members.map(m => <option key={m.uid} value={m.uid}>{m.displayName || m.email}</option>)}
          </select>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cellSelect} />
          <select value={status} onChange={e => setStatus(e.target.value)} className={cellSelect}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700">Cancel</button>
          <button onClick={() => handleSave(true)} disabled={!canSave} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700">
            <Check size={12} /> {saving ? 'Saving…' : 'Add task'}
          </button>
        </div>
      </div>

      {/* ── Desktop: inline grid matching the column layout ────────────── */}
      <div className="hidden md:grid grid-cols-12 gap-3 items-center px-4 py-2.5">
        <div className="col-span-3 min-w-0 space-y-1">
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Task title (required) — Enter to save, Esc to cancel"
            className="w-full px-2 py-1 text-sm border border-violet-300 rounded focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
          <select
            value={workspaceId}
            onChange={e => { setWorkspaceId(e.target.value); setCategoryId(''); setSubcategoryId(''); }}
            className={cellSelect + ' text-slate-600'}
          >
            <option value="">Pick workspace…</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }} className={cellSelect} disabled={!workspaceId}>
            <option value="">Uncategorized</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <select value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)} className={cellSelect} disabled={!categoryId || subs.length === 0}>
            <option value="">— none —</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="col-span-1 text-xs text-slate-500 truncate" title={`Owner: ${currentUserName}`}>
          you
        </div>
        <div className="col-span-1">
          <select value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)} className={cellSelect} disabled={!workspaceId}>
            <option value="">—</option>
            {members.map(m => <option key={m.uid} value={m.uid}>{(m.displayName || m.email || '').split(' ')[0]}</option>)}
          </select>
        </div>
        <div className="col-span-1">
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onKeyDown={handleKey} className={cellSelect} />
        </div>
        <div className="col-span-2 flex items-center gap-1 min-w-0">
          <select value={status} onChange={e => setStatus(e.target.value)} className={cellSelect + ' flex-1'}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>
          <button onClick={() => handleSave(true)} disabled={!canSave} className="px-2 py-1 text-xs rounded bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700 shrink-0" title="Save (Enter) — keeps row open for the next task">
            <Check size={12} />
          </button>
          <button onClick={onCancel} className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-100 shrink-0" title="Cancel (Esc)">
            <XIcon size={12} />
          </button>
        </div>
        {error && <div className="col-span-12 text-xs text-red-600 mt-1">{error}</div>}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function Dashboard({ showToast } = {}) {
  const { user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  // View mode — super-admins default to 'global' (all tasks on the platform)
  // so the dashboard is immediately populated on load without needing a click.
  // Non-super-admins always run in 'mine' (the hook silently downgrades).
  const [viewMode, setViewMode] = useState(isSuperAdmin ? 'global' : 'mine');
  const { tasks, loading, workspaces, effectiveMode } = usePlatformTasks({ mode: viewMode });
  const [addingInline, setAddingInline] = useState(false);

  // Click a row -> deep-link into the Team Board with full context so the
  // workspace, category, sub-category all auto-expand and the task modal opens.
  const openTaskInTeamBoard = (task) => {
    navigate('/tasks', {
      state: {
        openWorkspaceId:    task._parentId,
        openCategoryId:     task.categoryId    || null,
        openSubcategoryId:  task.subcategoryId || null,
        openTaskId:         task.id,
      },
    });
  };

  // Inline-add handler — called by the InlineTaskRow on Save.
  const handleInlineAdd = async (taskData) => {
    const wsId = taskData.workspaceId;
    if (!wsId || !taskData.text) return;
    const actor = { uid: user.uid, email: user.email, displayName: user.displayName || user.email };
    await addWorkspaceTask(wsId, {
      text:          taskData.text,
      status:        taskData.status   || 'open',
      priority:      'medium',
      dueDate:       taskData.dueDate  || null,
      assigneeUid:   taskData.assigneeUid   || null,
      assigneeEmail: taskData.assigneeEmail || null,
      assigneeName:  taskData.assigneeName  || null,
      categoryId:    taskData.categoryId    || null,
      subcategoryId: taskData.subcategoryId || null,
    }, actor);

    if (taskData.assigneeEmail) {
      notifyTaskAssigned({
        assigneeEmail: taskData.assigneeEmail,
        assigneeName:  taskData.assigneeName,
        taskText:      taskData.text,
        dueDate:       taskData.dueDate,
        priority:      'medium',
        ownerName:     user.displayName || user.email,
        ownerUid:      user.uid,
      }).catch((err) => logError(err, { location: 'Dashboard:notifyTaskAssigned' }));
    }
    if (showToast) showToast('Task added', 'success');
  };

  // drillDown: { kind: 'total' | 'outstanding' | 'dueToday' | 'overdue' | 'assignee' | 'bucket', value?: string }
  const [drillDown, setDrillDown] = useState(null);

  // Open + New Task: enable inline mode AND auto-open the drill-down to
  // 'outstanding' so the new row sits at the top of a visible list.
  const startInlineAdd = () => {
    setAddingInline(true);
    if (!drillDown) setDrillDown({ kind: 'outstanding' });
  };

  // ── Drill-down filters + sort (layered on top of the drill-down kind) ────
  const [filters, setFilters] = useState({ workspace: 'all', assignee: 'all', status: 'all' });
  const [sort,    setSort]    = useState({ column: 'due', direction: 'asc' });
  const resetFilters = () => setFilters({ workspace: 'all', assignee: 'all', status: 'all' });
  const filtersActive = filters.workspace !== 'all' || filters.assignee !== 'all' || filters.status !== 'all';

  // ── Aggregations (recomputed only when tasks change) ─────────────────────
  // NOTE: All hooks must run unconditionally — the non-super-admin guard
  // happens in the JSX below, not via an early return, to keep hook order
  // stable between renders.
  const sod = startOfToday();
  const eod = endOfToday();
  const weekEnd = sod + 7 * 24 * 60 * 60 * 1000;

  const counts = useMemo(() => {
    const total       = tasks.length;
    const outstanding = tasks.filter(t => !isDoneTask(t)).length;
    const dueToday    = tasks.filter(t => {
      const d = dueDateMs(t);
      return d && d >= sod && d <= eod && !isDoneTask(t);
    }).length;
    const overdue     = tasks.filter(t => {
      const d = dueDateMs(t);
      return d && d < sod && !isDoneTask(t);
    }).length;

    const assigneeMap = new Map();
    tasks.forEach(t => {
      if (isDoneTask(t)) return;
      const k = assigneeKey(t);
      assigneeMap.set(k, (assigneeMap.get(k) || 0) + 1);
    });
    const assigneeList = [...assigneeMap.entries()].sort((a, b) => b[1] - a[1]);

    const buckets = { Overdue: 0, Today: 0, 'This week': 0, Later: 0, 'No due date': 0 };
    tasks.forEach(t => {
      if (isDoneTask(t)) return;
      const d = dueDateMs(t);
      if (!d)             buckets['No due date']++;
      else if (d < sod)   buckets.Overdue++;
      else if (d <= eod)  buckets.Today++;
      else if (d <= weekEnd) buckets['This week']++;
      else                buckets.Later++;
    });

    return { total, outstanding, dueToday, overdue, assigneeList, buckets };
  }, [tasks, sod, eod, weekEnd]);

  // ── Drill-down filtering ─────────────────────────────────────────────────
  const drillTasks = useMemo(() => {
    if (!drillDown) return [];
    const { kind, value } = drillDown;
    if (kind === 'total')       return tasks;
    if (kind === 'outstanding') return tasks.filter(t => !isDoneTask(t));
    if (kind === 'dueToday')    return tasks.filter(t => {
      const d = dueDateMs(t);
      return d && d >= sod && d <= eod && !isDoneTask(t);
    });
    if (kind === 'overdue')     return tasks.filter(t => {
      const d = dueDateMs(t);
      return d && d < sod && !isDoneTask(t);
    });
    if (kind === 'assignee')    return tasks.filter(t => !isDoneTask(t) && assigneeKey(t) === value);
    if (kind === 'bucket')      return tasks.filter(t => {
      if (isDoneTask(t)) return false;
      const d = dueDateMs(t);
      if (value === 'No due date') return !d;
      if (value === 'Overdue')     return d && d < sod;
      if (value === 'Today')       return d && d >= sod && d <= eod;
      if (value === 'This week')   return d && d > eod && d <= weekEnd;
      if (value === 'Later')       return d && d > weekEnd;
      return false;
    });
    return [];
  }, [drillDown, tasks, sod, eod, weekEnd]);

  // ── Filter option lists (built from the FULL task pool, not the drill set,
  //    so options stay stable as you filter)
  const filterOptions = useMemo(() => {
    const wsSet = new Set();
    const asSet = new Set();
    tasks.forEach(t => {
      const wsLabel = t._kind === 'workspace' ? (t._label?.split(' › ')[0] || '') : (t._label || '');
      if (wsLabel) wsSet.add(wsLabel);
      asSet.add(assigneeKey(t));
    });
    return {
      workspaces: ['all', ...[...wsSet].sort((a, b) => a.localeCompare(b))],
      assignees:  ['all', ...[...asSet].sort((a, b) => a.localeCompare(b))],
      statuses:   ['all', 'open', 'in_progress', 'review', 'done'],
    };
  }, [tasks]);

  // ── Apply filter dropdowns on top of the drill-down kind ─────────────────
  const drillFiltered = useMemo(() => {
    return drillTasks.filter(t => {
      if (filters.workspace !== 'all') {
        const wsLabel = t._kind === 'workspace' ? (t._label?.split(' › ')[0] || '') : (t._label || '');
        if (wsLabel !== filters.workspace) return false;
      }
      if (filters.assignee !== 'all' && assigneeKey(t) !== filters.assignee) return false;
      if (filters.status !== 'all') {
        const taskStatus = isDoneTask(t) ? 'done' : (t.status || 'open');
        if (taskStatus !== filters.status) return false;
      }
      return true;
    });
  }, [drillTasks, filters]);

  // ── Sort drill-down tasks per the active sort spec ───────────────────────
  const drillSorted = useMemo(() => {
    const arr = [...drillFiltered];
    const dir = sort.direction === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sort.column === 'task')     return dir * (a.text || '').localeCompare(b.text || '');
      if (sort.column === 'path')     return dir * (a._label || '').localeCompare(b._label || '');
      if (sort.column === 'category') return dir * (a._categoryName || '').localeCompare(b._categoryName || '');
      if (sort.column === 'subcat')   return dir * (a._subcategoryName || '').localeCompare(b._subcategoryName || '');
      if (sort.column === 'owner')    return dir * ownerKey(a).localeCompare(ownerKey(b));
      if (sort.column === 'assignee') return dir * assigneeKey(a).localeCompare(assigneeKey(b));
      if (sort.column === 'status') {
        const sa = isDoneTask(a) ? 'done' : (a.status || 'open');
        const sb = isDoneTask(b) ? 'done' : (b.status || 'open');
        return dir * sa.localeCompare(sb);
      }
      // 'due'
      const ad = dueDateMs(a) ?? Infinity;
      const bd = dueDateMs(b) ?? Infinity;
      return dir * (ad - bd);
    });
    return arr;
  }, [drillFiltered, sort]);

  const drillTitle = (() => {
    if (!drillDown) return '';
    if (drillDown.kind === 'total')       return 'All tasks';
    if (drillDown.kind === 'outstanding') return 'Outstanding tasks';
    if (drillDown.kind === 'dueToday')    return 'Due today';
    if (drillDown.kind === 'overdue')     return 'Overdue tasks';
    if (drillDown.kind === 'assignee')    return `Assigned to ${drillDown.value}`;
    if (drillDown.kind === 'bucket')      return `Bucket: ${drillDown.value}`;
    return '';
  })();

  // ── Render ───────────────────────────────────────────────────────────────
  // Non-super-admins shouldn't get here (route is gated), but show a friendly
  // message anyway in case the route guard is bypassed.
  if (!isSuperAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-6 mt-12 bg-white rounded-2xl border border-slate-200 text-center">
        <h2 className="text-xl font-semibold text-slate-900">Dashboard is restricted</h2>
        <p className="mt-2 text-slate-600">This view is only available to platform super-admins.</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
        >
          <ArrowLeft size={16} /> Back to diary
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
            <LayoutDashboard size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 truncate">
              {effectiveMode === 'global' ? 'Platform Dashboard' : 'My Dashboard'}
            </h1>
            <p className="text-sm text-slate-500">
              {effectiveMode === 'global'
                ? <>Super-admin overview · {tasks.length} task{tasks.length === 1 ? '' : 's'} loaded</>
                : <>Tasks assigned to or created by you · {tasks.length} task{tasks.length === 1 ? '' : 's'} loaded</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Super-admin only: toggle between My tasks and Global view. */}
          {isSuperAdmin && (
            <button
              onClick={() => setViewMode(m => m === 'mine' ? 'global' : 'mine')}
              className={`btn btn-sm inline-flex items-center gap-1.5 ${effectiveMode === 'global' ? 'btn-purple' : 'btn-outline'}`}
              title={effectiveMode === 'global' ? 'Currently showing all platform tasks — click for My tasks only' : 'Currently showing My tasks — click for Global view'}
            >
              {effectiveMode === 'global'
                ? <><Globe size={14} /> Global view</>
                : <><UserCircle size={14} /> My tasks</>}
            </button>
          )}
          <button
            onClick={startInlineAdd}
            disabled={addingInline}
            className="btn btn-teal btn-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Add a task inline at the top of the list"
          >
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-slate-500 mb-4">Loading platform tasks…</div>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        <Tile
          icon={ListTodo}
          label="Total tasks"
          count={counts.total}
          accent="bg-slate-100 text-slate-700"
          onClick={() => setDrillDown({ kind: 'total' })}
          active={drillDown?.kind === 'total'}
        />
        <Tile
          icon={Clock}
          label="Outstanding"
          count={counts.outstanding}
          accent="bg-amber-100 text-amber-700"
          onClick={() => setDrillDown({ kind: 'outstanding' })}
          active={drillDown?.kind === 'outstanding'}
        />
        <Tile
          icon={Calendar}
          label="Due today"
          count={counts.dueToday}
          accent="bg-blue-100 text-blue-700"
          onClick={() => setDrillDown({ kind: 'dueToday' })}
          active={drillDown?.kind === 'dueToday'}
        />
        <Tile
          icon={AlertTriangle}
          label="Overdue"
          count={counts.overdue}
          accent="bg-red-100 text-red-700"
          onClick={() => setDrillDown({ kind: 'overdue' })}
          active={drillDown?.kind === 'overdue'}
        />

        {/* By assignee — count is unique assignees; FULL list shown inside (scrollable) */}
        <Tile
          icon={Users}
          label="By assignee"
          count={counts.assigneeList.length}
          accent="bg-emerald-100 text-emerald-700"
          onClick={() => setDrillDown({ kind: 'outstanding' })}
          active={drillDown?.kind === 'assignee'}
        >
          <div className="max-h-32 overflow-y-auto pr-1 -mr-1 space-y-1">
            {counts.assigneeList.map(([name, n]) => (
              <button
                key={name}
                onClick={(e) => { e.stopPropagation(); setDrillDown({ kind: 'assignee', value: name }); }}
                className="w-full flex justify-between items-center text-left hover:text-violet-700"
              >
                <span className="truncate">{name}</span>
                <span className="tabular-nums font-semibold ml-2">{n}</span>
              </button>
            ))}
          </div>
        </Tile>

        {/* By due date — buckets listed; click a bucket row to drill in */}
        <Tile
          icon={Calendar}
          label="By due date"
          count={counts.outstanding}
          accent="bg-violet-100 text-violet-700"
          onClick={() => setDrillDown({ kind: 'outstanding' })}
          active={drillDown?.kind === 'bucket'}
        >
          {Object.entries(counts.buckets).map(([name, n]) => (
            <button
              key={name}
              onClick={(e) => { e.stopPropagation(); setDrillDown({ kind: 'bucket', value: name }); }}
              className="w-full flex justify-between items-center text-left hover:text-violet-700"
            >
              <span className="truncate">{name}</span>
              <span className="tabular-nums font-semibold ml-2">{n}</span>
            </button>
          ))}
        </Tile>
      </div>

      {/* Drill-down panel */}
      {drillDown && (
        <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
              <h2 className="font-semibold text-slate-900 truncate">{drillTitle}</h2>
              <span className="text-xs text-slate-500 shrink-0">
                · {drillSorted.length} of {drillFiltered.length === drillTasks.length ? drillTasks.length : `${drillTasks.length} (filtered)`}
              </span>
            </div>
            <button
              onClick={() => { setDrillDown(null); resetFilters(); }}
              className="inline-flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-700 shrink-0 px-3 py-1.5 rounded-md hover:bg-slate-100 min-w-[44px] min-h-[36px]"
              aria-label="Close drill-down"
            >
              <XIcon size={14} /> <span className="hidden sm:inline">Close</span>
            </button>
          </div>

          {/* Filter dropdowns */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-wrap">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide mr-1">Filter:</span>
            <select
              value={filters.workspace}
              onChange={(e) => setFilters(f => ({ ...f, workspace: e.target.value }))}
              className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200 max-w-[200px]"
              title="Filter by workspace"
            >
              {filterOptions.workspaces.map(w => (
                <option key={w} value={w}>{w === 'all' ? 'All workspaces' : w}</option>
              ))}
            </select>
            <select
              value={filters.assignee}
              onChange={(e) => setFilters(f => ({ ...f, assignee: e.target.value }))}
              className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200 max-w-[200px]"
              title="Filter by assignee"
            >
              {filterOptions.assignees.map(a => (
                <option key={a} value={a}>{a === 'all' ? 'All assignees' : a}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
              className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
              title="Filter by status"
            >
              {filterOptions.statuses.map(s => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
                </option>
              ))}
            </select>
            {filtersActive && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 ml-1"
              >
                <XIcon size={12} /> Reset filters
              </button>
            )}
          </div>

          {/* Mobile sort dropdown — desktop has clickable column headers below,
              but those are hidden on small screens, so phones get this. */}
          <div className="md:hidden flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sort:</span>
            <select
              value={sort.column}
              onChange={(e) => setSort(s => ({ column: e.target.value, direction: s.direction }))}
              className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            >
              <option value="due">Due date</option>
              <option value="task">Task title</option>
              <option value="category">Category</option>
              <option value="subcat">Sub-category</option>
              <option value="owner">Owner</option>
              <option value="assignee">Assignee</option>
              <option value="status">Status</option>
            </select>
            <button
              onClick={() => setSort(s => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
              className="inline-flex items-center gap-1 text-xs rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
              title={`Currently ${sort.direction === 'asc' ? 'ascending' : 'descending'} — tap to flip`}
            >
              {sort.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {sort.direction === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>

          {/* Sortable column headers (desktop) */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50/50">
            <SortHeader column="task"     label="Task / Workspace" sort={sort} setSort={setSort} className="col-span-3" />
            <SortHeader column="category" label="Category"         sort={sort} setSort={setSort} className="col-span-2" />
            <SortHeader column="subcat"   label="Sub-category"     sort={sort} setSort={setSort} className="col-span-2" />
            <SortHeader column="owner"    label="Owner"            sort={sort} setSort={setSort} className="col-span-1" />
            <SortHeader column="assignee" label="Assignee"         sort={sort} setSort={setSort} className="col-span-1" />
            <SortHeader column="due"      label="Due"              sort={sort} setSort={setSort} className="col-span-1" />
            <SortHeader column="status"   label="Status"           sort={sort} setSort={setSort} className="col-span-2" />
          </div>

          {/* Inline add row — sits at the top of the list when active. */}
          {addingInline && (
            <InlineTaskRow
              workspaces={workspaces || []}
              defaultWorkspaceId={null}
              currentUserName={user?.displayName || user?.email}
              onCancel={() => setAddingInline(false)}
              onSave={handleInlineAdd}
            />
          )}

          {drillSorted.length === 0 && !addingInline ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              {filtersActive
                ? 'No tasks match the current filters.'
                : 'No tasks match this filter.'}
            </div>
          ) : (
            <div>
              {drillSorted.map(t => (
                <TaskRow key={t._path} task={t} onOpen={openTaskInTeamBoard} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
