import { useState } from 'react';
import { List, Kanban } from 'lucide-react';
import TaskManager from './TaskManager';
import KanbanBoard from './KanbanBoard';

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
    () => localStorage.getItem('ddiary_tasks_view') || 'list'
  );

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ddiary_tasks_view', v); } catch {}
  };

  return (
    <div className="fade-in">

      {/* ── View toggle pill ──────────────────────────────────────────────── */}
      <div style={{
        display: 'inline-flex', gap: 4, marginBottom: 20,
        background: '#f0e8d8', borderRadius: 14, padding: 4,
      }}>
        <ViewBtn icon={List}   label="My Tasks"   id="list"  active={view === 'list'}  onClick={switchView} />
        <ViewBtn icon={Kanban} label="Team Board" id="board" active={view === 'board'} onClick={switchView} />
      </div>

      {/* ── Views ────────────────────────────────────────────────────────── */}
      {view === 'list' && (
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
      )}

      {view === 'board' && (
        <KanbanBoard onWorkspaceCreated={onWorkspaceCreated} />
      )}
    </div>
  );
}

// ── Small helper ──────────────────────────────────────────────────────────────
function ViewBtn({ icon: Icon, label, id, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
        cursor: 'pointer', border: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        transition: 'all 0.18s',
        background: active ? '#fff' : 'transparent',
        color:      active ? '#4a3728' : '#8a7a6a',
        boxShadow:  active ? '0 1px 6px rgba(0,0,0,0.12)' : 'none',
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
