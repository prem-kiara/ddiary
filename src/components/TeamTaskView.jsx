import { useState, useEffect, useMemo } from 'react';
import {
  CheckSquare, Calendar, User, ChevronDown, ChevronRight, Clock, CheckCircle,
  UserPlus, ArrowUpRight, Check, X,
} from 'lucide-react';
// ChevronDown/ChevronRight are still used inside TaskCard below for the task-level expand/collapse

import { useAuth } from '../contexts/AuthContext';
import {
  useAssignedTasks,
  reassignAssignedTask,
  markTaskMovedToWorkspace,
} from '../hooks/useFirestore';
import { useMyWorkspaces } from '../hooks/useWorkspace';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';
import TaskCollabPanel, { StatusBadge } from './TaskCollabPanel';
import { MoveToBoard } from './TaskManager';
import SectionHeader from './shared/SectionHeader';
import { formatShortStamp, elapsedSince } from '../utils/dates';

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

/* ── Reassign sub-panel ──────────────────────────────────────────────────
 *
 * Inline picker shown when the assignee clicks "Reassign" on one of their
 * assigned tasks. Lets them hand the task to someone else without opening
 * the full Move-to-Team-Board flow.
 *
 * After a successful reassign, the task naturally disappears from the
 * current user's "Assigned to Me" (because assigneeEmail no longer matches).
 */
