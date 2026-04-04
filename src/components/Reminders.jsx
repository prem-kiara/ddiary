import { useState } from 'react';
import { Bell, Mail, Calendar, CheckCircle, Clock, UserPlus, Send, X, Edit2 } from 'lucide-react';
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

export default function Reminders({ tasks, onToggle, onUpdate, showToast }) {
  const { user } = useAuth();
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  const pendingTasks = tasks.filter(t => !t.completed);
  const overdueTasks = pendingTasks.filter(t => isOverdue(t.dueDate));
  const upcomingTasks = pendingTasks.filter(t => !isOverdue(t.dueDate));

  const openAssignForm = (task) => {
    setAssigningTaskId(task.id);
    setAssigneeName(task.assigneeName || '');
    setAssigneeEmail(task.assigneeEmail || '');
    setScheduleTime(task.scheduledEmailTime || '');
  };

  const closeAssignForm = () => {
    setAssigningTaskId(null);
    setAssigneeName('');
    setAssigneeEmail('');
    setScheduleTime('');
  };

  const handleSaveAssignment = async (taskId) => {
    if (!assigneeEmail.trim()) {
      showToast('Please enter an email address.', 'warning');
      return;
    }
    try {
      await onUpdate(taskId, {
        assigneeName: assigneeName.trim(),
        assigneeEmail: assigneeEmail.trim(),
        scheduledEmailTime: scheduleTime || null,
      });
      showToast('Assignment saved!', 'success');
      closeAssignForm();
    } catch {
      showToast('Failed to save assignment.', 'warning');
    }
  };

  const sendEmailNow = (task) => {
    const recipient = task.assigneeEmail;
    if (!recipient) {
      showToast('No assignee email set for this task. Please assign first.', 'warning');
      return;
    }
    const name = task.assigneeName ? ` ${task.assigneeName},` : '';
    const due = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const priority = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const subject = `Task Assigned to You: ${task.text}`;
    const body = `Hi${name}\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${priority}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${user?.displayName || user?.email || 'Your colleague'}`;
    window.open(`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    showToast('Email prepared — opening your mail app.', 'success');
  };

  const renderTask = (task) => {
    const overdue = !task.completed && isOverdue(task.dueDate);
    const isAssigning = assigningTaskId === task.id;

    return (
      <div key={task.id} style={{ borderBottom: '1px solid #f0e6d2' }}>
        {/* Task row */}
        <div className="task-row" style={{ borderBottom: 'none' }}>
          <Bell size={18} color={overdue ? '#c0392b' : '#c9a96e'} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{task.text}</div>
            {task.dueDate && (
              <div className={`task-due ${overdue ? 'overdue' : ''}`}>
                <Calendar size={12} /> {overdue ? 'Was due:' : 'Due:'} {formatDate(task.dueDate)}
              </div>
            )}
            {task.assigneeEmail && (
              <div style={{ fontSize: 12, color: '#2a9d8f', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <UserPlus size={11} />
                Assigned to: {task.assigneeName ? `${task.assigneeName} (${task.assigneeEmail})` : task.assigneeEmail}
                {task.scheduledEmailTime && (
                  <span style={{ marginLeft: 4, color: '#8a7a6a' }}>
                    · Auto-send: {new Date(task.scheduledEmailTime).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {task.assigneeEmail && (
              <button
                className="btn btn-sm btn-blue"
                onClick={() => sendEmailNow(task)}
                title="Send email to assignee now"
              >
                <Send size={13} /> Send
              </button>
            )}
            <button
              className="btn btn-sm btn-outline"
              onClick={() => isAssigning ? closeAssignForm() : openAssignForm(task)}
              title="Assign to someone"
            >
              {task.assigneeEmail ? <Edit2 size={13} /> : <UserPlus size={13} />}
              {task.assigneeEmail ? 'Edit' : 'Assign'}
            </button>
            <button className="btn btn-sm btn-teal" onClick={() => onToggle(task.id, false)}>
              <CheckCircle size={14} /> Done
            </button>
          </div>
        </div>

        {/* Inline assign form */}
        {isAssigning && (
          <div style={{
            background: '#f5f0e5',
            borderRadius: 8,
            padding: 16,
            margin: '0 0 12px 0',
            border: '1px solid #e8d5b7',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728', marginBottom: 12 }}>
              Assign Task to Someone
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="label">Name</label>
                <input
                  className="input"
                  style={{ padding: '10px 12px', fontSize: 14 }}
                  placeholder="Assignee name"
                  value={assigneeName}
                  onChange={e => setAssigneeName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="label">Email *</label>
                <input
                  className="input"
                  style={{ padding: '10px 12px', fontSize: 14 }}
                  type="email"
                  placeholder="assignee@company.com"
                  value={assigneeEmail}
                  onChange={e => setAssigneeEmail(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Schedule Email (optional)</label>
              <input
                className="input"
                style={{ padding: '10px 12px', fontSize: 14 }}
                type="datetime-local"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
              />
              <p style={{ fontSize: 12, color: '#8a7a6a', marginTop: 4 }}>
                Set a date/time to remind you to send this email. Use the Send button to deliver instantly.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-outline" onClick={closeAssignForm}>
                <X size={13} /> Cancel
              </button>
              <button className="btn btn-sm btn-blue" onClick={() => sendEmailNow({ ...task, assigneeEmail, assigneeName })}>
                <Send size={13} /> Send Now
              </button>
              <button className="btn btn-sm btn-teal" onClick={() => handleSaveAssignment(task.id)}>
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

      {/* Overdue Tasks */}
      {overdueTasks.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #c0392b' }}>
          <h3 style={{ color: '#c0392b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={20} /> Overdue Tasks
          </h3>
          {overdueTasks.map(renderTask)}
        </div>
      )}

      {/* Upcoming / Pending Tasks */}
      <div className="card">
        <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#4a3728' }}>
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

      {/* How assigning works */}
      <div className="card" style={{ background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <h3 style={{ marginBottom: 8, color: '#4a3728', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={18} /> Sending Task Emails
        </h3>
        <p style={{ color: '#8a7a6a', lineHeight: 1.7, fontSize: 14 }}>
          Click <strong>Assign</strong> on any task to enter an assignee's name and email.
          Use <strong>Send</strong> to instantly email them via your mail app.
          Set a schedule date/time to save a reminder of when to send the email.
        </p>
      </div>
    </div>
  );
}
