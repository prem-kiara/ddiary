import { useState, useEffect, useMemo } from 'react';
import {
  Plus, X, ChevronDown, ChevronRight, User, Calendar, Send, Mail,
  Circle, Clock, Eye, CheckCircle, Trash2, Link, Copy, Check as CheckIcon,
  Users, Edit2, Briefcase, UserPlus, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspaces, useWorkspace, useWorkspaceTasks,
  addWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask,
  createWorkspace, renameWorkspace, addWorkspaceMember,
  deleteWorkspace,
  createWorkspaceInvite, getExistingInvite,
} from '../hooks/useWorkspace';
import { logError } from '../utils/errorLogger';
import WorkspaceCollabPanel from './WorkspaceCollabPanel';
import WorkspaceInvitePrompt from './WorkspaceInvitePrompt';
import { notifyWorkspaceInvite, notifyTaskAssigned } from '../utils/emailNotifications';
import { fetchAllOrgUsers, searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#475569', bg: '#f1f5f9', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2563eb', bg: '#eff6ff', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#7c3aed', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#15803d', bg: '#eafaf1', Icon: CheckCircle  },
];
const PRIORITY_COLORS = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

const formatDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Task Detail Modal ─────────────────────────────────────────────────────────
function TaskDetailModal({ task, workspaceId, members, onDelete, currentUid, isAdmin, onClose }) {
  const priority  = PRIORITY_COLORS[task.priority] || '#d97706';
  const statusCfg = STATUSES.find(s => s.value === (task.status || 'open')) || STATUSES[0];
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee  = members.find(m => m.uid === task.assigneeUid);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(30,20,10,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 540,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #ede0c8', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 4, borderRadius: 2, background: priority, alignSelf: 'stretch', flexShrink: 0, minHeight: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' }}>{task.text}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {/* Status badge */}
              <span style={{ background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.color}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>
                {statusCfg.label}
              </span>
              {/* Priority badge */}
              <span style={{ background: `${priority}18`, color: priority, border: `1px solid ${priority}44`, fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize' }}>
                {task.priority || 'medium'}
              </span>
              {/* Due date */}
              {task.dueDate && (
                <span style={{ fontSize: 12, color: isOverdue ? '#dc2626' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Calendar size={11} />
                  {formatDate(task.dueDate)}
                  {isOverdue && <span style={{ background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>OVERDUE</span>}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {(assignee || task.assigneeName) && (
                <span style={{ fontSize: 12, color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {assignee?.displayName || task.assigneeName}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Created by {task.createdByName || 'someone'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {task.createdBy === currentUid && (
              <button
                onClick={() => { onDelete(task.id); onClose(); }}
                title="Delete task"
                style={{ background: '#fff0f0', border: '1px solid #f5c6c6', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Notes (if any) */}
        {task.notes && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #ede0c8', background: '#fdf8ee' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.notes}</div>
          </div>
        )}

        {/* Collaboration panel (comments, activity, status updates) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <WorkspaceCollabPanel
            workspaceId={workspaceId}
            task={task}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────
function KanbanCard({ task, workspaceId, members, onDelete, currentUid, isAdmin }) {
  const [open, setOpen] = useState(false);
  const priority  = PRIORITY_COLORS[task.priority] || '#d97706';
  const statusCfg = STATUSES.find(s => s.value === (task.status || 'open')) || STATUSES[0];
  const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();
  const assignee  = members.find(m => m.uid === task.assigneeUid);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{
          marginBottom: 8,
          borderRadius: 10,
          border: '1px solid #cbd5e1',
          opacity: task.status === 'done' ? 0.72 : 1,
          background: '#ffffff',
          cursor: 'pointer',
          display: 'flex',
          gap: 8,
          alignItems: 'stretch',
          height: 88,
          overflow: 'hidden',
          transition: 'box-shadow 0.15s, transform 0.1s',
          boxSizing: 'border-box',
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.10)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
      >
        {/* Priority stripe */}
        <div style={{ width: 4, background: priority, flexShrink: 0, borderRadius: '10px 0 0 10px' }} />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, padding: '10px 8px 10px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 5 }}>
          {/* Task title — clamp to 2 lines */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {task.text}
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
            {task.dueDate && (
              <span style={{ fontSize: 10, color: isOverdue ? '#dc2626' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <Calendar size={9} />
                {formatDate(task.dueDate)}
                {isOverdue && <span style={{ background: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 3px', borderRadius: 3 }}>!</span>}
              </span>
            )}
            {(assignee || task.assigneeName) && (
              <span style={{ fontSize: 10, color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, overflow: 'hidden' }}>
                <User size={9} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {assignee?.displayName || task.assigneeName}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Right side: delete + expand hint */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px 8px 0', flexShrink: 0 }}>
          {task.createdBy === currentUid
            ? (
              <button
                onClick={e => { e.stopPropagation(); onDelete(task.id); }}
                title="Delete task"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc262655', padding: 3, borderRadius: 4, display: 'flex' }}
              >
                <Trash2 size={11} />
              </button>
            )
            : <span />
          }
          <ChevronRight size={12} color="#94a3b8" />
        </div>
      </div>

      {open && (
        <TaskDetailModal
          task={task}
          workspaceId={workspaceId}
          members={members}
          onDelete={onDelete}
          currentUid={currentUid}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanColumn({ status, tasks, workspaceId, members, onDelete, currentUid, isAdmin }) {
  const { Icon, label, color, bg } = status;
  return (
    <div style={{ minWidth: 252, flex: '0 0 252px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, padding: '8px 4px', borderBottom: `2px solid ${color}33` }}>
        <Icon size={14} color={color} />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{label}</span>
        <span style={{ background: bg, color, border: `1px solid ${color}44`, fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, marginLeft: 'auto' }}>
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0
        ? <div style={{ border: '2px dashed #e2e8f0', borderRadius: 10, padding: '20px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No tasks here</div>
        : tasks.map(t => <KanbanCard key={t.id} task={t} workspaceId={workspaceId} members={members} onDelete={onDelete} currentUid={currentUid} isAdmin={isAdmin} />)
      }
    </div>
  );
}

// ── Add Task Modal ────────────────────────────────────────────────────────────
function AddTaskModal({ onClose, onAdd, members, workspaces, currentWorkspaceId, showToast }) {
  const [text,          setText]          = useState('');
  const [notes,         setNotes]         = useState('');
  const [status,        setStatus]        = useState('open');
  const [priority,      setPriority]      = useState('high');
  const [dueDate,       setDueDate]       = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [saving,        setSaving]        = useState(false);

  const [wsMode,       setWsMode]       = useState(workspaces.length ? 'existing' : 'new');
  const [selectedWsId, setSelectedWsId] = useState(currentWorkspaceId || workspaces[0]?.id || '');
  const [newWsName,    setNewWsName]    = useState('');

  // ── Fetch M365 org users ────────────────────────────────────────────────
  const [orgUsers, setOrgUsers] = useState([]);
  useEffect(() => {
    fetchAllOrgUsers().then(u => setOrgUsers(u || [])).catch(() => {});
  }, []);

  // Merged assignee list: workspace members (have UIDs) first, then org users, deduped by email
  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); list.push({ email: m.email, name: m.displayName || m.email, uid: m.uid || null }); }
    }
    for (const u of orgUsers) {
      const key = u.email?.toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); list.push({ email: u.email, name: u.displayName || u.email, uid: null }); }
    }
    return list;
  }, [members, orgUsers]);

  const switchToNewWsMode = () => {
    setWsMode('new');
    setNewWsName(prev => prev.trim() ? prev : text.trim().slice(0, 60));
  };

  const handleAdd = async () => {
    if (!text.trim()) return;
    if (wsMode === 'new' && !newWsName.trim()) return;
    setSaving(true);
    try {
      const person = assigneeOptions.find(p => p.email?.toLowerCase() === assigneeEmail.toLowerCase());
      await onAdd(
        {
          text: text.trim(),
          notes: notes.trim() || null,
          status,
          priority,
          dueDate:       dueDate ? new Date(dueDate).toISOString() : null,
          assigneeUid:   person?.uid   || null,
          assigneeEmail: person?.email?.toLowerCase() || null,
          assigneeName:  person?.name  || null,
        },
        {
          targetWorkspaceId: wsMode === 'existing' ? selectedWsId : null,
          newWorkspaceName:  wsMode === 'new'      ? newWsName.trim() : null,
        }
      );
      onClose();
    } catch (e) {
      logError(e, { location: 'KanbanBoard:AddTaskModal', action: 'addTask' });
      if (showToast) showToast('Failed to add task. Please try again.', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none',
  };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: 17, fontWeight: 700 }}>New Task</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Task description */}
          <div>
            <label style={labelStyle}>Task *</label>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Describe the task…" rows={3} autoFocus style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Workspace picker */}
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px' }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>
              <Briefcase size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Workspace
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: wsMode === 'new' ? 10 : 0 }}>
              {workspaces.map(ws => (
                <button key={ws.id} type="button"
                  onClick={() => { setWsMode('existing'); setSelectedWsId(ws.id); }}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                    background: wsMode === 'existing' && selectedWsId === ws.id ? '#7c3aed' : '#e2e8f0',
                    color:      wsMode === 'existing' && selectedWsId === ws.id ? '#fff'     : '#0f172a',
                    transition: 'all 0.15s',
                  }}
                >{ws.name}</button>
              ))}
              <button type="button" onClick={switchToNewWsMode}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px dashed ${wsMode === 'new' ? '#7c3aed' : '#7c3aed'}`,
                  background: wsMode === 'new' ? '#7c3aed' : 'transparent',
                  color:      wsMode === 'new' ? '#fff'     : '#7c3aed',
                  transition: 'all 0.15s',
                }}
              >+ New workspace</button>
            </div>
            {wsMode === 'new' && (
              <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                placeholder="Workspace name…" style={{ ...inputStyle, fontSize: 13, marginTop: 2 }} autoFocus={workspaces.length === 0} />
            )}
          </div>

          {/* Column + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Column</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
            </div>
          </div>

          {/* Assign to + Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Assign to</label>
              <select value={assigneeEmail} onChange={e => setAssigneeEmail(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {assigneeOptions.map(p => (
                  <option key={p.email} value={p.email}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional context, links, or details…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline btn-sm" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-teal" onClick={handleAdd}
            disabled={saving || !text.trim() || (wsMode === 'new' && !newWsName.trim())}
            style={{ flex: 2, justifyContent: 'center' }}
          >
            {saving
              ? (wsMode === 'new' ? 'Creating workspace…' : 'Adding…')
              : <><Plus size={15} /> {wsMode === 'new' ? 'Create Workspace & Add Task' : 'Add Task'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Workspace Setup (first workspace creation) ────────────────────────────────
function WorkspaceSetup({ onCreated, onCancel, showToast, title }) {
  const { user } = useAuth();
  const [name,     setName]     = useState('');
  const [taskText, setTaskText] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [step,     setStep]     = useState(1);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErrorMsg('');
    try {
      const id = await createWorkspace(user.uid, user.email, user.displayName || user.email, name.trim());
      if (taskText.trim()) {
        await addWorkspaceTask(id, {
          text: taskText.trim(), status: 'open', priority: 'high',
          dueDate: null, assigneeUid: null, assigneeEmail: null, assigneeName: null,
        }, { uid: user.uid, displayName: user.displayName || user.email, email: user.email });
      }
      if (showToast) showToast(`Workspace "${name.trim()}" created!`, 'success');
      await onCreated(id);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceSetup', action: 'createWorkspace' }, user.uid);
      const msg = e.message || 'Failed to create workspace. Please try again.';
      setErrorMsg(msg);
      if (showToast) showToast(msg, 'warning');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card" style={{ padding: 32, maxWidth: 480, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={18} color="#7c3aed" />
          <span style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{title || 'New Workspace'}</span>
        </div>
        {onCancel && (
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
            <X size={18} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
        {[{ n: 1, label: 'Name workspace' }, { n: 2, label: 'First task (optional)' }].map(({ n, label }) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              background: step >= n ? '#7c3aed' : '#e2e8f0',
              color: step >= n ? '#fff' : '#475569',
            }}>{n}</div>
            <span style={{ fontSize: 12, color: step >= n ? '#7c3aed' : '#94a3b8', fontWeight: step === n ? 700 : 400 }}>{label}</span>
            {n < 2 && <div style={{ width: 20, height: 1, background: step > n ? '#7c3aed' : '#e2e8f0', margin: '0 2px' }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          <input className="input" placeholder="e.g. KMCL Operations, Collections Team…"
            value={name} onChange={e => { setName(e.target.value); setErrorMsg(''); }}
            onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
            autoFocus style={{ marginBottom: 12 }}
          />
          {errorMsg && (
            <div style={{ background: '#fdf0f0', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 10, display: 'flex', gap: 8 }}>
              <span>⚠️</span><span>{errorMsg}</span>
            </div>
          )}
          <button className="btn btn-teal" onClick={() => name.trim() && setStep(2)} disabled={!name.trim()} style={{ justifyContent: 'center', width: '100%' }}>
            Continue →
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <textarea className="input" placeholder="e.g. Review pending loan applications… (optional)"
            value={taskText} onChange={e => setTaskText(e.target.value)}
            rows={3} autoFocus style={{ marginBottom: 16, resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)} style={{ flex: 1, justifyContent: 'center' }}>← Back</button>
            <button className="btn btn-teal" onClick={handleCreate} disabled={creating} style={{ flex: 2, justifyContent: 'center' }}>
              {creating ? 'Creating…' : <><Plus size={15} /> {taskText.trim() ? 'Create & Add Task' : 'Create Workspace'}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── WorkspaceBoardContent ─────────────────────────────────────────────────────
// The actual kanban board — rendered only when a workspace is expanded.
function WorkspaceBoardContent({ workspaceId, members, showToast, user, workspaces, onWorkspaceCreated, showAddTaskInitial, onAddTaskClose, isAdmin }) {
  const { tasks, loading: tasksLoading, error } = useWorkspaceTasks(workspaceId);
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [showAddTask, setShowAddTask]       = useState(showAddTaskInitial || false);

  const handleAddTask = async (taskData, wsOptions = {}) => {
    let targetWsId = workspaceId;
    try {
      if (wsOptions.newWorkspaceName) {
        const newId = await createWorkspace(
          user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName
        );
        if (onWorkspaceCreated) await onWorkspaceCreated(newId);
        if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
        targetWsId = newId;
      } else if (wsOptions.targetWorkspaceId && wsOptions.targetWorkspaceId !== workspaceId) {
        targetWsId = wsOptions.targetWorkspaceId;
      }

      await addWorkspaceTask(targetWsId, taskData, {
        uid: user.uid, email: user.email, displayName: user.displayName || user.email,
      });

      if (taskData.assigneeEmail) {
        notifyTaskAssigned({
          assigneeEmail: taskData.assigneeEmail,
          assigneeName:  taskData.assigneeName,
          taskText:      taskData.text,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(() => {});
      }
    } catch (e) {
      logError(e, { location: 'KanbanBoard:WorkspaceBoardContent', action: 'addWorkspaceTask' }, user.uid);
      throw e;
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('Delete this task from the workspace?')) return;
    try {
      await deleteWorkspaceTask(workspaceId, taskId);
    } catch (e) {
      logError(e, { location: 'KanbanBoard:handleDelete', action: 'deleteWorkspaceTask' }, user.uid);
      if (showToast) showToast('Failed to delete task.', 'warning');
    }
  };

  const closeAddTask = () => {
    setShowAddTask(false);
    if (onAddTaskClose) onAddTaskClose();
  };

  const filteredTasks = filterAssignee === 'all'
    ? tasks
    : filterAssignee === 'unassigned'
      ? tasks.filter(t => !t.assigneeUid && !t.assigneeEmail)
      : tasks.filter(t => t.assigneeUid === filterAssignee);

  const tasksByStatus = (status) => filteredTasks.filter(t => (t.status || 'open') === status);

  const filterMembers = [
    { uid: 'all',        displayName: 'All tasks'  },
    { uid: 'unassigned', displayName: 'Unassigned' },
    ...members,
  ];

  return (
    <div style={{ paddingTop: 14 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>View:</span>
        {filterMembers.map(m => (
          <button key={m.uid} onClick={() => setFilterAssignee(m.uid)}
            style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: filterAssignee === m.uid ? '#7c3aed' : '#f1f5f9',
              color:      filterAssignee === m.uid ? '#fff'     : '#0f172a',
              border:     filterAssignee === m.uid ? '1px solid #7c3aed' : '1px solid #cbd5e1',
              transition: 'all 0.15s',
            }}
          >{m.displayName || m.email}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #dc262644', color: '#dc2626', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Kanban columns */}
      {tasksLoading
        ? <div style={{ padding: '20px 0', color: '#475569', fontSize: 13 }}>Loading tasks…</div>
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
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          </div>
        )
      }

      {(showAddTask || showAddTaskInitial) && (
        <AddTaskModal
          onClose={closeAddTask}
          onAdd={handleAddTask}
          members={members}
          workspaces={workspaces}
          currentWorkspaceId={workspaceId}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── WorkspaceItem ─────────────────────────────────────────────────────────────
// A single collapsible workspace card with header, invite panel, and board.
function WorkspaceItem({ workspace, showToast, user, workspaces, onWorkspaceCreated, isFirst }) {
  // Persist expanded state per workspace
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(`ddiary_ws_${workspace.id}_expanded`);
      return stored !== null ? stored === 'true' : isFirst;
    } catch { return isFirst; }
  });
  const [showInvite,    setShowInvite]    = useState(false);
  const [showAddTask,   setShowAddTask]   = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Members are always loaded (shown in header chip row)
  const { members, loading: membersLoading } = useWorkspace(workspace.id);

  // Invite state
  const [inviteEmail,       setInviteEmail]       = useState('');
  const [inviteSending,     setInviteSending]     = useState(false);
  const [inviteEmailSent,   setInviteEmailSent]   = useState(false);
  const [inviteError,       setInviteError]       = useState('');
  const [copied,            setCopied]            = useState(false);
  const [inviteSuggestions, setInviteSuggestions] = useState([]);

  const handleInviteInputChange = (val) => {
    setInviteEmail(val);
    setInviteError('');
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(results => setInviteSuggestions(results || []));
    } else {
      setInviteSuggestions([]);
    }
  };

  const selectInviteSuggestion = (person) => {
    setInviteEmail(person.email);
    setInviteSuggestions([]);
  };

  // Rename state
  const [renaming,     setRenaming]     = useState(false);
  const [renameText,   setRenameText]   = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  const inviteUrl = `${window.location.origin}?workspace=${workspace.id}`;

  const toggleExpanded = () => {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem(`ddiary_ws_${workspace.id}_expanded`, String(next)); } catch {}
      return next;
    });
  };

  const handleRename = async () => {
    if (!renameText.trim() || renameText.trim() === workspace.name) { setRenaming(false); return; }
    setRenameSaving(true);
    try { await renameWorkspace(workspace.id, renameText.trim()); } catch (e) {
      logError(e, { location: 'WorkspaceItem:handleRename' }, user.uid);
    }
    setRenaming(false);
    setRenameSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      if (showToast) showToast(`Workspace deleted.`, 'success');
    } catch (e) {
      logError(e, { location: 'WorkspaceItem:handleDelete' }, user.uid);
      if (showToast) showToast('Failed to delete workspace.', 'warning');
      setDeleting(false);
      setShowDelete(false);
    }
  };

  const handleEmailInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteError('');
    try {
      const email = inviteEmail.trim().toLowerCase();

      // Guard: already a real member?
      if (members.some(m => m.email?.toLowerCase() === email)) {
        setInviteError('This person is already a member of this workspace.');
        return;
      }

      // Guard: pending invite already exists?
      const existing = await getExistingInvite(workspace.id, email);
      if (existing?.status === 'pending') {
        setInviteError('An invite is already pending — waiting for them to respond.');
        return;
      }

      // Create invite doc (overwrites any prior 'rejected' invite)
      await createWorkspaceInvite({
        workspaceId:   workspace.id,
        workspaceName: workspace.name,
        inviterUid:    user.uid,
        inviterEmail:  user.email,
        inviterName:   user.displayName || user.email,
        inviteeEmail:  email,
      });

      // Also pre-create pending member doc as fallback for claimPendingMemberships
      await addWorkspaceMember(workspace.id, {
        uid:         `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email,
        displayName: email.split('@')[0],
        role:        'member',
      });

      // Send email — non-fatal if it fails
      try {
        await notifyWorkspaceInvite({
          inviteeEmail:  email,
          inviteeName:   email.split('@')[0],
          inviterName:   user.displayName || user.email,
          workspaceName: workspace.name,
          inviteUrl,
        });
      } catch { /* email failure is non-fatal — the invite doc is already created */ }

      if (showToast) showToast(`Invite sent to ${email}!`, 'success');
      setInviteEmailSent(true);
      setInviteEmail('');
      setTimeout(() => setInviteEmailSent(false), 3000);
    } catch {
      setInviteError('Failed to send invite — please try again.');
    } finally {
      setInviteSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isAdmin = workspace.role === 'admin' || workspace.createdBy === user.uid;

  return (
    <div
      className="card"
      style={{
        marginBottom:  12,
        padding:       0,
        overflow:      'hidden',
        border:        expanded ? '1px solid #94a3b8' : '1px solid #e2e8f0',
        transition:    'border-color 0.2s, box-shadow 0.2s',
        boxShadow:     expanded ? '0 2px 12px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
      }}
    >
      {/* ── Header row ───────────────────────────────────────────────────────── */}
      <div
        onClick={toggleExpanded}
        style={{
          padding:       '14px 18px',
          cursor:        'pointer',
          display:       'flex',
          alignItems:    'center',
          gap:           10,
          background:    expanded ? '#f1f5f9' : '#ffffff',
          borderBottom:  expanded || showInvite ? '1px solid #e2e8f0' : 'none',
          transition:    'background 0.2s',
          userSelect:    'none',
        }}
      >
        {/* Expand / collapse chevron */}
        <div style={{ color: '#7c3aed', flexShrink: 0, display: 'flex' }}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>

        {/* Workspace name / rename */}
        {renaming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }} onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
              style={{
                fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-body)',
                color: '#0f172a', border: 'none', borderBottom: '2px solid #7c3aed',
                background: 'transparent', outline: 'none', minWidth: 160, flex: 1,
              }}
            />
            <button onClick={handleRename} disabled={renameSaving}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {renameSaving ? '…' : 'Save'}
            </button>
            <button onClick={() => setRenaming(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workspace.name}
            </span>
            {isAdmin && (
              <button onClick={e => { e.stopPropagation(); setRenameText(workspace.name); setRenaming(true); }}
                title="Rename workspace"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', padding: 2, display: 'flex', flexShrink: 0 }}>
                <Edit2 size={12} />
              </button>
            )}
            {/* Member count */}
            {!membersLoading && (
              <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <Users size={11} /> {members.length}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {/* Invite */}
          <button
            onClick={() => setShowInvite(v => !v)}
            className="btn btn-sm btn-outline"
            style={{ gap: 5 }}
          >
            <UserPlus size={13} /> Invite
          </button>

          {/* New task */}
          <button
            onClick={() => { setExpanded(true); setShowAddTask(true); }}
            className="btn btn-sm btn-teal"
            style={{ gap: 5 }}
          >
            <Plus size={13} /> Task
          </button>

          {/* Delete workspace (admin only) */}
          {isAdmin && (
            <button
              onClick={() => setShowDelete(true)}
              title="Delete workspace"
              style={{ background: 'none', border: '1px solid #e0c8c8', borderRadius: 6, cursor: 'pointer', color: '#dc262677', padding: '4px 6px', display: 'flex' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Invite panel ──────────────────────────────────────────────────────── */}
      {showInvite && (
        <div style={{ padding: '14px 18px', background: '#eff6ff', borderBottom: expanded ? '1px solid #e2e8f0' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={14} /> Invite to <strong>{workspace.name}</strong>
            </div>
            <button onClick={() => { setShowInvite(false); setInviteError(''); setInviteEmail(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
              <X size={16} />
            </button>
          </div>

          {/* Email input with org autocomplete */}
          <div style={{ position: 'relative', marginBottom: inviteError ? 6 : 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={inviteEmail}
                onChange={e => handleInviteInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setInviteSuggestions([]); handleEmailInvite(); } if (e.key === 'Escape') setInviteSuggestions([]); }}
                onBlur={() => setTimeout(() => setInviteSuggestions([]), 150)}
                placeholder="Search by name or email…"
                autoComplete="off"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${inviteError ? '#dc262666' : '#2563eb44'}`, background: '#fff', fontSize: 13, fontFamily: 'var(--font-body)', color: '#0f172a', outline: 'none' }}
              />
              <button className="btn btn-sm btn-teal" onClick={() => { setInviteSuggestions([]); handleEmailInvite(); }}
                disabled={inviteSending || !inviteEmail.trim()} style={{ flexShrink: 0, minWidth: 80 }}>
                {inviteEmailSent ? <><CheckIcon size={13} /> Sent!</>
                  : inviteSending ? '…'
                  : <><Send size={13} /> Send</>}
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {inviteSuggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 90, zIndex: 200,
                background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
              }}>
                {inviteSuggestions.map(person => (
                  <div
                    key={person.id || person.email}
                    onMouseDown={() => selectInviteSuggestion(person)}
                    style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{person.displayName}</span>
                    <span style={{ fontSize: 11, color: '#475569' }}>{person.email}</span>
                    {person.jobTitle && <span style={{ fontSize: 11, color: '#94a3b8' }}>{person.jobTitle}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inline error */}
          {inviteError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626', marginBottom: 10 }}>
              <AlertTriangle size={13} /> {inviteError}
            </div>
          )}

          {/* Help text */}
          <p style={{ fontSize: 11, color: '#6a9fd4', marginBottom: 10, marginTop: 0 }}>
            They'll receive an invite they can accept or decline.
          </p>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#c4dff5' }} />
            <span style={{ fontSize: 11, color: '#8ab8d6', fontWeight: 600 }}>or share link</span>
            <div style={{ flex: 1, height: 1, background: '#c4dff5' }} />
          </div>

          {/* Copy link */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={inviteUrl} onClick={e => e.target.select()}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #2563eb44', background: '#fff', fontSize: 11, fontFamily: 'monospace', color: '#2563eb', outline: 'none' }} />
            <button className="btn btn-sm btn-teal" onClick={handleCopy} style={{ flexShrink: 0 }}>
              {copied ? <><CheckIcon size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
            They open the link, sign in with Microsoft, and join automatically as a fallback.
          </p>
        </div>
      )}

      {/* ── Delete confirmation ───────────────────────────────────────────────── */}
      {showDelete && (
        <div style={{ padding: '14px 18px', background: '#fff5f5', borderBottom: expanded ? '1px solid #e2e8f0' : 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} color="#dc2626" />
          <span style={{ flex: 1, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
            Delete "{workspace.name}"? This removes it for all members and cannot be undone.
          </span>
          <button onClick={() => setShowDelete(false)} disabled={deleting}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={handleDelete} disabled={deleting}
            style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {deleting ? 'Deleting…' : 'Yes, Delete'}
          </button>
        </div>
      )}

      {/* ── Expanded board content ────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ padding: '0 18px 18px' }}>
          <WorkspaceBoardContent
            workspaceId={workspace.id}
            members={members}
            showToast={showToast}
            user={user}
            workspaces={workspaces}
            onWorkspaceCreated={onWorkspaceCreated}
            showAddTaskInitial={showAddTask}
            onAddTaskClose={() => setShowAddTask(false)}
            isAdmin={isAdmin}
          />
        </div>
      )}
    </div>
  );
}

// ── Main KanbanBoard ──────────────────────────────────────────────────────────
export default function KanbanBoard({ onWorkspaceCreated, showToast }) {
  const { user } = useAuth();
  const { workspaces, loading: wsListLoading } = useMyWorkspaces();
  const [showNewTask, setShowNewTask] = useState(false);

  if (wsListLoading) {
    return <div className="empty-state fade-in"><p>Loading workspaces…</p></div>;
  }

  // Handler for AddTaskModal when creating from the header or empty state
  const handleTopLevelAdd = async (taskData, wsOptions) => {
    let wsId = wsOptions.targetWorkspaceId || workspaces[0]?.id || null;
    if (wsOptions.newWorkspaceName) {
      wsId = await createWorkspace(user.uid, user.email, user.displayName || user.email, wsOptions.newWorkspaceName);
      if (onWorkspaceCreated) await onWorkspaceCreated(wsId);
      if (showToast) showToast(`Workspace "${wsOptions.newWorkspaceName}" created!`, 'success');
    }
    if (wsId) {
      await addWorkspaceTask(wsId, taskData, { uid: user.uid, email: user.email, displayName: user.displayName || user.email });
      if (taskData.assigneeEmail) {
        notifyTaskAssigned({
          assigneeEmail: taskData.assigneeEmail,
          assigneeName:  taskData.assigneeName,
          taskText:      taskData.text,
          dueDate:       taskData.dueDate,
          priority:      taskData.priority,
          ownerName:     user.displayName || user.email,
          ownerUid:      user.uid,
        }).catch(() => {});
      }
    }
  };

  return (
    <div className="fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={20} color="#7c3aed" /> Team Board
        </h2>
        <button className="btn btn-teal" onClick={() => setShowNewTask(true)} style={{ gap: 5 }}>
          <Plus size={14} /> New Task
        </button>
      </div>

      {/* New Task modal */}
      {showNewTask && (
        <AddTaskModal
          onClose={() => setShowNewTask(false)}
          onAdd={handleTopLevelAdd}
          members={[]}
          workspaces={workspaces}
          showToast={showToast}
        />
      )}

      {/* Pending invite banners (auto-dismiss on accept/decline) */}
      <WorkspaceInvitePrompt showToast={showToast} />

      {/* Empty state when no workspaces */}
      {!workspaces.length && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <Briefcase size={40} color="#7c3aed" style={{ opacity: 0.5 }} />
          <p style={{ marginTop: 12, color: '#475569', fontSize: 15, fontWeight: 600 }}>No team board yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 340, lineHeight: 1.6, marginTop: 6 }}>
            Click <strong>New Task</strong> above to create your first task and workspace.
          </p>
        </div>
      )}

      {/* Collapsible workspace list */}
      {workspaces.map((ws, i) => (
        <WorkspaceItem
          key={ws.id}
          workspace={ws}
          showToast={showToast}
          user={user}
          workspaces={workspaces}
          onWorkspaceCreated={onWorkspaceCreated}
          isFirst={i === 0}
        />
      ))}
    </div>
  );
}
