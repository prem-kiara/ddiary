import { useState } from 'react';
import { List, Kanban, User, Users } from 'lucide-react';
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
    () => localStorage.getItem('ddiary_tasks_view') || 'board'
  );

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ddiary_tasks_view', v); } catch {}
  };

  return (
    <div className="fade-in">

      {/* ── View toggle ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <ViewTab
          icon={Users}
          label="Team Board"
          description="Shared Kanban — assign & track"
          id="board"
          active={view === 'board'}
          onClick={switchView}
        />
        <ViewTab
          icon={User}
          label="My Tasks"
          description="Personal to-do list"
          id="list"
          active={view === 'list'}
          onClick={switchView}
        />
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
        <KanbanBoard onWorkspaceCreated={onWorkspaceCreated} showToast={showToast} />
      )}
    </div>
  );
}

// ── Tab button ─────────────────────────────────────────────────────────────────
function ViewTab({ icon: Icon, label, description, id, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: '10px 18px', borderRadius: 12, cursor: 'pointer',
        border: active ? '2px solid #2a9d8f' : '2px solid #e8d5b7',
        display: 'flex', alignItems: 'center', gap: 10,
        background: active ? '#f0faf9' : '#faf7f2',
        transition: 'all 0.18s',
        boxShadow: active ? '0 2px 8px rgba(42,157,143,0.15)' : 'none',
        textAlign: 'left',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
        background: active ? '#2a9d8f' : '#e8d5b7',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.18s',
      }}>
        <Icon size={16} color={active ? '#fff' : '#8a7a6a'} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#2a9d8f' : '#4a3728', lineHeight: 1.2 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#8a7a6a', marginTop: 2 }}>{description}</div>
      </div>
    </button>
  );
}
