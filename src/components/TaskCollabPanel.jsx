import { useState } from 'react';
import {
  MessageCircle, Activity, ChevronDown, ChevronUp, Send,
  Circle, Clock, Eye, CheckCircle, User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTaskComments, useTaskActivity, addComment, updateTaskStatus } from '../hooks/useFirestore';

/* ── Status config ────────────────────────────────────────────────────────── */
const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#8a7a6a', bg: '#f5f0e5', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2980b9', bg: '#eaf4fb', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#8e44ad', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#27ae60', bg: '#eafaf1', Icon: CheckCircle  },
];

function StatusBadge({ status }) {
  const cfg = STATUSES.find(s => s.value === status) || STATUSES[0];
  const { Icon, color, bg, label } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color, border: `1px solid ${color}44`,
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
    }}>
      <Icon size={10} /> {label}
    </span>
  );
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── TaskCollabPanel ──────────────────────────────────────────────────────── */
/**
 * Reusable panel that renders below a task card.
 *
 * Props:
 *   ownerUid   — UID of the task owner (used for Firestore paths)
 *   task       — full task object (id, status, text, …)
 *   onClose    — called when the panel is dismissed
 *   canChangeStatus — whether the current user may update status (owner or assignee)
 */
export default function TaskCollabPanel({ ownerUid, task, onClose, canChangeStatus = true }) {
  const { user } = useAuth();
  const { comments, loading: cLoading } = useTaskComments(ownerUid, task.id);
  const { activity }                    = useTaskActivity(ownerUid, task.id);

  const [tab,        setTab]        = useState('comments'); // 'comments' | 'activity'
  const [commentText, setCommentText] = useState('');
  const [sending,    setSending]    = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  /* ── Post a comment ─────────────────────────────────────────────────── */
  const handleSend = async () => {
    const text = commentText.trim();
    if (!text) return;
    setSending(true);
    try {
      await addComment(ownerUid, task.id, {
        authorUid:  user.uid,
        authorName: user.displayName || user.email,
        text,
      });
      setCommentText('');
    } catch (err) {
      console.error('addComment error', err);
    }
    setSending(false);
  };

  /* ── Change status ──────────────────────────────────────────────────── */
  const handleStatus = async (newStatus) => {
    if (newStatus === task.status) return;
    setStatusSaving(true);
    try {
      await updateTaskStatus(ownerUid, task.id, {
        status:    newStatus,
        actorUid:  user.uid,
        actorName: user.displayName || user.email,
      });
    } catch (err) {
      console.error('updateTaskStatus error', err);
    }
    setStatusSaving(false);
  };

  return (
    <div style={{
      border: '1px solid #d4c5a9',
      borderTop: 'none',
      borderRadius: '0 0 10px 10px',
      background: '#fffdf5',
      padding: '12px 16px 16px',
    }}>

      {/* ── Status selector ──────────────────────────────────────────────── */}
      {canChangeStatus && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8a7a6a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Status
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUSES.map(({ value, label, color, bg, Icon }) => {
              const active = (task.status || 'open') === value;
              return (
                <button
                  key={value}
                  disabled={statusSaving}
                  onClick={() => handleStatus(value)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                    cursor: statusSaving ? 'default' : 'pointer',
                    border: active ? `2px solid ${color}` : `1px solid ${color}55`,
                    background: active ? bg : 'transparent',
                    color: active ? color : '#8a7a6a',
                    opacity: statusSaving ? 0.6 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <Icon size={11} /> {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8d5b7', marginBottom: 12 }}>
        {[
          { key: 'comments', label: 'Comments', Icon: MessageCircle, count: comments.length },
          { key: 'activity', label: 'Activity',  Icon: Activity,       count: activity.length  },
        ].map(({ key, label, Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              color: tab === key ? '#2a9d8f' : '#8a7a6a',
              borderBottom: tab === key ? '2px solid #2a9d8f' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <Icon size={13} /> {label}
            {count > 0 && (
              <span style={{
                background: tab === key ? '#2a9d8f' : '#c9a96e',
                color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '1px 5px', borderRadius: 8, minWidth: 16, textAlign: 'center',
              }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Comments tab ─────────────────────────────────────────────────── */}
      {tab === 'comments' && (
        <div>
          {/* Thread */}
          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
            {cLoading && <p style={{ color: '#8a7a6a', fontSize: 13 }}>Loading…</p>}
            {!cLoading && comments.length === 0 && (
              <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                No comments yet. Be the first!
              </p>
            )}
            {comments.map(c => (
              <div key={c.id} style={{
                display: 'flex', gap: 8, marginBottom: 10,
                padding: '8px 10px', borderRadius: 8,
                background: c.authorUid === user.uid ? '#eaf4fb' : '#f5f0e5',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c.authorUid === user.uid ? '#2a9d8f22' : '#c9a96e33',
                  color: c.authorUid === user.uid ? '#2a9d8f' : '#8B6914',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13, flexShrink: 0,
                }}>
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

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
              placeholder="Write a comment… (⌘Enter to send)"
              rows={2}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                border: '1px solid #d4c5a9', fontSize: 13,
                fontFamily: 'var(--font-body)', resize: 'none',
                background: '#fffdf5', color: '#4a3728',
                lineHeight: 1.5, outline: 'none',
              }}
            />
            <button
              className="btn btn-teal btn-sm"
              onClick={handleSend}
              disabled={sending || !commentText.trim()}
              style={{ flexShrink: 0, height: 36 }}
            >
              <Send size={13} /> {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* ── Activity tab ─────────────────────────────────────────────────── */}
      {tab === 'activity' && (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {activity.length === 0 && (
            <p style={{ color: '#b5a898', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
              No activity yet.
            </p>
          )}
          {activity.map((a, i) => {
            const actionColor = {
              created:       '#27ae60',
              completed:     '#27ae60',
              reopened:      '#e67e22',
              status_changed:'#2980b9',
              commented:     '#8e44ad',
            }[a.action] || '#8a7a6a';

            return (
              <div key={a.id || i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                {/* Timeline dot */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: actionColor }} />
                  {i < activity.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 16, background: '#e8d5b7', marginTop: 2 }} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#4a3728', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 700 }}>{a.actorName || 'Someone'}</span>
                    {' '}
                    <span style={{ color: actionColor, fontWeight: 600 }}>{a.action?.replace('_', ' ')}</span>
                    {a.detail && a.action !== 'commented' && (
                      <span style={{ color: '#8a7a6a' }}> — {a.detail}</span>
                    )}
                  </div>
                  {a.action === 'commented' && a.detail && (
                    <div style={{ fontSize: 12, color: '#8a7a6a', marginTop: 2, fontStyle: 'italic' }}>
                      "{a.detail.length > 60 ? a.detail.slice(0, 60) + '…' : a.detail}"
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#b5a898', marginTop: 2 }}>{formatTime(a.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Close handle ─────────────────────────────────────────────────── */}
      {onClose && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: '#b5a898', display: 'inline-flex', alignItems: 'center', gap: 3,
            }}
          >
            <ChevronUp size={12} /> Close
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Re-export StatusBadge for use in other components ─────────────────── */
export { StatusBadge, STATUSES };
