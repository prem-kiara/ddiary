import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useEntries, useTasks, useAssignedTasks, useTeamMembers } from './hooks/useFirestore';
import { useNotifications } from './hooks/useNotifications';
import KanbanBoard from './components/KanbanBoard';
import TasksPage from './components/TasksPage';
import WorkspaceInvitePrompt from './components/WorkspaceInvitePrompt';
import ErrorBoundary from './components/ErrorBoundary';
import Auth from './components/Auth';
import Layout from './components/Layout';
import Toast from './components/Toast';
import DiaryList from './components/DiaryList';
import DiaryView from './components/DiaryView';
import DiaryEditor from './components/DiaryEditor';
import TeamTaskView from './components/TeamTaskView';
import SettingsPage from './components/SettingsPage';
import './styles/diary.css';

// ─── Route wrappers ──────────────────────────────────────────────────────────
// DiaryView needs an entry object. We prefer route state (fast, no re-fetch)
// then fall back to finding by ID in the already-loaded entries array.
function DiaryViewPage({ entries, archivedEntries, onEdit, onDelete, onArchive, onUnarchive }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const entry = location.state?.entry
    || entries.find(e => e.id === id)
    || archivedEntries.find(e => e.id === id);

  if (!entry) return <Navigate to="/" replace />;

  return (
    <DiaryView
      entry={entry}
      onBack={() => navigate('/')}
      onEdit={onEdit}
      onDelete={onDelete}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
    />
  );
}

// DiaryEditor for new entries (/write) and existing entries (/write/:id).
// Wraps onSave to include the editing entry's ID so DiaryApp can route the
// call to either addEntry or updateEntry without DiaryEditor needing to know.
function DiaryEditorPage({ entries, archivedEntries, onSave, onCancel, showToast }) {
  const { id } = useParams();
  const location = useLocation();
  const editingEntry = id
    ? (location.state?.entry || entries.find(e => e.id === id) || archivedEntries.find(e => e.id === id))
    : null;

  const handleSave = useCallback(
    async (entryData) => onSave(entryData, editingEntry?.id || null),
    [onSave, editingEntry]
  );

  return (
    <DiaryEditor
      editingEntry={editingEntry || null}
      onSave={handleSave}
      onCancel={onCancel}
      showToast={showToast}
    />
  );
}

