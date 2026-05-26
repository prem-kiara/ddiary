import { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown, Send, Check as CheckIcon, Save,
  MessageCircle, Activity as ActivityIcon, UserCheck, X, Mail, Loader2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaceComments, useWorkspaceActivity, addWorkspaceComment, updateWorkspaceTask } from '../hooks/useWorkspace';
import { notifyTaskReassigned, sendTaskEmailNow } from '../utils/emailNotifications';
import { sendTaskWhatsApp } from '../utils/whatsapp';
import { searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';
import { useTeamMembers } from '../hooks/useFirestore';
import { logError } from '../utils/errorLogger';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#475569', bg: '#f1f5f9' },
  { value: 'in_progress', label: 'In Progress', color: '#2563eb', bg: '#eff6ff' },
  { value: 'review',      label: 'Review',      color: '#7c3aed', bg: '#f5eef8' },
  { value: 'done',        label: 'Done',        color: '#15803d', bg: '#eafaf1' },
];

const formatTime = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// ── Workspace Collab Panel ────────────────────────────────────────────────────
// `compact` = true → hide the status selector and Reassign UI, render only the
//   Comments/Activity tab pair. Used by the inline-collapsible task card in
//   the Team Board view, where status/reassign live elsewhere (status badge
//   popover on the card header, reassign lives in the full-detail modal).
export default function WorkspaceCollabPanel({ workspaceId, task, isAdmin = false, onClose, compact = false, showToast }) {
  const { user } = useAuth();
  const { members } = useTeamMembers();
  const { comments } = useWorkspaceComments(workspaceId, task.id);
  const { activity }  = useWorkspaceActivity(workspaceId, task.id);

  // Look up the assignee's phone from the saved contacts book
  const assigneePhone = useMemo(() => {
    if (!task.assigneeEmail) return '';
    return members.find(m => m.email?.toLowerCase() === task.assigneeEmail.toLowerCase())?.phone || '';
  }, [members, task.assigneeEmail]);

  // Current user is the assignee if UID matches OR email matches (case-insensitive)
  const isAssignee = !!(
    (task.assigneeUid  && task.assigneeUid  === user.uid) ||
    (task.assigneeEmail && task.assigneeEmail.toLowerCase() === user.email?.toLowerCase())
  );
  // Only assignee or admin can change status / reassign
  const canAct = isAssignee || isAdmin;

  const [tab,          setTab]          = useState('comments');
  const [commentText,  setCommentText]  = useState('');
  const [saving,       setSaving]       = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

  // Pending status — clicking a button only stages the change; must be saved explicitly
  const [pendingStatus, setPendingStatus] = useState(null);
  // Reset pending if the saved status changes externally (real-time update from another user)
  useEffect(() => { setPendingStatus(null); }, [task.status]);

  const effectiveStatus = pendingStatus ?? (task.status || 'open');
  const hasStatusChange = pendingStatus !== null && pendingStatus !== task.status;

  // ── Reassign state ──────────────────────────────────────────────────────────
  const [showReassign,        setShowReassign]        = useState(false);
  const [reassignQuery,       setReassignQuery]       = useState('');
  const [reassignSuggestions, setReassignSuggestions] = useState([]);
  const [reassignPersons,     setReassignPersons]     = useState([]);  // multi
  const [reassignComment,     setReassignComment]     = useState('');
  const [reassigning,         setReassigning]         = useState(false);
  const [reassignError,       setReassignError]       = useState('');

  // ── Save staged status change ───────────────────────────────────────────────
  const handleSaveStatus = async () => {
    if (!hasStatusChange) return;
    setStatusSaving(true);
    try {
      await updateWorkspaceTask(workspaceId, task.id, { status: pendingStatus }, user, task);
      setPendingStatus(null);
    } catch (e) { logError(e, { location: 'WorkspaceCollabPanel:handleSaveStatus' }, user.uid); }
    setStatusSaving(false);
  };

  // ── Comment save ────────────────────────────────────────────────────────────
  const handleSaveComment = async () => {
    const t = commentText.trim();
    if (!t) return;
    setSaving(true);
    try {
      await addWorkspaceComment(workspaceId, task.id, {
        authorUid:   user.uid,
        authorName:  user.displayName || user.email,
        authorEmail: user.email,
        text: t,
      }, task);
      setCommentText('');
    } catch (e) { logError(e, { location: 'WorkspaceCollabPanel:handleSaveComment' }, user.uid); }
    setSaving(false);
  };

  // ── Reassign search ─────────────────────────────────────────────────────────
  const handleReassignSearch = (val) => {
    setReassignQuery(val);
    setReassignError('');
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(r => setReassignSuggestions(r || []));
    } else {
      setReassignSuggestions([]);
    }
  };

  const selectReassignPerson = (person) => {
    const p = { email: person.email?.toLowerCase(), name: person.displayName || person.email, uid: person.id || null };
    setReassignPersons(prev => prev.find(x => x.email === p.email) ? prev : [...prev, p]);
    setReassignQuery('');
    setReassignSuggestions([]);
  };

  const removeReassignPerson = (email) =>
    setReassignPersons(prev => prev.filter(p => p.email !== email));

  // ── Send reassign (also saves any staged status change) ─────────────────────
  const handleReassign = async () => {
    if (!reassignPersons.length) { setReassignError('Please select at least one person.'); return; }
    setReassigning(true);
    setReassignError('');
    try {
      const primary    = reassignPersons[0];
      const coAssignees = reassignPersons.slice(1).map(p => ({ uid: p.uid || null, email: p.email, name: p.name }));

      // 1. Post comment if provided
      if (reassignComment.trim()) {
        await addWorkspaceComment(workspaceId, task.id, {
          authorUid:   user.uid,
          authorName:  user.displayName || user.email,
          authorEmail: user.email,
          text:        reassignComment.trim(),
        }, task);
      }

      // 2. Reassign (+ include any staged status change in the same write)
      const updates = {
        assigneeEmail: primary.email,
        assigneeUid:   primary.uid   || null,
        assigneeName:  primary.name  || primary.email,
        coAssignees:   coAssignees.length ? coAssignees : null,
      };
      if (hasStatusChange) updates.status = pendingStatus;

      await updateWorkspaceTask(workspaceId, task.id, updates, user, task);
      setPendingStatus(null);

      // 3. Email all assignees (non-fatal)
      reassignPersons.forEach(p => {
        notifyTaskReassigned({
          assigneeEmail:    p.email,
          assigneeName:     p.name,
          taskText:         task.text,
          dueDate:          task.dueDate,
          priority:         task.priority,
          reassignedByName: user.displayName || user.email,
          latestComment:    reassignComment.trim() || null,
          taskId:           task.id,
          workspaceId,
        }).catch(() => {});
      });

      // 4. Reset
      setShowReassign(false);
      setReassignQuery('');
      setReassignPersons([]);
      setReassignComment('');
    } catch (e) {
      logError(e, { location: 'WorkspaceCollabPanel:handleReassign' }, user.uid);
      setReassignError('Failed to reassign. Please try again.');
    }
    setReassigning(false);
  };

  // ── On-demand Email / WhatsApp for the task assignee ───────────────────────
  const handleEmailNow = async () => {
    if (!task.assigneeEmail) return;
    setEmailSending(true);
    try {
      await sendTaskEmailNow({
        toEmail:     task.assigneeEmail,
        toName:      task.assigneeName,
        taskText:    task.text,
        taskId:      task.id,
        workspaceId,
        dueDate:     task.dueDate,
        priority:    task.priority || 'medium',
        notes:       task.notes,
        senderName:  user.displayName || user.email,
      });
      showToast?.(`Email sent to ${task.assigneeName || task.assigneeEmail}.`, 'success');
    } catch {
      showToast?.('Could not send email. Please try again.', 'warning');
    }
    setEmailSending(false);
  };

  const handleWhatsApp = () => {
    sendTaskWhatsApp(
      { ...task, assigneePhone, workspaceId },
      { user, showToast, fromFallback: 'Your manager' },
    );
  };

  const actionColor = {
    created: '#15803d', status_changed: '#2563eb', commented: '#7c3aed',
    completed: '#15803d', reassigned: '#d97706', moved: '#0d9488',
  };

  return (
    <div style={{ border: '1px solid #cbd5e1', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#ffffff', padding: '12px 16px 16px' }}>

      {/* ── Status selector (hidden in compact mode) ─────────────────────────── */}
      {!compact && (
      <div style={{ marginBottom: hasStatusChange ? 8 : 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          Status
          {!canAct && (
            <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              (only the assignee can change status)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map(({ value, label, color, bg }) => {
            const active = effectiveStatus === value;
            const isPendingChange = active && hasStatusChange;
            const locked = !canAct;
            return (
              <button
                key={value}
                disabled={locked}
                onClick={() => {
                  if (!canAct) return;
                  // Clicking the currently saved status reverts any staged change
                  if (value === (task.status || 'open')) setPendingStatus(null);
                  else setPendingStatus(value);
                }}
                title={locked ? 'Only the assignee can change status' : undefined}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                  cursor: locked ? 'not-allowed' : 'pointer',
                  border: active ? `2px solid ${color}` : `1px solid ${color}55`,
                  background: active ? bg : 'transparent',
                  color: active ? color : locked ? '#94a3b8' : '#475569',
                  opacity: locked ? 0.5 : 1,
                  // Dashed border signals "staged but not saved"
                  borderStyle: isPendingChange ? 'dashed' : 'solid',
                  transition: 'all 0.15s',
                }}
              >
                {label}
                {isPendingChange && <span style={{ fontSize: 9, marginLeft: 2 }}>●</span>}
              </button>
            );
          })}
        </div>
      </div>

      )}

      {/* Save status button — only shown when there's a staged change */}
      {!compact && hasStatusChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button
            onClick={handleSaveStatus}
            disabled={statusSaving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: statusSaving ? 'not-allowed' : 'pointer',
              border: 'none', background: '#7c3aed', color: '#fff',
              opacity: statusSaving ? 0.6 : 1, transition: 'opacity 0.15s',
            }}
          >
            <Save size={12} /> {statusSaving ? 'Saving…' : 'Save Status'}
          </button>
          <button
            onClick={() => setPendingStatus(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}
          >
            Revert
          </button>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Unsaved change</span>
        </div>
      )}

      {/* ── Reassign section — hidden in compact mode ────────────────────────── */}
      {!compact && canAct && (
        <div style={{ marginBottom: 14 }}>
          {!showReassign ? (
            <button
              onClick={() => setShowReassign(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: '1px solid #d9770644',
                background: '#fdf5ec', color: '#d97706', transition: 'all 0.2s',
              }}
            >
              <UserCheck size={13} /> Reassign Task
            </button>
          ) : (
            <div style={{ background: '#fdf5ec', border: '1px solid #d9770633', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <UserCheck size={13} /> Reassign Task
                </span>
                <button
                  onClick={() => { setShowReassign(false); setReassignQuery(''); setReassignPersons([]); setReassignComment(''); setReassignError(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', padding: 2 }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Selected people pills */}
              {reassignPersons.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {reassignPersons.map((p, i) => (
                    <span key={p.email} style={{
                      background: '#ede9fe', color: '#6d28d9', borderRadius: 12,
                      padding: '3px 10px 3px 12px', fontSize: 12, fontWeight: 600,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      {i === 0 && <span style={{ fontSize: 10, opacity: 0.7, marginRight: 2 }}>primary</span>}
                      {p.name}
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); removeReassignPerson(p.email); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', padding: 0, fontSize: 15, lineHeight: 1 }}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Person search */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  type="text"
                  value={reassignQuery}
                  onChange={e => handleReassignSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setReassignSuggestions([]); }}
                  onBlur={() => setTimeout(() => setReassignSuggestions([]), 150)}
                  placeholder={reassignPersons.length ? 'Add another person…' : 'Search name or email…'}
                  autoComplete="off"
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: `1px solid ${reassignPersons.length ? '#15803d44' : '#e2e8f0'}`,
                    borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)',
                    background: '#ffffff', color: '#0f172a', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {reassignSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
                    background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
                  }}>
                    {reassignSuggestions.map(p => {
                      const already = reassignPersons.find(x => x.email === p.email?.toLowerCase());
                      return (
                        <div
                          key={p.id || p.email}
                          onMouseDown={() => !already && selectReassignPerson(p)}
                          style={{ padding: '8px 12px', cursor: already ? 'default' : 'pointer', borderBottom: '1px solid #f1f5f9', opacity: already ? 0.5 : 1 }}
                          onMouseEnter={e => { if (!already) e.currentTarget.style.background = '#f1f5f9'; }}
                          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.displayName} {already && <span style={{ color: '#7c3aed', fontSize: 11 }}>✓ added</span>}</div>
                          <div style={{ fontSize: 11, color: '#475569' }}>{p.email}</div>
                          {p.jobTitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.jobTitle}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {reassignPersons.length > 0 && (
                  <div style={{ fontSize: 11, color: '#15803d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckIcon size={11} /> {reassignPersons.length === 1 ? `Assigning to ${reassignPersons[0].name}` : `Assigning to ${reassignPersons.length} people`}
                  </div>
                )}
              </div>

              {/* Optional comment */}
              <textarea
                value={reassignComment}
                onChange={e => setReassignComment(e.target.value)}
                placeholder="Add a comment for the new assignee (optional)…"
                rows={2}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0',
                  borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)',
                  background: '#ffffff', color: '#0f172a', resize: 'none',
                  outline: 'none', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 8,
                }}
              />

              {reassignError && (
                <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{reassignError}</div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={handleReassign}
                  disabled={reassigning || reassignPersons.length === 0}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    cursor: reassigning || !reassignPersons.length ? 'not-allowed' : 'pointer',
                    border: 'none', background: '#d97706', color: '#fff',
                    opacity: reassigning || !reassignPersons.length ? 0.6 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <Send size={13} />
                  {reassigning ? 'Reassigning…' : 'Send & Reassign'}
                </button>
                {hasStatusChange && (
                  <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
                    ✓ Will also save status change
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Email Now + WhatsApp (non-compact, assignee must be set) ────────── */}
      {!compact && task.assigneeEmail && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={handleEmailNow}
            disabled={emailSending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: emailSending ? 'not-allowed' : 'pointer',
              border: 'none', background: '#2563eb', color: '#fff',
              opacity: emailSending ? 0.6 : 1, transition: 'opacity 0.15s',
            }}
          >
            {emailSending
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <Mail size={13} />}
            {emailSending ? 'Sending…' : 'Email Now'}
          </button>
          <button
            onClick={handleWhatsApp}
            disabled={!assigneePhone}
            title={!assigneePhone
              ? 'No phone number saved for this contact. Add it in Settings → Contacts.'
              : `Send WhatsApp to ${task.assigneeName || task.assigneeEmail}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: !assigneePhone ? 'not-allowed' : 'pointer',
              border: 'none',
              background: assigneePhone ? '#25D366' : '#e2e8f0',
              color: assigneePhone ? '#fff' : '#94a3b8',
              transition: 'opacity 0.15s',
            }}
          >
            <MessageCircle size={13} /> WhatsApp
          </button>
          {!assigneePhone && (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              No phone — add in Settings → Contacts
            </span>
          )}
        </div>
      )}

      {/* ── Tab bar ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 12 }}>
        {[
          { key: 'comments', label: 'Comments', Icon: MessageCircle, count: comments.length },
          { key: 'activity', label: 'Activity',  Icon: ActivityIcon,  count: activity.length  },
        ].map(({ key, label, Icon, count }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: 13, fontWeight: 600,
            color: tab === key ? '#7c3aed' : '#475569',
            borderBottom: tab === key ? '2px solid #7c3aed' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Icon size={13} /> {label}
            {count > 0 && <span style={{ background: tab === key ? '#7c3aed' : '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* ── Comments ──────────────────────────────────────────────────────────── */}
      {tab === 'comments' && (
        <div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
            {comments.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No comments yet — be the first!</p>}
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: c.authorUid === user.uid ? '#eff6ff' : '#f1f5f9' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: c.authorUid === user.uid ? '#7c3aed22' : '#7c3aed33', color: c.authorUid === user.uid ? '#7c3aed' : '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {(c.authorName || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#0f172a' }}>{c.authorName || 'Unknown'}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="comment-compose" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <textarea
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveComment(); }}
              placeholder="Write a comment… (⌘Enter to save)" rows={2}
              style={{ flex: '1 1 180px', minWidth: 0, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', background: '#ffffff', color: '#0f172a', lineHeight: 1.5, outline: 'none' }}
            />
            <button className="btn btn-teal btn-sm" onClick={handleSaveComment} disabled={saving || !commentText.trim()} style={{ flexShrink: 0, minHeight: 40 }}>
              <Save size={13} /> {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── Activity ──────────────────────────────────────────────────────────── */}
      {tab === 'activity' && (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {activity.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No activity yet.</p>}
          {activity.map((a, i) => (
            <div key={a.id || i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: actionColor[a.action] || '#475569' }} />
                {i < activity.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 16, background: '#e2e8f0', marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#0f172a', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{a.actorName || 'Someone'}</span>{' '}
                  <span style={{ color: actionColor[a.action] || '#475569', fontWeight: 600 }}>{a.action?.replace('_', ' ')}</span>
                  {a.detail && a.action !== 'commented' && <span style={{ color: '#475569' }}> — {a.detail}</span>}
                </div>
                {a.action === 'commented' && a.detail && (
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 2, fontStyle: 'italic' }}>"{a.detail.length > 60 ? a.detail.slice(0, 60) + '…' : a.detail}"</div>
                )}
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatTime(a.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {onClose && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <ChevronDown size={12} /> Close
          </button>
        </div>
      )}
    </div>
  );
}
