import { useState, useEffect } from 'react';
import {
  Users, Plus, Trash2, Mail, User, Edit2, Check, X, Link, Copy,
  CheckCircle, ChevronRight, ChevronDown, Settings, LogOut as Leave,
  Building2, RefreshCw, Briefcase,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useMyWorkspaces, useWorkspace, useWorkspaceTasks,
  createWorkspace, renameWorkspace, addWorkspaceMember, removeWorkspaceMember, deleteWorkspace,
} from '../hooks/useWorkspace';
import { fetchAllOrgUsers } from '../utils/graphPeopleSearch';
import { notifyWorkspaceInvite } from '../utils/emailNotifications';

export default function TeamMembers({ showToast }) {
  const { user } = useAuth();
  const { workspaces, loading } = useMyWorkspaces();

  const [activeWsId,   setActiveWsId]   = useState(null);
  const [creating,     setCreating]     = useState(false);
  const [newName,      setNewName]      = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // ── Create workspace ──────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      const wid = await createWorkspace(user.uid, user.email, user.displayName, newName.trim());
      showToast('Workspace created!', 'success');
      setNewName('');
      setCreating(false);
      setActiveWsId(wid);
    } catch (e) {
      console.error(e);
      showToast('Failed to create workspace', 'warning');
    }
    setCreateLoading(false);
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading workspaces...</p></div>;

  // ── Viewing a specific workspace ──────────────────────────────────────
  if (activeWsId) {
    return (
      <WorkspaceDetail
        workspaceId={activeWsId}
        onBack={() => setActiveWsId(null)}
        showToast={showToast}
      />
    );
  }

  // ── Workspace list ────────────────────────────────────────────────────
  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          <Users size={20} style={{ marginRight: 8 }} />
          Workspaces
        </h2>
        <button className="btn btn-teal btn-sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New Workspace
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="label">Workspace Name</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Collections Team, Branch Ops..."
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              autoFocus
            />
            <button className="btn btn-teal" onClick={handleCreate} disabled={createLoading}>
              {createLoading ? 'Creating...' : 'Create'}
            </button>
            <button className="btn btn-outline" onClick={() => { setCreating(false); setNewName(''); }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Workspace cards */}
      {workspaces.length === 0 && !creating && (
        <div className="empty-state" style={{ padding: 40 }}>
          <Users size={40} color="#c9a96e" />
          <p style={{ marginTop: 10, color: '#8a7a6a', fontSize: 15 }}>No workspaces yet</p>
          <p style={{ fontSize: 13, color: '#b5a898', maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>
            Create a workspace to start collaborating with your team. Each workspace gets its own Kanban board.
          </p>
        </div>
      )}

      {workspaces.map(ws => (
        <div
          key={ws.id}
          onClick={() => setActiveWsId(ws.id)}
          className="card"
          style={{
            cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center',
            gap: 12, padding: '14px 16px',
            transition: 'box-shadow 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'}
          onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #2a9d8f, #8e44ad)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
          }}>
            {(ws.name || 'W').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#4a3728' }}>{ws.name}</div>
            <div style={{ fontSize: 12, color: '#8a7a6a' }}>
              {ws.role === 'admin' ? 'Admin' : 'Member'}
            </div>
          </div>
          <ChevronRight size={18} color="#b5a898" />
        </div>
      ))}
    </div>
  );
}


