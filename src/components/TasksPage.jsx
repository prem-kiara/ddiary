import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Users } from 'lucide-react';
import TaskManager from './TaskManager';
import KanbanBoard from './KanbanBoard';
import TeamTaskView from './TeamTaskView';

/**
 * Unified Tasks page — combines personal My Tasks (list view) and
 * the shared Team Board (Kanban view) into one place.
 *
 * Deep-link support:
 *   /tasks?task=<id>               → list view, highlight personal / assigned task
 *   /tasks?task=<id>&wsId=<wsId>   → board view, expand workspace + open task card
 *
 * Params are consumed and cleared immediately so a refresh doesn't re-trigger.
 */
export default function TasksPage({
  tasks, members, loading,
  onAdd, onUpdate, onToggle, onDelete, onClearCompleted,
  showToast, onWorkspaceCreated,
  highlightTaskId: highlightTaskIdProp, onHighlightConsumed: onHighlightConsumedProp,
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Capture both params before the first render clears them.
  const [highlightTaskId, setHighlightTaskId] = useState(
    () => searchParams.get('task') || highlightTaskIdProp || null
  );
  const [highlightWorkspaceId, setHighlightWorkspaceId] = useState(
    () => searchParams.get('wsId') || null
  );

  const [view, setView] = useState(() => {
    // If the URL says this is a workspace task, go straight to board view.
    if (searchParams.get('wsId')) return 'board';
    return localStorage.getItem('ddiary_tasks_view') || 'board';
  });

  // Consume URL params once, store in state, wipe the params.
  useEffect(() => {
    const taskParam = searchParams.get('task');
    const wsParam   = searchParams.get('wsId');
    if (taskParam || wsParam) {
      if (taskParam) setHighlightTaskId(taskParam);
      if (wsParam)   setHighlightWorkspaceId(wsParam);
      // Workspace task → board view; personal task → list view
      setView(wsParam ? 'board' : 'list');
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // Belt-and-suspenders: prop-based fallback (App.jsx useEffect, personal tasks only)
  useEffect(() => {
    if (highlightTaskIdProp && !highlightTaskId) {
      setHighlightTaskId(highlightTaskIdProp);
      setView('list');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTaskIdProp]);

  // Called by a TaskCard after it scrolls into view
  const handleHighlightConsumed = useCallback(() => {
    setHighlightTaskId(null);
    setHighlightWorkspaceId(null);
    onHighlightConsumedProp?.();
  }, [onHighlightConsumedProp]);

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ddiary_tasks_view', v); } catch {}
  };

  return (
    <div className="fade-in">
      {/* ── Segmented view toggle ─────────────────────────────────────────── */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
          <SegmentTab
            icon={Users}
            label="Team Board"
            id="board"
            active={view === 'board'}
            onClick={switchView}
          />
          <SegmentTab
            icon={User}
            label="My Tasks"
            id="list"
            active={view === 'list'}
            onClick={switchView}
          />
        </div>
      </div>

      {/* ── Views ────────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          <TaskManager
            tasks={tasks}
            members={members}
            loading={loading}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onToggle={onToggle}
            onDelete={onDelete}
            onClearCompleted={onClearCompleted}
            showToast={showToast}
            highlightTaskId={highlightTaskId}
            onHighlightConsumed={handleHighlightConsumed}
          />
          {/* Assigned to Me — tasks assigned by others; also supports deep-link highlight */}
          <TeamTaskView
            showToast={showToast}
            highlightTaskId={highlightTaskId}
            onHighlightConsumed={handleHighlightConsumed}
          />
        </>
      )}

      {view === 'board' && (
        <KanbanBoard
          onWorkspaceCreated={onWorkspaceCreated}
          showToast={showToast}
          highlightTaskId={highlightTaskId}
          highlightWorkspaceId={highlightWorkspaceId}
          onHighlightConsumed={handleHighlightConsumed}
        />
      )}
    </div>
  );
}

// ── Segmented tab button ──────────────────────────────────────────────────────
function SegmentTab({ icon: Icon, label, id, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
        ${active
          ? 'bg-white text-violet-700 shadow-sm'
          : 'text-slate-600 hover:text-slate-900'}
      `}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
}
