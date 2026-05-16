/**
 * usePlatformTasks — task aggregation for the Dashboard.
 *
 * Two modes:
 *
 *   'mine'   (default; mandatory for non-super-admins): two collection-group
 *            queries merged — tasks where I'm the assignee (by email) and
 *            tasks I created. Each task appears once even if both predicates
 *            match. Backed by the CG rule in firestore.rules that allows
 *            either match for non-super-admins.
 *
 *   'global' (super-admin only): single collection-group query for every task
 *            on the platform. Used for the optional super-admin overview.
 *            Silently downgrades to 'mine' for non-super-admins so a leaked
 *            mode flag doesn't cause permission-denied errors.
 *
 * Always excluded:
 *   - Personal-diary tasks (users/{uid}/tasks). The dashboard is for shared
 *     workspace work; personal tasks live in the user's diary.
 *   - Tasks with `deletedAt` set (soft-deleted) or `archived === true`.
 *
 * Returns enriched task rows with derived fields:
 *   _kind   — always 'workspace'
 *   _label  — full path string, e.g. "Credit Ops › Underwriting › Retail"
 *   _parentId — workspace ID (so dashboard rows can deep-link back)
 *
 * Also returns `workspaces` so callers (Dashboard's AddTaskModal) can reuse
 * the same useMyWorkspaces listener.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  collectionGroup, query, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useMyWorkspaces } from './useWorkspace';
import { logError } from '../utils/errorLogger';

function _rowFromDoc(d) {
  // Path examples:
  //   workspaces/{wsId}/tasks/{taskId}      (workspace task)
  //   users/{uid}/tasks/{taskId}            (personal task — filtered out below)
  const parent = d.ref.parent.parent;
  const parentCollection = parent?.parent?.id || null;
  return {
    id: d.id,
    _path: d.ref.path,
    _parentCollection: parentCollection, // 'workspaces' or 'users'
    _parentId: parent?.id || null,
    ...d.data(),
  };
}

export function usePlatformTasks({ mode = 'mine' } = {}) {
  const { user, isSuperAdmin } = useAuth();
  const { workspaces, loading: workspacesLoading } = useMyWorkspaces();

  const [rawTasks, setRawTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  // Effective mode — non-super-admins are always 'mine' regardless of the
  // requested mode, so the rules-permitted query is the only one we issue.
  const effectiveMode = mode === 'global' && isSuperAdmin ? 'global' : 'mine';

  useEffect(() => {
    setRawTasks([]);
    setTasksLoading(true);

    if (!user?.uid) { setTasksLoading(false); return; }

    if (effectiveMode === 'global') {
      // Super-admin overview: every task on the platform.
      const q = query(collectionGroup(db, 'tasks'));
      const unsub = onSnapshot(
        q,
        (snap) => {
          setRawTasks(snap.docs.map(_rowFromDoc));
          setTasksLoading(false);
        },
        (err) => {
          logError(err, { location: 'usePlatformTasks', action: 'globalCG' });
          setTasksLoading(false);
        }
      );
      return unsub;
    }

    // 'mine' — four parallel collection-group queries merged into one map.
    // Each query maintains its own snapshot map so removals propagate
    // correctly when (e.g.) a task is reassigned away from me.
    //
    //   1. tasks where I am the primary assignee — matched by UID
    //      (most reliable: UID is always set when a task is assigned)
    //   2. tasks where I am the primary assignee — matched by email
    //      (legacy/belt-and-suspenders: some tasks were saved with email only)
    //   3. tasks I created (createdBy == myUid)
    //   4. tasks where I am a co-assignee (allAssigneeEmails array-contains)
    //
    // Using both uid AND email for the assignee query is the key fix: tasks
    // assigned to the user by others are often stored with only assigneeUid
    // (no assigneeEmail), causing the email-only query to miss them entirely
    // and the dashboard to show a partial count (e.g. 7 instead of 32).
    const uidMap        = new Map();
    const emailMap      = new Map();
    const createdMap    = new Map();
    const coAssigneeMap = new Map();

    const myEmailLower = (user.email || '').toLowerCase();

    // Track which queries have delivered their first snapshot so we don't
    // call setTasksLoading(false) until ALL expected listeners have fired.
    // Pre-mark email / co-assignee as done if the user has no email so we
    // never block the loading state on queries we didn't start.
    let uidFired        = false;
    let emailFired      = !myEmailLower;
    let createdFired    = false;
    let coAssigneeFired = !myEmailLower;

    const flush = () => {
      // Merge all four maps; later maps win on path collisions (same task
      // returned by multiple queries) — order doesn't matter since the
      // document data is identical for the same path.
      const merged = new Map(uidMap);
      for (const [path, t] of emailMap)      merged.set(path, t);
      for (const [path, t] of createdMap)    merged.set(path, t);
      for (const [path, t] of coAssigneeMap) merged.set(path, t);
      setRawTasks([...merged.values()]);
      // Only stop showing the loading state once every query we started has
      // returned its first snapshot.  The first listener to fire would
      // otherwise mark loading complete while the other maps are still empty.
      if (uidFired && emailFired && createdFired && coAssigneeFired) {
        setTasksLoading(false);
      }
    };

    let unsubUid        = null;
    let unsubEmail      = null;
    let unsubCreated    = null;
    let unsubCoAssignee = null;

    // Query 1: assigned to me by UID (primary — UID is always present)
    const uidQ = query(
      collectionGroup(db, 'tasks'),
      where('assigneeUid', '==', user.uid)
    );
    unsubUid = onSnapshot(
      uidQ,
      (snap) => {
        uidMap.clear();
        snap.docs.forEach(d => uidMap.set(d.ref.path, _rowFromDoc(d)));
        uidFired = true;
        flush();
      },
      (err) => {
        uidFired = true;
        logError(err, { location: 'usePlatformTasks', action: 'mine.assigneeUid' });
        flush();
      }
    );

    if (myEmailLower) {
      // Query 2: assigned to me by email (belt-and-suspenders for older tasks)
      const emailQ = query(
        collectionGroup(db, 'tasks'),
        where('assigneeEmail', '==', myEmailLower)
      );
      unsubEmail = onSnapshot(
        emailQ,
        (snap) => {
          emailMap.clear();
          snap.docs.forEach(d => emailMap.set(d.ref.path, _rowFromDoc(d)));
          emailFired = true;
          flush();
        },
        (err) => {
          emailFired = true;
          logError(err, { location: 'usePlatformTasks', action: 'mine.assigneeEmail' });
          flush();
        }
      );

      // Query 4: co-assignee (tasks that have my email in allAssigneeEmails array)
      const coQ = query(
        collectionGroup(db, 'tasks'),
        where('allAssigneeEmails', 'array-contains', myEmailLower)
      );
      unsubCoAssignee = onSnapshot(
        coQ,
        (snap) => {
          coAssigneeMap.clear();
          snap.docs.forEach(d => coAssigneeMap.set(d.ref.path, _rowFromDoc(d)));
          coAssigneeFired = true;
          flush();
        },
        (err) => {
          coAssigneeFired = true;
          logError(err, { location: 'usePlatformTasks', action: 'mine.coAssignee' });
          flush();
        }
      );
    }

    // Query 3: tasks I created
    const createdQ = query(
      collectionGroup(db, 'tasks'),
      where('createdBy', '==', user.uid)
    );
    unsubCreated = onSnapshot(
      createdQ,
      (snap) => {
        createdMap.clear();
        snap.docs.forEach(d => createdMap.set(d.ref.path, _rowFromDoc(d)));
        createdFired = true;
        flush();
      },
      (err) => {
        createdFired = true;
        logError(err, { location: 'usePlatformTasks', action: 'mine.createdBy' });
        flush();
      }
    );

    return () => {
      try { unsubUid?.(); }         catch {}
      try { unsubEmail?.(); }       catch {}
      try { unsubCreated?.(); }     catch {}
      try { unsubCoAssignee?.(); }  catch {}
    };
  }, [user?.uid, user?.email, effectiveMode]);

  // ── Build workspace lookup (id -> { name, categories: { id -> {...} } }) ──
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

  // ── Enrich raw tasks: filter + label ─────────────────────────────────────
  const tasks = useMemo(() => {
    return rawTasks
      // Workspace tasks only — personal-diary tasks never appear in the dashboard.
      .filter(t => t._parentCollection === 'workspaces')
      // Hide soft-deleted + archived tasks (workspace tasks rarely have these
      // today, but the filter is cheap insurance for legacy/future fields).
      .filter(t => !t.deletedAt && !t.archived)
      .map(t => {
        const ws  = wsLookup[t._parentId];
        const cat = ws?.categories?.[t.categoryId];
        const sub = cat?.subs?.[t.subcategoryId];
        const wsName     = ws?.name  || '(unknown workspace)';
        const catName    = cat?.name || 'Uncategorized';
        const subName    = sub || null;
        const parts = [wsName, catName, ...(subName ? [subName] : [])];
        return {
          ...t,
          _kind:            'workspace',
          _label:           parts.join(' › '),
          _workspaceName:   wsName,
          _categoryName:    catName,
          _subcategoryName: subName,
        };
      });
  }, [rawTasks, wsLookup]);

  return {
    tasks,
    loading: tasksLoading || workspacesLoading,
    workspaces,
    effectiveMode,
  };
}
