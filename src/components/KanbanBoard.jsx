import { useState } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, User, Calendar, Send, Mail,
  Circle, Clock, Eye, CheckCircle, Trash2, Link, Copy, Check as CheckIcon,
  Users, Edit2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspaces, useWorkspace, useWorkspaceTasks,
  addWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask,
  createWorkspace, renameWorkspace,
} from '../hooks/useWorkspace';
import { logError } from '../utils/errorLogger';
import WorkspaceCollabPanel from './WorkspaceCollabPanel';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#8a7a6a', bg: '#f5f0e5', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2980b9', bg: '#eaf4fb', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#8e44ad', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#27ae60', bg: '#eafaf1', Icon: CheckCircle  },
];
const PRIORITY_COLORS = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };

const formatDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

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
      <div style={{ background: '#fffdf5', borderRadius: 16, padding: 28, width: '100%', maxWidth: 800, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
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
    } catch (e) { logError(e, { location: 'KanbanBoard:WorkspaceSetup', action: 'createWorkspace' }, user.uid); }
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
  const { workspaces, loading: wsListLoading } = useMyWorkspaces();

  // Active workspace selection — persisted in localStorage
  const [activeWsId, setActiveWsId] = useState(
    () => localStorage.getItem('ddiary_active_workspace') || null
  );
  const switchWorkspace = (id) => {
    setActiveWsId(id);
    try { localStorage.setItem('ddiary_active_workspace', id); } catch {}
    setFilterAssignee('all');
  };

  // If stored workspace isn't in the list, pick the first one
  const workspaceId = workspaces.find(w => w.id === activeWsId)?.id
                   || workspaces[0]?.id
                   || null;

  const { workspace, members, loading: wsLoading } = useWorkspace(workspaceId);
  const { tasks, loading: tasksLoading, error } = useWorkspaceTasks(workspaceId);

  const [showAddTask,     setShowAddTask]     = useState(false);
  const [showInvite,      setShowInvite]      = useState(false);
  const [showMembers,     setShowMembers]     = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [filterAssignee,  setFilterAssignee]  = useState('all');

  // Workspace rename
  const [renaming,     setRenaming]     = useState(false);
  const [renameText,   setRenameText]   = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const startRename = () => { setRenameText(workspace.name); setRenaming(true); };
  const handleRename = async () => {
    if (!renameText.trim() || renameText.trim() === workspace.name) { setRenaming(false); return; }
    setRenameSaving(true);
    try { await renameWorkspace(workspaceId, renameText.trim()); } catch (e) { logError(e, { location: 'KanbanBoard:handleRename', action: 'renameWorkspace' }, user.uid); }
    setRenaming(false);
    setRenameSaving(false);
  };

  if (wsListLoading || wsLoading) return <div className="empty-state fade-in"><p>Loading workspace…</p></div>;
  if (!workspaces.length || !workspace) return <WorkspaceSetup onCreated={async (id) => { switchWorkspace(id); if (onWorkspaceCreated) await onWorkspaceCreated(id); }} />;

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

      {/* ── Workspace tabs (when user has multiple) ────────────────────────── */}
      {workspaces.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#f0e8d8', borderRadius: 14, padding: 4, overflowX: 'auto' }}>
          {workspaces.map(ws => (
            <button
              key={ws.id}
              onClick={() => switchWorkspace(ws.id)}
              style={{
                padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                background: ws.id === workspaceId ? '#fff' : 'transparent',
                color: ws.id === workspaceId ? '#4a3728' : '#8a7a6a',
                boxShadow: ws.id === workspaceId ? '0 1px 6px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.18s',
              }}
            >
              {ws.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          {/* Workspace title + inline rename */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Users size={20} color="#c9a96e" />
            {renaming ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  autoFocus
                  value={renameText}
                  onChange={e => setRenameText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                  style={{
                    fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-body)',
                    color: '#4a3728', border: 'none', borderBottom: '2px solid #c9a96e',
                    background: 'transparent', outline: 'none', width: 220,
                  }}
                />
                <button onClick={handleRename} disabled={renameSaving}
                  style={{ background: '#2a9d8f', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  {renameSaving ? '…' : 'Save'}
                </button>
                <button onClick={() => setRenaming(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a7a6a' }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <h2 className="section-title" style={{ margin: 0 }}>{workspace.name}</h2>
                <button onClick={startRename} title="Rename workspace"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9a96e', padding: 2, display: 'flex' }}>
                  <Edit2 size={13} />
                </button>
              </div>
            )}
          </div>
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
