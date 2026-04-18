import { useState } from 'react';
import { User, Users } from 'lucide-react';
import TaskManager from './TaskManager';
import KanbanBoard from './KanbanBoard';
import TeamTaskView from './TeamTaskView';

/**
 * Unified Tasks page — combines personal My Tasks (list view) and
 * the shared Team Board (Kanban view) into one place.
 */
export default function TasksPage({
  tasks, members, loading,
  onAdd, onUpdate, onToggle, onDelete, onClearCompleted,
  showToast, onWorkspaceCreated,
}) {
  const [view, setView] = useState(
    () => localStorage.getItem('ddiary_tasks_view') || 'board'
  );

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
          />
          {/* Assigned to Me — personal tasks assigned by someone else (not workspace tasks) */}
          <TeamTaskView />
        </>
      )}

      {view === 'board' && (
        <KanbanBoard onWorkspaceCreated={onWorkspaceCreated} showToast={showToast} />
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
