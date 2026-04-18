import { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckSquare, Calendar, ChevronDown, ChevronRight, Clock, CheckCircle,
  UserPlus, ArrowUpRight, Check, X,
} from 'lucide-react';
// ChevronDown/ChevronRight are still used inside TaskCard below for the task-level expand/collapse

import { useAuth } from '../contexts/AuthContext';
import {
  useAssignedTasks,
  reassignAssignedTask,
  markTaskMovedToWorkspace,
  updateTaskStatus,
} from '../hooks/useFirestore';
import { useMyWorkspaces } from '../hooks/useWorkspace';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';
import TaskCollabPanel, { StatusBadge, STATUSES } from './TaskCollabPanel';
import { MoveToBoard } from './TaskManager';
import SectionHeader from './shared/SectionHeader';
import Avatar from './shared/Avatar';
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
const priorityLabels = { high: 'High', medium: 'Medium', low: 'Low' };

/* ── Inline status picker ─────────────────────────────────────────────────
 * Small popover that replaces the full "status row" inside the expanded
 * body. Triggered by clicking the status badge on the collapsed header so
 * the single-line layout stays clean while still letting assignees update
 * the task's state quickly.
 */
function StatusPickerPopover({ current, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 'calc(100% + 4px)', left: 0,
        background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10,
        boxShadow: '0 6px 20px rgba(15,23,42,0.12)',
        padding: 6, zIndex: 50, minWidth: 150,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {STATUSES.map(({ value, label, color, bg, Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            onClick={() => { onPick(value); onClose?.(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', textAlign: 'left',
              background: active ? bg : 'transparent',
              color: active ? color : '#475569',
            }}
          >
            <Icon size={11} /> {label}
          </button>
        );
      })}
    </div>
  );
}

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

/* ── Single task card ──────────────────────────────────────────────────────
 *
 * Layout goals (per product design):
 *   • Collapsed: ONE clean row with title (truncated) + status + priority +
 *     timestamp/elapsed + owner avatar + chevron. No secondary meta row
 *     unless there's an actionable signal (due date / overdue).
 *   • Expanded: dedicated to Comments + Activity only. A small icon footer
 *     exposes Reassign / Send to Team Board without competing for focus.
 *   • Status changes happen via a popover on the status badge, keeping
 *     TaskCollabPanel focused on the collab thread.
 */
function TaskCard({ task, workspaces, orgAssignees, showToast }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  // 'reassign' | 'move' | null — which inline action panel is open
  const [panel, setPanel] = useState(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  const overdue  = isOverdue(task.dueDate) && task.status !== 'done';
  const isDone   = task.status === 'done' || task.completed;
  const priority = priorityColors[task.priority] || '#d97706';
  const priorityLabel = priorityLabels[task.priority] || 'Medium';
  const effectiveStatus = task.status || (isDone ? 'done' : 'open');

  const togglePanel = (p) => setPanel(cur => cur === p ? null : p);

  // Inline status change (from the header badge popover). Mirrors the same
  // write that TaskCollabPanel used to do.
  const handleStatusChange = async (newStatus) => {
    if (newStatus === effectiveStatus) return;
    try {
      await updateTaskStatus(task._ownerUid, task.id, {
        status:       newStatus,
        actorUid:     user.uid,
        actorName:    user.displayName || user.email,
        taskText:     task.text,
        ownerEmail:   null,
        ownerName:    task.ownerName,
        assigneeName: task.assigneeName,
      });
    } catch (err) {
      console.error('[TeamTaskView] updateTaskStatus failed', err);
      showToast?.('Failed to update status.', 'warning');
    }
  };

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
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'visible',       // popover needs to escape the card
      opacity: isDone ? 0.65 : 1,
      background: '#ffffff',
    }}>
      {/* ── Collapsed header: SINGLE ROW ───────────────────────────── */}
      <div
        onClick={() => setOpen(v => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', background: 'transparent',
          cursor: 'pointer',
          padding: '10px 14px',
        }}
      >
        {/* Chevron */}
        {open
          ? <ChevronDown size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
          : <ChevronRight size={16} color="#94a3b8" style={{ flexShrink: 0 }} />}

        {/* Title — flexes and truncates */}
        <span
          title={task.text}
          style={{
            flex: '1 1 auto', minWidth: 0,
            fontWeight: 600, fontSize: 14, color: '#0f172a',
            textDecoration: isDone ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {task.text}
        </span>

        {/* Status badge — clickable, opens inline popover */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            setStatusPickerOpen(v => !v);
          }}
          title="Click to change status"
          style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}
        >
          <StatusBadge status={effectiveStatus} />
          {statusPickerOpen && (
            <StatusPickerPopover
              current={effectiveStatus}
              onPick={handleStatusChange}
              onClose={() => setStatusPickerOpen(false)}
            />
          )}
        </span>

        {/* Priority badge */}
        <span
          title={`${priorityLabel} priority`}
          style={{
            display: 'inline-flex', alignItems: 'center',
            background: `${priority}12`, color: priority,
            border: `1px solid ${priority}44`,
            fontSize: 11, fontWeight: 700,
            padding: '2px 8px', borderRadius: 10,
            flexShrink: 0,
          }}
        >
          {priorityLabel}
        </span>

        {/* Timestamp + elapsed — two-tone gray+violet */}
        {task.createdAt && (
          <span
            title={`Created ${formatShortStamp(task.createdAt)}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 11, color: '#94a3b8',
              flexShrink: 0,
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

        {/* Owner avatar — who assigned this to me */}
        {(task.ownerName || task._ownerUid) && (
          <Avatar
            id={task._ownerUid || task.ownerName}
            name={task.ownerName || 'your manager'}
            size="sm"
            title={`from ${task.ownerName || 'your manager'}`}
          />
        )}
      </div>

      {/* ── Optional due-date strip — only when a due date exists ──── */}
      {task.dueDate && (
        <div style={{
          padding: '0 14px 10px',
          marginLeft: 26,                     // align with title (chevron + gap)
          fontSize: 11,
          color: overdue ? '#dc2626' : '#94a3b8',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Calendar size={10} />
          <span>Due {formatDate(task.dueDate)}</span>
          {overdue && (
            <span style={{
              background: '#dc2626', color: '#fff',
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
              marginLeft: 2,
            }}>OVERDUE</span>
          )}
        </div>
      )}

      {/* ── Expanded body: Comments + Activity only ────────────────── */}
      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {/* The collab panel now renders *only* the Comments/Activity tabs
              — status controls live on the header badge. */}
          <TaskCollabPanel
            ownerUid={task._ownerUid}
            task={task}
            onClose={() => setOpen(false)}
            canChangeStatus={false}
          />

          {/* Subtle action footer — icon-only buttons so the expanded view
              stays focused on comments/activity but the key offload actions
              are still one click away. Hidden for done tasks. */}
          {!isDone && panel === null && (
            <div style={{
              padding: '0 14px 12px',
              display: 'flex', gap: 6, justifyContent: 'flex-end',
              alignItems: 'center',
            }}>
              <button
                onClick={() => togglePanel('reassign')}
                title="Reassign"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 7, padding: '4px 8px',
                  fontSize: 11, fontWeight: 600, color: '#475569',
                  cursor: 'pointer',
                }}
              >
                <UserPlus size={11} /> Reassign
              </button>
              {workspaces && workspaces.length > 0 && (
                <button
                  onClick={() => togglePanel('move')}
                  title="Send to Team Board"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: '#f8fafc', border: '1px solid #e2e8f0',
                    borderRadius: 7, padding: '4px 8px',
                    fontSize: 11, fontWeight: 600, color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  <ArrowUpRight size={11} /> Send to Team Board
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

          {/* Send-to-Team-Board inline panel */}
          {panel === 'move' && (
            <MoveToBoard
              task={task}
              workspaces={workspaces}
              orgAssignees={orgAssignees}
              onDelete={async () => {}}
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

  const pending    = tasks.filter(t => (t.status || 'open') !== 'done' && !t.completed);
  const completed  = tasks.filter(t => (t.status === 'done') || t.completed);

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
