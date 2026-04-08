import { useState } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, User, Calendar, Send, Mail,
  Circle, Clock, Eye, CheckCircle, Trash2, Link, Copy, Check as CheckIcon,
  MessageCircle, Activity as ActivityIcon, Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspace, useWorkspaceTasks, useWorkspaceComments, useWorkspaceActivity,
  addWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask,
  addWorkspaceComment, createWorkspace,
} from '../hooks/useWorkspace';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#8a7a6a', bg: '#f5f0e5', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2980b9', bg: '#eaf4fb', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#8e44ad', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#27ae60', bg: '#eafaf1', Icon: CheckCircle  },
];
const PRIORITY_COLORS = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };

const formatTime = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const formatDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Workspace Collab Panel ────────────────────────────────────────────────────
function WorkspaceCollabPanel({ workspaceId, task, onClose }) {
  const { user } = useAuth();
  const { comments } = useWorkspaceComments(workspaceId, task.id);
  const { activity }  = useWorkspaceActivity(workspaceId, task.id);

  const [tab,           setTab]          = useState('comments');
  const [commentText,   setCommentText]  = useState('');
  const [sending,       setSending]      = useState(false);
  const [statusSaving,  setStatusSaving] = useState(false);
  const [emailSent,     setEmailSent]    = useState(false);

  const handleSendEmail = () => {
    const statusLabel = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' }[task.status || 'open'] || task.status;
    const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date';
    const subject = encodeURIComponent(`[Task Update] ${task.text}`);
    const body = encodeURIComponent(
      `Hi ${task.assigneeName || task.assigneeEmail?.split('@')[0] || 'there'},\n\n` +
      `Here's a quick update on your task:\n\n` +
      `📋 Task: ${task.text}\n` +
      `📊 Status: ${statusLabel}\n` +
      `📅 Due: ${due}\n` +
      `🔴 Priority: ${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}\n\n` +
      `Please let me know if you have any questions.\n\n` +
      `Thanks,\n${user.displayName || user.email}`
    );
    window.location.href = `mailto:${task.assigneeEmail}?subject=${subject}&body=${body}`;
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const handleSend = async () => {
    const t = commentText.trim();
    if (!t) return;
    setSending(true);
    try {
      await addWorkspaceComment(workspaceId, task.id, {
        authorUid:   user.uid,
        authorName:  user.displayName || user.email,
        authorEmail: user.email,
        text: t,
      }, task);
      setCommentText('');
    } catch (e) { console.error(e); }
    setSending(false);
  };

  const handleStatus = async (newStatus) => {
    if (newStatus === task.status) return;
    setStatusSaving(true);
    try {
      await updateWorkspaceTask(workspaceId, task.id, { status: newStatus }, user, task);
    } catch (e) { console.error(e); }
    setStatusSaving(false);
  };

  const actionColor = {
    created: '#27ae60', status_changed: '#2980b9', commented: '#8e44ad', completed: '#27ae60',
  };

  return (
    <div style={{ border: '1px solid #d4c5a9', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#fffdf5', padding: '12px 16px 16px' }}>

      {/* Status selector */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Status</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map(({ value, label, color, bg, Icon }) => {
            const active = (task.status || 'open') === value;
            return (
              <button key={value} disabled={statusSaving} onClick={() => handleStatus(value)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: active ? `2px solid ${color}` : `1px solid ${color}55`,
                background: active ? bg : 'transparent', color: active ? color : '#8a7a6a',
                opacity: statusSaving ? 0.6 : 1, transition: 'all 0.15s',
              }}>
                <Icon size={11} /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual email button — only shown when task has an assignee */}
      {task.assigneeEmail && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={handleSendEmail}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: '1px solid #2980b944',
              background: emailSent ? '#eafaf1' : '#eaf4fb',
              color: emailSent ? '#27ae60' : '#2980b9',
              transition: 'all 0.2s',
            }}
          >
            {emailSent ? <><CheckIcon size={13} /> Email opened!</> : <><Mail size={13} /> Email {task.assigneeName || task.assigneeEmail}</>}
          </button>
          <span style={{ fontSize: 11, color: '#b5a898', marginLeft: 8 }}>Opens your email app with task details pre-filled</span>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8d5b7', marginBottom: 12 }}>
        {[
          { key: 'comments', label: 'Comments', Icon: MessageCircle, count: comments.length },
          { key: 'activity', label: 'Activity',  Icon: ActivityIcon,  count: activity.length  },
        ].map(({ key, label, Icon, count }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: 13, fontWeight: 600,
            color: tab === key ? '#2a9d8f' : '#8a7a6a',
            borderBottom: tab === key ? '2px solid #2a9d8f' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Icon size={13} /> {label}
            {count > 0 && <span style={{ background: tab === key ? '#2a9d8f' : '#c9a96e', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* Comments */}
      {tab === 'comments' && (
        <div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
            {comments.length === 0 && <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No comments yet — be the first!</p>}
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: c.authorUid === user.uid ? '#eaf4fb' : '#f5f0e5' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: c.authorUid === user.uid ? '#2a9d8f22' : '#c9a96e33', color: c.authorUid === user.uid ? '#2a9d8f' : '#8B6914', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {(c.authorName || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#4a3728' }}>{c.authorName || 'Unknown'}</span>
                    <span style={{ fontSize: 11, color: '#b5a898' }}>{formatTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#4a3728', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
              placeholder="Write a comment… (⌘Enter to send)" rows={2}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d4c5a9', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', background: '#fffdf5', color: '#4a3728', lineHeight: 1.5, outline: 'none' }}
            />
            <button className="btn btn-teal btn-sm" onClick={handleSend} disabled={sending || !commentText.trim()} style={{ flexShrink: 0, height: 36 }}>
              <Send size={13} /> {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Activity */}
      {tab === 'activity' && (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {activity.length === 0 && <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No activity yet.</p>}
          {activity.map((a, i) => (
            <div key={a.id || i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: actionColor[a.action] || '#8a7a6a' }} />
                {i < activity.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 16, background: '#e8d5b7', marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#4a3728', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{a.actorName || 'Someone'}</span>{' '}
                  <span style={{ color: actionColor[a.action] || '#8a7a6a', fontWeight: 600 }}>{a.action?.replace('_', ' ')}</span>
                  {a.detail && a.action !== 'commented' && <span style={{ color: '#8a7a6a' }}> — {a.detail}</span>}
                </div>
                {a.action === 'commented' && a.detail && (
                  <div style={{ fontSize: 12, color: '#8a7a6a', marginTop: 2, fontStyle: 'italic' }}>"{a.detail.length > 60 ? a.detail.slice(0, 60) + '…' : a.detail}"</div>
                )}
                <div style={{ fontSize: 11, color: '#b5a898', marginTop: 2 }}>{formatTime(a.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {onClose && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#b5a898', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <ChevronDown size={12} /> Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────
function KanbanCard({ task, workspaceId, members, onDelete, currentUid }) {
  const [open, setOpen] = useState(false);
  const priority = PRIORITY_COLORS[task.priority] || '#e67e22';
  const statusCfg = STATUSES.find(s => s.value === (task.status || 'open')) || STATUSES[0];
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee = members.find(m => m.uid === task.assigneeUid);

  return (
    <div style={{ marginBottom: 8, borderRadius: 10, overflow: 'hidden', border: '1px solid #d4c5a9', opacity: task.status === 'done' ? 0.72 : 1, transition: 'opacity 0.2s' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ background: '#fffdf5', padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}
      >
        {/* Priority strip */}
        <div style={{ width: 3, minHeight: 36, borderRadius: 2, background: priority, flexShrink: 0, marginTop: 2 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3728', lineHeight: 1.4, marginBottom: 5, wordBreak: 'break-word' }}>{task.text}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {task.dueDate && (
              <span style={{ fontSize: 11, color: isOverdue ? '#c0392b' : '#8a7a6a', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Calendar size={10} /> {formatDate(task.dueDate)}
                {isOverdue && <span style={{ background: '#c0392b', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4 }}>OVERDUE</span>}
              </span>
            )}
            {(assignee || task.assigneeName) && (
              <span style={{ fontSize: 11, color: '#2a9d8f', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <User size={10} /> {assignee?.displayName || task.assigneeName}
              </span>
            )}
            <span style={{ fontSize: 10, color: '#b5a898' }}>by {task.createdByName || 'someone'}</span>
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
          {task.createdBy === currentUid && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(task.id); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b55', padding: 3, borderRadius: 4, display: 'flex' }}
            >
              <Trash2 size={12} />
            </button>
          )}
          {open ? <ChevronDown size={14} color="#8a7a6a" /> : <ChevronRight size={14} color="#8a7a6a" />}
        </div>
      </div>

      {open && (
        <WorkspaceCollabPanel
          workspaceId={workspaceId}
          task={task}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanColumn({ status, tasks, workspaceId, members, onDelete, currentUid }) {
  const { Icon, label, color, bg } = status;
  return (
    <div style={{ minWidth: 252, flex: '0 0 252px', display: 'flex', flexDirection: 'column' }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, padding: '8px 4px', borderBottom: `2px solid ${color}33` }}>
        <Icon size={14} color={color} />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#4a3728' }}>{label}</span>
        <span style={{ background: bg, color, border: `1px solid ${color}44`, fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, marginLeft: 'auto' }}>
          {tasks.length}
        </span>
      </div>
      {/* Cards */}
      {tasks.length === 0
        ? <div style={{ border: '2px dashed #e8d5b7', borderRadius: 10, padding: '20px 12px', textAlign: 'center', color: '#c9b89a', fontSize: 12 }}>No tasks here</div>
        : tasks.map(t => <KanbanCard key={t.id} task={t} workspaceId={workspaceId} members={members} onDelete={onDelete} currentUid={currentUid} />)
      }
    </div>
  );
}

// ── Add Task Modal ────────────────────────────────────────────────────────────
function AddTaskModal({ onClose, onAdd, members }) {
  const [text,        setText]        = useState('');
  const [status,      setStatus]      = useState('open');
  const [priority,    setPriority]    = useState('medium');
  const [dueDate,     setDueDate]     = useState('');
  const [assigneeUid, setAssigneeUid] = useState('');
  const [saving,      setSaving]      = useState(false);

  const handleAdd = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const m = members.find(m => m.uid === assigneeUid);
    await onAdd({
      text: text.trim(), status, priority,
      dueDate:       dueDate ? new Date(dueDate).toISOString() : null,
      assigneeUid:   m?.uid   || null,
      assigneeEmail: m?.email?.toLowerCase() || null,
      assigneeName:  m?.displayName || null,
    });
    setSaving(false);
    onClose();
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #d4c5a9', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#fffdf5', color: '#4a3728',
    boxSizing: 'border-box', outline: 'none',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fffdf5', borderRadius: 16, padding: 28, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, color: '#4a3728', fontSize: 17 }}>New Workspace Task</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a7a6a' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Task *</label>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Describe the task…" rows={3} autoFocus style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Column</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Assign to</label>
              <select value={assigneeUid} onChange={e => setAssigneeUid(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.uid} value={m.uid}>{m.displayName || m.email}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-teal" onClick={handleAdd} disabled={saving || !text.trim()} style={{ flex: 2, justifyContent: 'center' }}>
            {saving ? 'Adding…' : <><Plus size={15} /> Add Task</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Workspace Setup (first time) ──────────────────────────────────────────────
function WorkspaceSetup({ onCreated }) {
  const { user } = useAuth();
  const [name,     setName]     = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const id = await createWorkspace(user.uid, user.email, user.displayName || user.email, name.trim());
      await onCreated(id);
    } catch (e) { console.error(e); }
    setCreating(false);
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Collaborate</h2>
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <Users size={48} color="#c9a96e" style={{ marginBottom: 16 }} />
        <h3 style={{ color: '#4a3728', marginBottom: 8, fontSize: 18 }}>Create a Workspace</h3>
        <p style={{ color: '#8a7a6a', fontSize: 14, lineHeight: 1.7, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
          A workspace is your shared Kanban board — like Trello or Jira — where you and your team can create tasks, assign them, track progress, and comment in real time.
        </p>
        <div style={{ maxWidth: 320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            className="input"
            placeholder="Workspace name (e.g. KMCL Operations)"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <button className="btn btn-teal" onClick={handleCreate} disabled={creating || !name.trim()} style={{ justifyContent: 'center' }}>
            {creating ? 'Creating…' : <><Plus size={15} /> Create Workspace</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main KanbanBoard ──────────────────────────────────────────────────────────
export default function KanbanBoard({ onWorkspaceCreated }) {
  const { user } = useAuth();
  const { workspace, members, loading: wsLoading } = useMyWorkspace();
  const workspaceId = user?.workspaceId;
  const { tasks, loading: tasksLoading, error } = useWorkspaceTasks(workspaceId);

  const [showAddTask,     setShowAddTask]     = useState(false);
  const [showInvite,      setShowInvite]      = useState(false);
  const [showMembers,     setShowMembers]     = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [filterAssignee,  setFilterAssignee]  = useState('all');

  if (wsLoading) return <div className="empty-state fade-in"><p>Loading workspace…</p></div>;
  if (!workspaceId || !workspace) return <WorkspaceSetup onCreated={onWorkspaceCreated} />;

  const inviteUrl = `${window.location.origin}?workspace=${workspaceId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAddTask = async (taskData) => {
    await addWorkspaceTask(workspaceId, taskData, {
      uid:         user.uid,
      displayName: user.displayName || user.email,
    });
  };

  const handleDelete = async (taskId) => {
    if (window.confirm('Delete this task from the workspace?')) {
      await deleteWorkspaceTask(workspaceId, taskId);
    }
  };

  const filteredTasks = filterAssignee === 'all'
    ? tasks
    : filterAssignee === 'unassigned'
      ? tasks.filter(t => !t.assigneeUid)
      : tasks.filter(t => t.assigneeUid === filterAssignee);

  const tasksByStatus = (status) => filteredTasks.filter(t => (t.status || 'open') === status);

  const filterMembers = [
    { uid: 'all', displayName: 'All tasks' },
    { uid: 'unassigned', displayName: 'Unassigned' },
    ...members,
  ];

  return (
    <div className="fade-in">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 6 }}>🏗️ {workspace.name}</h2>
          {/* Member chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {members.map(m => (
              <span key={m.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f5f0e5', border: '1px solid #d4c5a9', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#4a3728' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: m.uid === user.uid ? '#2a9d8f33' : '#c9a96e33', color: m.uid === user.uid ? '#2a9d8f' : '#8B6914', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
                  {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                </div>
                {m.displayName || m.email}
                {m.role === 'admin' && <span style={{ fontSize: 9, color: '#c9a96e', fontWeight: 800 }}>ADMIN</span>}
              </span>
            ))}
            <button onClick={() => setShowInvite(v => !v)} style={{ background: 'none', border: '1px dashed #c9a96e', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#c9a96e', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={11} /> Invite
            </button>
          </div>
        </div>
        <button className="btn btn-teal" onClick={() => setShowAddTask(true)}>
          <Plus size={15} /> New Task
        </button>
      </div>

      {/* ── Invite panel ────────────────────────────────────────────────────── */}
      {showInvite && (
        <div className="card" style={{ marginBottom: 14, background: '#eaf4fb', border: '1px solid #2980b944', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#2980b9', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link size={14} /> Invite a coworker
            </div>
            <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a7a6a' }}><X size={16} /></button>
          </div>
          <p style={{ fontSize: 13, color: '#4a3728', marginBottom: 10, lineHeight: 1.6 }}>
            Share this link. Your coworker will create an account and join <strong>{workspace.name}</strong> automatically.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={inviteUrl} onClick={e => e.target.select()} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #2980b944', background: '#fff', fontSize: 12, fontFamily: 'monospace', color: '#2980b9', outline: 'none' }} />
            <button className="btn btn-sm btn-teal" onClick={handleCopy} style={{ flexShrink: 0 }}>
              {copied ? <><CheckIcon size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#8a7a6a', fontWeight: 600 }}>View:</span>
        {filterMembers.map(m => (
          <button
            key={m.uid}
            onClick={() => setFilterAssignee(m.uid)}
            style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: filterAssignee === m.uid ? '#2a9d8f' : '#f5f0e5',
              color:      filterAssignee === m.uid ? '#fff'     : '#4a3728',
              border:     filterAssignee === m.uid ? '1px solid #2a9d8f' : '1px solid #d4c5a9',
              transition: 'all 0.15s',
            }}
          >
            {m.displayName || m.email}
          </button>
        ))}
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: '#fef5f5', border: '1px solid #c0392b44', color: '#c0392b', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Kanban board (horizontal scroll on mobile) ───────────────────── */}
      {tasksLoading
        ? <div className="empty-state"><p>Loading tasks…</p></div>
        : (
          <div style={{ overflowX: 'auto', paddingBottom: 20, marginLeft: -4, paddingLeft: 4 }}>
            <div style={{ display: 'flex', gap: 14, minWidth: 'max-content', alignItems: 'flex-start' }}>
              {STATUSES.map(status => (
                <KanbanColumn
                  key={status.value}
                  status={status}
                  tasks={tasksByStatus(status.value)}
                  workspaceId={workspaceId}
                  members={members}
                  onDelete={handleDelete}
                  currentUid={user.uid}
                />
              ))}
            </div>
          </div>
        )
      }

      {/* ── Add task modal ───────────────────────────────────────────────── */}
      {showAddTask && (
        <AddTaskModal
          onClose={() => setShowAddTask(false)}
          onAdd={handleAddTask}
          members={members}
        />
      )}
    </div>
  );
}
