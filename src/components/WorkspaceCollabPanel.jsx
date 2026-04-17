import { useState, useEffect } from 'react';
import {
  ChevronDown, Send, Check as CheckIcon, Save,
  MessageCircle, Activity as ActivityIcon, UserCheck, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaceComments, useWorkspaceActivity, addWorkspaceComment, updateWorkspaceTask } from '../hooks/useWorkspace';
import { notifyTaskReassigned } from '../utils/emailNotifications';
import { searchOrgPeopleDebounced } from '../utils/graphPeopleSearch';
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
export default function WorkspaceCollabPanel({ workspaceId, task, isAdmin = false, onClose }) {
  const { user } = useAuth();
  const { comments } = useWorkspaceComments(workspaceId, task.id);
  const { activity }  = useWorkspaceActivity(workspaceId, task.id);

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
  const [reassignPerson,      setReassignPerson]      = useState(null);
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
    setReassignPerson(null);
    setReassignError('');
    if (val.trim().length >= 2) {
      searchOrgPeopleDebounced(val.trim()).then(r => setReassignSuggestions(r || []));
    } else {
      setReassignSuggestions([]);
    }
  };

  const selectReassignPerson = (person) => {
    setReassignPerson({ email: person.email, name: person.displayName || person.email, uid: person.id || null });
    setReassignQuery(person.displayName || person.email);
    setReassignSuggestions([]);
  };

  // ── Send reassign (also saves any staged status change) ─────────────────────
  const handleReassign = async () => {
    if (!reassignPerson?.email) { setReassignError('Please select a person from the list.'); return; }
    setReassigning(true);
    setReassignError('');
    try {
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
        assigneeEmail: reassignPerson.email.toLowerCase(),
        assigneeUid:   reassignPerson.uid   || null,
        assigneeName:  reassignPerson.name  || reassignPerson.email,
      };
      if (hasStatusChange) updates.status = pendingStatus;

      await updateWorkspaceTask(workspaceId, task.id, updates, user, task);
      setPendingStatus(null);

      // 3. Email new assignee (non-fatal)
      notifyTaskReassigned({
        assigneeEmail:    reassignPerson.email,
        assigneeName:     reassignPerson.name,
        taskText:         task.text,
        dueDate:          task.dueDate,
        priority:         task.priority,
        reassignedByName: user.displayName || user.email,
        latestComment:    reassignComment.trim() || null,
        workspaceUrl:     window.location.origin,
      }).catch(() => {});

      // 4. Reset
      setShowReassign(false);
      setReassignQuery('');
      setReassignPerson(null);
      setReassignComment('');
    } catch (e) {
      logError(e, { location: 'WorkspaceCollabPanel:handleReassign' }, user.uid);
      setReassignError('Failed to reassign. Please try again.');
    }
    setReassigning(false);
  };

  const actionColor = {
    created: '#15803d', status_changed: '#2563eb', commented: '#7c3aed',
    completed: '#15803d', reassigned: '#d97706',
  };

  return (
    <div style={{ border: '1px solid #cbd5e1', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#ffffff', padding: '12px 16px 16px' }}>

      {/* ── Status selector ───────────────────────────────────────────────────── */}
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

      {/* Save status button — only shown when there's a staged change */}
      {hasStatusChange && (
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

      {/* ── Reassign section — only shown to assignee or admin ────────────────── */}
      {canAct && (
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
                  onClick={() => { setShowReassign(false); setReassignQuery(''); setReassignPerson(null); setReassignComment(''); setReassignError(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', padding: 2 }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Person search */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  type="text"
                  value={reassignQuery}
                  onChange={e => handleReassignSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setReassignSuggestions([]); }}
                  onBlur={() => setTimeout(() => setReassignSuggestions([]), 150)}
                  placeholder="Search name or email…"
                  autoComplete="off"
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: `1px solid ${reassignPerson ? '#15803d44' : '#e2e8f0'}`,
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
                    {reassignSuggestions.map(p => (
                      <div
                        key={p.id || p.email}
                        onMouseDown={() => selectReassignPerson(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{p.displayName}</div>
                        <div style={{ fontSize: 11, color: '#475569' }}>{p.email}</div>
                        {p.jobTitle && <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.jobTitle}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {reassignPerson && (
                  <div style={{ fontSize: 11, color: '#15803d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckIcon size={11} /> Assigning to <strong>{reassignPerson.name}</strong> ({reassignPerson.email})
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
                  disabled={reassigning || !reassignPerson}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    cursor: reassigning || !reassignPerson ? 'not-allowed' : 'pointer',
                    border: 'none', background: '#d97706', color: '#fff',
                    opacity: reassigning || !reassignPerson ? 0.6 : 1,
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveComment(); }}
              placeholder="Write a comment… (⌘Enter to save)" rows={2}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', background: '#ffffff', color: '#0f172a', lineHeight: 1.5, outline: 'none' }}
            />
            <button className="btn btn-teal btn-sm" onClick={handleSaveComment} disabled={saving || !commentText.trim()} style={{ flexShrink: 0, height: 36 }}>
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
