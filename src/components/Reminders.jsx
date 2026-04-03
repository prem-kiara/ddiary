import { Bell, Mail, Calendar, CheckCircle, Clock } from 'lucide-react';
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

export default function Reminders({ tasks, onToggle, showToast }) {
  const { user } = useAuth();
  const pendingTasks = tasks.filter(t => !t.completed);
  const overdueTasks = pendingTasks.filter(t => isOverdue(t.dueDate));
  const upcomingTasks = pendingTasks.filter(t => !isOverdue(t.dueDate));
  const reminderEmail = user?.settings?.reminderEmail || user?.email || '';

  const sendEmailReminder = () => {
    if (!reminderEmail) {
      showToast('Please set your email in Settings first', 'warning');
      return;
    }
    if (pendingTasks.length === 0) {
      showToast('No pending tasks to remind about!', 'info');
      return;
    }

    const subject = `Digital Diary: ${pendingTasks.length} pending task${pendingTasks.length > 1 ? 's' : ''}`;
    const lines = [];

    if (overdueTasks.length > 0) {
      lines.push('⚠️ OVERDUE TASKS:');
      overdueTasks.forEach((t, i) => {
        lines.push(`  ${i + 1}. ${t.text} (was due: ${formatDate(t.dueDate)})`);
      });
      lines.push('');
    }

    if (upcomingTasks.length > 0) {
      lines.push('📋 UPCOMING TASKS:');
      upcomingTasks.forEach((t, i) => {
        lines.push(`  ${i + 1}. ${t.text}${t.dueDate ? ` (due: ${formatDate(t.dueDate)})` : ''}`);
      });
    }

    const body = lines.join('\n');
    window.open(`mailto:${reminderEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    showToast('Email reminder prepared!', 'success');
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
          {overdueTasks.map(task => (
            <div key={task.id} className="task-row">
              <Bell size={18} color="#c0392b" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{task.text}</div>
                <div className="task-due overdue">
                  <Calendar size={12} /> Was due: {formatDate(task.dueDate)}
                </div>
              </div>
              <button className="btn btn-sm btn-teal" onClick={() => onToggle(task.id, false)}>
                <CheckCircle size={14} /> Done
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming Tasks */}
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
          upcomingTasks.map(task => (
            <div key={task.id} className="task-row">
              <Bell size={18} color="#c9a96e" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{task.text}</div>
                {task.dueDate && (
                  <div className="task-due">
                    <Calendar size={12} /> Due: {formatDate(task.dueDate)}
                  </div>
                )}
              </div>
              <button className="btn btn-sm btn-teal" onClick={() => onToggle(task.id, false)}>
                <CheckCircle size={14} /> Done
              </button>
            </div>
          ))
        )}
      </div>

      {/* Email Reminder */}
      <div className="card">
        <h3 style={{ marginBottom: 12, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={20} /> Email Reminder
        </h3>
        <p style={{ color: '#8a7a6a', marginBottom: 16, lineHeight: 1.6 }}>
          Send yourself an email digest of all pending tasks.
          {reminderEmail && (
            <span style={{ display: 'block', marginTop: 4, fontWeight: 600 }}>
              Sending to: {reminderEmail}
            </span>
          )}
        </p>
        <button className="btn btn-gold" onClick={sendEmailReminder}>
          <Mail size={16} /> Send Email Reminder
        </button>
      </div>

      {/* Auto Reminders Info */}
      <div className="card" style={{ background: '#f5f0e5', border: '1px dashed #c9a96e' }}>
        <h3 style={{ marginBottom: 8, color: '#4a3728', fontSize: 16 }}>Automatic Daily Reminders</h3>
        <p style={{ color: '#8a7a6a', lineHeight: 1.6, fontSize: 14 }}>
          When cloud sync is active, the app automatically sends you a daily email digest of all pending and overdue tasks
          at your preferred reminder time ({user?.settings?.reminderTime || '9:00 AM'}).
          Configure this in Settings.
        </p>
      </div>
    </div>
  );
}
