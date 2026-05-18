/**
 * usePlatformTasks — task aggregation for the Dashboard.
 *
 * Architecture: subscribe directly to each workspace's tasks subcollection.
 * This is simpler and more reliable than collection-group queries because:
 *   1. No composite indexes required.
 *   2. Security rules already allow workspace members to read all tasks.
 *   3. Returns ALL tasks the user has access to (not just their own).
 *
 * Two modes:
 *   'mine'   (default): queries all workspaces the user belongs to, then
 *            returns every task in those workspaces.  Client code can
 *            filter to "assigned to me" using the _isMine flag.
 *
 *   'global' (super-admin only): single CG query for every task on the
 *            platform.  Silently downgrades to 'mine' for non-super-admins.
 *
 * Always excluded: personal-diary tasks (users/{uid}/tasks) and tasks with
 * deletedAt set or archived === true.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  collection, collectionGroup, query, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useMyWorkspaces } from './useWorkspace';
import { logError } from '../utils/errorLogger';

function _rowFromDoc(d) {
  const parent = d.ref.parent.parent;
  const parentCollection = parent?.parent?.id || null;
  return {
    id: d.id,
    _path: d.ref.path,
    _parentCollection: parentCollection,
    _parentId: parent?.id || null,
    ...d.data(),
  };
}

export function usePlatformTasks({ mode = 'mine' } = {}) {
  const { user, isSuperAdmin } = useAuth();
  const { workspaces, loading: workspacesLoading } = useMyWorkspaces();

  const [rawTasks, setRawTasks]     = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const effectiveMode = mode === 'global' && isSuperAdmin ? 'global' : 'workspace';

  // Stable key derived from workspace IDs so the effect only re-runs when
  // the set of workspaces actually changes (not on every reference change).
  const wsIdKey = useMemo(
    () => workspaces.map(w => w.id).sort().join(','),
    [workspaces]
  );

  useEffect(() => {
    // Reset every time the user, workspace list, or mode changes.
    setRawTasks([]);
    setTasksLoading(true);

    if (!user?.uid) { setTasksLoading(false); return; }

    // Wait for the workspace list to finish loading before opening task
    // listeners.  Without this guard we'd open 0 listeners and immediately
    // show an empty dashboard.
    if (workspacesLoading) return;

    // ── Global mode (super-admin only) ──────────────────────────────────────
    if (effectiveMode === 'global') {
      const q = query(collectionGroup(db, 'tasks'));
      const unsub = onSnapshot(
        q,
        (snap) => { setRawTasks(snap.docs.map(_rowFromDoc)); setTasksLoading(false); },
        (err)  => { logError(err, { location: 'usePlatformTasks', action: 'globalCG' }); setTasksLoading(false); }
      );
      return () => unsub();
    }

    // ── Workspace mode — one listener per workspace ─────────────────────────
    // Subscribe to workspaces/{id}/tasks for every workspace the user belongs
    // to.  The Firestore security rules already permit workspace members to
    // read all tasks, so no extra indexes or CG rules are needed.

    const wsIds = wsIdKey ? wsIdKey.split(',').filter(Boolean) : [];

    if (wsIds.length === 0) {
      setRawTasks([]);
      setTasksLoading(false);
      return;
    }

    // Per-workspace task maps — keyed by task path for de-duplication.
    const tasksByWorkspace = new Map();
    wsIds.forEach(id => tasksByWorkspace.set(id, new Map()));

    // How many workspaces have delivered their first snapshot.
    let firstSnapCount = 0;
    const total = wsIds.length;

    const rebuild = () => {
      const merged = new Map();
      for (const [, wsMap] of tasksByWorkspace) {
        for (const [p, t] of wsMap) merged.set(p, t);
      }
      setRawTasks([...merged.values()]);
    };

    // Safety valve: show whatever arrived after 8 seconds rather than
    // spinning forever if a workspace listener is slow or errors.
    const timer = setTimeout(() => setTasksLoading(false), 8000);

    const unsubs = wsIds.map(wsId =>
      onSnapshot(
        collection(db, 'workspaces', wsId, 'tasks'),
        (snap) => {
          const wsMap = new Map();
          snap.docs.forEach(d => wsMap.set(d.ref.path, _rowFromDoc(d)));
          tasksByWorkspace.set(wsId, wsMap);
          rebuild();
          // Count only the first snapshot per workspace toward "all loaded".
          if (firstSnapCount < total) {
            firstSnapCount++;
            if (firstSnapCount === total) {
              clearTimeout(timer);
              setTasksLoading(false);
            }
          }
        },
        (err) => {
          logError(err, { location: 'usePlatformTasks', action: `ws.${wsId}` });
          if (firstSnapCount < total) {
            firstSnapCount++;
            if (firstSnapCount === total) {
              clearTimeout(timer);
              setTasksLoading(false);
            }
          }
        }
      )
    );

    return () => {
      clearTimeout(timer);
      unsubs.forEach(u => { try { u(); } catch { /* already unsubscribed */ } });
    };
  }, [user?.uid, wsIdKey, workspacesLoading, effectiveMode]);

  // ── Workspace label lookup ───────────────────────────────────────────────
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

  const myEmailLower = (user?.email || '').toLowerCase();

  const tasks = useMemo(() => {
    return rawTasks
      .filter(t => t._parentCollection === 'workspaces')
      .filter(t => !t.deletedAt && !t.archived)
      .map(t => {
        const ws  = wsLookup[t._parentId];
        const cat = ws?.categories?.[t.categoryId];
        const sub = cat?.subs?.[t.subcategoryId];
        const wsName  = ws?.name  || '(unknown workspace)';
        const catName = cat?.name || 'Uncategorized';
        const subName = sub || null;

        // _isMine: true when this task is directly related to the current user.
        // The Dashboard "My tasks" toggle filters on this flag client-side,
        // avoiding a second round of Firestore queries.
        const _isMine =
          t.assigneeUid === user?.uid ||
          (t.assigneeEmail || '').toLowerCase() === myEmailLower ||
          t.createdBy === user?.uid ||
          (Array.isArray(t.allAssigneeEmails) &&
            t.allAssigneeEmails.includes(myEmailLower));

        return {
          ...t,
          _kind:            'workspace',
          _label:           [wsName, catName, ...(subName ? [subName] : [])].join(' › '),
          _workspaceName:   wsName,
          _categoryName:    catName,
          _subcategoryName: subName,
          _isMine,
        };
      });
  }, [rawTasks, wsLookup, user?.uid, myEmailLower]);

  return { tasks, loading: tasksLoading || workspacesLoading, workspaces, effectiveMode };
}
