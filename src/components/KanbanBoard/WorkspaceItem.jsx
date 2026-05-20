import { useState, useEffect, useRef, useContext } from 'react';
import {
  X, ChevronDown, ChevronRight, User, Send,
  Check as CheckIcon, Users, Edit2, UserPlus, AlertTriangle,
  Trash2, Copy, GripVertical, Plus, FolderPlus,
} from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../contexts/AuthContext';
import {
  useWorkspace, renameWorkspace, deleteWorkspace,
  createWorkspaceInvite, getExistingInvite, addWorkspaceMember,
} from '../../hooks/useWorkspace';
import { logError } from '../../utils/errorLogger';
import { notifyWorkspaceInvite } from '../../utils/emailNotifications';
import { searchOrgPeopleDebounced } from '../../utils/graphPeopleSearch';
import { sendBatchInvites, summariseInviteResult } from '../../utils/batchInvite';
import DeepLinkContext from '../../contexts/DeepLinkContext';
import WorkspaceBoardContent from './WorkspaceBoardContent';

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

  // ── Deep-link auto-expand + scroll into view ─────────────────────────────
  // When the Dashboard navigated to a task in this workspace, auto-expand
  // the card and scroll it to the top of the viewport so the user lands at
  // the right place. Children (CategorySection / TaskCard) handle the rest.
  const { openWorkspaceId, openTaskId } = useContext(DeepLinkContext);
  // Latch openTaskId into local state the moment this workspace becomes the
  // target. This survives the context cleanup timeout so DeepLinkContext's
  // openTaskId can be re-injected for task cards that mount after Firestore
  // finishes loading (which can take longer than the cleanup window).
  const [latchedTaskId, setLatchedTaskId] = useState(null);
  const wsScrollRef = useRef(null);
  useEffect(() => {
    if (openWorkspaceId && openWorkspaceId === workspace.id) {
      setExpanded(true);
      if (openTaskId) setLatchedTaskId(openTaskId);
      // Defer scroll to next tick so the expanded body has measured.
      const t = setTimeout(() => {
        wsScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 250);
      return () => clearTimeout(t);
    }
  }, [openWorkspaceId, openTaskId, workspace.id]);
  const [showInvite,      setShowInvite]      = useState(false);
  const [showAddTask,     setShowAddTask]     = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showDelete,      setShowDelete]      = useState(false);
  const [deleting,        setDeleting]        = useState(false);

  // Members are always loaded (shown in header chip row)
  const { members, loading: membersLoading } = useWorkspace(workspace.id);

  // ── Invite state (chips-based, batch send) ──────────────────────────────
  // `invitees` — list of chips staged for the next Send click: [{email,name}]
  // `inviteInput` — text currently typed into the search box
  // `inviteSuggestions` — org-directory autocomplete results
  // `inviteSummary` — last Send result (for the inline status banner)
  const [invitees,          setInvitees]          = useState([]);
  const [inviteInput,       setInviteInput]       = useState('');
  const [inviteSending,     setInviteSending]     = useState(false);
  const [inviteSummary,     setInviteSummary]     = useState(null); // { text, tone }
  const [inviteError,       setInviteError]       = useState('');
  const [copied,            setCopied]            = useState(false);
  const [inviteSuggestions, setInviteSuggestions] = useState([]);

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

  // Enter / comma commit the current text as a chip; Backspace on an empty
  // input removes the last chip (standard email-chips UX).
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

  // Paste-safe: if user pastes "a@x.com, b@x.com; c@x.com" we add them all.
  const handleInvitePaste = (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!text || !/[,;\s]/.test(text)) return; // plain single-email paste: let onChange handle
    e.preventDefault();
    const parts = text.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    parts.forEach(p => addInviteChip(p));
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

  const handleBatchInvite = async () => {
    // Commit any pending text as a final chip before sending, so the user
    // doesn't have to explicitly press Enter first.
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
        workspaceId:     workspace.id,
        workspaceName:   workspace.name,
        inviter:         { uid: user.uid, email: user.email, displayName: user.displayName },
        invitees:        pool,
        existingMembers: members,
        inviteUrl,
      });
      const text = summariseInviteResult(result);
      // Tone: green if anything sent, amber if nothing sent but invitees were skipped, red on hard failures only.
      const tone = result.sent.length > 0 ? 'success' : (result.failed.length > 0 ? 'error' : 'info');
      setInviteSummary({ text, tone });
      if (showToast) showToast(text, tone === 'error' ? 'warning' : 'success');
      // Clear chips + input once the batch goes through. Any failed emails
      // are listed in the inline summary so the user can retry by typing.
      setInvitees([]);
      setInviteInput('');
      setInviteSuggestions([]);
    } catch (e) {
      logError(e, { location: 'WorkspaceItem:handleBatchInvite' }, user.uid);
      setInviteError('Failed to send invites — please try again.');
    } finally {
      setInviteSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const { isSuperAdmin } = useAuth();
  const isAdmin = workspace.role === 'admin' || workspace.createdBy === user.uid || isSuperAdmin;

  // ── DnD: this whole card is a drop target ───────────────────────────────────
  // Accepts both task drops (cross-workspace task move) and workspace drops
  // (workspace → task conversion). KanbanBoard's onDragEnd dispatches based on
  // active.data.kind.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id:   `wsdrop:${workspace.id}`,
    data: { kind: 'workspaceDropZone', workspace, workspaceId: workspace.id },
  });

  // ── DnD: a small grip handle on the header makes the workspace draggable ────
  // We deliberately use a dedicated handle (not the whole header) so the
  // existing click-to-expand and action buttons stay click-only.
  const {
    attributes: dragAttrs, listeners: dragListeners, setNodeRef: setDragRef,
    transform: dragTransform, isDragging,
  } = useDraggable({
    id:   `ws:${workspace.id}`,
    data: { kind: 'workspace', workspace },
  });

  return (
    <div
      ref={(el) => { setDropRef(el); wsScrollRef.current = el; }}
      className="card"
      style={{
        marginBottom:  10,
        padding:       0,
        overflow:      'hidden',
        border:        isOver ? '2px solid #7c3aed' : '1px solid #e2e8f0',
        background:    isOver ? '#faf5ff' : undefined,
        transition:    'border-color 0.2s, background 0.2s',
        boxShadow:     isOver ? '0 0 0 4px rgba(124, 58, 237, 0.12)' : 'none',
        opacity:       isDragging ? 0.5 : 1,
        transform:     dragTransform ? CSS.Translate.toString(dragTransform) : undefined,
      }}
    >
      {/* ── Header row ───────────────────────────────────────────────────────── */}
      <div
        className="ws-header-row"
        onClick={toggleExpanded}
        style={{
          background:    expanded ? '#f1f5f9' : '#ffffff',
          borderBottom:  expanded || showInvite ? '1px solid #e2e8f0' : 'none',
          transition:    'background 0.2s',
          userSelect:    'none',
        }}
      >
        {/* Drag handle — small grip icon, only this triggers workspace drag */}
        <button
          ref={setDragRef}
          {...dragAttrs}
          {...dragListeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag this workspace to convert it into a task"
          aria-label="Drag workspace"
          style={{
            background: 'none', border: 'none', padding: 4, cursor: 'grab',
            color: '#94a3b8', display: 'flex', alignItems: 'center', flexShrink: 0,
            marginRight: 2,
          }}
        >
          <GripVertical size={14} />
        </button>
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
            {/* Workspace creator — looked up from the loaded members list. */}
            {(() => {
              const creator = members.find(m => m.uid === workspace.createdBy);
              const creatorName = creator?.displayName || creator?.email;
              if (!creatorName) return null;
              return (
                <span
                  title={`Created by ${creatorName}`}
                  style={{
                    fontSize: 11, color: '#7c3aed', background: '#f5f3ff',
                    padding: '2px 7px', borderRadius: 10, fontWeight: 600,
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    flexShrink: 0, maxWidth: 160, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  <User size={10} /> by {creatorName.split(' ')[0]}
                </span>
              );
            })()}
            {/* Member count */}
            {!membersLoading && (
              <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <Users size={11} /> {members.length}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="ws-header-actions" onClick={e => e.stopPropagation()}>
          {/* Invite */}
          <button
            onClick={() => setShowInvite(v => !v)}
            className="btn btn-sm btn-outline"
            style={{ gap: 5 }}
          >
            <UserPlus size={13} /> Invite
          </button>

          {/* Add Category — available to every workspace member (not just
              admin/creator). Rename & delete remain admin-only. Triggers the
              inline input panel at the top of the board. */}
          <button
            onClick={() => { setExpanded(true); setShowAddCategory(true); }}
            className="btn btn-sm btn-outline"
            style={{ gap: 5 }}
          >
            <FolderPlus size={13} /> <span className="hide-mobile">Add </span>Category
          </button>

          {/* New task */}
          <button
            onClick={() => { setExpanded(true); setShowAddTask(true); }}
            className="btn btn-sm btn-teal"
            style={{ gap: 5 }}
          >
            <Plus size={13} /> Task
          </button>

          {/* Delete moved out of the header — see the small "Delete workspace"
              link rendered at the bottom of the expanded body below. Keeping
              destructive actions out of the header reduces accidental clicks. */}
        </div>

        {/* Expand / collapse chevron — always right-aligned for consistency */}
        <div style={{ color: '#475569', flexShrink: 0, display: 'flex', marginLeft: 4 }}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </div>

      {/* ── Invite panel (chips-based, batch send) ──────────────────────────── */}
      {showInvite && (
        <div style={{ padding: '14px 18px', background: '#eff6ff', borderBottom: expanded ? '1px solid #e2e8f0' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={14} /> Invite to <strong>{workspace.name}</strong>
              {invitees.length > 0 && (
                <span style={{ fontSize: 11, color: '#2563eb', background: '#dbeafe', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>
                  {invitees.length} ready
                </span>
              )}
            </div>
            <button onClick={() => { setShowInvite(false); setInviteError(''); setInviteInput(''); setInvitees([]); setInviteSummary(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
              <X size={16} />
            </button>
          </div>

          {/* Chips + input + autocomplete */}
          <div style={{ position: 'relative', marginBottom: inviteError ? 6 : 10 }}>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              alignItems: 'center', padding: '6px 8px',
              borderRadius: 8, border: `1px solid ${inviteError ? '#dc262666' : '#2563eb44'}`,
              background: '#fff', minHeight: 40,
            }}>
              {invitees.map(inv => (
                <span key={inv.email}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: '#dbeafe', color: '#1d4ed8',
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
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', display: 'flex', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={inviteInput}
                onChange={e => handleInviteInputChange(e.target.value)}
                onKeyDown={handleInviteInputKey}
                onPaste={handleInvitePaste}
                onBlur={() => setTimeout(() => setInviteSuggestions([]), 150)}
                placeholder={invitees.length ? 'Add another…' : 'Search name or email — Enter to add, paste a list to bulk-add'}
                autoComplete="off"
                style={{
                  flex: '1 1 180px', minWidth: 140,
                  padding: '6px 4px', border: 'none', outline: 'none',
                  background: 'transparent', fontSize: 13, color: '#0f172a',
                  fontFamily: 'var(--font-body)',
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

          {/* Send / clear row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: inviteSummary ? 10 : 6, alignItems: 'center' }}>
            <button className="btn btn-sm btn-teal" onClick={handleBatchInvite}
              disabled={inviteSending || (invitees.length === 0 && !inviteInput.trim())}
              style={{ flexShrink: 0, minWidth: 120 }}>
              {inviteSending ? '…' : <><Send size={13} /> Send{invitees.length > 1 ? ` ${invitees.length} invites` : ' invite'}</>}
            </button>
            {invitees.length > 0 && (
              <button onClick={() => { setInvitees([]); setInviteSummary(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 12 }}>
                Clear list
              </button>
            )}
          </div>

          {/* Inline result banner — green on success, amber when everyone was skipped */}
          {inviteSummary && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600,
              color: inviteSummary.tone === 'success' ? '#15803d'
                   : inviteSummary.tone === 'error'   ? '#dc2626'
                   : '#d97706',
              marginBottom: 10,
            }}>
              {inviteSummary.tone === 'success' ? <CheckIcon size={13} /> : <AlertTriangle size={13} />}
              {inviteSummary.text}
            </div>
          )}

          {/* Inline error */}
          {inviteError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#dc2626', marginBottom: 10 }}>
              <AlertTriangle size={13} /> {inviteError}
            </div>
          )}

          {/* Help text */}
          <p style={{ fontSize: 11, color: '#6a9fd4', marginBottom: 10, marginTop: 0 }}>
            Add people as chips, then click Send. They'll each receive an invite they can accept or decline. People already in the workspace or with a pending invite are skipped automatically.
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
      {/* Categories are nested inside the workspace — a small left indent makes
          the tree hierarchy visually legible without another card wrapper. */}
      {expanded && (
        <div style={{ padding: '0 14px 14px 18px', background: '#ffffff' }}>
          <WorkspaceBoardContent
            workspaceId={workspace.id}
            members={members}
            showToast={showToast}
            user={user}
            workspaces={workspaces}
            onWorkspaceCreated={onWorkspaceCreated}
            showAddTaskInitial={showAddTask}
            onAddTaskClose={() => setShowAddTask(false)}
            showAddCategoryInitial={showAddCategory}
            onAddCategoryClose={() => setShowAddCategory(false)}
            isAdmin={isAdmin}
            highlightTaskId={latchedTaskId}
            onHighlightTaskConsumed={() => setLatchedTaskId(null)}
          />

          {/* Workspace delete — moved here from the header so it's deliberate.
              Only admins/super-admins see it; only visible when expanded. */}
          {isAdmin && !showDelete && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0', textAlign: 'right' }}>
              <button
                onClick={() => setShowDelete(true)}
                title="Delete this workspace"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#dc2626aa', fontSize: 12, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 8px', borderRadius: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none';    e.currentTarget.style.color = '#dc2626aa'; }}
              >
                <Trash2 size={12} /> Delete workspace
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorkspaceItem;
