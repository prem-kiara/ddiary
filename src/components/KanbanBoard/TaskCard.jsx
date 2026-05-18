import { useState, useEffect, useContext } from 'react';
import { User, Calendar, Clock, Bell, MessageSquare } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useWorkspaceComments } from '../../hooks/useWorkspace';
import Avatar from '../shared/Avatar';
import { StatusPill, PriorityPill } from '../shared/Pills';
import { formatShortStamp, elapsedSince } from '../../utils/dates';
import { describeSchedule, describeNextSend } from '../../utils/reminders';
import DeepLinkContext from '../../contexts/DeepLinkContext';
import { formatDate } from './constants';
import TaskDetailModal from './TaskDetailModal';

// ── Task comment count (tiny hook-wrapper used by TaskCard) ───────────────────
function CommentCountBadge({ workspaceId, taskId }) {
  const { comments } = useWorkspaceComments(workspaceId, taskId);
  if (!comments || comments.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
      <MessageSquare size={11} /> {comments.length}
    </span>
  );
}

// ── Uniform Task Card (single-line summary; click opens full detail modal) ──
// Collapsed summary on one line: title (ellipsis) + status + priority +
// created timestamp/elapsed + due date + comment count + assignee avatar.
// Clicking the card opens the full TaskDetailModal (status controls,
// category move, notes, reassign, comments, activity — with all existing
// notifications intact).
function TaskCard({ task, workspace, workspaceId, members, onDelete, currentUid, isAdmin, user, showToast }) {
  const [open, setOpen] = useState(false);
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee     = members.find(m => m.uid === task.assigneeUid);
  const assigneeName = assignee?.displayName || task.assigneeName || null;
  const assigneeId   = assignee?.uid || task.assigneeEmail || assigneeName || 'unassigned';

  // ── Deep-link auto-open ──────────────────────────────────────────────────
  // When the Dashboard navigated to this exact task, open the detail modal.
  // The parent WorkspaceItem + CategorySection + SubcategorySection have
  // already auto-expanded by the time this card mounts.
  const { openTaskId, openWorkspaceId } = useContext(DeepLinkContext);
  useEffect(() => {
    if (openTaskId && openTaskId === task.id && openWorkspaceId === workspaceId) {
      setOpen(true);
    }
  }, [openTaskId, openWorkspaceId, task.id, workspaceId]);

  // ── Make this card draggable for cross-workspace moves ─────────────────────
  // Drag is gated by an 8 px movement threshold (set on the global sensor),
  // so a normal click still opens the detail modal without false-starting a drag.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id:   `task:${workspaceId}:${task.id}`,
    data: { kind: 'task', task, srcWorkspaceId: workspaceId, srcWorkspace: workspace },
  });
  const dragStyle = {
    transform:   CSS.Translate.toString(transform),
    opacity:     isDragging ? 0.5 : (task.status === 'done' ? 0.7 : 1),
    boxSizing:   'border-box',
    zIndex:      isDragging ? 50 : 'auto',
    cursor:      isDragging ? 'grabbing' : 'pointer',
  };

  return (
    <>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={() => { if (!isDragging) setOpen(true); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
        className="k-task-card group relative bg-white border border-slate-200 rounded-xl px-3 py-2.5 hover:shadow-sm hover:border-slate-300 transition"
        style={dragStyle}
      >
        {/* Title — flexes + truncates so everything else stays on the line */}
        <span
          title={task.text}
          className="k-title text-[14px] font-semibold text-slate-900 leading-snug truncate"
        >
          {task.text}
        </span>

        <span className="k-meta">
          {/* Status pill */}
          <StatusPill status={task.status || 'open'} />

          {/* Priority pill */}
          <PriorityPill priority={task.priority || 'medium'} />

          {/* Created timestamp + elapsed (two-tone gray + violet) */}
          {task.createdAt && (
            <span
              title={`Created ${formatShortStamp(task.createdAt)}`}
              className="k-created inline-flex items-center gap-1"
              style={{ fontSize: 11, color: '#94a3b8' }}
            >
              <Clock size={10} />
              <span>{formatShortStamp(task.createdAt)}</span>
              {task.status !== 'done' && (
                <span style={{ color: '#7c3aed', fontWeight: 600, marginLeft: 2 }}>
                  · {elapsedSince(task.createdAt)} open
                </span>
              )}
            </span>
          )}

          {/* Due date */}
          {task.dueDate && (
            <span
              className={`text-[11px] inline-flex items-center gap-1 ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}
              title={`Due ${formatDate(task.dueDate)}`}
            >
              <Calendar size={11} />
              {formatDate(task.dueDate)}
            </span>
          )}

          {/* Comment count (only renders when > 0) */}
          <CommentCountBadge workspaceId={workspaceId} taskId={task.id} />

          {/* Reminder pill (only when enabled + not paused) */}
          {task.reminder?.enabled && !task.reminder?.paused && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd55' }}
              title={`${describeSchedule(task.reminder)}${task.reminder.nextSendAt ? ` · next ${describeNextSend(task.reminder.nextSendAt, task.reminder.timezone)}` : ''}`}
            >
              <Bell size={10} />
              {task.reminder.nextSendAt ? describeNextSend(task.reminder.nextSendAt, task.reminder.timezone) : 'scheduled'}
            </span>
          )}

          {/* Owner — small "by Name" pill so the creator is visible at a glance.
              Distinguished from the assignee by the muted violet treatment. */}
          {(task.createdByName || task.createdByEmail) && (
            <span
              title={`Created by ${task.createdByName || task.createdByEmail}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe' }}
            >
              <User size={10} /> by {(task.createdByName || task.createdByEmail).split(' ')[0]}
            </span>
          )}

          {/* Assignee avatar(s) */}
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {assigneeName ? (
              <Avatar id={assigneeId} name={assigneeName} email={task.assigneeEmail} size="sm" title={`Assignee: ${assigneeName}`} />
            ) : (
              <span
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0"
                title="Unassigned"
              >
                <User size={13} />
              </span>
            )}
            {(task.coAssignees || []).map((ca, i) => (
              <span key={ca.email || i} style={{ marginLeft: -6, zIndex: i + 1 }}>
                <Avatar
                  id={ca.uid || ca.email || String(i)}
                  name={ca.name || ca.email}
                  email={ca.email}
                  size="sm"
                  title={`Co-assignee: ${ca.name || ca.email}`}
                />
              </span>
            ))}
          </span>
        </span>
      </div>

      {open && (
        <TaskDetailModal
          task={task}
          workspace={workspace}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          user={user}
          showToast={showToast}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default TaskCard;
