import { useState } from 'react';
import {
  Plus, Bell, Calendar, CheckSquare, Edit2, Check, X,
  ChevronDown, ChevronRight, User, Link,
} from 'lucide-react';
import { formatDate, isOverdue, isDueToday, toDateInputValue } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import TaskCollabPanel, { StatusBadge } from './TaskCollabPanel';
import { useTaskComments } from '../hooks/useFirestore';

// ── Comment count badge ────────────────────────────────────────────────────
function CommentBadge({ ownerUid, taskId }) {
  const { comments } = useTaskComments(ownerUid, taskId);
  if (!comments.length) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: '#8e44ad22', color: '#8e44ad',
      fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
    }}>
      💬 {comments.length}
    </span>
  );
}

// ── Assignee select ────────────────────────────────────────────────────────
function AssigneeSelect({ members, value, onChange }) {
  if (!members?.length) return null;
  return (
    <div>
      <label className="label">
        <User size={12} style={{ display: 'inline', marginRight: 4 }} />Assign to
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', height: 48, padding: '0 12px',
          border: '1px solid #d4c5a9', borderRadius: 8,
          fontSize: 15, fontFamily: 'var(--font-body)',
          background: '#fffdf5', color: '#4a3728',
          boxSizing: 'border-box', outline: 'none',
        }}
      >
        <option value="">— No assignee —</option>
        {members.map(m => (
          <option key={m.id} value={m.email || m.id}>
            {m.name}{m.email ? ` (${m.email})` : ''}
            {m.uid ? ' ✓' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

const priorityColors = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };

// ─────────────────────────────────────────────────────────────────────────────
export default function TaskManager({
  tasks, members = [], loading,
  onAdd, onToggle, onUpdate, onDelete, onClearCompleted, showToast,
}) {
  const { user } = useAuth();

  // ── Add form state ──────────────────────────────────────────────────────
  const [newText,     setNewText]     = useState('');
  const [newDue,      setNewDue]      = useState(toDateInputValue());
  const [newPriority, setNewPriority] = useState('medium');
  const [newAssignee, setNewAssignee] = useState('');   // selected email

  // ── Edit form state ─────────────────────────────────────────────────────
  const [editingId,    setEditingId]    = useState(null);
  const [editText,     setEditText]     = useState('');
  const [editDue,      setEditDue]      = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAssignee, setEditAssignee] = useState('');

  // ── Collab panel ────────────────────────────────────────────────────────
  const [collabOpenId, setCollabOpenId] = useState(null);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const memberByEmail = (email) => members.find(
    m => m.email?.toLowerCase() === email?.toLowerCase()
  );

  const pendingCount   = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const overdueCount   = tasks.filter(t => !t.completed && isOverdue(t.dueDate)).length;

  // ── Add task ────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newText.trim()) return;
    const m = memberByEmail(newAssignee);
    try {
      await onAdd({
        text:          newText.trim(),
        dueDate:       newDue ? new Date(newDue).toISOString() : null,
        priority:      newPriority,
        assigneeEmail: m?.email || null,
        assigneeName:  m?.name  || null,
        assigneePhone: m?.phone || null,
      });
      setNewText(''); setNewDue(toDateInputValue()); setNewPriority('medium'); setNewAssignee('');
      showToast(m ? `Task assigned to ${m.name}!` : 'Task added!', 'success');
    } catch {
      showToast('Failed to add task', 'warning');
    }
  };

  // ── Edit task ───────────────────────────────────────────────────────────
  const startEdit = (task) => {
    setEditingId(task.id);
    setEditText(task.text);
    setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : '');
    setEditPriority(task.priority || 'medium');
    setEditAssignee(task.assigneeEmail || '');
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleSaveEdit = async (taskId) => {
    if (!editText.trim()) return;
    const m = memberByEmail(editAssignee);
    try {
      await onUpdate(taskId, {
        text:          editText.trim(),
        dueDate:       editDue ? new Date(editDue).toISOString() : null,
        priority:      editPriority,
        assigneeEmail: m?.email || (editAssignee.includes('@') ? editAssignee : null),
        assigneeName:  m?.name  || null,
        assigneePhone: m?.phone || null,
      });
      showToast('Task updated!', 'success');
      cancelEdit();
    } catch {
      showToast('Failed to update task', 'warning');
    }
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;

  return (
    <div className="fade-in">
      <h2 className="section-title">Tasks & To-Dos</h2>

      {/* ── Add task form ──────────────────────────────────────────────── */}
      <div className="card">
        <label className="label">New Task</label>
        <textarea
          className="textarea"
          rows={2}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="What needs to be done?"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAdd(); }}
          style={{
            minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 12,
            fontFamily: 'var(--font-body)', fontSize: 15, backgroundImage: 'none', lineHeight: 1.6,
          }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label className="label">Due Date</label>
            <input
              type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
              style={{
                WebkitAppearance: 'none', appearance: 'none', width: '100%', height: 48,
                padding: '0 12px', border: '1px solid #d4c5a9', borderRadius: 8,
                fontSize: 15, fontFamily: 'var(--font-body)', background: '#fffdf5',
                color: '#4a3728', boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              value={newPriority} onChange={e => setNewPriority(e.target.value)}
              style={{
                width: '100%', height: 48, padding: '0 12px',
                border: '1px solid #d4c5a9', borderRadius: 8,
                fontSize: 15, fontFamily: 'var(--font-body)',
                background: '#fffdf5', color: '#4a3728',
                boxSizing: 'border-box', outline: 'none',
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* Assignee — only shown when there are team members */}
        {members.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <AssigneeSelect members={members} value={newAssignee} onChange={setNewAssignee} />
            {newAssignee && memberByEmail(newAssignee)?.uid && (
              <p style={{ fontSize: 12, color: '#2a9d8f', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Link size={11} /> This member has signed up — task will appear in their dashboard immediately.
              </p>
            )}
            {newAssignee && !memberByEmail(newAssignee)?.uid && (
              <p style={{ fontSize: 12, color: '#8a7a6a', marginTop: 4 }}>
                This member hasn't signed up yet — share the join link from the Team tab so they can log in.
              </p>
            )}
          </div>
        )}

        <button className="btn btn-gold" onClick={handleAdd} style={{ width: '100%', justifyContent: 'center' }}>
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
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

      {/* ── Task list ──────────────────────────────────────────────────── */}
      <div className="card">
        {tasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <CheckSquare size={36} color="#c9a96e" />
            <p>No tasks yet. Add one above!</p>
          </div>
        ) : (
          <>
            {tasks.map(task => {
              const overdue    = !task.completed && isOverdue(task.dueDate);
              const dueToday   = !task.completed && isDueToday(task.dueDate);
              const isEditing  = editingId === task.id;
              const collabOpen = collabOpenId === task.id;
              const assignee   = task.assigneeName || (task.assigneeEmail ? task.assigneeEmail.split('@')[0] : null);
              const isLinked   = !!task.assigneeUid || !!memberByEmail(task.assigneeEmail)?.uid;

              return (
                <div key={task.id} style={{ borderBottom: '1px solid #f0e6d2' }}>

                  {/* ── Normal task row ─────────────────────────────────── */}
                  {!isEditing && (
                    <div className={`task-row ${task.completed ? 'completed' : ''}`} style={{ borderBottom: 'none', flexWrap: 'wrap' }}>
                      <div style={{ width: 4, height: 32, borderRadius: 2, background: priorityColors[task.priority] || '#e67e22', flexShrink: 0 }} />

                      <input
                        type="checkbox"
                        className="task-checkbox"
                        checked={task.completed}
                        onChange={() => onToggle(task.id, task.completed)}
                      />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Title + badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`task-text ${task.completed ? 'done' : ''}`}>{task.text}</span>
                          {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
                          <CommentBadge ownerUid={user?.uid} taskId={task.id} />
                        </div>

                        {/* Meta row — due date + assignee */}
                        <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                          {task.dueDate && (
                            <div className={`task-due ${overdue ? 'overdue' : ''}`}>
                              <Calendar size={12} />
                              {formatDate(task.dueDate)}
                              {overdue   && <span className="overdue-badge">OVERDUE</span>}
                              {dueToday  && <span className="overdue-badge" style={{ background: '#e67e22' }}>DUE TODAY</span>}
                            </div>
                          )}
                          {assignee && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: 12,
                              color: isLinked ? '#2a9d8f' : '#8a7a6a',
                            }}>
                              <User size={11} />
                              {assignee}
                              {isLinked && <Link size={10} />}
                            </span>
                          )}
                        </div>
                      </div>

                      {task.reminder && !task.completed && <Bell size={16} color="#c9a96e" />}

                      {/* Collab toggle */}
                      <button
                        className="btn-icon"
                        title="Comments & Activity"
                        onClick={() => setCollabOpenId(collabOpen ? null : task.id)}
                      >
                        {collabOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>

                      {!task.completed && (
                        <button className="btn-icon" onClick={() => startEdit(task)} title="Edit task">
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Collab panel ────────────────────────────────────── */}
                  {!isEditing && collabOpen && (
                    <TaskCollabPanel
                      ownerUid={user?.uid}
                      task={task}
                      onClose={() => setCollabOpenId(null)}
                      canChangeStatus={true}
                    />
                  )}

                  {/* ── Inline edit form ────────────────────────────────── */}
                  {isEditing && (
                    <div style={{ padding: '12px 0' }}>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        style={{
                          minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 10,
                          fontFamily: 'var(--font-body)', fontSize: 15, backgroundImage: 'none', lineHeight: 1.6,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1, minWidth: 130 }}>
                          <label className="label">Due Date</label>
                          <input className="input" type="date" value={editDue} onChange={e => setEditDue(e.target.value)} />
                        </div>
                        <div style={{ minWidth: 110 }}>
                          <label className="label">Priority</label>
                          <select className="select" value={editPriority} onChange={e => setEditPriority(e.target.value)}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                      </div>

                      {members.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <AssigneeSelect members={members} value={editAssignee} onChange={setEditAssignee} />
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-outline" onClick={cancelEdit}><X size={14} /> Cancel</button>
                        <button className="btn btn-sm btn-teal" onClick={() => handleSaveEdit(task.id)}><Check size={14} /> Save</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

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
