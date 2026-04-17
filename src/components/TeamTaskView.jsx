import { useState } from 'react';
import { CheckSquare, Calendar, User, ChevronDown, ChevronRight, Clock, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAssignedTasks } from '../hooks/useFirestore';
import TaskCollabPanel, { StatusBadge } from './TaskCollabPanel';

const formatDate = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const isOverdue = (dueDate) => {
  if (!dueDate) return false;
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  return d < new Date() && d.toDateString() !== new Date().toDateString();
};

const priorityColors = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

/* ── Empty state ────────────────────────────────────────────────────────── */
function Empty({ user }) {
  return (
    <div className="empty-state" style={{ padding: 40 }}>
      <CheckSquare size={40} color="#7c3aed" />
      <p style={{ marginTop: 10, color: '#475569', fontSize: 15 }}>
        No tasks assigned to you yet.
      </p>
      <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
        Your manager will assign tasks to <strong>{user?.email}</strong>.
        They will appear here automatically — no refresh needed.
      </p>
    </div>
  );
}

/* ── Single task card ────────────────────────────────────────────────────── */
function TaskCard({ task }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const overdue  = isOverdue(task.dueDate) && task.status !== 'done';
  const isDone   = task.status === 'done' || task.completed;
  const priority = priorityColors[task.priority] || '#d97706';

  return (
    <div style={{
      border: '1px solid #cbd5e1',
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'hidden',
      opacity: isDone ? 0.65 : 1,
    }}>
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', background: '#ffffff',
          border: 'none', cursor: 'pointer',
          padding: '12px 14px', textAlign: 'left',
        }}
      >
        {/* Priority strip */}
        <div style={{ width: 4, height: 32, borderRadius: 2, background: priority, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 14, color: '#0f172a',
              textDecoration: isDone ? 'line-through' : 'none',
            }}>
              {task.text}
            </span>
            <StatusBadge status={task.status || (isDone ? 'done' : 'open')} />
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {task.dueDate && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 12, color: overdue ? '#dc2626' : '#475569',
              }}>
                <Calendar size={11} />
                {formatDate(task.dueDate)}
                {overdue && (
                  <span style={{
                    background: '#dc2626', color: '#fff',
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                  }}>OVERDUE</span>
                )}
              </span>
            )}
            {(task.ownerName || task._ownerUid) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#94a3b8' }}>
                <User size={11} /> from {task.ownerName || 'your manager'}
              </span>
            )}
          </div>
        </div>

        {open ? <ChevronDown size={16} color="#475569" /> : <ChevronRight size={16} color="#475569" />}
      </button>

      {/* ── Collab Panel ───────────────────────────────────────────────── */}
      {open && (
        <TaskCollabPanel
          ownerUid={task._ownerUid}
          task={task}
          onClose={() => setOpen(false)}
          canChangeStatus={true}
        />
      )}
    </div>
  );
}

/* ── TeamTaskView — shows tasks assigned to me by others ─────────────────── */
export default function TeamTaskView() {
  const { user } = useAuth();
  const { tasks, loading, error } = useAssignedTasks();

  const pending    = tasks.filter(t => (t.status || 'open') !== 'done' && !t.completed);
  const completed  = tasks.filter(t => (t.status === 'done') || t.completed);

  const [showDone, setShowDone] = useState(false);

  // Don't render anything if there are no assigned tasks and we're not loading
  if (!loading && tasks.length === 0 && !error) return null;

  return (
    <div className="fade-in" style={{ marginTop: 24 }}>
      <h2 className="section-title">Assigned to Me</h2>

      {loading && (
        <div className="empty-state"><p>Loading your tasks…</p></div>
      )}

      {!loading && error && (
        <div className="card" style={{ background: '#fef2f2', border: '1px solid #dc262644', color: '#dc2626', padding: 16, fontSize: 13 }}>
          <strong>Could not load tasks:</strong> {error}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && <Empty user={user} />}

      {/* Pending tasks */}
      {!loading && pending.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 14, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6, fontSize: 15 }}>
            <Clock size={16} color="#d97706" /> Pending Tasks ({pending.length})
          </h3>
          {pending.map(t => <TaskCard key={t.id} task={t} />)}
        </div>
      )}

      {/* Completed tasks (collapsible) */}
      {!loading && completed.length > 0 && (
        <div className="card">
          <button
            onClick={() => setShowDone(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', textAlign: 'left', padding: 0, marginBottom: showDone ? 14 : 0,
              color: '#0f172a', fontSize: 15, fontWeight: 700,
            }}
          >
            {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <CheckCircle size={16} color="#15803d" />
            Completed ({completed.length})
          </button>
          {showDone && completed.map(t => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}