// ─── Main app shell ──────────────────────────────────────────────────────────
function DiaryApp() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isCollaborator, setWorkspaceId, joinWorkspace } = useAuth();
  const {
    entries, trashedEntries, archivedEntries, loading: entriesLoading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry,
    archiveEntry, unarchiveEntry,
  } = useEntries();
  const { tasks, loading: tasksLoading, addTask, updateTask, toggleTask, deleteTask, clearCompleted } = useTasks();
  const { members, loading: membersLoading, addMember, addMembersBulk, updateMember, deleteMember } = useTeamMembers();
  const { tasks: assignedTasks } = useAssignedTasks();

  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  // ─── Handle ?workspace= invite link for already-authenticated users ─────────
  // Auth.jsx handles this for unauthenticated users.  For users who are already
  // signed in, they land straight in the app and Auth.jsx never renders, so we
  // process the param here instead — and clean up the URL afterwards.
  useEffect(() => {
    if (!user) return;
    const params  = new URLSearchParams(window.location.search);
    const wsParam = params.get('workspace');
    if (!wsParam) return;
    // Clean the URL immediately so back-navigation doesn't re-trigger this
    window.history.replaceState({}, '', window.location.pathname);
    joinWorkspace(wsParam)
      .then(() => showToast('You have joined the workspace!', 'success'))
      .catch(() => showToast('Could not join workspace — the link may have expired.', 'warning'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]); // run once per sign-in, not on every render

  // ─── Push-notification permission ────────────────────────────────────────
  const permissionRequested = useRef(false);
  useEffect(() => {
    if (user && !permissionRequested.current && 'Notification' in window && Notification.permission === 'default') {
      permissionRequested.current = true;
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

  const handleNewNotification = useCallback((n) => {
    showToast(n.body || n.title, 'info');
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(n.title || 'DDiary', {
          body: n.body || '',
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          tag: n.id,
        });
      } catch { /* some browsers don't support Notification constructor */ }
    }
  }, [showToast]);

  const { notifications, unreadCount, markRead, markAllRead } = useNotifications({ onNewNotification: handleNewNotification });

  // Update PWA app icon badge count
  useEffect(() => {
    if ('setAppBadge' in navigator) {
      if (unreadCount > 0) navigator.setAppBadge(unreadCount).catch(() => {});
      else                 navigator.clearAppBadge().catch(() => {});
    }
  }, [unreadCount]);

  // ─── Entry handlers ──────────────────────────────────────────────────────
  // editingId is supplied by DiaryEditorPage when an existing entry is being edited.
  const handleSaveEntry = async (entryData, editingId = null) => {
    if (editingId) await updateEntry(editingId, entryData);
    else           await addEntry(entryData);
    navigate('/');
  };

  const handleDeleteEntry   = async (id) => { await deleteEntry(id);   showToast('Entry moved to trash', 'success');        navigate('/'); };
  const handleArchiveEntry  = async (id) => { await archiveEntry(id);  showToast('Entry archived', 'success');              navigate('/'); };
  const handleUnarchiveEntry= async (id) => { await unarchiveEntry(id); showToast('Entry restored to diary', 'success');   navigate('/'); };
  const handleRestoreEntry  = async (id) => { await restoreEntry(id);  showToast('Entry restored', 'success'); };
  const handlePurgeEntry    = async (id) => { await purgeEntry(id);    showToast('Entry permanently deleted', 'success'); };

  const goToEditEntry = (entry) => navigate(`/write/${entry.id}`, { state: { entry } });

  // ─── Auth gate ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #fef9ef 0%, #f5e6c8 50%, #ede0c8 100%)',
        fontFamily: "'Georgia', serif", color: '#8B6914'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
          <p style={{ fontSize: 18, fontFamily: "'Caveat', cursive" }}>Opening your diary...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Auth />;

  const pendingCount = tasks.filter(t => !t.completed).length;

  const commonLayoutProps = {
    notifications, unreadCount,
    onMarkRead: markRead, onMarkAllRead: markAllRead,
  };

  // ─── Collaborator view — workspace Kanban only ───────────────────────────
  if (isCollaborator) {
    return (
      <>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <WorkspaceInvitePrompt showToast={showToast} />
        <Layout pendingCount={0} collaboratorMode {...commonLayoutProps}>
          <ErrorBoundary>
            <Routes>
              <Route path="/settings" element={<SettingsPage showToast={showToast} />} />
              <Route path="*"         element={<KanbanBoard onWorkspaceCreated={setWorkspaceId} showToast={showToast} />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </>
    );
  }

  // ─── Full app ────────────────────────────────────────────────────────────
  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <WorkspaceInvitePrompt showToast={showToast} />
      <Layout pendingCount={pendingCount} {...commonLayoutProps}>
        <ErrorBoundary>
        <Routes>
          {/* Diary home */}
          <Route
            path="/"
            element={
              <DiaryList
                entries={entries}
                trashedEntries={trashedEntries}
                archivedEntries={archivedEntries}
                loading={entriesLoading}
                onView={(entry) => navigate(`/entry/${entry.id}`, { state: { entry } })}
                onNew={() => navigate('/write')}
                onRestore={handleRestoreEntry}
                onPurge={handlePurgeEntry}
                onArchive={handleArchiveEntry}
                onUnarchive={handleUnarchiveEntry}
              />
            }
          />

          {/* View a single entry */}
          <Route
            path="/entry/:id"
            element={
              <DiaryViewPage
                entries={entries}
                archivedEntries={archivedEntries}
                onEdit={goToEditEntry}
                onDelete={handleDeleteEntry}
                onArchive={handleArchiveEntry}
                onUnarchive={handleUnarchiveEntry}
              />
            }
          />

          {/* Write new entry */}
          <Route
            path="/write"
            element={
              <DiaryEditorPage
                entries={entries}
                archivedEntries={archivedEntries}
                onSave={handleSaveEntry}
                onCancel={() => navigate('/')}
                showToast={showToast}
              />
            }
          />

          {/* Edit existing entry */}
          <Route
            path="/write/:id"
            element={
              <DiaryEditorPage
                entries={entries}
                archivedEntries={archivedEntries}
                onSave={handleSaveEntry}
                onCancel={() => navigate(-1)}
                showToast={showToast}
              />
            }
          />

          {/* Tasks */}
          <Route
            path="/tasks"
            element={
              <>
                <TasksPage
                  tasks={tasks}
                  members={members}
                  loading={tasksLoading}
                  onAdd={addTask}
                  onUpdate={updateTask}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                  onClearCompleted={clearCompleted}
                  showToast={showToast}
                  onWorkspaceCreated={setWorkspaceId}
                />
                {assignedTasks.length > 0 && <TeamTaskView />}
              </>
            }
          />

          {/* Settings */}
          <Route path="/settings" element={<SettingsPage showToast={showToast} />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </Layout>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DiaryApp />
    </AuthProvider>
  );
}
