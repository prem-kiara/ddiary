import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, User, CheckCircle } from 'lucide-react';
import { isOverdue } from '../../utils/dates';
import { useAuth } from '../../contexts/AuthContext';
import { useUserDirectory, useTeamMembers } from '../../hooks/useFirestore';
import { useMyWorkspaces } from '../../hooks/useWorkspace';
import SectionHeader from '../shared/SectionHeader';
import { fetchAllOrgUsers } from '../../utils/graphPeopleSearch';
import TaskCard from './TaskCard';
import { register as registerUnsaved, unregister as unregisterUnsaved } from '../../utils/unsavedState';

// ─────────────────────────────────────────────────────────────────────────────
export default function TaskManager({
  tasks, members = [], loading,
  onAdd, onToggle, onUpdate, onDelete, onClearCompleted, showToast,
  highlightTaskId, onHighlightConsumed,
}) {
  const { user } = useAuth();
  const { directory } = useUserDirectory(user?.uid);
  const { workspaces } = useMyWorkspaces();
  // Personal contact overrides (phone book) — used to silently persist edited
  // phones and merge them into the assign dropdown via phoneOverrides above.
  const { saveContactPhone } = useTeamMembers();
  const firstWs = workspaces[0] || null;

  // ── Org users from M365 ─────────────────────────────────────────────────
  // Refetched on tab visibility change (throttled) so newly-added org members
  // appear without requiring a page reload. Combined with the 401-retry in
  // graphPeopleSearch, this means the org directory stays current across
  // long-running browser sessions.
  const [orgUsers, setOrgUsers] = useState([]);
  const lastOrgFetchRef = useRef(0);
  useEffect(() => {
    const REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
    const refetch = () => {
      if (Date.now() - lastOrgFetchRef.current < REFRESH_MIN_INTERVAL_MS) return;
      lastOrgFetchRef.current = Date.now();
      fetchAllOrgUsers().then(users => setOrgUsers(users || [])).catch(() => {});
    };
    refetch(); // initial
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Merged assignee list: Firestore members (have UIDs) + M365 org users, deduped by email
  // Phone-override map built from the personal Contacts list. When assigning
  // a task, any saved override takes precedence over the Graph directory
  // value. Keys are lowercased emails.
  const phoneOverrides = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && m.phone) map.set(key, m.phone);
    }
    return map;
  }, [members]);

  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    const combined = [];
    // Graph directory users first — they have names, job titles, UIDs
    for (const u of orgUsers) {
      const key = u.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push({
          email: u.email,
          name:  u.displayName,
          uid:   null,
          phone: phoneOverrides.get(key) || u.phone || null,
        });
      }
    }
    // Then any saved contacts that weren't in the directory (e.g. external people)
    for (const m of members) {
      const key = m.email?.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push({ email: m.email, name: m.name, uid: m.uid || null, phone: m.phone || null });
      }
    }
    return combined;
  }, [members, orgUsers, phoneOverrides]);

  // ── Add form state (personal tasks — text-only) ─────────────────────────
  const [newText, setNewText] = useState('');

  // Track unsaved work: the quick-add input counts as unsaved while it has text
  // so the tab coordinator won't redirect a deep link into this tab mid-edit.
  useEffect(() => {
    if (newText.trim()) {
      registerUnsaved('task-add-form');
    } else {
      unregisterUnsaved('task-add-form');
    }
    return () => unregisterUnsaved('task-add-form');
  }, [newText]);

  // ── Section collapse state ──────────────────────────────────────────────
  const [personalOpen, setPersonalOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);

  // ── Derived lists ───────────────────────────────────────────────────────
  // Single flat list for open tasks (no Overdue/Pending split).
  // Overdue items sort first, then others by due date asc (no-due at end).
  const openTasks = tasks
    .filter(t => !t.completed)
    .sort((a, b) => {
      const ao = isOverdue(a.dueDate) ? 0 : 1;
      const bo = isOverdue(b.dueDate) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
  const completedTasks = tasks
    .filter(t => t.completed)
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
  const completedCount = completedTasks.length;

  // ── Add task (personal — minimal payload) ──────────────────────────────
  const handleAdd = async () => {
    if (!newText.trim()) return;
    try {
      await onAdd({
        text:     newText.trim(),
        dueDate:  null,
        priority: 'medium',
      });
      setNewText('');
      showToast('Task added!', 'success');
    } catch { showToast('Failed to add task', 'warning'); }
  };

  const inputStyle = {
    WebkitAppearance: 'none', appearance: 'none',
    width: '100%', height: 48, padding: '0 12px',
    border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 15, fontFamily: 'var(--font-body)',
    background: '#ffffff', color: '#0f172a',
    boxSizing: 'border-box', outline: 'none',
  };

  if (loading) return <div className="empty-state fade-in"><p>Loading tasks...</p></div>;

  const taskCardProps = {
    members, directory, onToggle, onUpdate, onDelete, showToast, ownerUid: user?.uid,
    workspaces,
    hasWorkspace:     workspaces.length > 0,
    orgAssignees:     assigneeOptions,
    saveContactPhone,
    highlightTaskId,
    onHighlightConsumed,
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">Tasks & To-Dos</h2>

      {/* ── Add task form (personal — text only) ──────────────────────── */}
      <div className="card">
        <label className="label">New Task</label>
        <textarea
          className="textarea"
          rows={2}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="What needs to be done?"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAdd(); }}
          style={{ minHeight: 'unset', height: 'auto', resize: 'none', marginBottom: 12, fontFamily: 'var(--font-body)', fontSize: 15, backgroundImage: 'none', lineHeight: 1.6 }}
        />
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}>
          <User size={12} /> Personal task. Need to assign it or pin a due date? Add it and click <strong>Team&nbsp;Board</strong> on the task card to move it over.
        </p>
        <button className="btn btn-gold" onClick={handleAdd} style={{ width: '100%', justifyContent: 'center' }}>
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* ── Personal Tasks (open items) ─────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <SectionHeader
          open={personalOpen} onToggle={() => setPersonalOpen(o => !o)}
          icon={<User size={16} />} label="Personal Tasks" count={openTasks.length} color="#7c3aed"
        />
        {personalOpen && (
          openTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: 24, borderTop: '1px solid #e2e8f0' }}>
              <CheckCircle size={36} color="#15803d" />
              <p>All caught up! No pending tasks.</p>
            </div>
          ) : (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {openTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Done strip (collapsed by default) ───────────────────────────── */}
      {completedTasks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHeader
            open={doneOpen} onToggle={() => setDoneOpen(o => !o)}
            icon={<CheckCircle size={16} />} label="Done" count={completedCount} color="#15803d"
          />
          {doneOpen && (
            <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ marginTop: 12 }}>
                {completedTasks.map(t => <TaskCard key={t.id} task={t} {...taskCardProps} />)}
              </div>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button className="btn btn-sm btn-outline" onClick={onClearCompleted}>
                  Clear all {completedCount} done task{completedCount > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