// ─── Workspace Detail View ───────────────────────────────────────────────────
function WorkspaceDetail({ workspaceId, onBack, showToast }) {
  const { user } = useAuth();
  const { workspace, members, loading } = useWorkspace(workspaceId);
  const { tasks: wsTasks } = useWorkspaceTasks(workspaceId);

  const [renaming,   setRenaming]   = useState(false);
  const [renameText, setRenameText] = useState('');
  const [copied,     setCopied]     = useState(false);

  // Org directory for adding members
  const [orgUsers,      setOrgUsers]      = useState([]);
  const [orgLoading,    setOrgLoading]    = useState(false);
  const [showOrgPanel,  setShowOrgPanel]  = useState(false);
  const [orgSearch,     setOrgSearch]     = useState('');

  const inviteUrl = `${window.location.origin}?workspace=${workspaceId}`;
  const isAdmin = workspace?.createdBy === user.uid || members.find(m => m.uid === user.uid)?.role === 'admin';

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
    if (!confirm('Delete this workspace? Tasks and data will be lost.')) return;
    try {
      await deleteWorkspace(workspaceId);
      showToast('Workspace deleted', 'success');
      onBack();
    } catch { showToast('Failed to delete workspace', 'warning'); }
  };

  const handleLeave = async () => {
    if (!confirm('Leave this workspace?')) return;
    try {
      await removeWorkspaceMember(workspaceId, user.uid);
      showToast('Left workspace', 'success');
      onBack();
    } catch { showToast('Failed to leave', 'warning'); }
  };

  // ── Fetch org users ─────────────────────────────────────────────────
  const loadOrgUsers = async () => {
    setOrgLoading(true);
    try {
      const users = await fetchAllOrgUsers();
      // Filter out people already in the workspace
      const memberEmails = new Set(members.map(m => m.email?.toLowerCase()));
      setOrgUsers(users.filter(u => u.email && !memberEmails.has(u.email.toLowerCase())));
    } catch { showToast('Failed to load org directory', 'warning'); }
    setOrgLoading(false);
  };

  const handleAddFromOrg = async (orgUser) => {
    // Create a placeholder member entry with their email.
    // When they sign in via the invite link, they'll get a proper uid.
    try {
      const placeholderUid = `pending_${orgUser.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await addWorkspaceMember(workspaceId, {
        uid: placeholderUid,
        email: orgUser.email,
        displayName: orgUser.displayName,
        role: 'member',
      });
      setOrgUsers(prev => prev.filter(u => u.email !== orgUser.email));
      showToast(`Invited ${orgUser.displayName}`, 'success');

      // Send invite email (fire-and-forget — don't block the UI)
      notifyWorkspaceInvite({
        inviteeEmail:  orgUser.email,
        inviteeName:   orgUser.displayName,
        inviterName:   user.displayName || user.email,
        workspaceName: workspace?.name || 'Workspace',
        inviteUrl,
      }).catch(() => {}); // silently ignore if MS token unavailable

    } catch { showToast('Failed to add member', 'warning'); }
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading workspace...</p></div>;
  if (!workspace) return <div className="empty-state fade-in"><p>Workspace not found</p></div>;

  return (
    <div className="fade-in">
      {/* Header with back button */}
      <button
        onClick={onBack}
        className="btn btn-outline btn-sm"
        style={{ marginBottom: 16 }}
      >
        ← All Workspaces
      </button>

      {/* Workspace name + rename */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {renaming ? (
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              className="input"
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
              autoFocus
            />
            <button className="btn btn-teal btn-sm" onClick={handleRename}><Check size={13} /></button>
            <button className="btn btn-outline btn-sm" onClick={() => setRenaming(false)}><X size={13} /></button>
          </div>
        ) : (
          <>
            <h2 className="section-title" style={{ margin: 0, flex: 1 }}>{workspace.name}</h2>
            {isAdmin && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setRenaming(true); setRenameText(workspace.name); }}
              >
                <Edit2 size={12} /> Rename
              </button>
            )}
          </>
        )}
      </div>

      {/* Invite link */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link size={14} /> Invite Link
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            value={inviteUrl}
            readOnly
            style={{ fontSize: 12, color: '#8a7a6a', flex: 1 }}
            onClick={e => e.target.select()}
          />
          <button className="btn btn-teal btn-sm" onClick={handleCopy}>
            {copied ? <><CheckCircle size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#b5a898', marginTop: 6 }}>
          Share this link with team members. They sign in with Microsoft and join this workspace.
        </p>
      </div>

      {/* Members list */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} /> Members ({members.length})
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => { setShowOrgPanel(!showOrgPanel); if (!showOrgPanel && orgUsers.length === 0) loadOrgUsers(); }}
          >
            <Building2 size={12} /> {showOrgPanel ? 'Hide Directory' : 'Add from Org'}
          </button>
        </div>

        {members.map(m => {
          const isPending = m.uid?.startsWith('pending_');
          return (
            <div
              key={m.uid}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid #f0e6d2',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: isPending ? '#f0e6d2' : '#2a9d8f22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isPending ? '#b5a898' : '#2a9d8f',
                fontWeight: 700, fontSize: 14,
              }}>
                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#4a3728' }}>
                  {m.displayName || m.email}
                  {isPending && <span style={{ fontSize: 11, color: '#e67e22', marginLeft: 6 }}>Invited</span>}
                </div>
                <div style={{ fontSize: 12, color: '#8a7a6a' }}>
                  {m.email} · {m.role}
                </div>
              </div>
              {isAdmin && m.uid !== user.uid && (
                <button
                  className="btn-icon"
                  onClick={() => handleRemoveMember(m.uid, m.displayName)}
                  title="Remove member"
                  style={{ color: '#c0392b' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Task summary */}
      {wsTasks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#4a3728', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
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
            Go to Tasks → Team Board to view and manage workspace tasks.
          </p>
        </div>
      )}

      {/* Org directory panel */}
      {showOrgPanel && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#8e44ad', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Building2 size={14} /> Organization Directory
            </div>
            <button className="btn btn-outline btn-sm" onClick={loadOrgUsers} disabled={orgLoading}>
              <RefreshCw size={12} className={orgLoading ? 'spin' : ''} /> Refresh
            </button>
          </div>
          {/* Search filter */}
          {!orgLoading && orgUsers.length > 0 && (
            <input
              className="input"
              placeholder="Search by name or email..."
              value={orgSearch}
              onChange={e => setOrgSearch(e.target.value)}
              style={{ fontSize: 13, marginBottom: 10 }}
            />
          )}
          {orgLoading && <p style={{ fontSize: 13, color: '#8a7a6a' }}>Loading org users...</p>}
          {!orgLoading && orgUsers.length === 0 && (
            <p style={{ fontSize: 13, color: '#8a7a6a' }}>No users to add (everyone is already in this workspace, or org directory is empty).</p>
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
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#8e44ad22', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#8e44ad', fontWeight: 700, fontSize: 13,
                }}>
                  {(u.displayName || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{u.displayName}</div>
                  <div style={{ fontSize: 11, color: '#8a7a6a' }}>
                    {u.email}
                    {u.jobTitle && <> · <Briefcase size={9} style={{ display: 'inline' }} /> {u.jobTitle}</>}
                  </div>
                </div>
                <button className="btn btn-teal btn-sm" onClick={() => handleAddFromOrg(u)}>
                  <Plus size={12} /> Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0e6d2' }}>
        {isAdmin ? (
          <button
            className="btn btn-red btn-sm"
            onClick={handleDeleteWorkspace}
          >
            <Trash2 size={12} /> Delete Workspace
          </button>
        ) : (
          <button
            className="btn btn-outline btn-sm"
            onClick={handleLeave}
            style={{ color: '#c0392b', borderColor: '#c0392b' }}
          >
            <Leave size={12} /> Leave Workspace
          </button>
        )}
      </div>
    </div>
  );
}
