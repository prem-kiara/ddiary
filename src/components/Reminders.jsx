import { useState, useRef, useEffect } from 'react';
import { Bell, Mail, Calendar, CheckCircle, Clock, UserPlus, Send, X, Edit2, MessageCircle, Link, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useUserDirectory } from '../hooks/useFirestore';
import { StatusBadge } from './TaskCollabPanel';
import MemberAutocomplete from './shared/MemberAutocomplete';
import SectionHeader from './shared/SectionHeader';
import { sendTaskWhatsApp } from '../utils/whatsapp';

const formatDate = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const isOverdue = (dueDate) => {
  if (!dueDate) return false;
  const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  return date < new Date() && date.toDateString() !== new Date().toDateString();
};

export default function Reminders({ tasks, teamMembers = [], onToggle, onUpdate, showToast }) {
  const { user } = useAuth();
  // userDirectory gives us the real Firebase UIDs for anyone who has signed up,
  // even if the auto-link in TeamMembers hasn't run yet.
  const { directory } = useUserDirectory(user?.uid);
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneePhone, setAssigneePhone] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  // Collapsible section state — overdue starts open (urgent), others also open by default
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  // Per-task expand/collapse — stores a Set of expanded task IDs
  const [expandedTaskIds, setExpandedTaskIds] = useState(new Set());
  const toggleTask = (id) => setExpandedTaskIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pendingTasks = tasks.filter(t => !t.completed);
  const overdueTasks = pendingTasks.filter(t => isOverdue(t.dueDate));
  const upcomingTasks = pendingTasks.filter(t => !isOverdue(t.dueDate));

  const openAssignForm = (task) => {
    setAssigningTaskId(task.id);
    setAssigneeName(task.assigneeName || '');
    setAssigneeEmail(task.assigneeEmail || '');
    setAssigneePhone(task.assigneePhone || '');
    setScheduleTime(task.scheduledEmailTime || '');
  };

  const closeAssignForm = () => {
    setAssigningTaskId(null);
    setAssigneeName(''); setAssigneeEmail(''); setAssigneePhone(''); setScheduleTime('');
    setSelectedMember(null);
  };

  // Track which team member object was selected (to get their uid if linked)
  const [selectedMember, setSelectedMember] = useState(null);

  const handleMemberSelect = (member) => {
    setSelectedMember(member);
    setAssigneeName(member.name);
    setAssigneeEmail(member.email || '');
    setAssigneePhone(member.phone || '');
  };

  const handleSaveAssignment = async (taskId) => {
    if (!assigneeEmail.trim() && !assigneePhone.trim()) {
      showToast('Please enter an email or phone number.', 'warning');
      return;
    }
    // Resolve the assignee's Firebase UID. Check in order:
    //   1. The member object explicitly selected from the autocomplete
    //   2. The teamMembers list (may already have uid if auto-linked)
    //   3. The userDirectory (real-time, has uid the moment they sign up — no tab-visit required)
    const emailKey = assigneeEmail.trim().toLowerCase();
    const linkedMember = selectedMember
      || teamMembers.find(m => m.email && m.email.toLowerCase() === emailKey);
    const dirEntry = directory.find(d => d.email && d.email.toLowerCase() === emailKey);
    const assigneeUid = linkedMember?.uid || dirEntry?.uid || null;

    try {
      await onUpdate(taskId, {
        assigneeName:       assigneeName.trim(),
        assigneeEmail:      assigneeEmail.trim().toLowerCase(),   // always lowercase
        assigneePhone:      assigneePhone.trim(),
        scheduledEmailTime: scheduleTime || null,
        assigneeUid,
      });
      showToast(
        assigneeUid
          ? 'Assignment saved! Task is now collaborative — your team member will see it in their dashboard.'
          : 'Assignment saved!',
        'success',
      );
      closeAssignForm();
      setSelectedMember(null);
    } catch {
      showToast('Failed to save assignment.', 'warning');
    }
  };

  // Opens Outlook if available, falls back to the device's default email app
  const sendEmailNow = (task) => {
    const recipient = task.assigneeEmail;
    if (!recipient) { showToast('No email set for this task.', 'warning'); return; }

    const greeting = task.assigneeName ? `Hi ${task.assigneeName},` : 'Hi,';
    const due = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const from = user?.displayName || 'Suren';
    const subject = `Task: ${task.text}`;
    const body = `${greeting}\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${priority}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${from}`;

    const mailtoUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // ms-outlook:// is the registered URL scheme for Microsoft Outlook on Windows/Mac
    const outlookUrl = `ms-outlook://compose?to=${encodeURIComponent(recipient)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Detect if Outlook opened by listening for the window losing focus
    let outlookHandled = false;
    const onBlur = () => { outlookHandled = true; };
    window.addEventListener('blur', onBlur, { once: true });

    // Trigger Outlook via a hidden link (silently ignored if scheme not registered)
    const a = document.createElement('a');
    a.href = outlookUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // After a short window, if Outlook didn't open, fall back to mailto:
    setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      if (!outlookHandled) {
        window.location.href = mailtoUrl;
        showToast('Opening your email app...', 'success');
      }
    }, 750);

    showToast('Opening Outlook...', 'success');
  };

  const sendWhatsApp = (task) => {
    sendTaskWhatsApp(task, { user, showToast, fromFallback: 'Your manager' });
  };

  const renderTask = (task) => {
    const overdue = !task.completed && isOverdue(task.dueDate);
    const isAssigning = assigningTaskId === task.id;
    const hasAssignee = task.assigneeEmail || task.assigneePhone;
    const isExpanded = expandedTaskIds.has(task.id);

    return (
      <div key={task.id} style={{
        borderBottom: '1px solid #e2e8f0',
        marginBottom: 8,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
      }}>
        {/* ── Collapsed header row (always visible, clickable) ── */}
        <div
          onClick={() => toggleTask(task.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 12px', cursor: 'pointer',
            background: isExpanded ? '#ffffff' : 'transparent',
            userSelect: 'none',
          }}
        >
          <Bell size={15} color={overdue ? '#dc2626' : '#7c3aed'} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.4, color: overdue ? '#dc2626' : '#0f172a' }}>
                {task.text}
              </span>
              {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
              {task.assigneeUid && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#e8f8f5', color: '#7c3aed',
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 7px', borderRadius: 10,
                  border: '1px solid #7c3aed44',
                }}>
                  <Link size={9} /> Collaborative
                </span>
              )}
            </div>
            {/* Compact summary line — due date + assignee name when collapsed */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {task.dueDate && (
                <span className={`task-due ${overdue ? 'overdue' : ''}`} style={{ fontSize: 12, margin: 0 }}>
                  <Calendar size={11} /> {overdue ? 'Was due:' : 'Due:'} {formatDate(task.dueDate)}
                </span>
              )}
              {hasAssignee && task.assigneeName && (
                <span style={{ fontSize: 12, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <UserPlus size={11} /> {task.assigneeName}
                </span>
              )}
            </div>
          </div>
          {/* Chevron */}
          <span style={{ color: '#6d28d9', flexShrink: 0 }}>
            {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </span>
        </div>

        {/* ── Expanded detail section ── */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '12px 12px 14px', background: '#ffffff' }}>
            {/* Full assignee details */}
            {hasAssignee && (
              <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <UserPlus size={11} />
                {task.assigneeName && <span style={{ fontWeight: 600 }}>{task.assigneeName}</span>}
                {task.assigneeEmail && <span style={{ color: '#475569' }}>· {task.assigneeEmail}</span>}
                {task.assigneePhone && <span style={{ color: '#475569' }}>· {task.assigneePhone}</span>}
                {task.scheduledEmailTime && (
                  <span style={{ color: '#475569' }}>· Scheduled: {new Date(task.scheduledEmailTime).toLocaleString()}</span>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hasAssignee && task.assigneeEmail && (
                <button className="btn btn-sm btn-blue" onClick={e => { e.stopPropagation(); sendEmailNow(task); }}>
                  <Mail size={13} /> Email Now
                </button>
              )}
              {hasAssignee && task.assigneePhone && (
                <button
                  className="btn btn-sm"
                  style={{ background: '#25D366', color: '#fff' }}
                  onClick={e => { e.stopPropagation(); sendWhatsApp(task); }}
                >
                  <MessageCircle size={13} /> WhatsApp
                </button>
              )}
              <button
                className="btn btn-sm btn-outline"
                onClick={e => { e.stopPropagation(); isAssigning ? closeAssignForm() : openAssignForm(task); }}
              >
                {hasAssignee ? <Edit2 size={13} /> : <UserPlus size={13} />}
                {hasAssignee ? 'Edit Assign' : 'Assign'}
              </button>
              <button
                className="btn btn-sm btn-teal"
                onClick={e => { e.stopPropagation(); onToggle(task.id, false); }}
              >
                <CheckCircle size={13} /> Done
              </button>
            </div>

            {/* Inline assign form */}
            {isAssigning && (
              <div style={{
                background: '#f1f5f9', borderRadius: 8, padding: 16,
                marginTop: 12, border: '1px solid #e2e8f0',
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 12 }}>
                  Assign Task — type a name to search your team
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label className="label">Name</label>
                    <MemberAutocomplete
                      value={assigneeName}
                      onChange={setAssigneeName}
                      onSelect={handleMemberSelect}
                      members={teamMembers}
                      placeholder="Type to search..."
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      style={{ padding: '10px 12px', fontSize: 14 }}
                      type="email"
                      placeholder="email@company.com"
                      value={assigneeEmail}
                      onChange={e => setAssigneeEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">WhatsApp</label>
                    <input
                      className="input"
                      style={{ padding: '10px 12px', fontSize: 14 }}
                      placeholder="e.g. 7305013582"
                      value={assigneePhone}
                      onChange={e => setAssigneePhone(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Schedule Send Time (optional)</label>
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                    style={{
                      WebkitAppearance: 'none', appearance: 'none',
                      width: '100%', boxSizing: 'border-box', height: 44,
                      padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8,
                      fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff',
                      color: '#0f172a', outline: 'none',
                    }}
                  />
                  <p style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    Save a scheduled time and use the Email Now / WhatsApp buttons to send when the time comes.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-outline" onClick={closeAssignForm}>
                    <X size={13} /> Cancel
                  </button>
                  <button className="btn btn-sm btn-teal" onClick={() => handleSaveAssignment(assigningTaskId)}>
                    Save Assignment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Reminders</h2>

      {/* ── Overdue Tasks ─────────────────────────────────────────────── */}
      {overdueTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #dc2626' }}>
          <SectionHeader
            open={overdueOpen}
            onToggle={() => setOverdueOpen(o => !o)}
            icon={<Clock size={18} />}
            label="Overdue Tasks"
            count={overdueTasks.length}
            color="#dc2626"
          />
          {overdueOpen && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 14 }}>
                {overdueTasks.map(renderTask)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pending Tasks ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          open={pendingOpen}
          onToggle={() => setPendingOpen(o => !o)}
          icon={<Bell size={18} />}
          label="Pending Tasks"
          count={pendingTasks.length}
        />
        {pendingOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e2e8f0' }}>
            {pendingTasks.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <CheckCircle size={36} color="#15803d" />
                <p>All caught up! No pending tasks.</p>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                {upcomingTasks.map(renderTask)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── How Notifications Work ────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#f1f5f9', border: '1px dashed #7c3aed' }}>
        <SectionHeader
          open={helpOpen}
          onToggle={() => setHelpOpen(o => !o)}
          icon={<Send size={16} />}
          label="How Notifications Work"
        />
        {helpOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e2e8f0' }}>
            <p style={{ color: '#475569', lineHeight: 1.7, fontSize: 13, marginTop: 12 }}>
              Click <strong>Assign</strong> on any task, type a name to search team members, and their email/phone fills automatically.
              <strong> Email Now</strong> opens Outlook (or your device mail app if Outlook isn't installed) pre-filled and ready to send.
              <strong> WhatsApp</strong> opens a pre-written message in WhatsApp. Add team members via the <strong>Team</strong> tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
