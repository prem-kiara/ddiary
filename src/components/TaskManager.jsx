import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Plus, Bell, Calendar, CheckSquare, Edit2, Check, X,
  User, Link, Mail, MessageCircle, ChevronDown, ChevronRight,
  CheckCircle, UserPlus, Send, ArrowUpRight, Clock,
} from 'lucide-react';
import { formatDate, isOverdue, isDueToday, toDateInputValue, formatShortStamp, elapsedSince } from '../utils/dates';
import { useAuth } from '../contexts/AuthContext';
import { useUserDirectory } from '../hooks/useFirestore';
import TaskCollabPanel, { StatusBadge } from './TaskCollabPanel';
import { useTaskComments } from '../hooks/useFirestore';
import {
  useMyWorkspaces, useWorkspace,
  addWorkspaceTask, addWorkspaceMember,
  createWorkspaceInvite, getExistingInvite,
} from '../hooks/useWorkspace';
import { notifyWorkspaceInvite, notifyTaskAssigned } from '../utils/emailNotifications';
import MemberAutocomplete from './shared/MemberAutocomplete';
import SectionHeader from './shared/SectionHeader';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';

// ── Helpers ───────────────────────────────────────────────────────────────────
const priorityColors = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

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
      background: '#7c3aed22', color: '#7c3aed',
      fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
    }}>
      💬 {comments.length}
    </span>
  );
}


