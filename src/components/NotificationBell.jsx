import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCircle, UserPlus, MessageSquare, RefreshCw, Check, Briefcase } from 'lucide-react';

const typeConfig = {
  task_assigned:    { icon: UserPlus,      color: '#7c3aed', bg: '#f5f3ff',  label: 'Assigned'  },
  reassigned:       { icon: UserPlus,      color: '#2563eb', bg: '#eff6ff',  label: 'Assigned'  },
  status_changed:   { icon: RefreshCw,     color: '#d97706', bg: '#fef3c7',  label: 'Status'    },
  task_completed:   { icon: CheckCircle,   color: '#15803d', bg: '#f0fdf4',  label: 'Completed' },
  comment:          { icon: MessageSquare, color: '#7c3aed', bg: '#f5f3ff',  label: 'Comment'   },
  workspace_invite: { icon: Briefcase,     color: '#4f46e5', bg: '#eef2ff',  label: 'Invite'    },
  workspace_created:{ icon: Briefcase,     color: '#4f46e5', bg: '#eef2ff',  label: 'Workspace' },
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
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        className="btn-icon relative"
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="notif-dropdown absolute top-full right-0 w-[360px] max-h-[440px] bg-white border border-slate-200 rounded-xl shadow-lg z-[100] mt-2 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
            <span className="font-bold text-sm text-slate-900">
              Notifications {unreadCount > 0 && <span className="text-red-600">({unreadCount})</span>}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => onMarkAllRead()}
                className="text-xs font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1"
              >
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 && (
              <div className="py-10 px-6 text-center text-slate-500">
                <Bell size={26} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm m-0">No notifications yet</p>
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
                  className={`px-4 py-3 cursor-pointer border-b border-slate-50 last:border-b-0 transition-colors ${n.read ? 'hover:bg-slate-50' : ''}`}
                  style={{ background: n.read ? undefined : cfg.bg }}
                >
                  <div className="flex gap-2.5 items-start">
                    {/* Icon */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: cfg.bg, border: `1px solid ${cfg.color}33` }}
                    >
                      <Icon size={14} color={cfg.color} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center gap-2">
                        <span
                          className={`text-[13px] text-slate-900 truncate ${n.read ? 'font-medium' : 'font-bold'}`}
                        >
                          {n.title}
                        </span>
                        <span className="text-[11px] text-slate-500 flex-shrink-0">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug line-clamp-2">
                        {n.body}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!n.read && (
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                        style={{ background: cfg.color }}
                      />
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
