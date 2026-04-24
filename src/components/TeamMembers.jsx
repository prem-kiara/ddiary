import { useState } from 'react';
import {
  Users, Plus, Trash2, User, Edit2, Check, X, Link, Copy,
  CheckCircle, ChevronRight, LogOut as Leave, Building2, RefreshCw,
  Briefcase, UserPlus, AlertTriangle, Clock,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspaces, useWorkspace, useWorkspaceTasks,
  createWorkspace, renameWorkspace, removeWorkspaceMember, deleteWorkspace,
  createWorkspaceInvite, getExistingInvite, addWorkspaceMember,
  usePendingLeaveRequests, requestLeave, approveLeave, denyLeave,
} from '../hooks/useWorkspace';
import { fetchAllOrgUsers, searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';
import { notifyWorkspaceInvite } from '../utils/emailNotifications';
import { sendBatchInvites, summariseInviteResult } from '../utils/batchInvite';

export default function TeamMembers({ showToast }) {
  const { user } = useAuth();
  const { workspaces, loading } = useMyWorkspaces();
  const [activeWsId,     setActiveWsId]     = useState(null);
  const [creating,       setCreating]       = useState(false);
  const [newName,        setNewName]        = useState('');
  // Optional seed category + sub-category for the new workspace
  const [newCatName,     setNewCatName]     = useState('');
  const [newSubCatName,  setNewSubCatName]  = useState('');
  const [createLoading,  setCreateLoading]  = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      const seed = newCatName.trim()
        ? { name: newCatName.trim(), subcategoryName: newSubCatName.trim() || null }
        : null;
      const wid = await createWorkspace(user.uid, user.email, user.displayName, newName.trim(), seed);
      showToast(`Workspace "${newName.trim()}" created!`, 'success');
      setNewName('');
      setNewCatName('');
      setNewSubCatName('');
      setCreating(false);
      setActiveWsId(wid);
    } catch (e) {
      showToast(e?.message || 'Failed to create workspace.', 'warning');
    } finally {
      setCreateLoading(false);
    }
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading workspaces...</p></div>;

  if (activeWsId) {
    return (
      <WorkspaceDetail
        workspaceId={activeWsId}
        onBack={() => setActiveWsId(null)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          <Users size={20} style={{ marginRight: 8 }} />Workspaces
        </h2>
        <div className="page-actions">
          <button className="btn btn-teal btn-sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New Workspace
          </button>
        </div>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="label">Workspace Name</label>
          <input className="input" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Collections Team, Branch Ops..."
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} autoFocus
            style={{ marginBottom: 10 }}
          />

          <div className="form-grid-2" style={{ marginBottom: 8 }}>
            <div>
              <label className="label">Category (optional)</label>
              <input className="input" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                placeholder="e.g. Credit & Underwriting"
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
            </div>
            <div>
              <label className="label">Sub-category (optional)</label>
              <input className="input" value={newSubCatName} onChange={e => setNewSubCatName(e.target.value)}
                placeholder="e.g. Retail"
                disabled={!newCatName.trim()}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px' }}>
            You can add more categories and sub-categories later from the board.
          </p>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-teal" onClick={handleCreate} disabled={createLoading || !newName.trim()}>
              {createLoading ? 'Creating...' : 'Create'}
            </button>
            <button className="btn btn-outline" onClick={() => { setCreating(false); setNewName(''); setNewCatName(''); setNewSubCatName(''); }}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}

      {workspaces.length === 0 && !creating && (
        <div className="empty-state" style={{ padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <Users size={40} color="#7c3aed" style={{ opacity: 0.5 }} />
          <p style={{ marginTop: 12, color: '#475569', fontSize: 15, fontWeight: 600, textAlign: 'center' }}>No workspaces yet</p>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 340, textAlign: 'center', lineHeight: 1.6, marginTop: 6 }}>
            Create a workspace to start collaborating with your team.
          </p>
        </div>
      )}

      {workspaces.map(ws => (
        <div key={ws.id} onClick={() => setActiveWsId(ws.id)} className="card"
          style={{ cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', transition: 'box-shadow 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'}
          onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
            {(ws.name || 'W').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{ws.name}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{ws.role === 'admin' ? 'Admin' : 'Member'}</div>
          </div>
          <ChevronRight size={18} color="#94a3b8" />
        </div>
      ))}
    </div>
  );
}


// ─── Workspace Detail ─────────────────────────────────────────────────────────
function WorkspaceDetail({ workspaceId, onBack, showToast }) {
  const { user } = useAuth();
  const { workspace, members, loading } = useWorkspace(workspaceId);
  const { tasks: wsTasks } = useWorkspaceTasks(workspaceId);
  const { requests: leaveRequests } = usePendingLeaveRequests(workspaceId);

  const [renaming,   setRenaming]   = useState(false);
  const [renameText, setRenameText] = useState('');
  const [copied,     setCopied]     = useState(false);

  // ── Invite state (chips-based, batch send) ────────────────────────────
  // `invitees` — list of chips staged for the next Send click
  // `inviteInput` — current text in the search box
  // `inviteSuggestions` — org-directory autocomplete results
  // `inviteSummary` — inline status banner after the last Send
  const [invitees,          setInvitees]          = useState([]);
  const [inviteInput,       setInviteInput]       = useState('');
  const [inviteSuggestions, setInviteSuggestions] = useState([]);
  const [inviteSending,     setInviteSending]     = useState(false);
  const [inviteSummary,     setInviteSummary]     = useState(null);
  const [inviteError,       setInviteError]       = useState('');

  // Org directory state
  const [orgUsers,     setOrgUsers]     = useState([]);
  const [orgLoading,   setOrgLoading]   = useState(false);
  const [showOrgPanel, setShowOrgPanel] = useState(false);
  const [orgSearch,    setOrgSearch]    = useState('');
  const [addingOrg,    setAddingOrg]    = useState({});

  // Leave / delete state
  const [leaveLoading,  setLeaveLoading]  = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [leaveAction,   setLeaveAction]   = useState({}); // { [reqId]: 'approving' | 'denying' }

  const inviteUrl = `${window.location.origin}?workspace=${workspaceId}`;

  // The workspace creator is always considered admin
  const isAdmin = workspace?.createdBy === user.uid ||
                  members.find(m => m.uid === user.uid)?.role === 'admin';

  // ── Deduplicate members: if a pending_* doc and a real doc share the same
  //    email, show only the real doc.  This prevents double entries when the
  //    placeholder isn't cleaned up before the real UID doc is written.
  const dedupedMembers = (() => {
    const realEmails = new Set(
      members
        .filter(m => !m.uid?.startsWith('pending_'))
        .map(m => m.email?.toLowerCase())
        .filter(Boolean)
    );
    return members.filter(m => {
      if (!m.uid?.startsWith('pending_')) return true;           // always show real members
      return !realEmails.has(m.email?.toLowerCase());            // only show pending if no real match
    });
  })();

  // Owner of the workspace (for leave request notifications)
  const ownerMember = members.find(m => m.role === 'admin') || members[0];
  const ownerEmail  = workspace?.createdBy
    ? members.find(m => m.uid === workspace.createdBy)?.email || user.email
    : user.email;

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      showToast('Invite link copied!', 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRename = async () => {
    if (!renameText.trim()) return;
    try {
      await renameWorkspace(workspaceId, renameText.trim());
      showToast('Workspace renamed', 'success');
      setRenaming(false);
    } catch { showToast('Failed to rename', 'warning'); }
  };

  const handleRemoveMember = async (uid, name) => {
    if (!confirm(`Remove ${name || 'this member'} from the workspace?`)) return;
    try {
      await removeWorkspaceMember(workspaceId, uid);
      showToast('Member removed', 'success');
    } catch { showToast('Failed to remove member', 'warning'); }
  };

  const handleDeleteWorkspace = async () => {
    if (!confirm('Delete this workspace? All tasks and data will be permanently lost.')) return;
    setDeleteLoading(true);
    try {
      await deleteWorkspace(workspaceId);
      showToast('Workspace deleted', 'success');
      onBack();
    } catch (e) {
      showToast('Failed to delete workspace', 'warning');
      setDeleteLoading(false);
    }
  };

  // ── Leave request (member submits, owner approves/denies) ──────────────
  const handleRequestLeave = async () => {
    if (!confirm(`Request to leave "${workspace?.name}"?\nThe workspace admin must approve before you are removed.`)) return;
    setLeaveLoading(true);
    try {
      await requestLeave(workspaceId, workspace.name, user, ownerEmail);
      showToast('Leave request sent — waiting for admin approval.', 'success');
    } catch { showToast('Failed to send leave request.', 'warning'); }
    finally { setLeaveLoading(false); }
  };

  const handleApproveLeave = async (req) => {
    setLeaveAction(a => ({ ...a, [req.id]: 'approving' }));
    try {
      await approveLeave(req);
      showToast(`${req.memberName} has been removed.`, 'success');
    } catch { showToast('Failed to approve leave.', 'warning'); }
    finally { setLeaveAction(a => ({ ...a, [req.id]: undefined })); }
  };

  const handleDenyLeave = async (req) => {
    setLeaveAction(a => ({ ...a, [req.id]: 'denying' }));
    try {
      await denyLeave(req);
      showToast(`Denied — ${req.memberName} stays in the workspace.`, 'success');
    } catch { showToast('Failed to deny leave.', 'warning'); }
    finally { setLeaveAction(a => ({ ...a, [req.id]: undefined })); }
  };

  // ── Chip helpers ──────────────────────────────────────────────────────
  const handleInviteInputChange = (val) => {
    setInviteInput(val);
    setInviteError('');
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(results => setInviteSuggestions(results || []));
    } else {
      setInviteSuggestions([]);
    }
  };

  const addInviteChip = (email, displayName) => {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) return;
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      setInviteError(`"${email}" isn't a valid email.`);
      return;
    }
    if (invitees.some(i => i.email === clean)) {
      setInviteError('Already added to this batch.');
      return;
    }
    setInvitees(prev => [...prev, { email: clean, name: displayName || clean.split('@')[0] }]);
    setInviteInput('');
    setInviteSuggestions([]);
    setInviteError('');
  };

  const removeInviteChip = (email) => {
    setInvitees(prev => prev.filter(i => i.email !== email));
  };

  const selectInviteSuggestion = (person) => {
    addInviteChip(person.email, person.displayName);
  };

  const handleInviteInputKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inviteInput.trim()) addInviteChip(inviteInput.trim());
      else if (e.key === 'Enter' && invitees.length > 0 && !inviteSending) handleBatchInvite();
    } else if (e.key === 'Backspace' && !inviteInput && invitees.length > 0) {
      setInvitees(prev => prev.slice(0, -1));
    } else if (e.key === 'Escape') {
      setInviteSuggestions([]);
    }
  };

  const handleInvitePaste = (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!text || !/[,;\s]/.test(text)) return;
    e.preventDefault();
    text.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).forEach(p => addInviteChip(p));
  };

  // ── Batch invite (uses workspaceInvites for accept/reject flow) ────────
  const handleBatchInvite = async () => {
    // Commit any typed-but-not-yet-chipped text as a final chip
    let pool = invitees;
    if (inviteInput.trim()) {
      const v = inviteInput.trim().toLowerCase();
      if (/^\S+@\S+\.\S+$/.test(v) && !invitees.some(i => i.email === v)) {
        pool = [...invitees, { email: v, name: v.split('@')[0] }];
      }
    }
    if (pool.length === 0) {
      setInviteError('Add at least one email to invite.');
      return;
    }
    setInviteSending(true);
    setInviteError('');
    setInviteSummary(null);
    try {
      const result = await sendBatchInvites({
        workspaceId,
        workspaceName:   workspace?.name || 'Workspace',
        inviter:         { uid: user.uid, email: user.email, displayName: user.displayName },
        invitees:        pool,
        existingMembers: dedupedMembers,
        inviteUrl,
      });
      const text = summariseInviteResult(result);
      const tone = result.sent.length > 0 ? 'success' : (result.failed.length > 0 ? 'error' : 'info');
      setInviteSummary({ text, tone });
      showToast(text, tone === 'error' ? 'warning' : 'success');
      setInvitees([]);
      setInviteInput('');
      setInviteSuggestions([]);
    } catch {
      setInviteError('Failed to send invites. Please try again.');
    } finally {
      setInviteSending(false);
    }
  };

  // ── Add from org directory (also uses invite system) ──────────────────
  const loadOrgUsers = async () => {
    setOrgLoading(true);
    try {
      const users = await fetchAllOrgUsers();
      const memberEmails = new Set(members.map(m => m.email?.toLowerCase()).filter(Boolean));
      setOrgUsers(users.filter(u => u.email && !memberEmails.has(u.email.toLowerCase())));
    } catch { showToast('Failed to load org directory', 'warning'); }
    setOrgLoading(false);
  };

  const handleAddFromOrg = async (orgUser) => {
    setAddingOrg(a => ({ ...a, [orgUser.id]: true }));
    try {
      const email = orgUser.email.toLowerCase();

      // Check if already a member or already invited
      if (dedupedMembers.some(m => m.email?.toLowerCase() === email)) {
        showToast('Already a member.', 'info');
        return;
      }
      const existing = await getExistingInvite(workspaceId, email);
      if (existing?.status === 'pending') {
        showToast('Invite already pending.', 'info');
        return;
      }

      // Create invite doc (for in-app accept/reject prompt)
      await createWorkspaceInvite({
        workspaceId, workspaceName: workspace?.name || 'Workspace',
        inviterUid: user.uid, inviterEmail: user.email, inviterName: user.displayName || user.email,
        inviteeEmail: email,
      });
      // Keep pending member doc as fallback
      await addWorkspaceMember(workspaceId, {
        uid: `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email, displayName: orgUser.displayName, role: 'member',
      });

      // Send invite email
      notifyWorkspaceInvite({
        inviteeEmail: email, inviteeName: orgUser.displayName,
        inviterName: user.displayName || user.email,
        workspaceName: workspace?.name || 'Workspace', inviteUrl,
      }).catch(() => {});

      setOrgUsers(prev => prev.filter(u => u.email !== orgUser.email));
      showToast(`Invite sent to ${orgUser.displayName}`, 'success');
    } catch { showToast('Failed to invite member', 'warning'); }
    finally { setAddingOrg(a => ({ ...a, [orgUser.id]: false })); }
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading workspace...</p></div>;
  if (!workspace) return <div className="empty-state fade-in"><p>Workspace not found</p></div>;

  return (
    <div className="fade-in">
      {/* Back button */}
      <button onClick={onBack} className="btn btn-outline btn-sm" style={{ marginBottom: 16 }}>
        ← All Workspaces
      </button>

      {/* Workspace name + rename */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {renaming ? (
          <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            <input className="input" value={renameText} onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }} autoFocus
              style={{ flex: '1 1 200px', minWidth: 0 }} />
            <button className="btn btn-teal btn-sm" onClick={handleRename}><Check size={13} /></button>
            <button className="btn btn-outline btn-sm" onClick={() => setRenaming(false)}><X size={13} /></button>
          </div>
        ) : (
          <>
            <h2 className="section-title" style={{ margin: 0, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{workspace.name}</h2>
            {isAdmin && (
              <button className="btn btn-outline btn-sm"
                onClick={() => { setRenaming(true); setRenameText(workspace.name); }}>
                <Edit2 size={12} /> Rename
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Leave requests (owner sees pending requests) ─────────────────── */}
      {isAdmin && leaveRequests.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #d9770644', background: '#fffbf5' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={14} /> Leave Requests ({leaveRequests.length})
          </div>
          {leaveRequests.map(req => {
            const busy = leaveAction[req.id];
            return (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{req.memberName}</div>
                  <div style={{ fontSize: 12, color: '#475569', wordBreak: 'break-word' }}>{req.memberEmail} · wants to leave</div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                  <button onClick={() => handleDenyLeave(req)} disabled={!!busy}
                    style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', minHeight: 38 }}>
                    {busy === 'denying' ? '…' : 'Deny'}
                  </button>
                  <button onClick={() => handleApproveLeave(req)} disabled={!!busy}
                    style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: '#15803d', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', minHeight: 38 }}>
                    {busy === 'approving' ? '…' : 'Approve'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Invite link ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link size={14} /> Invite
        </div>

        {/* Chip-based batch invite */}
        <div style={{ position: 'relative', marginBottom: inviteError ? 6 : 8 }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
            padding: '6px 8px', borderRadius: 8,
            border: `1px solid ${inviteError ? '#dc262655' : '#cbd5e1'}`,
            background: '#fff', minHeight: 40,
          }}>
            {invitees.map(inv => (
              <span key={inv.email}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#ede9fe', color: '#6d28d9',
                  padding: '3px 4px 3px 9px', borderRadius: 14,
                  fontSize: 12, fontWeight: 600, maxWidth: '100%',
                }}
                title={inv.email}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inv.name && inv.name !== inv.email ? `${inv.name} · ${inv.email}` : inv.email}
                </span>
                <button
                  onClick={() => removeInviteChip(inv.email)}
                  title="Remove"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6d28d9', display: 'flex', padding: 0 }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input type="text" value={inviteInput}
              onChange={e => handleInviteInputChange(e.target.value)}
              onKeyDown={handleInviteInputKey}
              onPaste={handleInvitePaste}
              onBlur={() => setTimeout(() => setInviteSuggestions([]), 150)}
              placeholder={invitees.length ? 'Add another…' : 'Search name or email — Enter to add, paste a list to bulk-add'}
              autoComplete="off"
              style={{
                flex: '1 1 180px', minWidth: 140,
                padding: '6px 4px', border: 'none', outline: 'none',
                background: 'transparent', fontSize: 13,
                fontFamily: 'var(--font-body)', color: '#0f172a',
              }}
            />
          </div>

          {/* Autocomplete dropdown */}
          {inviteSuggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
              background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
            }}>
              {inviteSuggestions.map(person => (
                <div key={person.id || person.email}
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

        {/* Send / Clear row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: inviteSummary ? 10 : 8 }}>
          <button className="btn btn-teal btn-sm" onClick={handleBatchInvite}
            disabled={inviteSending || (invitees.length === 0 && !inviteInput.trim())}
            style={{ flexShrink: 0, minWidth: 120 }}>
            {inviteSending ? '…' : <><UserPlus size={13} /> Send{invitees.length > 1 ? ` ${invitees.length} invites` : ' invite'}</>}
          </button>
          {invitees.length > 0 && (
            <button onClick={() => { setInvitees([]); setInviteSummary(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 12 }}>
              Clear list
            </button>
          )}
        </div>

        {/* Result banner */}
        {inviteSummary && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600,
            color: inviteSummary.tone === 'success' ? '#15803d'
                 : inviteSummary.tone === 'error'   ? '#dc2626'
                 : '#d97706',
            marginBottom: 10,
          }}>
            {inviteSummary.tone === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
            {inviteSummary.text}
          </div>
        )}

        {inviteError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626', marginBottom: 8 }}>
            <AlertTriangle size={12} /> {inviteError}
          </div>
        )}
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px' }}>
          Add people as chips, then click Send. People already in the workspace or with a pending invite are skipped automatically.
        </p>

        {/* Copy link divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>or share link</span>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" value={inviteUrl} readOnly
            style={{ fontSize: 12, color: '#475569', flex: '1 1 180px', minWidth: 0 }} onClick={e => e.target.select()} />
          <button className="btn btn-teal btn-sm" onClick={handleCopy} style={{ flexShrink: 0 }}>
            {copied ? <><CheckCircle size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
          They sign in with Microsoft and join automatically as a fallback.
        </p>
      </div>

      {/* ── Members list ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} /> Members ({dedupedMembers.filter(m => !m.uid?.startsWith('pending_')).length})
            {dedupedMembers.some(m => m.uid?.startsWith('pending_')) && (
              <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>
                · {dedupedMembers.filter(m => m.uid?.startsWith('pending_')).length} invited
              </span>
            )}
          </div>
          <button className="btn btn-outline btn-sm"
            onClick={() => { setShowOrgPanel(!showOrgPanel); if (!showOrgPanel && orgUsers.length === 0) loadOrgUsers(); }}>
            <Building2 size={12} /> {showOrgPanel ? 'Hide Directory' : 'Add from Org'}
          </button>
        </div>

        {dedupedMembers.length === 0 && (
          <p style={{ fontSize: 13, color: '#94a3b8', padding: '10px 0' }}>No members yet.</p>
        )}

        {dedupedMembers.map(m => {
          const isPending = m.uid?.startsWith('pending_');
          const isMe = m.uid === user.uid;
          return (
            <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: isPending ? '#e2e8f0' : isMe ? '#7c3aed22' : '#7c3aed22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isPending ? '#94a3b8' : isMe ? '#7c3aed' : '#6d28d9', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.displayName || m.email}
                  {isPending && <span style={{ fontSize: 11, color: '#d97706', marginLeft: 6, fontWeight: 600 }}>Invited</span>}
                  {isMe && <span style={{ fontSize: 11, color: '#7c3aed', marginLeft: 6 }}>You</span>}
                </div>
                <div style={{ fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.email} · {m.role}
                </div>
              </div>
              {isAdmin && !isMe && (
                <button className="btn-icon" onClick={() => handleRemoveMember(m.uid, m.displayName)}
                  title="Remove member" style={{ color: '#dc2626' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Task summary ─────────────────────────────────────────────────── */}
      {wsTasks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>
            Tasks ({wsTasks.length})
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            {['open', 'in_progress', 'review', 'done'].map(status => {
              const count = wsTasks.filter(t => (t.status || 'open') === status).length;
              if (count === 0) return null;
              const colors = { open: '#475569', in_progress: '#2563eb', review: '#7c3aed', done: '#15803d' };
              const labels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
              return (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[status] }} />
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>{count}</span>
                  <span style={{ color: '#475569' }}>{labels[status]}</span>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8' }}>
            Go to Tasks → Team Board to view and manage tasks.
          </p>
        </div>
      )}

      {/* ── Org directory panel ─────────────────────────────────────────── */}
      {showOrgPanel && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Building2 size={14} /> Organization Directory
            </div>
            <button className="btn btn-outline btn-sm" onClick={loadOrgUsers} disabled={orgLoading}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {!orgLoading && orgUsers.length > 0 && (
            <input className="input" placeholder="Search by name or email..."
              value={orgSearch} onChange={e => setOrgSearch(e.target.value)}
              style={{ fontSize: 13, marginBottom: 10 }} />
          )}
          {orgLoading && <p style={{ fontSize: 13, color: '#475569' }}>Loading org users...</p>}
          {!orgLoading && orgUsers.length === 0 && (
            <p style={{ fontSize: 13, color: '#475569' }}>
              No users to add (everyone's already in this workspace or directory is empty).
            </p>
          )}
          <div style={{ maxHeight: 320, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {orgUsers
              .filter(u => {
                if (!orgSearch.trim()) return true;
                const q = orgSearch.toLowerCase();
                return (u.displayName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
              })
              .map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#7c3aed22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {(u.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.displayName}</div>
                    <div style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.email}
                      {u.jobTitle && <> · <Briefcase size={9} style={{ display: 'inline' }} /> {u.jobTitle}</>}
                    </div>
                  </div>
                  <button className="btn btn-teal btn-sm" onClick={() => handleAddFromOrg(u)} disabled={addingOrg[u.id]} style={{ flexShrink: 0 }}>
                    {addingOrg[u.id] ? '…' : <><UserPlus size={12} /> Invite</>}
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 10 }}>
        {isAdmin ? (
          <button className="btn btn-red btn-sm" onClick={handleDeleteWorkspace} disabled={deleteLoading}>
            <Trash2 size={12} /> {deleteLoading ? 'Deleting…' : 'Delete Workspace'}
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={handleRequestLeave} disabled={leaveLoading}
            style={{ color: '#dc2626', borderColor: '#dc2626' }}>
            <Leave size={12} /> {leaveLoading ? 'Sending request…' : 'Request to Leave'}
          </button>
        )}
      </div>
    </div>
  );
}
