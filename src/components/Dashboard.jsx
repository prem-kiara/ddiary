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
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ListTodo, AlertTriangle, Clock, Users, Calendar,
  ArrowLeft, ChevronRight, Folder,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePlatformTasks } from '../hooks/usePlatformTasks';

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

// ─── Drill-down list row ───────────────────────────────────────────────────
function TaskRow({ task }) {
  const overdue = (() => {
    const d = dueDateMs(task);
    return d && d < startOfToday() && !isDoneTask(task);
  })();
  return (
    <div className="grid grid-cols-12 gap-3 items-center px-4 py-3 border-b border-slate-100 hover:bg-slate-50">
      <div className="col-span-12 md:col-span-5">
        <div className="font-medium text-slate-900 truncate">{task.text || '(no title)'}</div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1 truncate">
          <Folder size={12} className="shrink-0" />
          <span className="truncate">{task._label}</span>
        </div>
      </div>
      <div className="col-span-6 md:col-span-3 text-sm text-slate-700 truncate">
        {assigneeKey(task)}
      </div>
      <div className={`col-span-3 md:col-span-2 text-sm tabular-nums ${overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
        {formatDue(task.dueDate)}
      </div>
      <div className="col-span-3 md:col-span-2 text-xs">
        <span className={`inline-flex px-2 py-0.5 rounded-full font-medium ${
          isDoneTask(task)            ? 'bg-emerald-50 text-emerald-700'
          : task.status === 'review'  ? 'bg-blue-50 text-blue-700'
          : task.status === 'in_progress' ? 'bg-amber-50 text-amber-700'
          : 'bg-slate-100 text-slate-700'
        }`}>
          {(task.status || 'open').replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function Dashboard() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [includePersonal, setIncludePersonal] = useState(false);
  const { tasks, loading } = usePlatformTasks({ includePersonal });
  // drillDown: { kind: 'total' | 'outstanding' | 'dueToday' | 'overdue' | 'assignee' | 'bucket', value?: string }
  const [drillDown, setDrillDown] = useState(null);

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

  // ── Sort drill-down tasks: overdue first, then by due date asc ───────────
  const drillSorted = useMemo(() => {
    const arr = [...drillTasks];
    arr.sort((a, b) => {
      const ad = dueDateMs(a) ?? Infinity;
      const bd = dueDateMs(b) ?? Infinity;
      return ad - bd;
    });
    return arr;
  }, [drillTasks]);

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
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
            <LayoutDashboard size={20} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">Platform Dashboard</h1>
            <p className="text-sm text-slate-500">Super-admin overview · {tasks.length} task{tasks.length === 1 ? '' : 's'} loaded</p>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 select-none">
          <input
            type="checkbox"
            checked={includePersonal}
            onChange={(e) => setIncludePersonal(e.target.checked)}
            className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          Include personal-diary tasks
        </label>
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

        {/* By assignee — count is unique assignees, with top 3 listed inside */}
        <Tile
          icon={Users}
          label="By assignee"
          count={counts.assigneeList.length}
          accent="bg-emerald-100 text-emerald-700"
          onClick={() => counts.assigneeList[0] && setDrillDown({ kind: 'assignee', value: counts.assigneeList[0][0] })}
          active={drillDown?.kind === 'assignee'}
        >
          {counts.assigneeList.slice(0, 4).map(([name, n]) => (
            <button
              key={name}
              onClick={(e) => { e.stopPropagation(); setDrillDown({ kind: 'assignee', value: name }); }}
              className="w-full flex justify-between items-center text-left hover:text-violet-700"
            >
              <span className="truncate">{name}</span>
              <span className="tabular-nums font-semibold ml-2">{n}</span>
            </button>
          ))}
        </Tile>

        {/* By due date — count is total bucketed; bucket rows clickable */}
        <Tile
          icon={Calendar}
          label="By due date"
          count={counts.outstanding}
          accent="bg-violet-100 text-violet-700"
          onClick={() => setDrillDown({ kind: 'bucket', value: 'Overdue' })}
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
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <ChevronRight size={16} className="text-slate-400" />
              <h2 className="font-semibold text-slate-900">{drillTitle}</h2>
              <span className="text-xs text-slate-500">· {drillSorted.length} result{drillSorted.length === 1 ? '' : 's'}</span>
            </div>
            <button
              onClick={() => setDrillDown(null)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Close
            </button>
          </div>

          {/* Column headers (desktop) */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50">
            <div className="col-span-5">Task / Path</div>
            <div className="col-span-3">Assignee</div>
            <div className="col-span-2">Due</div>
            <div className="col-span-2">Status</div>
          </div>

          {drillSorted.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No tasks match this filter.</div>
          ) : (
            <div>
              {drillSorted.map(t => <TaskRow key={t._path} task={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
