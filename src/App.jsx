import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useEntries, useTasks, useTeamMembers, useSheets } from './hooks/useFirestore';
import { useNotifications } from './hooks/useNotifications';
import { useReminderDispatcher } from './hooks/useReminderDispatcher';
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
import SettingsPage from './components/SettingsPage';
import Dashboard from './components/Dashboard';
import SpreadsheetList from './components/SpreadsheetList';
import SpreadsheetGrid from './components/SpreadsheetGrid';
import SheetInviteBanner from './components/SheetInviteBanner';
import DiaryInviteBanner from './components/DiaryInviteBanner';
import { saveSharedDiary } from './hooks/useSharedDiaries';
import './styles/diary.css';

// ─── Route wrappers ──────────────────────────────────────────────────────────
// DiaryView needs an entry object. We prefer route state (fast, no re-fetch)
// then fall back to finding by ID in the already-loaded entries array.
function DiaryViewPage({ entries, archivedEntries, onEdit, onDelete, onArchive, onUnarchive, showToast }) {
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
      showToast={showToast}
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

// ─── Sheets route wrappers ───────────────────────────────────────────────────
function SheetListPage({
  sheets, archivedSheets, trashedSheets, loading,
  onNew, onTrash, onRestore, onPurge, onArchive, onUnarchive,
}) {
  const navigate = useNavigate();
  return (
    <SpreadsheetList
      sheets={sheets}
      archivedSheets={archivedSheets}
      trashedSheets={trashedSheets}
      loading={loading}
      onOpen={(sheet) => navigate(`/sheets/${sheet.id}`, { state: { sheet } })}
      onNew={onNew}
      onTrash={onTrash}
      onRestore={onRestore}
      onPurge={onPurge}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
      onOpenShared={(sheet) => navigate(`/sheets/${sheet.id}`, { state: { sheet, isShared: true } })}
    />
  );
}

function SheetGridPage({ sheets, onSave }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Prefer the live data from the Firestore store (always up-to-date title + data).
  // Fall back to location state only if the sheet hasn't loaded yet.
  const sheet = sheets.find(s => s.id === id) || location.state?.sheet;

  // isShared = true ONLY when the user is a collaborator who opened the sheet
  // from the "Shared with me" section (location.state.isShared is set explicitly
  // in that case by onOpenShared).
  //
  // Do NOT derive isShared from sheet.isShared — that flag just means the owner
  // has shared the sheet with others.  When the OWNER opens their own shared
  // sheet, saves must still go to their own users/{uid}/sheets collection (via
  // onSave), not to the sharedSheets collection.  Using sheet.isShared here was
  // the root cause of title changes never reaching the My Sheets list.
  const isCollaborator = location.state?.isShared === true;
  const isShared = isCollaborator;

  if (!sheet) return <Navigate to="/sheets" replace />;

  return (
    <SpreadsheetGrid
      sheet={sheet}
      onSave={onSave}
      onBack={() => navigate('/sheets')}
      isShared={isShared}
      sharedSheetId={isShared ? sheet.id : null}
    />
  );
}

// ─── Main app shell ──────────────────────────────────────────────────────────
function DiaryApp() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isCollaborator, isSuperAdmin, setWorkspaceId, joinWorkspace } = useAuth();
  const {
    entries, trashedEntries, archivedEntries, loading: entriesLoading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry,
    archiveEntry, unarchiveEntry,
  } = useEntries();
  const { tasks, loading: tasksLoading, addTask, updateTask, toggleTask, deleteTask, clearCompleted } = useTasks();
  const { members, loading: membersLoading, addMember, addMembersBulk, updateMember, deleteMember } = useTeamMembers();
  const {
    sheets, archivedSheets, trashedSheets, loading: sheetsLoading,
    addSheet, updateSheet,
    trashSheet, restoreSheet, purgeSheet,
    archiveSheet, unarchiveSheet,
  } = useSheets();

  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  // ─── Invite highlight IDs (from deep links) ──────────────────────────────
  const [highlightInviteId,       setHighlightInviteId]       = useState(null);
  const [highlightDiaryInviteId,  setHighlightDiaryInviteId]  = useState(null);
  const [highlightTaskId,         setHighlightTaskId]         = useState(null);

  // ─── Handle ?workspace= and ?invite= deep links for already-auth'd users ───
  // Auth.jsx handles these for unauthenticated users.  For users who are already
  // signed in, they land straight in the app and Auth.jsx never renders, so we
  // process the params here instead — and clean up the URL afterwards.
  useEffect(() => {
    if (!user) return;
    const params  = new URLSearchParams(window.location.search);

    // Workspace join link
    const wsParam = params.get('workspace');
    if (wsParam) {
      window.history.replaceState({}, '', window.location.pathname);
      joinWorkspace(wsParam)
        .then(() => showToast('You have joined the workspace!', 'success'))
        .catch(() => showToast('Could not join workspace — the link may have expired.', 'warning'));
    }

    // Sheet invite deep link — navigate to /sheets and highlight the invite card
    const inviteParam = params.get('invite');
    if (inviteParam) {
      window.history.replaceState({}, '', window.location.pathname);
      setHighlightInviteId(inviteParam);
      if (window.location.pathname !== '/sheets') navigate('/sheets');
    }

    // Diary invite deep link — navigate to / and highlight the invite banner
    const diaryInviteParam = params.get('diary-invite');
    if (diaryInviteParam) {
      window.history.replaceState({}, '', window.location.pathname);
      setHighlightDiaryInviteId(diaryInviteParam);
      if (window.location.pathname !== '/') navigate('/');
    }

    // Task deep link — navigate to /tasks?task=<id>[&wsId=<id>]; TasksPage reads it via useSearchParams
    const taskParam = params.get('task');
    const wsIdParam = params.get('wsId');
    if (taskParam) {
      // Only navigate if not already on /tasks (avoid double-navigation)
      if (window.location.pathname !== '/tasks') {
        const q = wsIdParam
          ? `?task=${encodeURIComponent(taskParam)}&wsId=${encodeURIComponent(wsIdParam)}`
          : `?task=${encodeURIComponent(taskParam)}`;
        navigate(`/tasks${q}`);
      }
      // If already on /tasks, the URL still has the params so TasksPage's useSearchParams picks them up
    }
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
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-72.png',
          tag: n.id,
        });
      } catch { /* some browsers don't support Notification constructor */ }
    }
  }, [showToast]);

  const { notifications, unreadCount, markRead, markAllRead } = useNotifications({ onNewNotification: handleNewNotification });

  // ─── Per-task recurring email reminders ──────────────────────────────────
  // Free-tier dispatcher: runs entirely in the browser using the signed-in
  // user's Microsoft Graph token. See useReminderDispatcher for details.
  useReminderDispatcher();

  // Update PWA app icon badge count
  useEffect(() => {
    if ('setAppBadge' in navigator) {
      if (unreadCount > 0) navigator.setAppBadge(unreadCount).catch(() => {});
      else                 navigator.clearAppBadge().catch(() => {});
    }
  }, [unreadCount]);

  // ─── Entry handlers ──────────────────────────────────────────────────────
  const handleSaveEntry = async (entryData, editingId = null) => {
    if (editingId) {
      const editingEntry = entries.find(e => e.id === editingId)
        || archivedEntries.find(e => e.id === editingId);

      if (editingEntry?.isShared) {
        // Owner saving their own shared entry — write to both stores
        await updateEntry(editingId, entryData);
        await saveSharedDiary(editingId, entryData, user).catch(() => {});
      } else if (editingEntry) {
        // Normal personal entry
        await updateEntry(editingId, entryData);
      } else {
        // Entry not found in personal collection — it's a shared-with-me entry.
        // Save only to sharedDiaries; the collaborator has no personal copy.
        await saveSharedDiary(editingId, entryData, user);
      }
    } else {
      await addEntry(entryData);
    }
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <p className="text-slate-600 text-sm font-medium">Opening your workspace…</p>
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
      <SheetInviteBanner showToast={showToast} highlightInviteId={highlightInviteId} />
      <DiaryInviteBanner showToast={showToast} highlightInviteId={highlightDiaryInviteId} />
      <Layout pendingCount={pendingCount} isSuperAdmin={isSuperAdmin} {...commonLayoutProps}>
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
                showToast={showToast}
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
                highlightTaskId={highlightTaskId}
                onHighlightConsumed={() => setHighlightTaskId(null)}
                onWorkspaceCreated={setWorkspaceId}
              />
            }
          />

          {/* Sheets list */}
          <Route
            path="/sheets"
            element={
              <SheetListPage
                sheets={sheets}
                archivedSheets={archivedSheets}
                trashedSheets={trashedSheets}
                loading={sheetsLoading}
                onNew={addSheet}
                onTrash={trashSheet}
                onRestore={restoreSheet}
                onPurge={purgeSheet}
                onArchive={archiveSheet}
                onUnarchive={unarchiveSheet}
              />
            }
          />

          {/* Individual sheet */}
          <Route
            path="/sheets/:id"
            element={
              <SheetGridPage
                sheets={sheets}
                onSave={updateSheet}
              />
            }
          />

          {/* Settings */}
          <Route path="/settings" element={<SettingsPage showToast={showToast} />} />

          {/* Dashboard — open to all users.
              Default view shows tasks the user is assigned to or created.
              Super-admins get a Global toggle inside the page. */}
          <Route
            path="/dashboard"
            element={<Dashboard showToast={showToast} />}
          />

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