function ReassignPanel({ task, orgAssignees, onClose, showToast }) {
  const { user } = useAuth();
  const [newAssigneeEmail, setNewAssigneeEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    // Exclude the current user (reassigning to myself is a no-op).
    const myEmail = user?.email?.toLowerCase();
    return (orgAssignees || []).filter(o => o.email?.toLowerCase() !== myEmail);
  }, [orgAssignees, user?.email]);

  const handleSave = async () => {
    if (!newAssigneeEmail) {
      showToast?.('Please pick someone to reassign to.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const chosen     = options.find(o => o.email === newAssigneeEmail);
      const newName    = chosen?.name || newAssigneeEmail.split('@')[0];
      const newUid     = chosen?.uid  || null;

      await reassignAssignedTask(task._ownerUid, task.id, {
        newAssigneeEmail,
        newAssigneeName: newName,
        newAssigneeUid:  newUid,
        actor:           { uid: user.uid, email: user.email, displayName: user.displayName || user.email },
        ownerEmail:      null, // we don't have the owner's email in the task; notification is best-effort
        ownerName:       task.ownerName,
        taskText:        task.text,
      });

      showToast?.(`Reassigned to ${newName}.`, 'success');
      onClose?.();
    } catch (e) {
      console.error('reassignAssignedTask failed', e);
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied.'
        : (e?.message || 'Please try again.');
      showToast?.(`Failed to reassign. ${detail}`, 'warning');
      setSaving(false);
    }
  };

  const selStyle = {
    width: '100%', height: 40, padding: '0 10px',
    border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13,
    fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a', outline: 'none',
  };

  return (
    <div style={{ padding: '0 12px 14px' }}>
      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
      <div style={{ background: '#fef3c7', border: '1px solid #d9770644', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserPlus size={14} /> Reassign Task
        </div>
        <p style={{ fontSize: 12, color: '#0f172a', marginBottom: 12, lineHeight: 1.5 }}>
          Hand this task off to someone else. It will disappear from your Assigned to&nbsp;Me once saved.
          {task.ownerName ? ` ${task.ownerName} (who gave it to you) will be notified.` : ''}
        </p>

        <div style={{ marginBottom: 12 }}>
          <label className="label">
            Reassign to <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select
            value={newAssigneeEmail}
            onChange={e => setNewAssigneeEmail(e.target.value)}
            style={{ ...selStyle, borderColor: newAssigneeEmail ? '#cbd5e1' : '#dc262688' }}
            required
          >
            <option value="" disabled>— Pick someone —</option>
            {options.map(o => (
              <option key={o.email} value={o.email}>
                {o.name}{o.email ? ` (${o.email})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: '#d97706', color: '#fff', border: 'none',
              opacity: (!newAssigneeEmail || saving) ? 0.5 : 1,
              cursor:  (!newAssigneeEmail || saving) ? 'not-allowed' : 'pointer',
            }}
            onClick={handleSave}
            disabled={saving || !newAssigneeEmail}
          >
            {saving ? 'Reassigning…' : <><Check size={13} /> Reassign</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Single task card ────────────────────────────────────────────────────── */
function TaskCard({ task, workspaces, orgAssignees, showToast }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  // 'reassign' | 'move' | null — which inline action panel is expanded
  const [panel, setPanel] = useState(null);

  const overdue  = isOverdue(task.dueDate) && task.status !== 'done';
  const isDone   = task.status === 'done' || task.completed;
  const priority = priorityColors[task.priority] || '#d97706';

  const togglePanel = (p) => setPanel(cur => cur === p ? null : p);

  // onFinalize passed to MoveToBoard: instead of deleting the source task
  // (which we don't have permission to do — it's in someone else's
  // collection), we annotate it with movedToWorkspace so the owner still
  // sees it in their personal list with a "Moved to X" badge, and our own
  // "Assigned to Me" hides it via the useAssignedTasks filter.
  const handleMoveFinalize = async (taskId, { workspaceId, workspaceName, workspaceTaskId }) => {
    await markTaskMovedToWorkspace(task._ownerUid, taskId, {
      workspaceId,
      workspaceName,
      workspaceTaskId,
      actor: { uid: user.uid, email: user.email, displayName: user.displayName || user.email },
      ownerEmail: null,
      ownerName:  task.ownerName,
      taskText:   task.text,
    });
  };

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
            {task.createdAt && (
              <span
                title={`Created ${formatShortStamp(task.createdAt)}`}
                style={{
                  fontSize: 11, color: '#94a3b8',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}
              >
                <Clock size={10} />
                <span>{formatShortStamp(task.createdAt)}</span>
                {!isDone && (
                  <span style={{ color: '#7c3aed', fontWeight: 600, marginLeft: 2 }}>
                    · {elapsedSince(task.createdAt)} open
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {open ? <ChevronDown size={16} color="#475569" /> : <ChevronRight size={16} color="#475569" />}
      </button>

      {/* ── Expanded body ──────────────────────────────────────────────── */}
      {open && (
        <div>
          {/* Action buttons: Reassign / Send to Team Board.
              Only shown for pending (non-done) tasks — you can't offload a
              task that's already marked done. */}
          {!isDone && (
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap',
              padding: '8px 14px 0',
              background: '#ffffff',
            }}>
              <button
                className={`btn btn-sm ${panel === 'reassign' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => togglePanel('reassign')}
                title="Hand this task to someone else"
              >
                <UserPlus size={12} /> Reassign
              </button>
              {workspaces && workspaces.length > 0 && (
                <button
                  className={`btn btn-sm ${panel === 'move' ? 'btn-teal' : 'btn-outline'}`}
                  onClick={() => togglePanel('move')}
                  title="Send this task to a Team Board"
                >
                  <ArrowUpRight size={12} /> Send to Team Board
                </button>
              )}
            </div>
          )}

          {/* Reassign inline panel */}
          {panel === 'reassign' && (
            <ReassignPanel
              task={task}
              orgAssignees={orgAssignees}
              onClose={() => setPanel(null)}
              showToast={showToast}
            />
          )}

          {/* Send-to-Team-Board inline panel — reuses the same MoveToBoard UI
              used for Personal Tasks, but with an onFinalize override so the
              source task gets annotated instead of deleted. */}
          {panel === 'move' && (
            <MoveToBoard
              task={task}
              workspaces={workspaces}
              orgAssignees={orgAssignees}
              onDelete={async () => {}}           // never used — onFinalize takes over
              onFinalize={handleMoveFinalize}
              headerLabel="Send to Team Board"
              helpText={
                `This task will be moved onto the selected Team Board. ` +
                `${task.ownerName || 'The person who assigned it'} will still see it in their personal tasks with a "Moved to Team Board" badge.`
              }
              showToast={showToast}
              onClose={() => setPanel(null)}
              user={user}
            />
          )}

          {/* Existing collab panel (status + comments + activity) */}
          <TaskCollabPanel
            ownerUid={task._ownerUid}
            task={task}
            onClose={() => setOpen(false)}
            canChangeStatus={true}
          />
        </div>
      )}
    </div>
  );
}

/* ── TeamTaskView — shows tasks assigned to me by others ─────────────────── */
export default function TeamTaskView({ showToast } = {}) {
  const { user } = useAuth();
  const { tasks, loading, error } = useAssignedTasks();
  const { workspaces } = useMyWorkspaces();

  // Full org directory for the Reassign / Send-to-Team-Board assignee picker.
  // Fetched once and passed down to each TaskCard so we don't refetch per card.
  const [orgUsers, setOrgUsers] = useState([]);
  useEffect(() => {
    fetchAllOrgUsers().then(u => setOrgUsers(u || [])).catch(() => {});
  }, []);

  // Normalise org users into {email, name, uid, phone} shape so it matches
  // the structure MoveToBoard's orgAssignees prop expects.
  const orgAssignees = useMemo(() => (orgUsers || [])
    .filter(u => u.email)
    .map(u => ({
      email: u.email.toLowerCase(),
      name:  u.displayName || u.email,
      uid:   null,
      phone: u.phone || null,
    })), [orgUsers]);

  // Sort by due date ascending; tasks with no due date go to the bottom.
  const byDueDateAsc = (a, b) => {
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return ad - bd;
  };

  const pending    = tasks.filter(t => (t.status || 'open') !== 'done' && !t.completed).sort(byDueDateAsc);
  const completed  = tasks.filter(t => (t.status === 'done') || t.completed).sort(byDueDateAsc);

  const [showPending, setShowPending] = useState(true);
  const [showDone,    setShowDone]    = useState(false);

  const cardProps = { workspaces, orgAssignees, showToast };

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
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
          <SectionHeader
            open={showPending} onToggle={() => setShowPending(v => !v)}
            icon={<Clock size={16} />} label="Pending Tasks" count={pending.length} color="#d97706"
          />
          {showPending && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {pending.map(t => <TaskCard key={t.id} task={t} {...cardProps} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed tasks */}
      {!loading && completed.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHeader
            open={showDone} onToggle={() => setShowDone(v => !v)}
            icon={<CheckCircle size={16} />} label="Completed" count={completed.length} color="#15803d"
          />
          {showDone && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {completed.map(t => <TaskCard key={t.id} task={t} {...cardProps} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
