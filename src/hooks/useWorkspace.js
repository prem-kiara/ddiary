import { useState, useEffect, useRef } from 'react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { logError } from '../utils/errorLogger';

// ─── All workspaces where the current user is a member (real-time) ──────────
export function useMyWorkspaces() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Track inner workspace-doc listeners so we can clean them up properly.
  // The key problem: onSnapshot callbacks can't return cleanup functions.
  // We store active inner unsubs in a ref and tear them down explicitly.
  const innerUnsubsRef = useRef([]);

  useEffect(() => {
    if (!user?.uid) { setWorkspaces([]); setLoading(false); return; }

    const cleanupInner = () => {
      innerUnsubsRef.current.forEach(fn => fn());
      innerUnsubsRef.current = [];
    };

    const q = query(
      collectionGroup(db, 'members'),
      where('uid', '==', user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      // Tear down previous workspace listeners before setting up new ones
      cleanupInner();

      const memberDocs = snap.docs.map(d => ({
        workspaceId: d.ref.parent.parent?.id,
        role: d.data().role,
      })).filter(d => d.workspaceId);

      if (memberDocs.length === 0) {
        setWorkspaces([]);
        setLoading(false);
        return;
      }

      // Shared mutable state for this batch of listeners
      const wsMap = new Map();
      let loaded = 0;
      const total = memberDocs.length;

      const flush = () => {
        setWorkspaces(Array.from(wsMap.values()));
        setLoading(false);
      };

      innerUnsubsRef.current = memberDocs.map(({ workspaceId, role }) => {
        return onSnapshot(doc(db, 'workspaces', workspaceId), (wsSnap) => {
          if (wsSnap.exists()) {
            wsMap.set(workspaceId, { id: workspaceId, role, ...wsSnap.data() });
          } else {
            // Workspace doc is missing — likely deleted; remove from map silently
            wsMap.delete(workspaceId);
          }
          loaded++;
          if (loaded >= total) flush();
        }, (err) => {
          logError(err, { location: 'useMyWorkspaces', action: 'workspaceDocSnapshot', workspaceId });
          loaded++;
          if (loaded >= total) flush();
        });
      });
    }, (err) => {
      logError(err, { location: 'useMyWorkspaces', action: 'membersCollectionGroupQuery' });
      setLoading(false);
    });

    return () => {
      unsub();
      cleanupInner();
    };
  }, [user?.uid]);

  return { workspaces, loading };
}

// ─── Single workspace metadata + members (for active workspace view) ────────
export function useWorkspace(workspaceId) {
  const [workspace, setWorkspace] = useState(null);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!workspaceId) { setWorkspace(null); setMembers([]); setLoading(false); return; }

    let loaded = { ws: false, mem: false };
    const done = () => { if (loaded.ws && loaded.mem) setLoading(false); };

    const unsubWs = onSnapshot(doc(db, 'workspaces', workspaceId), (snap) => {
      setWorkspace(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      loaded.ws = true; done();
    }, () => { loaded.ws = true; done(); });

    const unsubMem = onSnapshot(
      collection(db, 'workspaces', workspaceId, 'members'),
      (snap) => {
        setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
        loaded.mem = true; done();
      },
      () => { loaded.mem = true; done(); }
    );

    return () => { unsubWs(); unsubMem(); };
  }, [workspaceId]);

  return { workspace, members, loading };
}

// ─── BACKWARD COMPAT — old single-workspace hook used by TaskManager ────────
// Returns the first workspace + its members. Will be phased out.
export function useMyWorkspace() {
  const { workspaces, loading } = useMyWorkspaces();
  const firstWs = workspaces[0] || null;
  const [members, setMembers] = useState([]);

  useEffect(() => {
    if (!firstWs?.id) { setMembers([]); return; }
    const unsub = onSnapshot(
      collection(db, 'workspaces', firstWs.id, 'members'),
      (snap) => setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    );
    return unsub;
  }, [firstWs?.id]);

  return { workspace: firstWs, members, loading };
}

// ─── Workspace tasks (real-time) ─────────────────────────────────────────────
export function useWorkspaceTasks(workspaceId) {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!workspaceId) { setTasks([]); setLoading(false); return; }

    const q = query(
      collection(db, 'workspaces', workspaceId, 'tasks'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q,
      (snap) => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); setError(null); },
      (err)  => { setError(err.message); setLoading(false); }
    );
    return unsub;
  }, [workspaceId]);

  return { tasks, loading, error };
}

// ─── Workspace task comments (real-time) ─────────────────────────────────────
export function useWorkspaceComments(workspaceId, taskId) {
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!workspaceId || !taskId) { setComments([]); setLoading(false); return; }
    const q = query(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => { setComments(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }, () => setLoading(false));
    return unsub;
  }, [workspaceId, taskId]);

  return { comments, loading };
}

