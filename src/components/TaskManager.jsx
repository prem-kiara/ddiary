import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Plus, Bell, Calendar, CheckSquare, Edit2, Check, X,
  User, Link, Mail, MessageCircle, ChevronDown, ChevronRight,
  Clock, CheckCircle, UserPlus, Send, AlertCircle, ArrowUpRight,
} from 'lucide-react';
import { formatDate, isOverdue, isDueToday, toDateInputValue } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { useUserDirectory } from '../hooks/useFirestore';
import TaskCollabPanel, { StatusBadge } from './TaskCollabPanel';
import { useTaskComments } from '../hooks/useFirestore';
import { useMyWorkspaces, useWorkspace, addWorkspaceTask } from '../hooks/useWorkspace';
import MemberAutocomplete from './shared/MemberAutocomplete';
import SectionHeader from './shared/SectionHeader';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';

// ── Helpers ───────────────────────────────────────────────────────────────────
const priorityColors = { high: '#c0392b', medium: '#e67e22', low: '#27ae60' };

function formatWhatsAppPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  return digits;
}

// ── Comment count badge ────────────────────────────────────────────────────────
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


// ── Move-to-Board sub-panel (needs its own hook for workspace members) ────────
function MoveToBoard({ task, workspaces, onDelete, showToast, onClose, user }) {
  const [selectedWsId, setSelectedWsId] = useState(workspaces[0]?.id || '');
  const { members: wsMembers } = useWorkspace(selectedWsId);
  const [moveStatus, setMoveStatus] = useState('open');
  const [moveAssignee, setMoveAssignee] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);

  // Pre-fill assignee when workspace changes
  useEffect(() => {
    const matched = wsMembers?.find(
      m => m.email?.toLowerCase() === task.assigneeEmail?.toLowerCase()
    );
    setMoveAssignee(matched?.uid || '');
  }, [selectedWsId, wsMembers, task.assigneeEmail]);

  const handleMove = async () => {
    if (!selectedWsId) return;
    setMoveSaving(true);
    try {
      const wsAssignee = wsMembers?.find(m => m.uid === moveAssignee);
      await addWorkspaceTask(selectedWsId, {
        text:          task.text,
        status:        moveStatus,
        priority:      task.priority || 'medium',
        dueDate:       task.dueDate  || null,
        assigneeUid:   wsAssignee?.uid   || null,
        assigneeEmail: wsAssignee?.email?.toLowerCase() || null,
        assigneeName:  wsAssignee?.displayName || null,
      }, {
        uid:         user.uid,
        email:       user.email,
        displayName: user.displayName || user.email,
      });
      await onDelete(task.id);
      showToast('Task moved to Team Board!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to move task. Please try again.', 'warning');
      setMoveSaving(false);
    }
  };

  const selStyle = { width: '100%', height: 40, padding: '0 10px', border: '1px solid #d4c5a9', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', background: '#fffdf5', color: '#4a3728', outline: 'none' };

  return (
    <div style={{ padding: '0 12px 14px' }}>
      <div style={{ height: 1, background: '#f0e6d2', marginBottom: 12 }} />
      <div style={{ background: '#eaf4fb', border: '1px solid #2980b944', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#2980b9', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowUpRight size={14} /> Move to Team Board
        </div>
        <p style={{ fontSize: 12, color: '#4a3728', marginBottom: 12, lineHeight: 1.5 }}>
          This task will be removed from My Tasks and added to the Team Board Kanban.
        </p>
        {workspaces.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <label className="label">Workspace</label>
            <select value={selectedWsId} onChange={e => { setSelectedWsId(e.target.value); setMoveAssignee(''); }} style={selStyle}>
              {workspaces.map(ws => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="label">Column</label>
            <select value={moveStatus} onChange={e => setMoveStatus(e.target.value)} style={selStyle}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label className="label">Assign to</label>
            <select value={moveAssignee} onChange={e => setMoveAssignee(e.target.value)} style={selStyle}>
              <option value="">Unassigned</option>
              {(wsMembers || []).map(m => (
                <option key={m.uid} value={m.uid}>
                  {m.displayName || m.email}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button
            className="btn btn-sm"
            style={{ background: '#2980b9', color: '#fff', border: 'none' }}
            onClick={handleMove}
            disabled={moveSaving}
          >
            {moveSaving ? 'Moving…' : <><ArrowUpRight size={13} /> Move to Team Board</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Individual task card ───────────────────────────────────────────────────────
function TaskCard({
  task, members, directory,
  onToggle, onUpdate, onDelete,
  showToast, ownerUid,
  workspaces, hasWorkspace,
}) {
  const { user } = useAuth();
  const overdue   = !task.completed && isOverdue(task.dueDate);
  const dueToday  = !task.completed && isDueToday(task.dueDate);
  const assignee  = task.assigneeName || (task.assigneeEmail ? task.assigneeEmail.split('@')[0] : null);
  const isLinked  = !!task.assigneeUid;
  const hasAssignee = task.assigneeEmail || task.assigneePhone;

  // Expand / collapse
  const [expanded,    setExpanded]    = useState(false);
  // Which panel is open inside the expanded area
  const [panel,       setPanel]       = useState(null); // 'edit' | 'assign' | 'collab' | 'move'

  // Edit state
  const [editText,     setEditText]     = useState(task.text);
  const [editDue,      setEditDue]      = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [editPriority, setEditPriority] = useState(task.priority || 'medium');
  const [editAssignee, setEditAssignee] = useState(task.assigneeEmail || '');
  const [editSaving,   setEditSaving]   = useState(false);

  // Assign panel state
  const [assignName,    setAssignName]    = useState(task.assigneeName  || '');
  const [assignEmail,   setAssignEmail]   = useState(task.assigneeEmail || '');
  const [assignPhone,   setAssignPhone]   = useState(task.assigneePhone || '');
  const [scheduleTime,  setScheduleTime]  = useState(task.scheduledEmailTime || '');
  const [selectedMember, setSelectedMember] = useState(null);
  const [assignSaving,  setAssignSaving]  = useState(false);

  const memberByEmail = (email) => members.find(m => m.email?.toLowerCase() === email?.toLowerCase());

  const openPanel = (p) => {
    if (panel === p) { setPanel(null); return; }
    // Reset state when switching panels
    if (p === 'edit') {
      setEditText(task.text);
      setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : '');
      setEditPriority(task.priority || 'medium');
      setEditAssignee(task.assigneeEmail || '');
    }
    if (p === 'assign') {
      setAssignName(task.assigneeName || '');
      setAssignEmail(task.assigneeEmail || '');
      setAssignPhone(task.assigneePhone || '');
      setScheduleTime(task.scheduledEmailTime || '');
      setSelectedMember(null);
    }
    setPanel(p);
    setExpanded(true);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setEditSaving(true);
    const m = memberByEmail(editAssignee);
    try {
      await onUpdate(task.id, {
        text:          editText.trim(),
        dueDate:       editDue ? new Date(editDue).toISOString() : null,
        priority:      editPriority,
        assigneeEmail: m?.email || (editAssignee.includes('@') ? editAssignee : null),
        assigneeName:  m?.name  || null,
        assigneePhone: m?.phone || null,
      });
      showToast('Task updated!', 'success');
      setPanel(null);
    } catch { showToast('Failed to update', 'warning'); }
    setEditSaving(false);
  };

  const handleSaveAssign = async () => {
    if (!assignEmail.trim() && !assignPhone.trim()) {
      showToast('Please enter an email or phone number.', 'warning'); return;
    }
    setAssignSaving(true);
    const emailKey = assignEmail.trim().toLowerCase();
    const linked   = selectedMember || members.find(m => m.email?.toLowerCase() === emailKey);
    const dirEntry = directory.find(d => d.email?.toLowerCase() === emailKey);
    const assigneeUid = linked?.uid || dirEntry?.uid || null;
    try {
      await onUpdate(task.id, {
        assigneeName:       assignName.trim(),
        assigneeEmail:      emailKey,
        assigneePhone:      assignPhone.trim(),
        scheduledEmailTime: scheduleTime || null,
        assigneeUid,
      });
      showToast(assigneeUid ? "Assigned! They'll see this in their dashboard." : 'Assignment saved!', 'success');
      setPanel(null);
    } catch { showToast('Failed to save assignment.', 'warning'); }
    setAssignSaving(false);
  };

  const handleEmail = () => {
    if (!task.assigneeEmail) { showToast('No email set for this task.', 'warning'); return; }
    const from    = user?.displayName || user?.email || 'Your manager';
    const due     = task.dueDate ? `\nDue: ${formatDate(task.dueDate)}` : '';
    const pri     = task.priority ? `\nPriority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const subject = `Task: ${task.text}`;
    const body    = `Hi ${task.assigneeName || task.assigneeEmail.split('@')[0]},\n\nYou have been assigned the following task:\n\n📋 ${task.text}${due}${pri}\n\nPlease action this at your earliest convenience.\n\nRegards,\n${from}`;
    window.location.href = `mailto:${task.assigneeEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showToast('Opening email app…', 'success');
  };

  const handleWhatsApp = () => {
    if (!task.assigneePhone) { showToast('No phone number set for this task.', 'warning'); return; }
    const phone = formatWhatsAppPhone(task.assigneePhone);
    const from  = user?.displayName || 'Your manager';
    const due   = task.dueDate ? `\n📅 Due: ${formatDate(task.dueDate)}` : '';
    const pri   = task.priority ? `\n⚡ Priority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
    const msg   = `Hi ${task.assigneeName || 'there'},\n\nYou have been assigned a task:\n\n📋 *${task.text}*${due}${pri}\n\nPlease action this at your earliest convenience.\n\n— ${from}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const inputStyle = {
    WebkitAppearance: 'none', appearance: 'none',
    width: '100%', boxSizing: 'border-box', height: 44,
    padding: '0 12px', border: '1px solid #d4c5a9', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#fffdf5',
    color: '#4a3728', outline: 'none',
  };

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${overdue ? '#c0392b44' : '#e8d5b7'}`,
      marginBottom: 8,
      boxShadow: expanded ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
    }}>
      {/* ── Header row (always visible) ───────────────────────────────── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', cursor: 'pointer', userSelect: 'none',
          background: task.completed ? '#f9f6f0' : expanded ? '#fffdf5' : '#fff',
          borderLeft: `3px solid ${overdue ? '#c0392b' : priorityColors[task.priority] || '#e67e22'}`,
        }}
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          className="task-checkbox"
          checked={task.completed}
          onChange={e => { e.stopPropagation(); onToggle(task.id, task.completed); }}
          style={{ flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 14, lineHeight: 1.4,
              color: task.completed ? '#b5a898' : overdue ? '#c0392b' : '#4a3728',
              textDecoration: task.completed ? 'line-through' : 'none',
            }}>
              {task.text}
            </span>
            {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
            <CommentBadge ownerUid={ownerUid} taskId={task.id} />
            {isLinked && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#e8f8f5', color: '#2a9d8f',
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                border: '1px solid #2a9d8f44',
              }}>
                <Link size={9} /> Linked
              </span>
            )}
          </div>
          {/* Meta: due date + assignee */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
            {task.dueDate && (
              <span className={`task-due ${overdue ? 'overdue' : ''}`} style={{ fontSize: 12, margin: 0 }}>
                <Calendar size={11} />
                {overdue ? 'Was due:' : dueToday ? 'Due today:' : 'Due:'} {formatDate(task.dueDate)}
                {overdue  && <span className="overdue-badge">OVERDUE</span>}
                {dueToday && !overdue && <span className="overdue-badge" style={{ background: '#e67e22' }}>TODAY</span>}
              </span>
            )}
            {assignee && (
              <span style={{ fontSize: 12, color: isLinked ? '#2a9d8f' : '#8a7a6a', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <User size={11} /> {assignee}
              </span>
            )}
          </div>
        </div>

        <span style={{ color: '#8a7a6a', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </div>

      {/* ── Expanded area ─────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #f0e6d2', background: '#fffdf8' }}>

          {/* Action buttons row */}
          {!task.completed && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 12px 8px' }}>
              {task.assigneeEmail && (
                <button className="btn btn-sm btn-blue" onClick={handleEmail}>
                  <Mail size={12} /> Email Now
                </button>
              )}
              {task.assigneePhone && (
                <button className="btn btn-sm" style={{ background: '#25D366', color: '#fff', border: 'none' }} onClick={handleWhatsApp}>
                  <MessageCircle size={12} /> WhatsApp
                </button>
              )}
              <button
                className={`btn btn-sm ${panel === 'assign' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('assign')}
              >
                {hasAssignee ? <Edit2 size={12} /> : <UserPlus size={12} />}
                {hasAssignee ? 'Edit Assign' : 'Assign'}
              </button>
              <button
                className={`btn btn-sm ${panel === 'edit' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('edit')}
              >
                <Edit2 size={12} /> Edit
              </button>
              <button
                className={`btn btn-sm ${panel === 'collab' ? 'btn-teal' : 'btn-outline'}`}
                onClick={() => openPanel('collab')}
              >
                💬 Comments
              </button>
              {hasWorkspace && (
                <button
                  className={`btn btn-sm ${panel === 'move' ? 'btn-teal' : 'btn-outline'}`}
                  onClick={() => openPanel('move')}
                  title="Move this task to the Team Board"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <ArrowUpRight size={12} /> Team Board
                </button>
              )}
              <button
                className="btn btn-sm"
                style={{ background: '#27ae60', color: '#fff', border: 'none', marginLeft: 'auto' }}
                onClick={() => onToggle(task.id, false)}
              >
                <CheckCircle size={12} /> Done
              </button>
            </div>
          )}

          {task.completed && (
            <div style={{ padding: '8px 12px' }}>
              <button className="btn btn-sm btn-outline" onClick={() => onToggle(task.id, true)}>
                ↩ Mark Incomplete
              </button>
            </div>
          )}

          {/* ── Edit panel ──────────────────────────────────────────── */}
          {panel === 'edit' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#f0e6d2', marginBottom: 12 }} />
              <textarea
                className="textarea"
                rows={2}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                style={{ minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 10, fontFamily: 'var(--font-body)', fontSize: 14, backgroundImage: 'none', lineHeight: 1.6 }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" value={editDue} onChange={e => setEditDue(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select value={editPriority} onChange={e => setEditPriority(e.target.value)} style={inputStyle}>
                    <option value="high">🔴 High</option>
                    <option value="medium">🟡 Medium</option>
                    <option value="low">🟢 Low</option>
                  </select>
                </div>
              </div>
              {members.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Assign to</label>
                  <select value={editAssignee} onChange={e => setEditAssignee(e.target.value)} style={inputStyle}>
                    <option value="">— No assignee —</option>
                    {members.map(m => <option key={m.id} value={m.email || m.id}>{m.name}{m.email ? ` (${m.email})` : ''}{m.uid ? ' ✓' : ''}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setPanel(null)}><X size={13} /> Cancel</button>
                <button className="btn btn-sm btn-teal" onClick={handleSaveEdit} disabled={editSaving}><Check size={13} /> {editSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}

          {/* ── Assign panel ──────────────────────────────────────── */}
          {panel === 'assign' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#f0e6d2', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', marginBottom: 10 }}>
                Assign Task — type a name to search your team
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="label">Name</label>
                  <MemberAutocomplete
                    value={assignName}
                    onChange={setAssignName}
                    onSelect={m => { setSelectedMember(m); setAssignName(m.name); setAssignEmail(m.email || ''); setAssignPhone(m.phone || ''); }}
                    members={members}
                    placeholder="Search team…"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="email@company.com" value={assignEmail} onChange={e => setAssignEmail(e.target.value)} style={{ fontSize: 14 }} />
                </div>
                <div>
                  <label className="label">WhatsApp</label>
                  <input className="input" placeholder="e.g. 7305013582" value={assignPhone} onChange={e => setAssignPhone(e.target.value)} style={{ fontSize: 14 }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Schedule Send Time <span style={{ fontWeight: 400, color: '#b5a898' }}>(optional — reminder note)</span></label>
                <input type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" onClick={() => setPanel(null)}><X size={13} /> Cancel</button>
                <button className="btn btn-sm btn-teal" onClick={handleSaveAssign} disabled={assignSaving}>
                  {assignSaving ? 'Saving…' : 'Save Assignment'}
                </button>
              </div>
            </div>
          )}

          {/* ── Collab / Comments panel ────────────────────────────── */}
          {panel === 'collab' && (
            <div style={{ padding: '0 12px 14px' }}>
              <div style={{ height: 1, background: '#f0e6d2', marginBottom: 4 }} />
              <TaskCollabPanel
                ownerUid={ownerUid}
                task={task}
                onClose={() => setPanel(null)}
                canChangeStatus
              />
            </div>
          )}

          {/* ── Move to Team Board panel ───────────────────────────── */}
          {panel === 'move' && (
            <MoveToBoard
              task={task}
              workspaces={workspaces}
              onDelete={onDelete}
              showToast={showToast}
              onClose={() => setPanel(null)}
              user={user}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TaskManager({
  tasks, members = [], loading,
  onAdd, onToggle, onUpdate, onDelete, onClearCompleted, showToast,
}) {
  const { user } = useAuth();
  const { directory } = useUserDirectory(user?.uid);
  const { workspaces } = useMyWorkspaces();
  const firstWs = workspaces[0] || null;

  // ── Org users from M365 ─────────────────────────────────────────────────
  const [orgUsers, setOrgUsers] = useState([]);
  useEffect(() => {
    fetchAllOrgUsers().then(users => setOrgUsers(users || [])).catch(() => {});
  }, []);

  // Merged assignee list: Firestore members (have UIDs) + M365 org users, deduped by email
  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const combined = [];
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push({ email: m.email, name: m.name, uid: m.uid || null, phone: m.phone || null });
      }
    }
    for (const u of orgUsers) {
      const key = u.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push({ email: u.email, name: u.displayName, uid: null, phone: u.phone || null });
      }
    }
    return combined;
  }, [members, orgUsers]);

  // ── Add form state ──────────────────────────────────────────────────────
  const [newText,     setNewText]     = useState('');
  const [newDue,      setNewDue]      = useState(toDateInputValue());
  const [newPriority, setNewPriority] = useState('high');
  const [newAssignee, setNewAssignee] = useState('');

  // ── Section collapse state ──────────────────────────────────────────────
  const [overdueOpen,    setOverdueOpen]    = useState(true);
  const [pendingOpen,    setPendingOpen]    = useState(true);
  const [completedOpen,  setCompletedOpen]  = useState(false);

  const memberByEmail = (email) => assigneeOptions.find(m => m.email?.toLowerCase() === email?.toLowerCase());

  // ── Derived lists ───────────────────────────────────────────────────────
  const overdueTasks   = tasks.filter(t => !t.completed && isOverdue(t.dueDate));
  const pendingTasks   = tasks.filter(t => !t.completed && !isOverdue(t.dueDate));
  const completedTasks = tasks.filter(t => t.completed);
  const pendingCount   = tasks.filter(t => !t.completed).length;
  const completedCount = completedTasks.length;

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
      setNewText(''); setNewDue(toDateInputValue()); setNewPriority('high'); setNewAssignee('');
      showToast(m ? `Task assigned to ${m.name}!` : 'Task added!', 'success');
    } catch { showToast('Failed to add task', 'warning'); }
  };

  const inputStyle = {
    WebkitAppearance: 'none', appearance: 'none',
    width: '100%', height: 48, padding: '0 12px',
    border: '1px solid #d4c5a9', borderRadius: 8,
    fontSize: 15, fontFamily: 'var(--font-body)',
    background: '#fffdf5', color: '#4a3728',
    boxSizing: 'border-box', outline: 'none',
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;

  const taskCardProps = {
    members, directory, onToggle, onUpdate, onDelete, showToast, ownerUid: user?.uid,
    workspaces,
    hasWorkspace:     workspaces.length > 0,
  };

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
          style={{ minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 12, fontFamily: 'var(--font-body)', fontSize: 15, backgroundImage: 'none', lineHeight: 1.6 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label className="label">Due Date</label>
            <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">Priority</label>
            <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={inputStyle}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="label"><User size={12} style={{ display: 'inline', marginRight: 4 }} />Assign to</label>
          <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} style={inputStyle}>
            <option value="">— No assignee —</option>
            {assigneeOptions.map(m => (
              <option key={m.email} value={m.email}>
                {m.name}{m.email ? ` (${m.email})` : ''}
              </option>
            ))}
          </select>
          {newAssignee && memberByEmail(newAssignee)?.uid && (
            <p style={{ fontSize: 12, color: '#2a9d8f', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Link size={11} /> Linked — task will appear in their dashboard immediately.
            </p>
          )}
        </div>
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
          <div className="stat-number">{overdueTasks.length}</div>
          <div className="stat-label">Overdue</div>
        </div>
      </div>

      {/* ── Overdue section ────────────────────────────────────────────── */}
      {overdueTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #c0392b', marginBottom: 14 }}>
          <SectionHeader
            open={overdueOpen} onToggle={() => setOverdueOpen(o => !o)}
            icon={<AlertCircle size={16} />} label="Overdue" count={overdueTasks.length} color="#c0392b"
          />
          {overdueOpen && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f0e6d2' }}>
              <div style={{ marginTop: 12 }}>
                {overdueTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pending section ────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <SectionHeader
          open={pendingOpen} onToggle={() => setPendingOpen(o => !o)}
          icon={<Clock size={16} />} label="Pending" count={pendingTasks.length}
        />
        {pendingOpen && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f0e6d2' }}>
            {pendingTasks.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <CheckCircle size={36} color="#27ae60" />
                <p>All caught up! No pending tasks.</p>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {pendingTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Completed section ──────────────────────────────────────────── */}
      {completedTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHeader
            open={completedOpen} onToggle={() => setCompletedOpen(o => !o)}
            icon={<CheckCircle size={16} />} label="Completed" count={completedCount} color="#27ae60"
          />
          {completedOpen && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f0e6d2' }}>
              <div style={{ marginTop: 12 }}>
                {completedTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button className="btn btn-sm btn-outline" onClick={onClearCompleted}>
                  Clear all {completedCount} completed task{completedCount > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
