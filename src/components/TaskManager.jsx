import { useState } from 'react';
import { Plus, Bell, Calendar, CheckSquare, Edit2, Check, X } from 'lucide-react';
import { formatDate, isOverdue, isDueToday, toDateInputValue } from '../utils/dates';

export default function TaskManager({ tasks, loading, onAdd, onToggle, onUpdate, onClearCompleted, showToast }) {
  const [newText, setNewText] = useState('');
  const [newDue, setNewDue] = useState(toDateInputValue());
  const [newPriority, setNewPriority] = useState('medium');

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editPriority, setEditPriority] = useState('medium');

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
    } catch {
      showToast('Failed to add task', 'warning');
    }
  };

  const startEdit = (task) => {
    setEditingId(task.id);
    setEditText(task.text);
    setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setEditPriority(task.priority || 'medium');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditDue('');
    setEditPriority('medium');
  };

  const handleSaveEdit = async (taskId) => {
    if (!editText.trim()) return;
    try {
      await onUpdate(taskId, {
        text: editText.trim(),
        dueDate: editDue ? new Date(editDue).toISOString() : null,
        priority: editPriority,
      });
      showToast('Task updated!', 'success');
      cancelEdit();
    } catch {
      showToast('Failed to update task', 'warning');
    }
  };

  if (loading) {
    return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;
  }

  return (
    <div className="fade-in">
      <h2 className="section-title">Tasks & To-Dos</h2>

      {/* Add Task Form — stacked layout for iPad compatibility */}
      <div className="card">
        <label className="label">New Task</label>
        <textarea
          className="textarea"
          rows={2}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="What needs to be done?"
          style={{
            minHeight: 'unset',
            height: 'auto',
            resize: 'none',
            marginBottom: 12,
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            backgroundImage: 'none',
            lineHeight: 1.6,
          }}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAdd(); }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'end', minWidth: 0 }}>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <label className="label">Due Date</label>
            <input
              className="input"
              type="date"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label className="label">Priority</label>
            <select
              className="select"
              value={newPriority}
              onChange={e => setNewPriority(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div style={{ minWidth: 0 }}>
            <label className="label" style={{ visibility: 'hidden' }}>Add</label>
            <button className="btn btn-gold" onClick={handleAdd} style={{ width: '100%', justifyContent: 'center', boxSizing: 'border-box' }}>
              <Plus size={16} /> Add
            </button>
          </div>
        </div>
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
              const isEditing = editingId === task.id;

              return (
                <div key={task.id}>
                  {/* Normal task row */}
                  {!isEditing && (
                    <div className={`task-row ${task.completed ? 'completed' : ''}`}>
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
                      {!task.completed && (
                        <button className="btn-icon" onClick={() => startEdit(task)} title="Edit task">
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Inline edit form */}
                  {isEditing && (
                    <div style={{
                      padding: '12px 0',
                      borderBottom: '1px solid #f0e6d2',
                    }}>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        style={{
                          minHeight: 'unset',
                          height: 'auto',
                          resize: 'none',
                          marginBottom: 10,
                          fontFamily: 'var(--font-body)',
                          fontSize: 15,
                          backgroundImage: 'none',
                          lineHeight: 1.6,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1, minWidth: 130 }}>
                          <label className="label">Due Date</label>
                          <input
                            className="input"
                            type="date"
                            value={editDue}
                            onChange={e => setEditDue(e.target.value)}
                          />
                        </div>
                        <div style={{ minWidth: 110 }}>
                          <label className="label">Priority</label>
                          <select
                            className="select"
                            value={editPriority}
                            onChange={e => setEditPriority(e.target.value)}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                        <button className="btn btn-sm btn-outline" onClick={cancelEdit}>
                          <X size={14} /> Cancel
                        </button>
                        <button className="btn btn-sm btn-teal" onClick={() => handleSaveEdit(task.id)}>
                          <Check size={14} /> Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Clear Completed */}
            {completedCount > 0 && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <button className="btn btn-sm btn-outline" onClick={onClearCompleted}>
                  Clear {completedCount} completed task{completedCount > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
