import { BookOpen, Home, PenTool, CheckSquare, Bell, Settings, LogOut, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

export default function Layout({ children, currentPage, onNavigate, pendingCount, memberMode = false }) {
  const { user, logout } = useAuth();

  const ownerNavItems = [
    { id: 'home',      icon: Home,        label: 'Diary'     },
    { id: 'write',     icon: PenTool,     label: 'Write'     },
    { id: 'tasks',     icon: CheckSquare, label: 'Tasks'     },
    { id: 'reminders', icon: Bell,        label: 'Reminders' },
    { id: 'team',      icon: Users,       label: 'Team'      },
    { id: 'settings',  icon: Settings,    label: 'Settings'  },
  ];

  // Team members see only their tasks + settings
  const memberNavItems = [
    { id: 'tasks',    icon: CheckSquare, label: 'My Tasks' },
    { id: 'settings', icon: Settings,    label: 'Settings' },
  ];

  const navItems = memberMode ? memberNavItems : ownerNavItems;

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header className="app-header">
        <h1>
          <BookOpen size={24} />
          <span>{memberMode ? 'Team Tasks' : 'My Digital Diary'}</span>
        </h1>
        <div className="header-info">
          {!memberMode && pendingCount > 0 && <span className="badge" style={{ padding: '4px 10px' }}>{pendingCount} pending</span>}
          {user?.displayName && (
            <span className="header-date" style={{ fontSize: 13 }}>{user.displayName}</span>
          )}
          <span className="header-date">{formatDate(Date.now())}</span>
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
            className={`nav-btn ${currentPage === n.id ? 'active' : ''}`}
            onClick={() => onNavigate(n.id)}
          >
            <n.icon size={18} />
            <span>{n.label}</span>
            {n.id === 'tasks' && !memberMode && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
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
