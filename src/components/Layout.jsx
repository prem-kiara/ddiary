import { useNavigate, useLocation } from 'react-router-dom';
import { Home, PenTool, CheckSquare, Settings, LogOut, List, Kanban } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import NotificationBell from './NotificationBell';
import Avatar from './shared/Avatar';

const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// Map URL path prefixes to nav item IDs so the active tab highlights correctly.
function useActivePage() {
  const { pathname } = useLocation();
  if (pathname === '/' || pathname.startsWith('/entry')) return 'home';
  if (pathname.startsWith('/write'))    return 'write';
  if (pathname.startsWith('/tasks'))    return 'tasks';
  if (pathname.startsWith('/team'))     return 'team';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/collaborate')) return 'collaborate';
  return 'home';
}

export default function Layout({
  children, pendingCount,
  memberMode = false, collaboratorMode = false,
  notifications = [], unreadCount = 0, onMarkRead, onMarkAllRead,
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const activePage = useActivePage();

  const ownerNavItems = [
    { id: 'home',     path: '/',         icon: Home,        label: 'Diary'    },
    { id: 'write',    path: '/write',    icon: PenTool,     label: 'Write'    },
    { id: 'tasks',    path: '/tasks',    icon: List,        label: 'Tasks'    },
    { id: 'settings', path: '/settings', icon: Settings,    label: 'Settings' },
  ];

  // Team members (subordinates) see only their assigned tasks + settings
  const memberNavItems = [
    { id: 'tasks',    path: '/tasks',    icon: CheckSquare, label: 'My Tasks' },
    { id: 'settings', path: '/settings', icon: Settings,    label: 'Settings' },
  ];

  // Collaborators (peers) see only the shared workspace + settings
  const collaboratorNavItems = [
    { id: 'collaborate', path: '/',         icon: Kanban,   label: 'Collaborate' },
    { id: 'settings',    path: '/settings', icon: Settings, label: 'Settings'    },
  ];

  const navItems = collaboratorMode
    ? collaboratorNavItems
    : memberMode
      ? memberNavItems
      : ownerNavItems;

  const headerTitle = collaboratorMode ? 'Workspace' : memberMode ? 'Team Tasks' : 'Dhanam Workspace';
  const showTaskBadge = !memberMode && !collaboratorMode && pendingCount > 0;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="app-header">
        <h1>
          <img
            src="/Logo.png"
            alt="Dhanam"
            className="h-8 w-auto object-contain shrink-0"
            draggable={false}
          />
          <span>{headerTitle}</span>
        </h1>
        <div className="header-info">
          {showTaskBadge && (
            <span className="badge hide-mobile">{pendingCount} pending</span>
          )}
          <span className="header-date hidden md:inline">{formatDate(Date.now())}</span>
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead || (() => {})}
            onMarkAllRead={onMarkAllRead || (() => {})}
            onNavigateToTasks={() => navigate('/tasks')}
          />
          {user && (
            <Avatar
              id={user.uid || user.email}
              name={user.displayName}
              email={user.email}
              size="sm"
              title={user.displayName || user.email}
            />
          )}
          <button className="btn-icon" onClick={logout} title="Sign Out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Top navigation — desktop + tablet */}
      <nav className="app-nav">
        {navItems.map(n => (
          <button
            key={n.id}
            className={`nav-btn ${activePage === n.id ? 'active' : ''}`}
            onClick={() => navigate(n.path)}
          >
            <n.icon size={16} />
            <span>{n.label}</span>
            {n.id === 'tasks' && showTaskBadge && (
              <span className="badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main className="main-content">
        {children}
      </main>

      {/* Bottom tab bar — mobile (phones). Shown only via CSS on ≤640px. */}
      <nav className="bottom-tabs" aria-label="Primary">
        {navItems.map(n => (
          <button
            key={n.id}
            className={`bottom-tabs-btn ${activePage === n.id ? 'active' : ''}`}
            onClick={() => navigate(n.path)}
            aria-label={n.label}
            aria-current={activePage === n.id ? 'page' : undefined}
          >
            <span className="bt-icon-wrap">
              <n.icon size={22} strokeWidth={activePage === n.id ? 2.4 : 2} />
            </span>
            <span>{n.label}</span>
            {n.id === 'tasks' && showTaskBadge && (
              <span className="bt-badge">{pendingCount > 9 ? '9+' : pendingCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