// ─── Workspace task activity (real-time) ─────────────────────────────────────
export function useWorkspaceActivity(workspaceId, taskId) {
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (!workspaceId || !taskId) return;
    const q = query(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {});
    return unsub;
  }, [workspaceId, taskId]);

  return { activity };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createWorkspace(uid, email, displayName, name) {
  const ref = await addDoc(collection(db, 'workspaces'), {
    name,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'workspaces', ref.id, 'members', uid), {
    uid, email, displayName,
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameWorkspace(workspaceId, name) {
  await updateDoc(doc(db, 'workspaces', workspaceId), { name });
}

export async function addWorkspaceMember(workspaceId, { uid, email, displayName, role = 'member' }) {
  await setDoc(doc(db, 'workspaces', workspaceId, 'members', uid), {
    uid, email, displayName, role,
    joinedAt: serverTimestamp(),
  });
}

export async function removeWorkspaceMember(workspaceId, uid) {
  await deleteDoc(doc(db, 'workspaces', workspaceId, 'members', uid));
}

/**
 * Delete a workspace and ALL its subcollections (tasks, members, comments, activity).
 * Done entirely client-side in batches — compatible with Firebase Spark (free) plan.
 *
 * Deletion order:
 *   1. For each task → delete its 'comments' and 'activity' subcollections
 *   2. Delete all tasks
 *   3. Delete all members
 *   4. Delete the workspace doc
 */
export async function deleteWorkspace(workspaceId) {
  const wsRef = doc(db, 'workspaces', workspaceId);

  // 1. Delete every task's subcollections, then the task itself
  const tasksSnap = await getDocs(collection(db, 'workspaces', workspaceId, 'tasks'));
  for (const taskDoc of tasksSnap.docs) {
    const taskId = taskDoc.id;

    const [commentsSnap, activitySnap] = await Promise.all([
      getDocs(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments')),
      getDocs(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity')),
    ]);

    await Promise.all([
      ...commentsSnap.docs.map(d => deleteDoc(d.ref)),
      ...activitySnap.docs.map(d => deleteDoc(d.ref)),
    ]);

    await deleteDoc(taskDoc.ref);
  }

  // 2. Delete all members
  const membersSnap = await getDocs(collection(db, 'workspaces', workspaceId, 'members'));
  await Promise.all(membersSnap.docs.map(d => deleteDoc(d.ref)));

  // 3. Delete the workspace doc itself
  await deleteDoc(wsRef);
}

export async function addWorkspaceTask(workspaceId, task, actor) {
  const assigneeEmail = task.assigneeEmail?.toLowerCase() || null;
  const ref = await addDoc(collection(db, 'workspaces', workspaceId, 'tasks'), {
    text:           task.text?.trim() || '',
    status:         task.status   || 'open',
    priority:       task.priority || 'medium',
    dueDate:        task.dueDate  || null,
    assigneeUid:    task.assigneeUid   || null,
    assigneeEmail,
    assigneeName:   task.assigneeName  || null,
    createdBy:      actor.uid,
    createdByEmail: actor.email,
    createdByName:  actor.displayName || actor.email,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  });
  await _logWorkspaceActivity(workspaceId, ref.id, {
    actorUid: actor.uid, actorName: actor.displayName || actor.email,
    action: 'created', detail: task.text,
  });
  return ref;
}

export async function updateWorkspaceTask(workspaceId, taskId, updates, actor, task = null) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId), {
    ...updates, updatedAt: serverTimestamp(),
  });
  if (updates.status && actor) {
    const labels = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
    await _logWorkspaceActivity(workspaceId, taskId, {
      actorUid: actor.uid, actorName: actor.displayName || actor.email,
      action: 'status_changed', detail: `→ ${labels[updates.status] || updates.status}`,
    });
  }
}

export async function deleteWorkspaceTask(workspaceId, taskId) {
  await deleteDoc(doc(db, 'workspaces', workspaceId, 'tasks', taskId));
}

export async function addWorkspaceComment(workspaceId, taskId, { authorUid, authorName, authorEmail, text }, task = null) {
  await addDoc(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'comments'), {
    authorUid, authorName, text,
    createdAt: serverTimestamp(),
  });
  await _logWorkspaceActivity(workspaceId, taskId, {
    actorUid: authorUid, actorName: authorName,
    action: 'commented', detail: text,
  });
}

async function _logWorkspaceActivity(workspaceId, taskId, { actorUid, actorName, action, detail }) {
  await addDoc(collection(db, 'workspaces', workspaceId, 'tasks', taskId, 'activity'), {
    actorUid, actorName, action, detail: detail || '',
    createdAt: serverTimestamp(),
  });
}
