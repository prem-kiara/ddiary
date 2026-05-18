import { useState } from 'react';
import {
  Bell, Calendar, Edit2, Check, X,
  User, Link, Mail, MessageCircle, ChevronDown, ChevronRight,
  CheckCircle, UserPlus, ArrowUpRight, Clock,
} from 'lucide-react';
import { formatDate, isOverdue, isDueToday, formatShortStamp, elapsedSince } from '../../utils/dates';
import { useAuth } from '../../contexts/AuthContext';
import TaskCollabPanel, { StatusBadge } from '../TaskCollabPanel';
import { useTaskComments } from '../../hooks/useFirestore';
import MemberAutocomplete from '../shared/MemberAutocomplete';
import ReminderEditor from '../shared/ReminderEditor';
import { normalizeReminder, computeNextSendAt, describeSchedule, describeNextSend } from '../../utils/reminders';
import { sendTaskWhatsApp } from '../../utils/whatsapp';
import MoveToBoard from './MoveToBoard';

// ── Helpers ───────────────────────────────────────────────────────────────────
const priorityColors = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

// ── Comment count badge ────────────────────────────────────────────────────────
function CommentBadge({ ownerUid, taskId }) {
  const { comments } = useTaskComments(ownerUid, taskId);
  if (!comments.length) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: '#7c3aed22', color: '#7c3aed',
      fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
    }}>
      💬 {comments.length}
    </span>
  );
}

