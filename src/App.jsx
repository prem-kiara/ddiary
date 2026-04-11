import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useEntries, useTasks, useAssignedTasks, useTeamMembers, useUserDirectory } from './hooks/useFirestore';
import { useNotifications } from './hooks/useNotifications';
import KanbanBoard from './components/KanbanBoard';
import TasksPage from './components/TasksPage';
import Auth from './components/Auth';
import Layout from './components/Layout';
import Toast from './components/Toast';
import DiaryList from './components/DiaryList';
import DiaryView from './components/DiaryView';
import DiaryEditor from './components/DiaryEditor';
import TeamMembers from './components/TeamMembers';
import TeamTaskView from './components/TeamTaskView';
import SettingsPage from './components/SettingsPage';
import './styles/diary.css';

function DiaryApp() {
  const { user, loading: authLoading, isCollaborator, setWorkspaceId } = useAuth();
  const {
    entries, trashedEntries, archivedEntries, loading: entriesLoading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry,
    archiveEntry, unarchiveEntry,
  } = useEntries();
  const { tasks, loading: tasksLoading, addTask, updateTask, toggleTask, deleteTask, clearCompleted } = useTasks();
  const { members, loading: membersLoading, addMember, addMembersBulk, updateMember, deleteMember } = useTeamMembers();
  const { tasks: assignedTasks } = useAssignedTasks();
  const { directory } = useUserDirectory(user?.uid);

  // ─── Retroactive task & member patch ────────────────────────────────────
  useEffect(() => {
    tasks.forEach(task => {
      if (task.assigneeEmail && task.assigneeEmail !== task.assigneeEmail.toLowerCase()) {
        updateTask(task.id, { assigneeEmail: task.assigneeEmail.toLowerCase() }).catch(() => {});
      }
    });
  }, [tasks]);

  // Track which emails we've already auto-added to avoid duplicate writes
  const autoAddedRef = useRef(new Set());

  useEffect(() => {
    if (!directory.length) return;
    directory.forEach(async (dirEntry) => {
      const emailKey = dirEntry.email?.toLowerCase();
      if (!emailKey || !dirEntry.uid) return;

      const memberRecord = members.find(m => m.email?.toLowerCase() === emailKey);

      if (memberRecord && !memberRecord.uid) {
        updateMember(memberRecord.id, { uid: dirEntry.uid }).catch(() => {});
      } else if (!memberRecord && !autoAddedRef.current.has(emailKey)) {
        autoAddedRef.current.add(emailKey);
        addMember({
          name: dirEntry.displayName || dirEntry.email,
          email: dirEntry.email,
          phone: '',
        }).catch(() => {});
      }

      tasks.forEach(task => {
        if (task.assigneeEmail?.toLowerCase() === emailKey && !task.assigneeUid) {
          updateTask(task.id, { assigneeUid: dirEntry.uid }).catch(() => {});
        }
      });
    });
  }, [directory, tasks, members]);

  const [page, setPage] = useState('home');
  const [viewingEntry, setViewingEntry] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);

  // ─── Real-time notifications ────────────────────────────────────────────
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

  const {
    notifications, unreadCount, markRead, markAllRead,
  } = useNotifications({ onNewNotification: handleNewNotification });

  // Update PWA app icon badge count
  useEffect(() => {
    if ('setAppBadge' in navigator) {
      if (unreadCount > 0) {
        navigator.setAppBadge(unreadCount).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [unreadCount]);

  const pendingCount = tasks.filter(t => !t.completed).length;

  // ─── Navigation helpers ──────────────────────────────────────────────
  const navigate = (p) => {
    setPage(p);
    setViewingEntry(null);
    if (p === 'write' && !editingEntry) setEditingEntry(null);
  };

  const goToNewEntry = () => { setEditingEntry(null); setPage('write'); };
  const goToEditEntry = (entry) => { setEditingEntry(entry); setPage('write'); };
  const handleViewEntry = (entry) => { setViewingEntry(entry); };

  // ─── Entry handlers ──────────────────────────────────────────────────
  const handleSaveEntry = async (entryData) => {
    if (editingEntry) await updateEntry(editingEntry.id, entryData);
    else await addEntry(entryData);
    setEditingEntry(null);
    setPage('home');
  };

  const handleDeleteEntry = async (id) => { await deleteEntry(id); setViewingEntry(null); showToast('Entry moved to trash', 'success'); };
  const handleArchiveEntry = async (id) => { await archiveEntry(id); setViewingEntry(null); showToast('Entry archived', 'success'); };
  const handleUnarchiveEntry = async (id) => { await unarchiveEntry(id); setViewingEntry(null); showToast('Entry restored to diary', 'success'); };
  const handleRestoreEntry = async (id) => { await restoreEntry(id); showToast('Entry restored', 'success'); };
  const handlePurgeEntry = async (id) => { await purgeEntry(id); showToast('Entry permanently deleted', 'success'); };
  const handleCancelEdit = () => { setEditingEntry(null); setPage('home'); };

  // ─── Auth gate ───────────────────────────────────────────────────────
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

  // ─── Collaborator view (role: 'collaborator') — workspace Kanban only ──
  if (isCollaborator) {
    return (
      <>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <Layout
          currentPage={page} onNavigate={navigate} pendingCount={0} collaboratorMode
          notifications={notifications} unreadCount={unreadCount}
          onMarkRead={markRead} onMarkAllRead={markAllRead}
        >
          {page !== 'settings' && <KanbanBoard onWorkspaceCreated={setWorkspaceId} />}
          {page === 'settings' && <SettingsPage showToast={showToast} />}
        </Layout>
      </>
    );
  }

  // ─── Full app — everyone gets the same experience ───────────────────
  return (
    <>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <Layout
        currentPage={page} onNavigate={navigate} pendingCount={pendingCount}
        notifications={notifications} unreadCount={unreadCount}
        onMarkRead={markRead} onMarkAllRead={markAllRead}
      >
        {/* Diary Home / List */}
        {page === 'home' && !viewingEntry && (
          <DiaryList
            entries={entries}
            trashedEntries={trashedEntries}
            archivedEntries={archivedEntries}
            loading={entriesLoading}
            onView={handleViewEntry}
            onNew={goToNewEntry}
            onRestore={handleRestoreEntry}
            onPurge={handlePurgeEntry}
            onArchive={handleArchiveEntry}
            onUnarchive={handleUnarchiveEntry}
          />
        )}

        {/* View Single Entry */}
        {page === 'home' && viewingEntry && (
          <DiaryView
            entry={viewingEntry}
            onBack={() => setViewingEntry(null)}
            onEdit={goToEditEntry}
            onDelete={handleDeleteEntry}
            onArchive={handleArchiveEntry}
            onUnarchive={handleUnarchiveEntry}
          />
        )}

        {/* Write / Edit Entry */}
        {page === 'write' && (
          <DiaryEditor
            editingEntry={editingEntry}
            onSave={handleSaveEntry}
            onCancel={handleCancelEdit}
            showToast={showToast}
          />
        )}

        {/* Tasks — unified My Tasks + Team Board (Suren's TasksPage) */}
        {page === 'tasks' && (
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
            {/* Show tasks assigned to me by others */}
            {assignedTasks.length > 0 && <TeamTaskView />}
          </>
        )}

        {/* Team Members */}
        {page === 'team' && (
          <TeamMembers
            members={members}
            loading={membersLoading}
            onAdd={addMember}
            onAddBulk={addMembersBulk}
            onUpdate={updateMember}
            onDelete={deleteMember}
            showToast={showToast}
          />
        )}

        {/* Settings */}
        {page === 'settings' && (
          <SettingsPage showToast={showToast} />
        )}
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
