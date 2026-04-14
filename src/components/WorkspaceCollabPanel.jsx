import { useState } from 'react';
import {
  ChevronDown, Mail, Send, Check as CheckIcon,
  MessageCircle, Activity as ActivityIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaceComments, useWorkspaceActivity, addWorkspaceComment, updateWorkspaceTask } from '../hooks/useWorkspace';
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
export default function WorkspaceCollabPanel({ workspaceId, task, onClose }) {
  const { user } = useAuth();
  const { comments } = useWorkspaceComments(workspaceId, task.id);
  const { activity }  = useWorkspaceActivity(workspaceId, task.id);

  const [tab,           setTab]          = useState('comments');
  const [commentText,   setCommentText]  = useState('');
  const [sending,       setSending]      = useState(false);
  const [statusSaving,  setStatusSaving] = useState(false);
  const [emailSent,     setEmailSent]    = useState(false);

  const handleSendEmail = () => {
    const statusLabel = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' }[task.status || 'open'] || task.status;
    const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date';
    const subject = encodeURIComponent(`[Task Update] ${task.text}`);
    const body = encodeURIComponent(
      `Hi ${task.assigneeName || task.assigneeEmail?.split('@')[0] || 'there'},\n\n` +
      `Here's a quick update on your task:\n\n` +
      `📋 Task: ${task.text}\n` +
      `📊 Status: ${statusLabel}\n` +
      `📅 Due: ${due}\n` +
      `🔴 Priority: ${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}\n\n` +
      `Please let me know if you have any questions.\n\n` +
      `Thanks,\n${user.displayName || user.email}`
    );
    window.location.href = `mailto:${task.assigneeEmail}?subject=${subject}&body=${body}`;
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const handleSend = async () => {
    const t = commentText.trim();
    if (!t) return;
    setSending(true);
    try {
      await addWorkspaceComment(workspaceId, task.id, {
        authorUid:   user.uid,
        authorName:  user.displayName || user.email,
        authorEmail: user.email,
        text: t,
      }, task);
      setCommentText('');
    } catch (e) { logError(e, { location: 'WorkspaceCollabPanel:handleSend', action: 'addWorkspaceComment' }, user.uid); }
    setSending(false);
  };

  const handleStatus = async (newStatus) => {
    if (newStatus === task.status) return;
    setStatusSaving(true);
    try {
      await updateWorkspaceTask(workspaceId, task.id, { status: newStatus }, user, task);
    } catch (e) { logError(e, { location: 'WorkspaceCollabPanel:handleStatus', action: 'updateWorkspaceTask' }, user.uid); }
    setStatusSaving(false);
  };

  const actionColor = {
    created: '#27ae60', status_changed: '#2980b9', commented: '#8e44ad', completed: '#27ae60',
  };

  return (
    <div style={{ border: '1px solid #d4c5a9', borderTop: 'none', borderRadius: '0 0 10px 10px', background: '#fffdf5', padding: '12px 16px 16px' }}>

      {/* Status selector */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Status</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map(({ value, label, color, bg }) => {
            const active = (task.status || 'open') === value;
            return (
              <button key={value} disabled={statusSaving} onClick={() => handleStatus(value)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: active ? `2px solid ${color}` : `1px solid ${color}55`,
                background: active ? bg : 'transparent', color: active ? color : '#8a7a6a',
                opacity: statusSaving ? 0.6 : 1, transition: 'all 0.15s',
              }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual email button — only shown when task has an assignee */}
      {task.assigneeEmail && (
        <div style={{ marginBottom: 14 }}>
          <button
            onClick={handleSendEmail}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: '1px solid #2980b944',
              background: emailSent ? '#eafaf1' : '#eaf4fb',
              color: emailSent ? '#27ae60' : '#2980b9',
              transition: 'all 0.2s',
            }}
          >
            {emailSent ? <><CheckIcon size={13} /> Email opened!</> : <><Mail size={13} /> Email {task.assigneeName || task.assigneeEmail}</>}
          </button>
          <span style={{ fontSize: 11, color: '#b5a898', marginLeft: 8 }}>Opens your email app with task details pre-filled</span>
        </div>
      )}

      {/* Tab bar */}
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

      {/* Comments */}
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
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
              placeholder="Write a comment… (⌘Enter to send)" rows={2}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d4c5a9', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', background: '#fffdf5', color: '#4a3728', lineHeight: 1.5, outline: 'none' }}
            />
            <button className="btn btn-teal btn-sm" onClick={handleSend} disabled={sending || !commentText.trim()} style={{ flexShrink: 0, height: 36 }}>
              <Send size={13} /> {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Activity */}
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
