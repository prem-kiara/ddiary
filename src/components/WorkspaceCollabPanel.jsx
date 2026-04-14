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
  { value: 'open',        label: 'Open',        color: '#8a7a6a', bg: '#f5f0e5' },
  { value: 'in_progress', label: 'In Progress', color: '#2980b9', bg: '#eaf4fb' },
  { value: 'review',      label: 'Review',      color: '#8e44ad', bg: '#f5eef8' },
  { value: 'done',        label: 'Done',        color: '#27ae60', bg: '#eafaf1' },
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
    created: '#27ae60', status_changed: '#2980b9', commented: '#8e44ad',
    completed: '#27ae60', reassigned: '#e67e22',
  };

  return (
    <div style={{ border: '1px solid #d4c5a9', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#fffdf5', padding: '12px 16px 16px' }}>

      {/* ── Status selector ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: hasStatusChange ? 8 : 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          Status
          {!canAct && (
            <span style={{ fontSize: 10, color: '#b5a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
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
                  color: active ? color : locked ? '#c9b89a' : '#8a7a6a',
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
              border: 'none', background: '#2a9d8f', color: '#fff',
              opacity: statusSaving ? 0.6 : 1, transition: 'opacity 0.15s',
            }}
          >
            <Save size={12} /> {statusSaving ? 'Saving…' : 'Save Status'}
          </button>
          <button
            onClick={() => setPendingStatus(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#b5a898' }}
          >
            Revert
          </button>
          <span style={{ fontSize: 11, color: '#b5a898' }}>Unsaved change</span>
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
                cursor: 'pointer', border: '1px solid #e67e2244',
                background: '#fdf5ec', color: '#e67e22', transition: 'all 0.2s',
              }}
            >
              <UserCheck size={13} /> Reassign Task
            </button>
          ) : (
            <div style={{ background: '#fdf5ec', border: '1px solid #e67e2233', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#e67e22', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <UserCheck size={13} /> Reassign Task
                </span>
                <button
                  onClick={() => { setShowReassign(false); setReassignQuery(''); setReassignPerson(null); setReassignComment(''); setReassignError(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a7a6a', display: 'flex', padding: 2 }}
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
                    border: `1px solid ${reassignPerson ? '#27ae6044' : '#e8d5b7'}`,
                    borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)',
                    background: '#fffdf5', color: '#4a3728', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {reassignSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
                    background: '#fff', border: '1px solid #d4c5a9', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: 2, overflow: 'hidden',
                  }}>
                    {reassignSuggestions.map(p => (
                      <div
                        key={p.id || p.email}
                        onMouseDown={() => selectReassignPerson(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0e8d8' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f5f0e5'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3728' }}>{p.displayName}</div>
                        <div style={{ fontSize: 11, color: '#8a7a6a' }}>{p.email}</div>
                        {p.jobTitle && <div style={{ fontSize: 11, color: '#b5a898' }}>{p.jobTitle}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {reassignPerson && (
                  <div style={{ fontSize: 11, color: '#27ae60', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  width: '100%', padding: '8px 12px', border: '1px solid #e8d5b7',
                  borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)',
                  background: '#fffdf5', color: '#4a3728', resize: 'none',
                  outline: 'none', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 8,
                }}
              />

              {reassignError && (
                <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 8 }}>{reassignError}</div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={handleReassign}
                  disabled={reassigning || !reassignPerson}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    cursor: reassigning || !reassignPerson ? 'not-allowed' : 'pointer',
                    border: 'none', background: '#e67e22', color: '#fff',
                    opacity: reassigning || !reassignPerson ? 0.6 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <Send size={13} />
                  {reassigning ? 'Reassigning…' : 'Send & Reassign'}
                </button>
                {hasStatusChange && (
                  <span style={{ fontSize: 11, color: '#2a9d8f', fontWeight: 600 }}>
                    ✓ Will also save status change
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab bar ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8d5b7', marginBottom: 12 }}>
        {[
          { key: 'comments', label: 'Comments', Icon: MessageCircle, count: comments.length },
          { key: 'activity', label: 'Activity',  Icon: ActivityIcon,  count: activity.length  },
        ].map(({ key, label, Icon, count }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', fontSize: 13, fontWeight: 600,
            color: tab === key ? '#2a9d8f' : '#8a7a6a',
            borderBottom: tab === key ? '2px solid #2a9d8f' : '2px solid transparent',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Icon size={13} /> {label}
            {count > 0 && <span style={{ background: tab === key ? '#2a9d8f' : '#c9a96e', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* ── Comments ──────────────────────────────────────────────────────────── */}
      {tab === 'comments' && (
        <div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
            {comments.length === 0 && <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No comments yet — be the first!</p>}
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: c.authorUid === user.uid ? '#eaf4fb' : '#f5f0e5' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: c.authorUid === user.uid ? '#2a9d8f22' : '#c9a96e33', color: c.authorUid === user.uid ? '#2a9d8f' : '#8B6914', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {(c.authorName || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#4a3728' }}>{c.authorName || 'Unknown'}</span>
                    <span style={{ fontSize: 11, color: '#b5a898' }}>{formatTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#4a3728', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveComment(); }}
              placeholder="Write a comment… (⌘Enter to save)" rows={2}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d4c5a9', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', background: '#fffdf5', color: '#4a3728', lineHeight: 1.5, outline: 'none' }}
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
          {activity.length === 0 && <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No activity yet.</p>}
          {activity.map((a, i) => (
            <div key={a.id || i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: actionColor[a.action] || '#8a7a6a' }} />
                {i < activity.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 16, background: '#e8d5b7', marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#4a3728', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{a.actorName || 'Someone'}</span>{' '}
                  <span style={{ color: actionColor[a.action] || '#8a7a6a', fontWeight: 600 }}>{a.action?.replace('_', ' ')}</span>
                  {a.detail && a.action !== 'commented' && <span style={{ color: '#8a7a6a' }}> — {a.detail}</span>}
                </div>
                {a.action === 'commented' && a.detail && (
                  <div style={{ fontSize: 12, color: '#8a7a6a', marginTop: 2, fontStyle: 'italic' }}>"{a.detail.length > 60 ? a.detail.slice(0, 60) + '…' : a.detail}"</div>
                )}
                <div style={{ fontSize: 11, color: '#b5a898', marginTop: 2 }}>{formatTime(a.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {onClose && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#b5a898', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <ChevronDown size={12} /> Close
          </button>
        </div>
      )}
    </div>
  );
}