// ── Individual task card ───────────────────────────────────────────────────────
export default function TaskCard({
  task, members, directory,
  onToggle, onUpdate, onDelete,
  showToast, ownerUid,
  workspaces, hasWorkspace, orgAssignees,
  saveContactPhone,   // used to silently persist phone overrides from the Assign panel
}) {
  const { user } = useAuth();
  const overdue   = !task.completed && isOverdue(task.dueDate);
  const dueToday  = !task.completed && isDueToday(task.dueDate);
  const assignee  = task.assigneeName || (task.assigneeEmail ? task.assigneeEmail.split('@')[0] : null);
  const isLinked  = !!task.assigneeUid;
  const hasAssignee = task.assigneeEmail || task.assigneePhone;

  // Expand / collapse
  const [expanded,    setExpanded]    = useState(false);
  // Which panel is open inside the expanded area
  const [panel,       setPanel]       = useState(null); // 'edit' | 'assign' | 'collab' | 'move' | 'reminder'
  // Reminder editor state (live-edits the reminder object until user saves it)
  // Guard against legacy `reminder: true` boolean value on old task docs.
  const taskReminder = task.reminder && typeof task.reminder === 'object' ? task.reminder : null;
  const [reminderDraft, setReminderDraft] = useState(taskReminder);
  const [reminderSaving, setReminderSaving] = useState(false);

  // Edit state
  const [editText,     setEditText]     = useState(task.text);
  const [editDue,      setEditDue]      = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [editPriority, setEditPriority] = useState(task.priority || 'medium');
  const [editAssignee, setEditAssignee] = useState(task.assigneeEmail || '');
  const [editSaving,   setEditSaving]   = useState(false);

  // Assign panel state
  const [assignName,    setAssignName]    = useState(task.assigneeName  || '');
  const [assignEmail,   setAssignEmail]   = useState(task.assigneeEmail || '');
  const [assignPhone,   setAssignPhone]   = useState(task.assigneePhone || '');
  const [scheduleTime,  setScheduleTime]  = useState(task.scheduledEmailTime || '');
  const [selectedMember, setSelectedMember] = useState(null);
  const [assignSaving,  setAssignSaving]  = useState(false);

  const memberByEmail = (email) => members.find(m => m.email?.toLowerCase() === email?.toLowerCase());

  const openPanel = (p) => {
    if (panel === p) { setPanel(null); return; }
    // Reset state when switching panels
    if (p === 'edit') {
      setEditText(task.text);
      setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : '');
      setEditPriority(task.priority || 'medium');
      setEditAssignee(task.assigneeEmail || '');
    }
    if (p === 'assign') {
      setAssignName(task.assigneeName || '');
      setAssignEmail(task.assigneeEmail || '');
      setAssignPhone(task.assigneePhone || '');
      setScheduleTime(task.scheduledEmailTime || '');
      setSelectedMember(null);
    }
    setPanel(p);
    setExpanded(true);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setEditSaving(true);
    const m = memberByEmail(editAssignee);
    try {
      await onUpdate(task.id, {
        text:          editText.trim(),
        dueDate:       editDue ? new Date(editDue).toISOString() : null,
        priority:      editPriority,
        assigneeEmail: m?.email || (editAssignee.includes('@') ? editAssignee : null),
        assigneeName:  m?.name  || null,
        assigneePhone: m?.phone || null,
      });
      showToast('Task updated!', 'success');
      setPanel(null);
    } catch { showToast('Failed to update', 'warning'); }
    setEditSaving(false);
  };

  const handleSaveAssign = async () => {
    if (!assignEmail.trim() && !assignPhone.trim()) {
      showToast('Please enter an email or phone number.', 'warning'); return;
    }
    setAssignSaving(true);
    const emailKey = assignEmail.trim().toLowerCase();
    const trimmedPhone = assignPhone.trim();
    const linked   = selectedMember || members.find(m => m.email?.toLowerCase() === emailKey);
    const dirEntry = directory.find(d => d.email?.toLowerCase() === emailKey);
    const assigneeUid = linked?.uid || dirEntry?.uid || null;
    try {
      await onUpdate(task.id, {
        assigneeName:       assignName.trim(),
        assigneeEmail:      emailKey,
        assigneePhone:      trimmedPhone,
        scheduledEmailTime: scheduleTime || null,
        assigneeUid,
      });
      // Silently persist the phone as an override in the personal Contacts list
      // so future assignments to the same person auto-fill with this number
      // instead of the stale Graph directory value.
      if (emailKey && trimmedPhone && saveContactPhone) {
        saveContactPhone(emailKey, assignName.trim() || emailKey, trimmedPhone).catch(() => {});
      }
      showToast(assigneeUid ? "Assigned! They'll see this in their dashboard." : 'Assignment saved!', 'success');
      setPanel(null);
    } catch { showToast('Failed to save assignment.', 'warning'); }
    setAssignSaving(false);
  };

  const handleEmail = () => {
    if (!task.assigneeEmail) { showToast('No email set for this task.', 'warning'); return; }
    const from    = user?.displayName || user?.email || 'Your manager';
    const due     = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const pri     = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const subject = `Task: ${task.text}`;
    const body    = `Hi ${task.assigneeName || task.assigneeEmail.split('@')[0]},\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${pri}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${from}`;
    window.location.href = `mailto:${task.assigneeEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showToast('Opening email app…', 'success');
  };

  const handleWhatsApp = () => {
    sendTaskWhatsApp(task, { user, showToast, fromFallback: 'Your manager' });
  };

  const inputStyle = {
    WebkitAppearance: 'none', appearance: 'none',
    width: '100%', boxSizing: 'border-box', height: 44,
    padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff',
    color: '#0f172a', outline: 'none',
  };

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${overdue ? '#dc262644' : '#e2e8f0'}`,
      marginBottom: 8,
      boxShadow: expanded ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
    }}>
      {/* ── Header row (always visible) ───────────────────────────────── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', cursor: 'pointer', userSelect: 'none',
          background: task.completed ? '#f9f6f0' : expanded ? '#ffffff' : '#fff',
          borderLeft: `3px solid ${overdue ? '#dc2626' : priorityColors[task.priority] || '#d97706'}`,
        }}
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          className="task-checkbox"
          checked={task.completed}
          onChange={e => { e.stopPropagation(); onToggle(task.id, task.completed); }}
          style={{ flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 14, lineHeight: 1.4,
              color: task.completed ? '#94a3b8' : overdue ? '#dc2626' : '#0f172a',
              textDecoration: task.completed ? 'line-through' : 'none',
            }}>
              {task.text}
            </span>
            {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
            {taskReminder?.enabled && !taskReminder?.paused && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#ede9fe', color: '#6d28d9',
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  border: '1px solid #c4b5fd55',
                }}
                title={`${describeSchedule(taskReminder)}${taskReminder.nextSendAt ? ` · next ${describeNextSend(taskReminder.nextSendAt, taskReminder.timezone)}` : ''}`}
              >
                <Bell size={9} /> {taskReminder.nextSendAt ? describeNextSend(taskReminder.nextSendAt, taskReminder.timezone) : 'scheduled'}
              </span>
            )}
            <CommentBadge ownerUid={ownerUid} taskId={task.id} />
            {isLinked && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#e8f8f5', color: '#7c3aed',
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                border: '1px solid #7c3aed44',
              }}>
                <Link size={9} /> Linked
              </span>
            )}
            {/* Shown on the owner's card when the assignee has pushed this
                task onto a Team Board. Keeps the owner aware that the task
                is now being tracked on the shared Kanban — click the card to
                read the activity log for details. */}
            {task.movedToWorkspace && (
              <span
                title={`Moved by ${task.movedToWorkspace.movedByName || 'assignee'} on ${
                  task.movedToWorkspace.movedAt ? new Date(task.movedToWorkspace.movedAt).toLocaleDateString() : 'an earlier date'
                }`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#eff6ff', color: '#2563eb',
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  border: '1px solid #2563eb44',
                }}
              >
                <ArrowUpRight size={9} /> Moved to {task.movedToWorkspace.workspaceName || 'Team Board'}
              </span>
            )}
          </div>
          {/* Meta: due date + assignee + created stamp */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2, alignItems: 'center' }}>
            {task.dueDate && (
              <span className={`task-due ${overdue ? 'overdue' : ''}`} style={{ fontSize: 12, margin: 0 }}>
                <Calendar size={11} />
                {overdue ? 'Was due:' : dueToday ? 'Due today:' : 'Due:'} {formatDate(task.dueDate)}
                {overdue  && <span className="overdue-badge">OVERDUE</span>}
                {dueToday && !overdue && <span className="overdue-badge" style={{ background: '#d97706' }}>TODAY</span>}
              </span>
            )}
            {assignee && (
              <span style={{ fontSize: 12, color: isLinked ? '#7c3aed' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <User size={11} /> {assignee}
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
                {!task.completed && (
                  <span style={{ color: '#7c3aed', fontWeight: 600, marginLeft: 2 }}>
                    · {elapsedSince(task.createdAt)} open
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        <span style={{ color: '#475569', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </div>

      {/* ── Expanded area ─────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>

          {/* Action buttons row */}
          {!task.completed && (
            <div className="task-action-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 12px 8px' }}>
              {task.assigneeEmail && (
                <button className="btn btn-sm btn-blue" onClick={handleEmail}>
                  <Mail size={12} /> Email Now
                </button>
              )}
              {task.assigneePhone && (
                <button className="btn btn-sm" style={{ background: '#25D366', color: '#fff', border: 'none' }} onClick={handleWhatsApp}>
                  <MessageCircle size={12} /> WhatsApp
                </button>
              )}
              <button
                className={`btn btn-sm ${panel === 'assign' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('assign')}
              >
                {hasAssignee ? <Edit2 size={12} /> : <UserPlus size={12} />}
                {hasAssignee ? 'Edit Assign' : 'Assign'}
              </button>
              <button
                className={`btn btn-sm ${panel === 'edit' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('edit')}
              >
                <Edit2 size={12} /> Edit
              </button>
              <button
                className={`btn btn-sm ${panel === 'reminder' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => { setReminderDraft(taskReminder); openPanel('reminder'); }}
                title={taskReminder?.enabled ? 'Edit recurring email reminder' : 'Set up recurring email reminder'}
              >
                <Bell size={12} /> {taskReminder?.enabled ? 'Reminder ✓' : 'Reminder'}
              </button>
              <button
                className={`btn btn-sm ${panel === 'collab' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('collab')}
              >
                💬 Comments
              </button>
              {hasWorkspace && (
                <button
                  className={`btn btn-sm ${panel === 'move' ? 'btn-teal' : 'btn-outline'}`}
                  onClick={() => openPanel('move')}
                  title="Move this task to the Team Board"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <ArrowUpRight size={12} /> Team Board
                </button>
              )}
              <button
                className="btn btn-sm task-done-btn"
                style={{ background: '#15803d', color: '#fff', border: 'none' }}
                onClick={() => onToggle(task.id, false)}
              >
                <CheckCircle size={12} /> Done
              </button>
            </div>
          )}

          {task.completed && (
            <div style={{ padding: '8px 12px' }}>
              <button className="btn btn-sm btn-outline" onClick={() => onToggle(task.id, true)}>
                ↩ Mark Incomplete
              </button>
            </div>
          )}

          {/* ── Edit panel ──────────────────────────────────────────── */}
          {panel === 'edit' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
              <textarea
                className="textarea"
                rows={2}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                style={{ minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 10, fontFamily: 'var(--font-body)', fontSize: 14, backgroundImage: 'none', lineHeight: 1.6 }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" value={editDue} onChange={e => setEditDue(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select value={editPriority} onChange={e => setEditPriority(e.target.value)} style={inputStyle}>
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">🟢 Low</option>
                  </select>
                </div>
              </div>
              {members.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Assign to</label>
                  <select value={editAssignee} onChange={e => setEditAssignee(e.target.value)} style={inputStyle}>
                    <option value="">— No assignee —</option>
                    {members.map(m => <option key={m.id} value={m.email || m.id}>{m.name}{m.email ? ` (${m.email})` : ''}{m.uid ? ' ✓' : ''}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setPanel(null)}><X size={13} /> Cancel</button>
                <button className="btn btn-sm btn-teal" onClick={handleSaveEdit} disabled={editSaving}><Check size={13} /> {editSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}

          {/* ── Assign panel ──────────────────────────────────────── */}
          {panel === 'assign' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>
                Assign Task — type a name to search your team
              </div>
              <div className="form-grid-3" style={{ marginBottom: 10 }}>
                <div>
                  <label className="label">Name</label>
                  <MemberAutocomplete
                    value={assignName}
                    onChange={setAssignName}
                    onSelect={m => {
                      // Prefer saved phone override (from Contacts) over the
                      // value the autocomplete returned. This is how the
                      // "refreshed" numbers stick across assignments.
                      const override = members.find(
                        mm => mm.email?.toLowerCase() === m.email?.toLowerCase()
                      )?.phone;
                      setSelectedMember(m);
                      setAssignName(m.name);
                      setAssignEmail(m.email || '');
                      setAssignPhone(override || m.phone || '');
                    }}
                    members={members}
                    placeholder="Search team…"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="email@company.com" value={assignEmail} onChange={e => setAssignEmail(e.target.value)} style={{ fontSize: 14 }} />
                </div>
                <div>
                  <label className="label">WhatsApp</label>
                  <input className="input" placeholder="e.g. 7305013582" value={assignPhone} onChange={e => setAssignPhone(e.target.value)} style={{ fontSize: 14 }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Schedule Send Time <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional — reminder note)</span></label>
                <input type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setPanel(null)}><X size={13} /> Cancel</button>
                <button className="btn btn-sm btn-teal" onClick={handleSaveAssign} disabled={assignSaving}>
                  {assignSaving ? 'Saving…' : 'Save Assignment'}
                </button>
              </div>
            </div>
          )}

          {/* ── Collab / Comments panel ────────────────────────────── */}
          {panel === 'collab' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 4 }} />
              <TaskCollabPanel
                ownerUid={ownerUid}
                task={task}
                onClose={() => setPanel(null)}
                canChangeStatus
              />
            </div>
          )}

          {/* ── Reminder panel ─────────────────────────────────────── */}
          {panel === 'reminder' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
              <ReminderEditor
                value={reminderDraft}
                onChange={setReminderDraft}
                timezone={user?.settings?.timezone
                  || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata')
                  || 'Asia/Kolkata'}
                creatorEmail={user?.email}
                creatorName={user?.displayName || user?.email}
              />
              <div className="modal-actions" style={{ marginTop: 12 }}>
                <button className="btn btn-sm btn-outline" onClick={() => { setReminderDraft(taskReminder); setPanel(null); }}>
                  <X size={13} /> Cancel
                </button>
                <button
                  className="btn btn-sm btn-teal"
                  disabled={reminderSaving}
                  onClick={async () => {
                    setReminderSaving(true);
                    try {
                      // Normalize + compute next-send one more time before persisting.
                      let payload = reminderDraft ? normalizeReminder(reminderDraft, {
                        timezone: user?.settings?.timezone,
                        creatorEmail: user?.email,
                        creatorName:  user?.displayName || user?.email,
                      }) : null;
                      if (payload) payload.nextSendAt = computeNextSendAt(payload);
                      await onUpdate(task.id, { reminder: payload });
                      showToast('Reminder saved!', 'success');
                      setPanel(null);
                    } catch {
                      showToast('Failed to save reminder.', 'warning');
                    }
                    setReminderSaving(false);
                  }}
                >
                  <Check size={13} /> {reminderSaving ? 'Saving…' : 'Save Reminder'}
                </button>
              </div>
            </div>
          )}

          {/* ── Move to Team Board panel ───────────────────────────── */}
          {panel === 'move' && (
            <MoveToBoard
              task={task}
              workspaces={workspaces}
              orgAssignees={orgAssignees}
              onDelete={onDelete}
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