// ── Move-to-Board sub-panel (needs its own hook for workspace members) ────────
//
// Props:
//   task            — the source task being moved
//   workspaces      — list of workspaces the user belongs to
//   orgAssignees    — merged org directory for the assignee picker
//   onDelete        — default "finalize" callback: deletes the source task
//                     (used when moving a Personal task)
//   onFinalize      — OPTIONAL override: when provided, called instead of
//                     onDelete(task.id) after the workspace task is created.
//                     Used by "Send to Team Board" from Assigned-to-Me so the
//                     source task gets annotated with movedToWorkspace instead
//                     of deleted (the source task isn't ours to delete).
//                     Receives the new workspace task ID as its first arg.
//   headerLabel     — OPTIONAL visual title override (default "Move to Team Board")
//   helpText        — OPTIONAL help copy override
//   showToast       — toast helper
//   onClose         — close callback
//   user            — current user
export function MoveToBoard({
  task, workspaces, orgAssignees,
  onDelete, onFinalize,
  headerLabel, helpText,
  showToast, onClose, user,
}) {
  const [selectedWsId, setSelectedWsId] = useState(workspaces[0]?.id || '');
  const { workspace: selectedWs, members: wsMembers } = useWorkspace(selectedWsId);
  const [moveStatus, setMoveStatus] = useState('open');
  // Selected assignee is tracked by email — works for both workspace members
  // (who have UIDs) and M365 org users (who don't, until they sign in).
  const [moveAssigneeEmail, setMoveAssigneeEmail] = useState(user?.email?.toLowerCase() || '');
  const [moveCategoryId, setMoveCategoryId] = useState('');
  const [moveSubcategoryId, setMoveSubcategoryId] = useState('');
  const [movePriority, setMovePriority] = useState('medium');
  const [moveDue, setMoveDue] = useState('');
  // Notes/comments that will be carried onto the workspace task so the team
  // sees the context for why it was moved. Seeded from any existing notes on
  // the source task — user can edit or clear before moving.
  const [moveNotes, setMoveNotes] = useState(task.notes || '');
  const [moveSaving, setMoveSaving] = useState(false);

  const categories = selectedWs?.categories || [];
  const activeSubs = categories.find(c => c.id === moveCategoryId)?.subcategories || [];

  // ── Merge workspace members (already joined) with the full org directory.
  // Workspace members come first (they're the fastest path — they can already
  // see the task). Org users come after, deduped by email. Members are marked
  // so the UI can show a subtle "(workspace member)" hint.
  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const m of (wsMembers || [])) {
      const key = m.email?.toLowerCase();
      if (!key || key.startsWith('pending_')) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        email: key,
        name:  m.displayName || m.email,
        isMember: true,
      });
    }
    for (const p of (orgAssignees || [])) {
      const key = p.email?.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ email: key, name: p.name || p.email, isMember: false });
    }
    // Always ensure "Me" is present (edge case: user isn't yet in the workspace).
    const myKey = user?.email?.toLowerCase();
    if (myKey && !seen.has(myKey)) {
      list.unshift({ email: myKey, name: user.displayName || user.email, isMember: false });
    }
    return list;
  }, [wsMembers, orgAssignees, user]);

  // Pre-fill assignee when workspace changes; reset category picker.
  // Preference: existing task assignee (if they're in the dropdown) → current user.
  useEffect(() => {
    if (!assigneeOptions.length) return;
    const taskEmail = task.assigneeEmail?.toLowerCase();
    const matched = taskEmail && assigneeOptions.find(o => o.email === taskEmail);
    const me      = user?.email?.toLowerCase();
    setMoveAssigneeEmail(matched?.email || me || assigneeOptions[0]?.email || '');
    setMoveCategoryId('');
    setMoveSubcategoryId('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWsId, assigneeOptions.length]);

  // If user switches category, reset the sub-category selection.
  useEffect(() => { setMoveSubcategoryId(''); }, [moveCategoryId]);

  const handleMove = async () => {
    if (!selectedWsId) return;
    if (!moveAssigneeEmail) {
      showToast('Please pick an assignee before moving to Team Board.', 'warning');
      return;
    }
    setMoveSaving(true);
    try {
      const chosen       = assigneeOptions.find(o => o.email === moveAssigneeEmail);
      const wsMember     = wsMembers?.find(m => m.email?.toLowerCase() === moveAssigneeEmail);
      const assigneeName = chosen?.name || wsMember?.displayName || moveAssigneeEmail.split('@')[0];
      const isSelf       = moveAssigneeEmail === user?.email?.toLowerCase();
      const ownerName    = user.displayName || user.email;
      const wsName       = selectedWs?.name || workspaces.find(w => w.id === selectedWsId)?.name || 'workspace';

      // ── If the picked assignee isn't a workspace member yet, pre-create a
      //    pending_* placeholder member doc so:
      //      (a) Firestore rules let them read the task once they sign in
      //      (b) claimPendingMemberships() swaps the placeholder for their real UID
      //    + create a proper workspace invite doc and email the invite.
      let sentInviteEmail = false;
      if (!wsMember) {
        const safe = moveAssigneeEmail.replace(/[^a-zA-Z0-9]/g, '_');
        await addWorkspaceMember(selectedWsId, {
          uid:         `pending_${safe}`,
          email:       moveAssigneeEmail,
          displayName: assigneeName,
          role:        'member',
        });

        // Create a workspace invite — skip if one is already pending.
        try {
          const existing = await getExistingInvite(selectedWsId, moveAssigneeEmail);
          if (!existing || existing.status !== 'pending') {
            await createWorkspaceInvite({
              workspaceId:   selectedWsId,
              workspaceName: wsName,
              inviterUid:    user.uid,
              inviterEmail:  user.email,
              inviterName:   ownerName,
              inviteeEmail:  moveAssigneeEmail,
            });
          }
        } catch (inviteErr) { /* non-fatal — move still proceeds */ console.warn('createWorkspaceInvite failed', inviteErr); }

        // Send the invite email (best-effort).
        if (!isSelf) {
          try {
            await notifyWorkspaceInvite({
              inviteeEmail: moveAssigneeEmail,
              inviteeName:  assigneeName,
              inviterName:  ownerName,
              workspaceName: wsName,
              inviteUrl:    `${window.location.origin}?workspace=${selectedWsId}`,
            });
            sentInviteEmail = true;
          } catch (mailErr) { console.warn('notifyWorkspaceInvite failed', mailErr); }
        }
      }

      // ── Add the task.
      const newTaskRef = await addWorkspaceTask(selectedWsId, {
        text:          task.text,
        notes:         moveNotes?.trim() || null,
        status:        moveStatus,
        priority:      movePriority || 'medium',
        dueDate:       moveDue ? new Date(moveDue).toISOString() : null,
        // Only set a UID when the assignee is already a real member (pending_* UIDs
        // aren't real Firebase UIDs, so we leave assigneeUid null and let the
        // collectionGroup query match by email instead).
        assigneeUid:   (wsMember && !wsMember.uid?.startsWith('pending_')) ? wsMember.uid : null,
        assigneeEmail: moveAssigneeEmail,
        assigneeName:  assigneeName,
        categoryId:    moveCategoryId    || null,
        subcategoryId: moveSubcategoryId || null,
      }, {
        uid:         user.uid,
        email:       user.email,
        displayName: ownerName,
      });

      // ── Notify the assignee about the new task (skip when assigning to self).
      //    If we already sent an invite email, the invite email itself covers it;
      //    otherwise send the dedicated task-assigned email.
      if (!isSelf && !sentInviteEmail) {
        try {
          await notifyTaskAssigned({
            assigneeEmail: moveAssigneeEmail,
            assigneeName:  assigneeName,
            taskText:      task.text,
            dueDate:       moveDue || null,
            priority:      movePriority || 'medium',
            ownerName:     ownerName,
            ownerUid:      user.uid,
          });
        } catch (mailErr) { console.warn('notifyTaskAssigned failed', mailErr); }
      }

      // Finalize the source task: custom callback if caller supplied one
      // (e.g. annotate 'movedToWorkspace' when the source is in someone
      // else's collection), otherwise default to delete.
      if (onFinalize) {
        await onFinalize(task.id, {
          workspaceId:   selectedWsId,
          workspaceName: wsName,
          workspaceTaskId: newTaskRef?.id || null,
        });
      } else {
        await onDelete(task.id);
      }
      showToast(
        !wsMember && !isSelf
          ? `Task moved and invite sent to ${assigneeName}!`
          : 'Task moved to Team Board!',
        'success'
      );
    } catch (e) {
      console.error(e);
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied — redeploy Firestore rules.'
        : (e?.message || 'Please try again.');
      showToast(`Failed to move task. ${detail}`, 'warning');
      setMoveSaving(false);
    }
  };

  const selStyle = { width: '100%', height: 40, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', background: '#ffffff', color: '#0f172a', outline: 'none' };

  return (
    <div style={{ padding: '0 12px 14px' }}>
      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
      <div style={{ background: '#eff6ff', border: '1px solid #2563eb44', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#2563eb', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowUpRight size={14} /> {headerLabel || 'Move to Team Board'}
        </div>
        <p style={{ fontSize: 12, color: '#0f172a', marginBottom: 12, lineHeight: 1.5 }}>
          {helpText || 'This task will be removed from My Tasks and added to the Team Board Kanban.'}
        </p>

        {/* Workspace picker (only when more than one option) */}
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

        {/* Category + Sub-category (only if the workspace has categories) */}
        {categories.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label className="label">Category</label>
              <select value={moveCategoryId} onChange={e => setMoveCategoryId(e.target.value)} style={selStyle}>
                <option value="">Uncategorised</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Sub-category</label>
              <select
                value={moveSubcategoryId}
                onChange={e => setMoveSubcategoryId(e.target.value)}
                style={selStyle}
                disabled={!moveCategoryId || activeSubs.length === 0}
              >
                <option value="">{moveCategoryId ? (activeSubs.length ? '— None —' : 'No sub-categories') : 'Pick a category first'}</option>
                {activeSubs.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Status + Assignee */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="label">Status</label>
            <select value={moveStatus} onChange={e => setMoveStatus(e.target.value)} style={selStyle}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label className="label">
              Assign to <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              value={moveAssigneeEmail}
              onChange={e => setMoveAssigneeEmail(e.target.value)}
              style={{
                ...selStyle,
                borderColor: moveAssigneeEmail ? '#cbd5e1' : '#dc262688',
              }}
              required
            >
              {!moveAssigneeEmail && <option value="" disabled>— Pick someone —</option>}
              {assigneeOptions.map(o => {
                const isMe = o.email === user?.email?.toLowerCase();
                return (
                  <option key={o.email} value={o.email}>
                    {isMe ? `Me (${o.name})` : o.name}
                    {!o.isMember && !isMe ? ' — will be invited' : ''}
                  </option>
                );
              })}
            </select>
            {moveAssigneeEmail && !assigneeOptions.find(o => o.email === moveAssigneeEmail)?.isMember && moveAssigneeEmail !== user?.email?.toLowerCase() && (
              <p style={{ fontSize: 11, color: '#7c3aed', marginTop: 4, lineHeight: 1.4 }}>
                They'll be added to this workspace so they can see the task.
              </p>
            )}
          </div>
        </div>

        {/* Priority + Due date */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label className="label">Priority</label>
            <select value={movePriority} onChange={e => setMovePriority(e.target.value)} style={selStyle}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" value={moveDue} onChange={e => setMoveDue(e.target.value)} style={selStyle} />
          </div>
        </div>

        {/* Notes / comments — carried onto the workspace task so the team
            sees context for why this was moved. Optional. */}
        <div style={{ marginBottom: 12 }}>
          <label className="label">
            Notes <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional — shown on the Team Board card)</span>
          </label>
          <textarea
            value={moveNotes}
            onChange={e => setMoveNotes(e.target.value)}
            rows={3}
            placeholder="Add any context or comments for the team…"
            style={{
              width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
              borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)',
              background: '#ffffff', color: '#0f172a',
              resize: 'vertical', minHeight: 64, outline: 'none',
              boxSizing: 'border-box', lineHeight: 1.5,
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onClose}>
            <X size={13} /> Cancel
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: '#2563eb', color: '#fff', border: 'none',
              opacity: (!moveAssigneeEmail || moveSaving) ? 0.5 : 1,
              cursor:  (!moveAssigneeEmail || moveSaving) ? 'not-allowed' : 'pointer',
            }}
            onClick={handleMove}
            disabled={moveSaving || !moveAssigneeEmail}
            title={!moveAssigneeEmail ? 'Pick an assignee first' : undefined}
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
  workspaces, hasWorkspace, orgAssignees,
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
    padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 14, fontFamily: 'var(--font-body)', background: '#ffffff',
    color: '#0f172a', outline: 'none',
  };

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${overdue ? '#dc262644' : '#e2e8f0'}`,
      marginBottom: 8,
      boxShadow: expanded ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
    }}>
      {/* ── Header row (always visible) ───────────────────────────────── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', cursor: 'pointer', userSelect: 'none',
          background: task.completed ? '#f9f6f0' : expanded ? '#ffffff' : '#fff',
          borderLeft: `3px solid ${overdue ? '#dc2626' : priorityColors[task.priority] || '#d97706'}`,
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
              color: task.completed ? '#94a3b8' : overdue ? '#dc2626' : '#0f172a',
              textDecoration: task.completed ? 'line-through' : 'none',
            }}>
              {task.text}
            </span>
            {task.status && task.status !== 'open' && <StatusBadge status={task.status} />}
            <CommentBadge ownerUid={ownerUid} taskId={task.id} />
            {isLinked && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#e8f8f5', color: '#7c3aed',
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                border: '1px solid #7c3aed44',
              }}>
                <Link size={9} /> Linked
              </span>
            )}
            {/* Shown on the owner's card when the assignee has pushed this
                task onto a Team Board. Keeps the owner aware that the task
                is now being tracked on the shared Kanban — click the card to
                read the activity log for details. */}
            {task.movedToWorkspace && (
              <span
                title={`Moved by ${task.movedToWorkspace.movedByName || 'assignee'} on ${
                  task.movedToWorkspace.movedAt ? new Date(task.movedToWorkspace.movedAt).toLocaleDateString() : 'an earlier date'
                }`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#eff6ff', color: '#2563eb',
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  border: '1px solid #2563eb44',
                }}
              >
                <ArrowUpRight size={9} /> Moved to {task.movedToWorkspace.workspaceName || 'Team Board'}
              </span>
            )}
          </div>
          {/* Meta: due date + assignee + created stamp */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2, alignItems: 'center' }}>
            {task.dueDate && (
              <span className={`task-due ${overdue ? 'overdue' : ''}`} style={{ fontSize: 12, margin: 0 }}>
                <Calendar size={11} />
                {overdue ? 'Was due:' : dueToday ? 'Due today:' : 'Due:'} {formatDate(task.dueDate)}
                {overdue  && <span className="overdue-badge">OVERDUE</span>}
                {dueToday && !overdue && <span className="overdue-badge" style={{ background: '#d97706' }}>TODAY</span>}
              </span>
            )}
            {assignee && (
              <span style={{ fontSize: 12, color: isLinked ? '#7c3aed' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <User size={11} /> {assignee}
              </span>
            )}
            {task.createdAt && (
              <span
                title={`Created ${formatShortStamp(task.createdAt)}`}
                style={{
                  fontSize: 11, color: '#94a3b8',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}
              >
                <Clock size={10} />
                <span>{formatShortStamp(task.createdAt)}</span>
                {!task.completed && (
                  <span style={{ color: '#7c3aed', fontWeight: 600, marginLeft: 2 }}>
                    · {elapsedSince(task.createdAt)} open
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        <span style={{ color: '#475569', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </div>

      {/* ── Expanded area ─────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>

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
                style={{ background: '#15803d', color: '#fff', border: 'none', marginLeft: 'auto' }}
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
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
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
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>
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
                <label className="label">Schedule Send Time <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional — reminder note)</span></label>
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
              <div style={{ height: 1, background: '#e2e8f0', marginBottom: 4 }} />
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
              orgAssignees={orgAssignees}
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

  // ── Add form state (personal tasks — text-only) ─────────────────────────
  const [newText, setNewText] = useState('');

  // ── Section collapse state ──────────────────────────────────────────────
  const [personalOpen, setPersonalOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);

  const memberByEmail = (email) => assigneeOptions.find(m => m.email?.toLowerCase() === email?.toLowerCase());

  // ── Derived lists ───────────────────────────────────────────────────────
  // Single flat list for open tasks (no Overdue/Pending split).
  // Overdue items sort first, then others by due date asc (no-due at end).
  const openTasks = tasks
    .filter(t => !t.completed)
    .sort((a, b) => {
      const ao = isOverdue(a.dueDate) ? 0 : 1;
      const bo = isOverdue(b.dueDate) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
  const completedTasks = tasks
    .filter(t => t.completed)
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
  const completedCount = completedTasks.length;

  // ── Add task (personal — minimal payload) ──────────────────────────────
  const handleAdd = async () => {
    if (!newText.trim()) return;
    try {
      await onAdd({
        text:     newText.trim(),
        dueDate:  null,
        priority: 'medium',
      });
      setNewText('');
      showToast('Task added!', 'success');
    } catch { showToast('Failed to add task', 'warning'); }
  };

  const inputStyle = {
    WebkitAppearance: 'none', appearance: 'none',
    width: '100%', height: 48, padding: '0 12px',
    border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 15, fontFamily: 'var(--font-body)',
    background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none',
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;

  const taskCardProps = {
    members, directory, onToggle, onUpdate, onDelete, showToast, ownerUid: user?.uid,
    workspaces,
    hasWorkspace:     workspaces.length > 0,
    orgAssignees:     assigneeOptions,
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Tasks & To-Dos</h2>

      {/* ── Add task form (personal — text only) ──────────────────────── */}
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
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}>
          <User size={12} /> Personal task. Need to assign it or pin a due date? Add it and click <strong>Team&nbsp;Board</strong> on the task card to move it over.
        </p>
        <button className="btn btn-gold" onClick={handleAdd} style={{ width: '100%', justifyContent: 'center' }}>
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* ── Personal Tasks (open items) ─────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <SectionHeader
          open={personalOpen} onToggle={() => setPersonalOpen(o => !o)}
          icon={<User size={16} />} label="Personal Tasks" count={openTasks.length} color="#7c3aed"
        />
        {personalOpen && (
          openTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: 24, borderTop: '1px solid #e2e8f0' }}>
              <CheckCircle size={36} color="#15803d" />
              <p>All caught up! No pending tasks.</p>
            </div>
          ) : (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {openTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Done strip (collapsed by default) ───────────────────────────── */}
      {completedTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHeader
            open={doneOpen} onToggle={() => setDoneOpen(o => !o)}
            icon={<CheckCircle size={16} />} label="Done" count={completedCount} color="#15803d"
          />
          {doneOpen && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {completedTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button className="btn btn-sm btn-outline" onClick={onClearCompleted}>
                  Clear all {completedCount} done task{completedCount > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
