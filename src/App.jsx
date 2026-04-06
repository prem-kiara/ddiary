import { useState, useCallback, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useEntries, useTasks, useTeamMembers, useUserDirectory } from './hooks/useFirestore';
import Auth from './components/Auth';
import Layout from './components/Layout';
import Toast from './components/Toast';
import DiaryList from './components/DiaryList';
import DiaryView from './components/DiaryView';
import DiaryEditor from './components/DiaryEditor';
import TaskManager from './components/TaskManager';
import Reminders from './components/Reminders';
import TeamMembers from './components/TeamMembers';
import TeamTaskView from './components/TeamTaskView';
import SettingsPage from './components/SettingsPage';
import './styles/diary.css';

function DiaryApp() {
  const { user, loading: authLoading, isMember } = useAuth();
  const {
    entries, trashedEntries, archivedEntries, loading: entriesLoading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry,
    archiveEntry, unarchiveEntry,
  } = useEntries();
  const { tasks, loading: tasksLoading, addTask, updateTask, toggleTask, deleteTask, clearCompleted } = useTasks();
  const { members, loading: membersLoading, addMember, addMembersBulk, updateMember, deleteMember } = useTeamMembers();
  const { directory } = useUserDirectory(user?.uid);

  // ─── Retroactive task & member patch ────────────────────────────────────
  // Runs on load and whenever tasks or the userDirectory changes.
  // 1. Lowercases any assigneeEmail that was saved with mixed case (old data).
  // 2. Links assigneeUid and teamMember.uid for any member who has signed up.
  useEffect(() => {
    // Fix mixed-case emails on existing tasks (no directory entry needed)
    tasks.forEach(task => {
      if (task.assigneeEmail && task.assigneeEmail !== task.assigneeEmail.toLowerCase()) {
        updateTask(task.id, { assigneeEmail: task.assigneeEmail.toLowerCase() }).catch(() => {});
      }
    });
  }, [tasks]);

  useEffect(() => {
    if (!directory.length) return;
    directory.forEach(async (dirEntry) => {
      const emailKey = dirEntry.email?.toLowerCase();
      if (!emailKey || !dirEntry.uid) return;

      // Link teamMembers record
      const memberRecord = members.find(m => m.email?.toLowerCase() === emailKey && !m.uid);
      if (memberRecord) {
        updateMember(memberRecord.id, { uid: dirEntry.uid }).catch(() => {});
      }

      // Link assigneeUid on any task assigned to this email
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

  const pendingCount = tasks.filter(t => !t.completed).length;

  // ─── Navigation helpers ──────────────────────────────────────────────
  const navigate = (p) => {
    setPage(p);
    setViewingEntry(null);
    if (p === 'write' && !editingEntry) setEditingEntry(null);
  };

  const goToNewEntry = () => {
    setEditingEntry(null);
    setPage('write');
  };

  const goToEditEntry = (entry) => {
    setEditingEntry(entry);
    setPage('write');
  };

  const handleViewEntry = (entry) => {
    setViewingEntry(entry);
  };

  // ─── Entry handlers ──────────────────────────────────────────────────
  const handleSaveEntry = async (entryData) => {
    if (editingEntry) {
      await updateEntry(editingEntry.id, entryData);
    } else {
      await addEntry(entryData);
    }
    setEditingEntry(null);
    setPage('home');
  };

  const handleDeleteEntry = async (id) => {
    await deleteEntry(id);
    setViewingEntry(null);
    showToast('Entry moved to trash', 'success');
  };

  const handleArchiveEntry = async (id) => {
    await archiveEntry(id);
    setViewingEntry(null);
    showToast('Entry archived', 'success');
  };

  const handleUnarchiveEntry = async (id) => {
    await unarchiveEntry(id);
    setViewingEntry(null);
    showToast('Entry restored to diary', 'success');
  };

  const handleRestoreEntry = async (id) => {
    await restoreEntry(id);
    showToast('Entry restored', 'success');
  };

  const handlePurgeEntry = async (id) => {
    await purgeEntry(id);
    showToast('Entry permanently deleted', 'success');
  };

  const handleCancelEdit = () => {
    setEditingEntry(null);
    setPage('home');
  };

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

  // ─── Team-member view (role: 'member') ───────────────────────────────
  // Members only see their assigned tasks + settings.
  if (isMember) {
    return (
      <>
        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}
        <Layout currentPage={page} onNavigate={navigate} pendingCount={0} memberMode>
          {page !== 'settings' && <TeamTaskView />}
          {page === 'settings' && <SettingsPage showToast={showToast} />}
        </Layout>
      </>
    );
  }

  // ─── Owner / full app ────────────────────────────────────────────────
  return (
    <>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      <Layout currentPage={page} onNavigate={navigate} pendingCount={pendingCount}>
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

        {/* Tasks */}
        {page === 'tasks' && (
          <TaskManager
            tasks={tasks}
            members={members}
            loading={tasksLoading}
            onAdd={addTask}
            onUpdate={updateTask}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onClearCompleted={clearCompleted}
            showToast={showToast}
          />
        )}

        {/* Reminders */}
        {page === 'reminders' && (
          <Reminders
            tasks={tasks}
            teamMembers={members}
            onToggle={toggleTask}
            onUpdate={updateTask}
            showToast={showToast}
          />
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
