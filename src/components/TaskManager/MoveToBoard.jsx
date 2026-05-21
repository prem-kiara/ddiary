import { useState, useEffect, useMemo } from 'react';
import {
  X, ArrowUpRight, ChevronDown,
} from 'lucide-react';
import { useWorkspace } from '../../hooks/useWorkspace';
import {
  addWorkspaceTask, addWorkspaceMember,
  createWorkspaceInvite, getExistingInvite,
} from '../../hooks/useWorkspace';
import { notifyWorkspaceInvite, notifyTaskAssigned } from '../../utils/emailNotifications';

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
export default function MoveToBoard({
  task, workspaces, orgAssignees,
  onDelete, onFinalize,
  headerLabel, helpText,
  showToast, onClose, user,
}) {
  const [selectedWsId, setSelectedWsId] = useState(workspaces[0]?.id || '');
  const { workspace: selectedWs, members: wsMembers } = useWorkspace(selectedWsId);
  const [moveStatus, setMoveStatus] = useState('open');
  // Multi-assignee: array of emails. Primary = [0], co-assignees = rest.
  const [moveAssigneeEmails, setMoveAssigneeEmails] = useState(
    user?.email?.toLowerCase() ? [user.email.toLowerCase()] : []
  );
  const [moveAssigneePicker, setMoveAssigneePicker] = useState(false);
  const [moveAssigneeSearch, setMoveAssigneeSearch] = useState('');
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
    const primary = matched?.email || me || assigneeOptions[0]?.email || '';
    setMoveAssigneeEmails(primary ? [primary] : []);
    setMoveCategoryId('');
    setMoveSubcategoryId('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWsId, assigneeOptions.length]);

  // If user switches category, reset the sub-category selection.
  useEffect(() => { setMoveSubcategoryId(''); }, [moveCategoryId]);

  // Close assignee picker on outside click
  useEffect(() => {
    if (!moveAssigneePicker) return;
    const close = () => { setMoveAssigneePicker(false); setMoveAssigneeSearch(''); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moveAssigneePicker]);

  const handleMove = async () => {
    if (!selectedWsId) return;
    if (!moveAssigneeEmails.length) {
      showToast('Please pick an assignee before moving to Team Board.', 'warning');
      return;
    }
    setMoveSaving(true);
    try {
      const moveAssigneeEmail = moveAssigneeEmails[0];
      const coAssignees = moveAssigneeEmails.slice(1).map(email => {
        const o = assigneeOptions.find(x => x.email === email);
        const m = wsMembers?.find(x => x.email?.toLowerCase() === email);
        return { uid: (m && !m.uid?.startsWith('pending_')) ? m.uid : null, email, name: o?.name || email.split('@')[0] };
      });
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
        coAssignees:   coAssignees.length ? coAssignees : null,
        categoryId:    moveCategoryId    || null,
        subcategoryId: moveSubcategoryId || null,
      }, {
        uid:         user.uid,
        email:       user.email,
        displayName: ownerName,
      });

      // ── Notify all assignees (skip when assigning to self for primary).
      const allAssignees = [
        isSelf || sentInviteEmail ? null : { email: moveAssigneeEmail, name: assigneeName },
        ...coAssignees,
      ].filter(Boolean);
      for (const a of allAssignees) {
        try {
          await notifyTaskAssigned({
            assigneeEmail: a.email,
            assigneeName:  a.name,
            taskText:      task.text,
            notes:         moveNotes?.trim() || null,
            dueDate:       moveDue || null,
            priority:      movePriority || 'medium',
            ownerName:     ownerName,
            ownerUid:      user.uid,
            taskId:        newTaskRef?.id,
            workspaceId:   selectedWsId,
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
          <div style={{ position: 'relative' }}>
            <label className="label">
              Assign to <span style={{ color: '#dc2626' }}>*</span>
            </label>
            {/* Pill trigger */}
            <div
              onClick={() => setMoveAssigneePicker(o => !o)}
              style={{
                ...selStyle, height: 'auto', minHeight: 40, padding: '6px 10px',
                display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'pointer',
                borderColor: moveAssigneeEmails.length ? '#cbd5e1' : '#dc262688',
              }}
            >
              {moveAssigneeEmails.length === 0
                ? <span style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>— Pick someone —</span>
                : moveAssigneeEmails.map(email => {
                    const o = assigneeOptions.find(x => x.email === email);
                    const isMe = email === user?.email?.toLowerCase();
                    return (
                      <span key={email} style={{
                        background: '#dbeafe', color: '#1d4ed8', borderRadius: 12,
                        padding: '2px 8px 2px 10px', fontSize: 12, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        {isMe ? `Me` : (o?.name || email)}
                        <button
                          type="button"
                          onMouseDown={e => { e.stopPropagation(); setMoveAssigneeEmails(prev => prev.filter(x => x !== email)); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', padding: 0, fontSize: 14, lineHeight: 1 }}
                        >×</button>
                      </span>
                    );
                  })
              }
              <ChevronDown size={12} style={{ marginLeft: 'auto', color: '#94a3b8', flexShrink: 0 }} />
            </div>
            {/* Dropdown */}
            {moveAssigneePicker && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                  background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                }}
              >
                <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                  <input
                    autoFocus
                    type="text"
                    value={moveAssigneeSearch}
                    onChange={e => setMoveAssigneeSearch(e.target.value)}
                    placeholder="Search people…"
                    style={{
                      width: '100%', padding: '6px 10px', fontSize: 13,
                      border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none',
                      fontFamily: 'var(--font-body)', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {assigneeOptions
                    .filter(o => !moveAssigneeSearch || o.name?.toLowerCase().includes(moveAssigneeSearch.toLowerCase()) || o.email?.toLowerCase().includes(moveAssigneeSearch.toLowerCase()))
                    .map(o => {
                      const isMe = o.email === user?.email?.toLowerCase();
                      const selected = moveAssigneeEmails.includes(o.email);
                      return (
                        <label key={o.email} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          cursor: 'pointer', background: selected ? '#eff6ff' : 'transparent',
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = selected ? '#dbeafe' : '#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background = selected ? '#eff6ff' : 'transparent'}
                        >
                          <input type="checkbox" checked={selected}
                            onChange={ev => setMoveAssigneeEmails(prev =>
                              ev.target.checked ? [...prev, o.email] : prev.filter(x => x !== o.email)
                            )}
                            style={{ accentColor: '#2563eb', width: 15, height: 15 }}
                          />
                          <span style={{ fontSize: 13, color: '#0f172a', fontWeight: selected ? 600 : 400, flex: 1 }}>
                            {isMe ? `Me (${o.name})` : o.name}
                            {!o.isMember && !isMe && <span style={{ color: '#7c3aed', fontSize: 11, marginLeft: 4 }}>— will be invited</span>}
                          </span>
                          {selected && <span style={{ color: '#2563eb', fontSize: 12 }}>✓</span>}
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
            {moveAssigneeEmails.some(e => !assigneeOptions.find(o => o.email === e)?.isMember && e !== user?.email?.toLowerCase()) && (
              <p style={{ fontSize: 11, color: '#7c3aed', marginTop: 4, lineHeight: 1.4 }}>
                Non-members will be added to this workspace so they can see the task.
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
              opacity: (!moveAssigneeEmails.length || moveSaving) ? 0.5 : 1,
              cursor:  (!moveAssigneeEmails.length || moveSaving) ? 'not-allowed' : 'pointer',
            }}
            onClick={handleMove}
            disabled={moveSaving || !moveAssigneeEmails.length}
            title={!moveAssigneeEmails.length ? 'Pick an assignee first' : undefined}
          >
            {moveSaving ? 'Moving…' : <><ArrowUpRight size={13} /> Move to Team Board</>}
          </button>
        </div>
      </div>
    </div>
  );
}
