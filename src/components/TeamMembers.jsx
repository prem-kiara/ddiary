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
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';
import { notifyWorkspaceInvite } from '../utils/emailNotifications';

export default function TeamMembers({ showToast }) {
  const { user } = useAuth();
  const { workspaces, loading } = useMyWorkspaces();
  const [activeWsId,     setActiveWsId]     = useState(null);
  const [creating,       setCreating]       = useState(false);
  const [newName,        setNewName]        = useState('');
  const [createLoading,  setCreateLoading]  = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      const wid = await createWorkspace(user.uid, user.email, user.displayName, newName.trim());
      showToast(`Workspace "${newName.trim()}" created!`, 'success');
      setNewName('');
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          <Users size={20} style={{ marginRight: 8 }} />Workspaces
        </h2>
        <button className="btn btn-teal btn-sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New Workspace
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="label">Workspace Name</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Collections Team, Branch Ops..."
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} autoFocus />
            <button className="btn btn-teal" onClick={handleCreate} disabled={createLoading}>
              {createLoading ? 'Creating...' : 'Create'}
            </button>
            <button className="btn btn-outline" onClick={() => { setCreating(false); setNewName(''); }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {workspaces.length === 0 && !creating && (
        <div className="empty-state" style={{ padding: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <Users size={40} color="#c9a96e" style={{ opacity: 0.5 }} />
          <p style={{ marginTop: 12, color: '#8a7a6a', fontSize: 15, fontWeight: 600, textAlign: 'center' }}>No workspaces yet</p>
          <p style={{ fontSize: 13, color: '#b5a898', maxWidth: 340, textAlign: 'center', lineHeight: 1.6, marginTop: 6 }}>
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
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #2a9d8f, #8e44ad)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
            {(ws.name || 'W').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#4a3728' }}>{ws.name}</div>
            <div style={{ fontSize: 12, color: '#8a7a6a' }}>{ws.role === 'admin' ? 'Admin' : 'Member'}</div>
          </div>
          <ChevronRight size={18} color="#b5a898" />
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

  // Invite by email state
  const [inviteEmail,     setInviteEmail]     = useState('');
  const [inviteSending,   setInviteSending]   = useState(false);
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [inviteError,     setInviteError]     = useState('');

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

  // ── Email invite (uses workspaceInvites for accept/reject flow) ────────
  const handleEmailInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteError('');
    try {
      const email = inviteEmail.trim().toLowerCase();

      if (dedupedMembers.some(m => m.email?.toLowerCase() === email)) {
        setInviteError('This person is already a member.');
        return;
      }
      const existing = await getExistingInvite(workspaceId, email);
      if (existing?.status === 'pending') {
        setInviteError('An invite is already pending — waiting for their response.');
        return;
      }

      await createWorkspaceInvite({
        workspaceId, workspaceName: workspace.name,
        inviterUid: user.uid, inviterEmail: user.email, inviterName: user.displayName || user.email,
        inviteeEmail: email,
      });
      // Keep pending member doc as fallback for claimPendingMemberships
      await addWorkspaceMember(workspaceId, {
        uid: `pending_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email, displayName: email.split('@')[0], role: 'member',
      });
      try {
        await notifyWorkspaceInvite({
          inviteeEmail: email, inviteeName: email.split('@')[0],
          inviterName: user.displayName || user.email,
          workspaceName: workspace.name, inviteUrl,
        });
      } catch {}

      showToast(`Invite sent to ${email}!`, 'success');
      setInviteEmailSent(true);
      setInviteEmail('');
      setTimeout(() => setInviteEmailSent(false), 3000);
    } catch {
      setInviteError('Failed to send invite. Please try again.');
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {renaming ? (
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input className="input" value={renameText} onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }} autoFocus />
            <button className="btn btn-teal btn-sm" onClick={handleRename}><Check size={13} /></button>
            <button className="btn btn-outline btn-sm" onClick={() => setRenaming(false)}><X size={13} /></button>
          </div>
        ) : (
          <>
            <h2 className="section-title" style={{ margin: 0, flex: 1 }}>{workspace.name}</h2>
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
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e67e2244', background: '#fffbf5' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#e67e22', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={14} /> Leave Requests ({leaveRequests.length})
          </div>
          {leaveRequests.map(req => {
            const busy = leaveAction[req.id];
            return (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0e6d2', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728' }}>{req.memberName}</div>
                  <div style={{ fontSize: 12, color: '#8a7a6a' }}>{req.memberEmail} · wants to leave</div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                  <button onClick={() => handleDenyLeave(req)} disabled={!!busy}
                    style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d4c5a9', background: '#fff', color: '#4a3728', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    {busy === 'denying' ? '…' : 'Deny'}
                  </button>
                  <button onClick={() => handleApproveLeave(req)} disabled={!!busy}
                    style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#27ae60', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
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
        <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link size={14} /> Invite
        </div>

        {/* Email invite */}
        <div style={{ display: 'flex', gap: 8, marginBottom: inviteError ? 6 : 10 }}>
          <input type="email" value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleEmailInvite()}
            placeholder="colleague@company.com"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${inviteError ? '#c0392b55' : '#d4c5a9'}`, background: '#fff', fontSize: 13, fontFamily: 'var(--font-body)', color: '#4a3728', outline: 'none' }}
          />
          <button className="btn btn-teal btn-sm" onClick={handleEmailInvite}
            disabled={inviteSending || !inviteEmail.trim()} style={{ flexShrink: 0, minWidth: 80 }}>
            {inviteEmailSent ? <><CheckCircle size={13} /> Sent!</>
              : inviteSending ? '…'
              : <><UserPlus size={13} /> Send</>}
          </button>
        </div>
        {inviteError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c0392b', marginBottom: 8 }}>
            <AlertTriangle size={12} /> {inviteError}
          </div>
        )}
        <p style={{ fontSize: 11, color: '#b5a898', margin: '0 0 10px' }}>
          They'll receive an in-app prompt to accept or decline.
        </p>

        {/* Copy link divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, height: 1, background: '#e8d5b7' }} />
          <span style={{ fontSize: 11, color: '#b5a898' }}>or share link</span>
          <div style={{ flex: 1, height: 1, background: '#e8d5b7' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" value={inviteUrl} readOnly
            style={{ fontSize: 12, color: '#8a7a6a', flex: 1 }} onClick={e => e.target.select()} />
          <button className="btn btn-teal btn-sm" onClick={handleCopy}>
            {copied ? <><CheckCircle size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#b5a898', marginTop: 6 }}>
          They sign in with Microsoft and join automatically as a fallback.
        </p>
      </div>

      {/* ── Members list ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} /> Members ({dedupedMembers.filter(m => !m.uid?.startsWith('pending_')).length})
            {dedupedMembers.some(m => m.uid?.startsWith('pending_')) && (
              <span style={{ fontSize: 11, color: '#e67e22', fontWeight: 600 }}>
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
          <p style={{ fontSize: 13, color: '#b5a898', padding: '10px 0' }}>No members yet.</p>
        )}

        {dedupedMembers.map(m => {
          const isPending = m.uid?.startsWith('pending_');
          const isMe = m.uid === user.uid;
          return (
            <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0e6d2' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: isPending ? '#f0e6d2' : isMe ? '#2a9d8f22' : '#c9a96e22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isPending ? '#b5a898' : isMe ? '#2a9d8f' : '#8B6914', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728' }}>
                  {m.displayName || m.email}
                  {isPending && <span style={{ fontSize: 11, color: '#e67e22', marginLeft: 6, fontWeight: 600 }}>Invited</span>}
                  {isMe && <span style={{ fontSize: 11, color: '#2a9d8f', marginLeft: 6 }}>You</span>}
                </div>
                <div style={{ fontSize: 12, color: '#8a7a6a' }}>
                  {m.email} · {m.role}
                </div>
              </div>
              {isAdmin && !isMe && (
                <button className="btn-icon" onClick={() => handleRemoveMember(m.uid, m.displayName)}
                  title="Remove member" style={{ color: '#c0392b' }}>
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
          <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', marginBottom: 10 }}>
            Tasks ({wsTasks.length})
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            {['open', 'in_progress', 'review', 'done'].map(status => {
              const count = wsTasks.filter(t => (t.status || 'open') === status).length;
              if (count === 0) return null;
              const colors = { open: '#8a7a6a', in_progress: '#2980b9', review: '#8e44ad', done: '#27ae60' };
              const labels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
              return (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[status] }} />
                  <span style={{ color: '#4a3728', fontWeight: 600 }}>{count}</span>
                  <span style={{ color: '#8a7a6a' }}>{labels[status]}</span>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: '#b5a898' }}>
            Go to Tasks → Team Board to view and manage tasks.
          </p>
        </div>
      )}

      {/* ── Org directory panel ─────────────────────────────────────────── */}
      {showOrgPanel && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#8e44ad', display: 'flex', alignItems: 'center', gap: 6 }}>
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
          {orgLoading && <p style={{ fontSize: 13, color: '#8a7a6a' }}>Loading org users...</p>}
          {!orgLoading && orgUsers.length === 0 && (
            <p style={{ fontSize: 13, color: '#8a7a6a' }}>
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
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0e6d2' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#8e44ad22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8e44ad', fontWeight: 700, fontSize: 13 }}>
                    {(u.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{u.displayName}</div>
                    <div style={{ fontSize: 11, color: '#8a7a6a' }}>
                      {u.email}
                      {u.jobTitle && <> · <Briefcase size={9} style={{ display: 'inline' }} /> {u.jobTitle}</>}
                    </div>
                  </div>
                  <button className="btn btn-teal btn-sm" onClick={() => handleAddFromOrg(u)} disabled={addingOrg[u.id]}>
                    {addingOrg[u.id] ? '…' : <><UserPlus size={12} /> Invite</>}
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0e6d2', display: 'flex', gap: 10 }}>
        {isAdmin ? (
          <button className="btn btn-red btn-sm" onClick={handleDeleteWorkspace} disabled={deleteLoading}>
            <Trash2 size={12} /> {deleteLoading ? 'Deleting…' : 'Delete Workspace'}
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={handleRequestLeave} disabled={leaveLoading}
            style={{ color: '#c0392b', borderColor: '#c0392b' }}>
            <Leave size={12} /> {leaveLoading ? 'Sending request…' : 'Request to Leave'}
          </button>
        )}
      </div>
    </div>
  );
}
