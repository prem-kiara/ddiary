import { useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, Home, PenTool, CheckSquare, Settings, LogOut, List, Kanban } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import NotificationBell from './NotificationBell';

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

  const headerTitle = collaboratorMode ? 'Workspace' : memberMode ? 'Team Tasks' : 'My Digital Diary';

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header className="app-header">
        <h1>
          <BookOpen size={24} />
          <span>{headerTitle}</span>
        </h1>
        <div className="header-info">
          {!memberMode && !collaboratorMode && pendingCount > 0 && (
            <span className="badge" style={{ padding: '4px 10px' }}>{pendingCount} pending</span>
          )}
          {user?.displayName && (
            <span className="header-date" style={{ fontSize: 13 }}>{user.displayName}</span>
          )}
          <span className="header-date">{formatDate(Date.now())}</span>
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead || (() => {})}
            onMarkAllRead={onMarkAllRead || (() => {})}
            onNavigateToTasks={() => navigate('/tasks')}
          />
          <button className="btn-icon" onClick={logout} title="Sign Out" style={{ color: 'rgba(254,249,239,0.7)' }}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        {navItems.map(n => (
          <button
            key={n.id}
            className={`nav-btn ${activePage === n.id ? 'active' : ''}`}
            onClick={() => navigate(n.path)}
          >
            <n.icon size={18} />
            <span>{n.label}</span>
            {n.id === 'tasks' && !memberMode && !collaboratorMode && pendingCount > 0 && (
              <span className="badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
