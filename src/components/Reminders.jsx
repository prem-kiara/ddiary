import { useState, useRef, useEffect } from 'react';
import { Bell, Mail, Calendar, CheckCircle, Clock, UserPlus, Send, X, Edit2, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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

function formatWhatsAppPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  return digits;
}

function MemberAutocomplete({ value, onChange, onSelect, members, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  const filtered = value.trim().length > 0
    ? members.filter(m => m.name.toLowerCase().includes(value.toLowerCase()))
    : [];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ padding: '10px 12px', fontSize: 14 }}
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fffdf5', border: '1px solid #d4c5a9', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.map(m => (
            <div
              key={m.id}
              onClick={() => { onSelect(m); setOpen(false); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0e6d2' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f0e5'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
              {m.email && <div style={{ fontSize: 12, color: '#8a7a6a' }}>{m.email}</div>}
              {m.phone && <div style={{ fontSize: 12, color: '#8a7a6a' }}>{m.phone}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Reminders({ tasks, teamMembers = [], onToggle, onUpdate, showToast }) {
  const { user } = useAuth();
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneePhone, setAssigneePhone] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

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
  };

  const handleMemberSelect = (member) => {
    setAssigneeName(member.name);
    setAssigneeEmail(member.email || '');
    setAssigneePhone(member.phone || '');
  };

  const handleSaveAssignment = async (taskId) => {
    if (!assigneeEmail.trim() && !assigneePhone.trim()) {
      showToast('Please enter an email or phone number.', 'warning');
      return;
    }
    try {
      await onUpdate(taskId, {
        assigneeName: assigneeName.trim(),
        assigneeEmail: assigneeEmail.trim(),
        assigneePhone: assigneePhone.trim(),
        scheduledEmailTime: scheduleTime || null,
      });
      showToast('Assignment saved!', 'success');
      closeAssignForm();
    } catch {
      showToast('Failed to save assignment.', 'warning');
    }
  };

  // Opens native email app / Outlook pre-filled
  const sendEmailNow = (task) => {
    const recipient = task.assigneeEmail;
    if (!recipient) { showToast('No email set for this task.', 'warning'); return; }
    const greeting = task.assigneeName ? `Hi ${task.assigneeName},` : 'Hi,';
    const due = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const from = user?.displayName || 'Suren';
    const subject = `Task: ${task.text}`;
    const body = `${greeting}\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${priority}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${from}`;
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showToast('Opening your email app...', 'success');
  };

  const sendWhatsApp = (task) => {
    const rawPhone = task.assigneePhone;
    if (!rawPhone) { showToast('No phone number set for this task.', 'warning'); return; }
    const phone = formatWhatsAppPhone(rawPhone);
    const greeting = task.assigneeName ? `Hi ${task.assigneeName},` : 'Hi,';
    const due = task.dueDate ? `\n📅 Due: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\n⚡ Priority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const from = user?.displayName || 'Suren';
    const msg = `${greeting}\n\nYou have been assigned a task:\n\n📋 *${task.text}*${due}${priority}\n\nPlease action this at your earliest convenience.\n\n— ${from}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const renderTask = (task) => {
    const overdue = !task.completed && isOverdue(task.dueDate);
    const isAssigning = assigningTaskId === task.id;
    const hasAssignee = task.assigneeEmail || task.assigneePhone;

    return (
      <div key={task.id} style={{ borderBottom: '1px solid #f0e6d2', paddingBottom: 14, marginBottom: 14 }}>
        {/* Task text — full width */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
          <Bell size={16} color={overdue ? '#c0392b' : '#c9a96e'} style={{ flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.5 }}>{task.text}</div>
            {task.dueDate && (
              <div className={`task-due ${overdue ? 'overdue' : ''}`} style={{ marginTop: 4 }}>
                <Calendar size={12} /> {overdue ? 'Was due:' : 'Due:'} {formatDate(task.dueDate)}
              </div>
            )}
            {hasAssignee && (
              <div style={{ fontSize: 12, color: '#2a9d8f', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <UserPlus size={11} />
                {task.assigneeName && <span style={{ fontWeight: 600 }}>{task.assigneeName}</span>}
                {task.assigneeEmail && <span style={{ color: '#8a7a6a' }}>· {task.assigneeEmail}</span>}
                {task.assigneePhone && <span style={{ color: '#8a7a6a' }}>· {task.assigneePhone}</span>}
                {task.scheduledEmailTime && (
                  <span style={{ color: '#8a7a6a' }}>· Scheduled: {new Date(task.scheduledEmailTime).toLocaleString()}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — below task text, full row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 26 }}>
          {hasAssignee && task.assigneeEmail && (
            <button className="btn btn-sm btn-blue" onClick={() => sendEmailNow(task)}>
              <Mail size={13} /> Email Now
            </button>
          )}
          {hasAssignee && task.assigneePhone && (
            <button
              className="btn btn-sm"
              style={{ background: '#25D366', color: '#fff' }}
              onClick={() => sendWhatsApp(task)}
            >
              <MessageCircle size={13} /> WhatsApp
            </button>
          )}
          <button
            className="btn btn-sm btn-outline"
            onClick={() => isAssigning ? closeAssignForm() : openAssignForm(task)}
          >
            {hasAssignee ? <Edit2 size={13} /> : <UserPlus size={13} />}
            {hasAssignee ? 'Edit Assign' : 'Assign'}
          </button>
          <button className="btn btn-sm btn-teal" onClick={() => onToggle(task.id, false)}>
            <CheckCircle size={13} /> Done
          </button>
        </div>

        {/* Inline assign form */}
        {isAssigning && (
          <div style={{
            background: '#f5f0e5', borderRadius: 8, padding: 16,
            marginTop: 12, border: '1px solid #e8d5b7',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728', marginBottom: 12 }}>
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
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                  height: 44,
                  padding: '0 12px',
                  border: '1px solid #d4c5a9',
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: 'var(--font-body)',
                  background: '#fffdf5',
                  color: '#4a3728',
                  outline: 'none',
                }}
              />
              <p style={{ fontSize: 12, color: '#8a7a6a', marginTop: 4 }}>
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
    );
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Reminders</h2>

      {overdueTasks.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #c0392b' }}>
          <h3 style={{ color: '#c0392b', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={20} /> Overdue Tasks
          </h3>
          {overdueTasks.map(renderTask)}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: '#4a3728' }}>
          <Bell size={20} color="#c9a96e" /> Pending Tasks
        </h3>
        {pendingTasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <CheckCircle size={36} color="#27ae60" />
            <p>All caught up! No pending tasks.</p>
          </div>
        ) : (
          upcomingTasks.map(renderTask)
        )}
      </div>

      <div className="card" style={{ background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <h3 style={{ marginBottom: 8, color: '#4a3728', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Send size={16} /> How Notifications Work
        </h3>
        <p style={{ color: '#8a7a6a', lineHeight: 1.7, fontSize: 13 }}>
          Click <strong>Assign</strong> on any task, type a name to search team members, and their email/phone fills automatically.
          <strong> Email Now</strong> opens Outlook or your device mail app pre-filled and ready to send.
          <strong> WhatsApp</strong> opens a pre-written message in WhatsApp. Add team members via the <strong>Team</strong> tab.
        </p>
      </div>
    </div>
  );
}
