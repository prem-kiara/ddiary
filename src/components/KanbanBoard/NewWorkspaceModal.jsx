import { useState } from 'react';
import { Plus, X, Briefcase, UserPlus, Folder } from 'lucide-react';
import {
  createWorkspace, createWorkspaceInvite, getExistingInvite, addWorkspaceMember,
} from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';
import { notifyWorkspaceInvite } from '../../utils/emailNotifications';
import { searchOrgPeopleDebounced } from '../../utils/graphPeopleSearch';

// ── New Workspace Modal ───────────────────────────────────────────────────────
//
// Stand-alone "create a workspace" flow. Unlike the inline "+ New workspace"
// chip inside AddTaskModal (which forces you to also create a task in the
// same step), this modal creates just the workspace. Fields:
//   - name (required)
//   - description (optional)
//   - initial category + sub-category (optional, seeds the board)
//   - invite members (optional, pending invites are sent on save)
//
// On success: the new workspace is auto-expanded in the list (via
// localStorage flag), a toast is shown, and onWorkspaceCreated fires.
function NewWorkspaceModal({ onClose, onCreated, showToast, user }) {
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [catName,     setCatName]     = useState('');
  const [subName,     setSubName]     = useState('');
  const [saving,      setSaving]      = useState(false);

  // Invitee chips + live email input
  const [inviteInput,       setInviteInput]       = useState('');
  const [inviteSuggestions, setInviteSuggestions] = useState([]);
  const [invitees,          setInvitees]          = useState([]); // [{ email, name }]

  const handleInviteInputChange = (val) => {
    setInviteInput(val);
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(results => setInviteSuggestions(results || []));
    } else {
      setInviteSuggestions([]);
    }
  };

  const addInvitee = (email, displayName) => {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) return;
    if (clean === (user?.email || '').toLowerCase()) return; // creator is auto-admin
    if (invitees.some(i => i.email === clean)) return;        // already added
    setInvitees(prev => [...prev, { email: clean, name: displayName || clean.split('@')[0] }]);
    setInviteInput('');
    setInviteSuggestions([]);
  };

  const removeInvitee = (email) => {
    setInvitees(prev => prev.filter(i => i.email !== email));
  };

  const handleInviteInputKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Basic email validation before adding
      const v = inviteInput.trim();
      if (/^\S+@\S+\.\S+$/.test(v)) addInvitee(v);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const wsId = await createWorkspace(
        user.uid, user.email, user.displayName || user.email,
        name.trim(),
        catName.trim() ? { name: catName.trim(), subcategoryName: subName.trim() || null } : null,
        description.trim() || null,
      );

      // Auto-expand the newly created workspace so the creator can start
      // adding tasks/categories right away.
      try { localStorage.setItem(`ddiary_ws_${wsId}_expanded`, 'true'); } catch {}

      // Fire invites (non-fatal — workspace is already created)
      const inviteUrl = `${window.location.origin}?workspace=${wsId}`;
      for (const inv of invitees) {
        try {
          const existing = await getExistingInvite(wsId, inv.email);
          if (existing?.status === 'pending') continue;
          await createWorkspaceInvite({
            workspaceId:   wsId,
            workspaceName: name.trim(),
            inviterUid:    user.uid,
            inviterEmail:  user.email,
            inviterName:   user.displayName || user.email,
            inviteeEmail:  inv.email,
          });
          // Pre-create pending member doc as fallback for claimPendingMemberships
          await addWorkspaceMember(wsId, {
            uid:         `pending_${inv.email.replace(/[^a-zA-Z0-9]/g, '_')}`,
            email:       inv.email,
            displayName: inv.name,
            role:        'member',
          });
          // Email (best-effort)
          try {
            await notifyWorkspaceInvite({
              inviteeEmail:  inv.email,
              inviteeName:   inv.name,
              inviterName:   user.displayName || user.email,
              workspaceName: name.trim(),
              inviteUrl,
            });
          } catch { /* non-fatal */ }
        } catch (inviteErr) {
          console.warn('createWorkspaceInvite failed for', inv.email, inviteErr);
        }
      }

      if (onCreated) {
        try { await onCreated(wsId); } catch { /* non-fatal */ }
      }

      if (showToast) {
        const invitePart = invitees.length ? ` · ${invitees.length} invite${invitees.length > 1 ? 's' : ''} sent` : '';
        showToast(`Workspace "${name.trim()}" created!${invitePart}`, 'success');
      }
      onClose();
    } catch (e) {
      logError(e, { location: 'KanbanBoard:NewWorkspaceModal', action: 'createWorkspace' });
      const detail = e?.code === 'permission-denied'
        ? 'Permission denied — Firestore rules may be out of date.'
        : (e?.message || 'Unknown error');
      if (showToast) showToast(`Failed to create workspace. ${detail}`, 'warning');
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
    <div className="sheet-modal-overlay" onClick={onClose}>
      <div className="sheet-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={18} color="#7c3aed" />
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: 17, fontWeight: 700 }}>New Workspace</h3>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Workspace name */}
          <div>
            <label style={labelStyle}>Workspace name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Marketing Team, Q2 Projects…"
              autoFocus
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's this workspace for? (optional)"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Initial category + sub-category */}
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px' }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>
              <Folder size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Seed category (optional)
            </label>
            <div className="form-grid-2">
              <input
                value={catName}
                onChange={e => setCatName(e.target.value)}
                placeholder="Category (optional)"
                style={{ ...inputStyle, fontSize: 13 }}
              />
              <input
                value={subName}
                onChange={e => setSubName(e.target.value)}
                placeholder="Sub-category (optional)"
                disabled={!catName.trim()}
                style={{ ...inputStyle, fontSize: 13, opacity: catName.trim() ? 1 : 0.6 }}
              />
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
              You can add more categories later from the board.
            </p>
          </div>

          {/* Invite members */}
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px' }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>
              <UserPlus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Invite members (optional)
            </label>

            {/* Selected invitee chips */}
            {invitees.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {invitees.map(inv => (
                  <span key={inv.email} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', background: '#7c3aed', color: '#fff',
                    borderRadius: 20, fontSize: 12, fontWeight: 600,
                  }}>
                    {inv.name}
                    <button
                      type="button"
                      onClick={() => removeInvitee(inv.email)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, display: 'inline-flex' }}
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Input + suggestions */}
            <div style={{ position: 'relative' }}>
              <input
                value={inviteInput}
                onChange={e => handleInviteInputChange(e.target.value)}
                onKeyDown={handleInviteInputKey}
                placeholder="Type a name or email and pick from suggestions…"
                style={{ ...inputStyle, fontSize: 13 }}
              />
              {inviteSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                  marginTop: 4, maxHeight: 200, overflowY: 'auto', zIndex: 10,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}>
                  {inviteSuggestions.map(p => (
                    <button
                      key={p.email}
                      type="button"
                      onClick={() => addInvitee(p.email, p.displayName)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', background: 'none', border: 'none',
                        cursor: 'pointer', fontSize: 13, color: '#0f172a',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f5eef8'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ fontWeight: 600 }}>{p.displayName || p.email}</div>
                      {p.displayName && <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.email}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
              Invitees get an email + an in-app prompt to join. You can always invite more later.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>
            <X size={14} /> Cancel
          </button>
          <button
            className="btn btn-teal"
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            style={{
              opacity: (saving || !name.trim()) ? 0.6 : 1,
              cursor:  (saving || !name.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Creating…' : <><Plus size={14} /> Create Workspace</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewWorkspaceModal;
