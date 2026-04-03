import { useState } from 'react';
import { Plus, Trash2, Bell, Calendar, CheckSquare } from 'lucide-react';
import { formatDate, isOverdue, isDueToday, toDateInputValue } from '../utils/dates';

export default function TaskManager({ tasks, loading, onAdd, onToggle, onDelete, onClearCompleted, showToast }) {
  const [newText, setNewText] = useState('');
  const [newDue, setNewDue] = useState(toDateInputValue());
  const [newPriority, setNewPriority] = useState('medium');

  const pendingCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const overdueCount = tasks.filter(t => !t.completed && isOverdue(t.dueDate)).length;

  const handleAdd = async () => {
    if (!newText.trim()) return;
    try {
      await onAdd({
        text: newText.trim(),
        dueDate: newDue ? new Date(newDue).toISOString() : null,
        priority: newPriority,
      });
      setNewText('');
      setNewDue(toDateInputValue());
      setNewPriority('medium');
      showToast('Task added!', 'success');
    } catch (err) {
      showToast('Failed to add task', 'warning');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  if (loading) {
    return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;
  }

  return (
    <div className="fade-in">
      <h2 className="section-title">Tasks & To-Dos</h2>

      {/* Add Task Form */}
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label className="label">New Task</label>
          <input
            className="input"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What needs to be done?"
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <label className="label">Due Date</label>
          <input className="input" type="date" value={newDue} onChange={e => setNewDue(e.target.value)} />
        </div>
        <div style={{ minWidth: 110 }}>
          <label className="label">Priority</label>
          <select className="select" value={newPriority} onChange={e => setNewPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <button className="btn btn-gold" onClick={handleAdd}>
          <Plus size={16} /> Add
        </button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card pending">
          <div className="stat-number">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card completed">
          <div className="stat-number">{completedCount}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card overdue">
          <div className="stat-number">{overdueCount}</div>
          <div className="stat-label">Overdue</div>
        </div>
      </div>

      {/* Task List */}
      <div className="card">
        {tasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <CheckSquare size={36} color="#c9a96e" />
            <p>No tasks yet. Add one above!</p>
          </div>
        ) : (
          <>
            {tasks.map(task => {
              const overdue = !task.completed && isOverdue(task.dueDate);
              const dueToday = !task.completed && isDueToday(task.dueDate);
              const priorityColors = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };
              return (
                <div key={task.id} className={`task-row ${task.completed ? 'completed' : ''}`}>
                  {/* Priority indicator */}
                  <div style={{ width: 4, height: 32, borderRadius: 2, background: priorityColors[task.priority] || '#e67e22', flexShrink: 0 }} />
                  <input
                    type="checkbox"
                    className="task-checkbox"
                    checked={task.completed}
                    onChange={() => onToggle(task.id, task.completed)}
                  />
                  <div style={{ flex: 1 }}>
                    <span className={`task-text ${task.completed ? 'done' : ''}`}>{task.text}</span>
                    {task.dueDate && (
                      <div className={`task-due ${overdue ? 'overdue' : ''}`}>
                        <Calendar size={12} />
                        {formatDate(task.dueDate)}
                        {overdue && <span className="overdue-badge">OVERDUE</span>}
                        {dueToday && <span className="overdue-badge" style={{ background: '#e67e22' }}>DUE TODAY</span>}
                      </div>
                    )}
                  </div>
                  {task.reminder && !task.completed && <Bell size={16} color="#c9a96e" />}
                  <button className="btn-icon" onClick={() => onDelete(task.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}

            {/* Clear Completed */}
            {completedCount > 0 && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <button className="btn btn-sm btn-outline" onClick={onClearCompleted}>
                  <Trash2 size={14} /> Clear {completedCount} completed task{completedCount > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
