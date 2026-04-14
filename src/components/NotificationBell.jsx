import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCircle, UserPlus, MessageSquare, ArrowRight, RefreshCw, Check, Briefcase } from 'lucide-react';

const typeConfig = {
  task_assigned:    { icon: UserPlus,      color: '#8B6914', bg: '#fef9ef',  label: 'Assigned'  },
  reassigned:       { icon: UserPlus,      color: '#2a6cb8', bg: '#e8f0fe',  label: 'Assigned'  },
  status_changed:   { icon: RefreshCw,     color: '#e67e22', bg: '#fef3e2',  label: 'Status'    },
  task_completed:   { icon: CheckCircle,   color: '#27ae60', bg: '#e8f8f0',  label: 'Completed' },
  comment:          { icon: MessageSquare, color: '#8e44ad', bg: '#f5eafa',  label: 'Comment'   },
  workspace_invite: { icon: Briefcase,     color: '#2a9d8f', bg: '#eaf6f5',  label: 'Invite'    },
  workspace_created:{ icon: Briefcase,     color: '#2a9d8f', bg: '#eaf6f5',  label: 'Workspace' },
};

// Safe timeAgo — handles null, undefined, plain JS Date, ISO string, and
// Firestore Timestamps (which have a .toDate() method).
function timeAgo(ts) {
  if (!ts) return '';
  try {
    const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(date.getTime())) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60)  return 'just now';
    const mins = Math.floor(seconds / 60);
    if (mins  < 60)  return `${mins}m ago`;
    const hrs  = Math.floor(mins  / 60);
    if (hrs   < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs   / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

export default function NotificationBell({ notifications, unreadCount, onMarkRead, onMarkAllRead, onNavigateToTasks }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        className="btn-icon"
        onClick={() => setOpen(!open)}
        title="Notifications"
        style={{ color: 'rgba(254,249,239,0.85)', position: 'relative' }}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -6,
            background: '#c0392b', color: '#fff',
            fontSize: 10, fontWeight: 800,
            minWidth: 18, height: 18,
            borderRadius: 9, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', lineHeight: 1,
            border: '2px solid #5a3e28',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0,
          width: 360, maxHeight: 440,
          background: '#fffdf5', border: '1px solid #d4c5a9',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          zIndex: 100, marginTop: 8,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #f0e6d2',
          }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#4a3728' }}>
              Notifications {unreadCount > 0 && <span style={{ color: '#c0392b' }}>({unreadCount})</span>}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => onMarkAllRead()}
                style={{
                  background: 'none', border: 'none', color: '#2a9d8f', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: '#8a7a6a' }}>
                <Bell size={28} color="#d4c5a9" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 14, margin: 0 }}>No notifications yet</p>
              </div>
            )}

            {notifications.map(n => {
              // Fall back to task_assigned config for unknown types — never crashes
              const cfg  = typeConfig[n.type] || typeConfig.task_assigned;
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.read) onMarkRead(n.id);
                    if (onNavigateToTasks) onNavigateToTasks();
                    setOpen(false);
                  }}
                  style={{
                    padding: '12px 16px', cursor: 'pointer',
                    borderBottom: '1px solid #f0e6d2',
                    background: n.read ? 'transparent' : cfg.bg,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (n.read) e.currentTarget.style.background = '#f9f5ec'; }}
                  onMouseLeave={e => { if (n.read) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {/* Icon */}
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: cfg.bg, border: `1px solid ${cfg.color}33`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, marginTop: 2,
                    }}>
                      <Icon size={15} color={cfg.color} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontWeight: n.read ? 500 : 700, fontSize: 13, color: '#4a3728',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {n.title}
                        </span>
                        <span style={{ fontSize: 11, color: '#8a7a6a', flexShrink: 0 }}>
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p style={{
                        fontSize: 12, color: '#8a7a6a', margin: '3px 0 0',
                        lineHeight: 1.4,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {n.body}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!n.read && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: cfg.color, flexShrink: 0, marginTop: 6,
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
