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

const priorityColors = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };

/* ── Empty state ────────────────────────────────────────────────────────── */
function Empty({ user }) {
  return (
    <div className="empty-state" style={{ padding: 40 }}>
      <CheckSquare size={40} color="#c9a96e" />
      <p style={{ marginTop: 10, color: '#8a7a6a', fontSize: 15 }}>
        No tasks assigned to you yet.
      </p>
      <p style={{ fontSize: 13, color: '#b5a898', maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
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
  const priority = priorityColors[task.priority] || '#e67e22';

  return (
    <div style={{
      border: '1px solid #d4c5a9',
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
          width: '100%', background: '#fffdf5',
          border: 'none', cursor: 'pointer',
          padding: '12px 14px', textAlign: 'left',
        }}
      >
        {/* Priority strip */}
        <div style={{ width: 4, height: 32, borderRadius: 2, background: priority, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 14, color: '#4a3728',
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
                fontSize: 12, color: overdue ? '#c0392b' : '#8a7a6a',
              }}>
                <Calendar size={11} />
                {formatDate(task.dueDate)}
                {overdue && (
                  <span style={{
                    background: '#c0392b', color: '#fff',
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                  }}>OVERDUE</span>
                )}
              </span>
            )}
            {(task.ownerName || task._ownerUid) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#b5a898' }}>
                <User size={11} /> from {task.ownerName || 'your manager'}
              </span>
            )}
          </div>
        </div>

        {open ? <ChevronDown size={16} color="#8a7a6a" /> : <ChevronRight size={16} color="#8a7a6a" />}
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

/* ── TeamTaskView ────────────────────────────────────────────────────────── */
export default function TeamTaskView() {
  const { user } = useAuth();
  const { tasks, loading, error } = useAssignedTasks();

  // Warn if invitedBy is missing — this means we can't query the right owner's tasks
  if (!user?.invitedBy) {
    return (
      <div className="fade-in">
        <h2 className="section-title">My Tasks</h2>
        <div className="card" style={{ background: '#fef9ef', border: '1px solid #c9a96e44', padding: 20 }}>
          <p style={{ color: '#8a7a6a', fontSize: 14, lineHeight: 1.7 }}>
            Your account is not linked to a team yet. Please sign out and sign up again using your manager's join link.
          </p>
          {/* Debug info */}
          <div style={{ marginTop: 12, padding: 10, background: '#fff3cd', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#856404' }}>
            <strong>Debug info:</strong><br />
            UID: {user?.uid || 'none'}<br />
            Email: {user?.email || 'none'}<br />
            Role: {user?.role || 'none'}<br />
            invitedBy: {user?.invitedBy || '⚠️ NOT SET'}
          </div>
        </div>
      </div>
    );
  }

  const pending    = tasks.filter(t => (t.status || 'open') !== 'done' && !t.completed);
  const completed  = tasks.filter(t => (t.status === 'done') || t.completed);

  const [showDone, setShowDone] = useState(false);

  return (
    <div className="fade-in">
      <h2 className="section-title">My Tasks</h2>

      {/* Welcome strip */}
      <div className="card" style={{ background: '#eaf4fb', border: '1px solid #2980b944', padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: '#2a9d8f22', color: '#2a9d8f',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 18, flexShrink: 0,
          }}>
            {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#2a9d8f' }}>
              {user?.displayName || user?.email}
            </div>
            <div style={{ fontSize: 13, color: '#8a7a6a' }}>
              {pending.length} pending · {completed.length} completed
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card pending">
          <div className="stat-number">{pending.length}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card completed">
          <div className="stat-number">{completed.length}</div>
          <div className="stat-label">Done</div>
        </div>
        <div className="stat-card overdue">
          <div className="stat-number">{pending.filter(t => isOverdue(t.dueDate)).length}</div>
          <div className="stat-label">Overdue</div>
        </div>
      </div>

      {loading && (
        <div className="empty-state"><p>Loading your tasks…</p></div>
      )}

      {!loading && error && (
        <div className="card" style={{ background: '#fef5f5', border: '1px solid #c0392b44', color: '#c0392b', padding: 16, fontSize: 13 }}>
          <strong>Could not load tasks:</strong> {error}
        </div>
      )}

      {/* Debug panel — always visible so we can diagnose query issues */}
      <div style={{ margin: '8px 0', padding: 10, background: '#f0f4ff', border: '1px solid #b0c4ff', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', color: '#334' }}>
        <strong>Query debug:</strong> email=<em>{user?.email}</em> · invitedBy=<em>{user?.invitedBy}</em> · tasks found=<em>{tasks.length}</em> · {loading ? 'loading…' : error ? '❌ ' + error : '✅ ok'}
      </div>

      {!loading && !error && tasks.length === 0 && <Empty user={user} />}

      {/* Pending tasks */}
      {!loading && pending.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 14, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 6, fontSize: 15 }}>
            <Clock size={16} color="#e67e22" /> Pending Tasks ({pending.length})
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
              color: '#4a3728', fontSize: 15, fontWeight: 700,
            }}
          >
            {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <CheckCircle size={16} color="#27ae60" />
            Completed ({completed.length})
          </button>
          {showDone && completed.map(t => <TaskCard key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}
