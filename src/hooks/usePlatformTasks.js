/**
 * usePlatformTasks — super-admin-only platform-wide task aggregation.
 *
 * Subscribes to:
 *   1. EVERY task in EVERY workspace via collectionGroup('tasks').
 *      (Firestore rules already grant super-admins read access platform-wide
 *       — see firestore.rules / isSuperAdmin().)
 *   2. EVERY workspace doc, to map workspaceId → name + categories. Reuses
 *      useMyWorkspaces() since the super-admin path of that hook already
 *      subscribes to the whole `workspaces` collection.
 *   3. (Optional) userDirectory, so personal tasks (users/{uid}/tasks) can
 *      be labelled with the owner's name when `includePersonal` is true.
 *
 * Returns enriched task rows with two derived fields:
 *   _kind  — 'workspace' | 'personal'
 *   _label — full path string, e.g. "Credit Ops › Underwriting › Retail"
 *            or "Suren Saravanan's Diary"
 *
 * Non-super-admins get an empty list. The hook is intentionally a no-op
 * for them so it's safe to mount unconditionally if you want to.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  collection, collectionGroup, query, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useMyWorkspaces } from './useWorkspace';
import { logError } from '../utils/errorLogger';

export function usePlatformTasks({ includePersonal = false } = {}) {
  const { isSuperAdmin } = useAuth();
  const { workspaces, loading: workspacesLoading } = useMyWorkspaces();

  const [rawTasks, setRawTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [userDir, setUserDir] = useState({}); // uid -> { email, displayName }

  // ── Subscribe: every task across the platform ─────────────────────────────
  useEffect(() => {
    if (!isSuperAdmin) {
      setRawTasks([]);
      setTasksLoading(false);
      return;
    }

    const q = query(collectionGroup(db, 'tasks'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          // d.ref.path looks like:
          //   workspaces/{wsId}/tasks/{taskId}      (workspace task)
          //   users/{uid}/tasks/{taskId}            (personal task)
          const parent = d.ref.parent.parent;             // workspaces/{wsId} or users/{uid}
          const parentCollection = parent?.parent?.id || null; // 'workspaces' or 'users'
          return {
            id: d.id,
            _path: d.ref.path,
            _parentCollection: parentCollection,
            _parentId: parent?.id || null,
            ...d.data(),
          };
        });
        setRawTasks(rows);
        setTasksLoading(false);
      },
      (err) => {
        logError(err, { location: 'usePlatformTasks', action: 'collectionGroupTasks' });
        setTasksLoading(false);
      }
    );

    return unsub;
  }, [isSuperAdmin]);

  // ── Subscribe: userDirectory (only when personal tasks are included) ──────
  useEffect(() => {
    if (!isSuperAdmin || !includePersonal) {
      setUserDir({});
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'userDirectory'),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => { map[d.id] = d.data(); });
        setUserDir(map);
      },
      (err) => logError(err, { location: 'usePlatformTasks', action: 'userDirectory' })
    );
    return unsub;
  }, [isSuperAdmin, includePersonal]);

  // ── Build workspace lookup once per workspaces snapshot ───────────────────
  const wsLookup = useMemo(() => {
    const map = {};
    workspaces.forEach((w) => {
      const cats = {};
      (w.categories || []).forEach((c) => {
        const subs = {};
        (c.subcategories || []).forEach((s) => { subs[s.id] = s.name; });
        cats[c.id] = { name: c.name, subs };
      });
      map[w.id] = { name: w.name || '(untitled workspace)', categories: cats };
    });
    return map;
  }, [workspaces]);

  // ── Enrich raw tasks with kind + path label ───────────────────────────────
  const tasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        if (t._parentCollection === 'workspaces') return true;
        if (t._parentCollection === 'users')      return includePersonal;
        return false;
      })
      .map((t) => {
        if (t._parentCollection === 'workspaces') {
          const ws  = wsLookup[t._parentId];
          const cat = ws?.categories?.[t.categoryId];
          const sub = cat?.subs?.[t.subcategoryId];
          const parts = [
            ws?.name || '(unknown workspace)',
            cat?.name || 'Uncategorized',
            ...(sub ? [sub] : []),
          ];
          return { ...t, _kind: 'workspace', _label: parts.join(' › ') };
        }
        // personal
        const u = userDir[t._parentId] || {};
        const owner = u.displayName || u.email || `User ${(t._parentId || '').slice(0, 6)}`;
        return { ...t, _kind: 'personal', _label: `${owner}'s Diary` };
      });
  }, [rawTasks, wsLookup, userDir, includePersonal]);

  return {
    tasks,
    loading: tasksLoading || workspacesLoading,
    // Expose the workspace list so callers (e.g. Dashboard's AddTaskModal)
    // don't have to mount a second useMyWorkspaces listener.
    workspaces,
  };
}
