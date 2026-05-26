import { useState, useEffect } from 'react';
import {
  X, ChevronDown, ChevronRight, User, Calendar, Clock,
  CheckCircle as CheckIcon, Trash2, Pencil, Bell,
} from 'lucide-react';
import { updateWorkspaceTask } from '../../hooks/useWorkspace';
import WorkspaceCollabPanel from '../WorkspaceCollabPanel';
import ReminderEditor from '../shared/ReminderEditor';
import { formatShortStamp, elapsedSince } from '../../utils/dates';
import { normalizeReminder, computeNextSendAt, describeSchedule, describeNextSend } from '../../utils/reminders';
import { PRIORITY_COLORS, STATUSES, formatDate } from './constants';
import CategoryPicker from './CategoryPicker';

// ── WorkspaceReminderSection ─────────────────────────────────────────────────
// Inline reminder editor for existing workspace tasks — expandable section
// inside TaskDetailModal. Creator or admin can turn reminders on/off and tune
// the schedule; saving writes the full `reminder` object onto the task doc.
function WorkspaceReminderSection({ workspaceId, task, user, showToast }) {
  const taskReminder = task.reminder && typeof task.reminder === 'object' ? task.reminder : null;
  const [open, setOpen]     = useState(false);
  const [draft, setDraft]   = useState(taskReminder);
  const [saving, setSaving] = useState(false);
  const tz = user?.settings?.timezone
    || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata')
    || 'Asia/Kolkata';

  // Keep the draft in sync when the underlying task changes (real-time Firestore updates).
  useEffect(() => { setDraft(taskReminder); /* eslint-disable-next-line */ }, [task.id, JSON.stringify(taskReminder)]);

  const enabled = !!taskReminder?.enabled;
  const summary = enabled ? describeSchedule(taskReminder) : 'Off';

  const handleSave = async () => {
    setSaving(true);
    try {
      let payload = draft ? normalizeReminder(draft, {
        timezone: tz,
        creatorEmail: task.createdByEmail || user?.email,
        creatorName:  task.createdByName || user?.displayName || user?.email,
      }) : null;
      if (payload) payload.nextSendAt = computeNextSendAt(payload);
      await updateWorkspaceTask(workspaceId, task.id, { reminder: payload }, user, task);
      if (showToast) showToast('Reminder saved!', 'success');
      setOpen(false);
    } catch (e) {
      if (showToast) showToast('Failed to save reminder.', 'warning');
    }
    setSaving(false);
  };

  return (
    <div style={{ padding: '12px 18px', borderBottom: '1px solid #ede0c8', background: '#faf7ff' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, textAlign: 'left',
        }}
      >
        <Bell size={14} color={enabled ? '#7c3aed' : '#94a3b8'} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Email Reminder
        </span>
        <span style={{ fontSize: 12, color: enabled ? '#0f172a' : '#94a3b8', flex: 1 }}>
          {summary}
        </span>
        {open ? <ChevronDown size={14} color="#475569" /> : <ChevronRight size={14} color="#475569" />}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <ReminderEditor
            value={draft}
            onChange={setDraft}
            timezone={tz}
            creatorEmail={task.createdByEmail || user?.email}
            creatorName={task.createdByName || user?.displayName || user?.email}
          />
          <div className="modal-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-outline" onClick={() => { setDraft(taskReminder); setOpen(false); }}>
              <X size={13} /> Cancel
            </button>
            <button className="btn btn-sm btn-teal" onClick={handleSave} disabled={saving}>
              <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save Reminder'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Task Detail Modal ─────────────────────────────────────────────────────────
function TaskDetailModal({ task, workspace, workspaceId, members, onDelete, currentUid, isAdmin, user, showToast, onClose }) {
  const priority  = PRIORITY_COLORS[task.priority] || '#d97706';
  const statusCfg = STATUSES.find(s => s.value === (task.status || 'open')) || STATUSES[0];
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee  = members.find(m => m.uid === task.assigneeUid);
  // The workspace creator OR an admin (which includes super-admins) can re-categorise tasks.
  const isCreator = !!(workspace && user && workspace.createdBy === user.uid) || isAdmin;
  const canEdit   = task.createdBy === currentUid || isAdmin;

  // ── Inline title editing ──────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleText, setEditTitleText] = useState(task.text || '');
  const [savingTitle, setSavingTitle] = useState(false);

  const startEditTitle = () => { setEditTitleText(task.text || ''); setEditingTitle(true); };
  const cancelEditTitle = () => setEditingTitle(false);
  const saveTitle = async () => {
    const trimmed = editTitleText.trim();
    if (!trimmed || trimmed === task.text) { cancelEditTitle(); return; }
    setSavingTitle(true);
    try {
      await updateWorkspaceTask(workspaceId, task.id, { text: trimmed }, user, task);
      showToast?.('Task updated.', 'success');
      setEditingTitle(false);
    } catch (e) {
      showToast?.('Failed to save. Please try again.', 'warning');
    }
    setSavingTitle(false);
  };

  return (
    <div className="sheet-modal-overlay" onClick={onClose}>
      <div
        className="sheet-modal sheet-modal-xl"
        onClick={e => e.stopPropagation()}
        style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #ede0c8', display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ width: 4, borderRadius: 2, background: priority, alignSelf: 'stretch', flexShrink: 0, minHeight: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Title — editable inline for creator/admin */}
            {editingTitle ? (
              <div>
                <textarea
                  autoFocus
                  value={editTitleText}
                  onChange={e => setEditTitleText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveTitle();
                    if (e.key === 'Escape') cancelEditTitle();
                  }}
                  rows={3}
                  style={{
                    width: '100%', fontSize: 15, fontWeight: 700, color: '#0f172a',
                    lineHeight: 1.4, padding: '6px 10px', borderRadius: 8,
                    border: '2px solid #7c3aed', outline: 'none', resize: 'vertical',
                    fontFamily: 'var(--font-body)', background: '#faf5ff', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    onClick={saveTitle}
                    disabled={savingTitle || !editTitleText.trim()}
                    style={{
                      padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer',
                      opacity: (savingTitle || !editTitleText.trim()) ? 0.5 : 1,
                    }}
                  >
                    {savingTitle ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditTitle}
                    style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: 'none', color: '#475569', border: '1px solid #cbd5e1', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>⌘↵ to save · Esc to cancel</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div
                  style={{
                    fontSize:    15,
                    fontWeight:  700,
                    color:       '#0f172a',
                    lineHeight:  1.4,
                    wordBreak:   'break-word',
                    maxHeight:   200,
                    overflowY:   'auto',
                    paddingRight: 6,
                    flex: 1,
                  }}
                >
                  {task.text}
                </div>
                {canEdit && (
                  <button
                    onClick={startEditTitle}
                    title="Edit task title"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                      color: '#94a3b8', borderRadius: 4, flexShrink: 0, marginTop: 1,
                      display: 'inline-flex', alignItems: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.background = '#f5f3ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'none'; }}
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {/* Status badge */}
              <span style={{ background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.color}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>
                {statusCfg.label}
              </span>
              {/* Priority badge */}
              <span style={{ background: `${priority}18`, color: priority, border: `1px solid ${priority}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize' }}>
                {task.priority || 'medium'}
              </span>
              {/* Due date */}
              {task.dueDate && (
                <span style={{ fontSize: 12, color: isOverdue ? '#dc2626' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Calendar size={11} />
                  {formatDate(task.dueDate)}
                  {isOverdue && <span style={{ background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>OVERDUE</span>}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {(assignee || task.assigneeName) && (
                <span style={{ fontSize: 12, color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {assignee?.displayName || task.assigneeName}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Created by {task.createdByName || 'someone'}</span>
              {task.createdAt && (
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Clock size={11} /> {formatShortStamp(task.createdAt)}
                  {task.status !== 'done' && (
                    <span style={{ color: '#7c3aed', fontWeight: 600, marginLeft: 2 }}>
                      · {elapsedSince(task.createdAt, { longer: true })} open
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {(task.createdBy === currentUid || isAdmin) && (
              <button
                onClick={() => { onDelete(task.id); onClose(); }}
                title="Delete task"
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Category picker — only the workspace creator can re-categorise */}
        {isCreator && (
          <CategoryPicker
            task={task}
            workspace={workspace}
            user={user}
            showToast={showToast}
          />
        )}

        {/* Notes (if any) */}
        {task.notes && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #ede0c8', background: '#fdf8ee' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.notes}</div>
          </div>
        )}

        {/* Reminder editor (visible to creator + admin) */}
        {(task.createdBy === currentUid || isAdmin) && (
          <WorkspaceReminderSection
            workspaceId={workspaceId}
            task={task}
            user={user}
            showToast={showToast}
          />
        )}

        {/* Collaboration panel (comments, activity, status updates) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <WorkspaceCollabPanel
            workspaceId={workspaceId}
            task={task}
            isAdmin={isAdmin}
            onClose={onClose}
            showToast={showToast}
          />
        </div>
      </div>
    </div>
  );
}

export default TaskDetailModal;
