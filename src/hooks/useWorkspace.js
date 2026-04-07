import { useState, useEffect } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// ─── Workspace metadata + members ────────────────────────────────────────────
export function useMyWorkspace() {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const wid = user?.workspaceId;
    if (!wid) { setLoading(false); return; }

    let loaded = { ws: false, mem: false };
    const done = () => { if (loaded.ws && loaded.mem) setLoading(false); };

    const unsubWs = onSnapshot(doc(db, 'workspaces', wid), (snap) => {
      setWorkspace(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      loaded.ws = true; done();
    }, () => { loaded.ws = true; done(); });

    const unsubMem = onSnapshot(
      collection(db, 'workspaces', wid, 'members'),
      (snap) => {
        setMembers(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
        loaded.mem = true; done();
      },
      () => { loaded.mem = true; done(); }
    );

    return () => { unsubWs(); unsubMem(); };
  }, [user?.workspaceId]);

  return { workspace, members, loading };
}

// ─── Workspace tasks (real-time) ─────────────────────────────────────────────
export function useWorkspaceTasks(workspaceId) {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }

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
    if (!workspaceId || !taskId) { setLoading(false); return; }
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

export async function addWorkspaceMember(workspaceId, { uid, email, displayName, role = 'member' }) {
  await setDoc(doc(db, 'workspaces', workspaceId, 'members', uid), {
    uid, email, displayName, role,
    joinedAt: serverTimestamp(),
  });
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

// task = full current task object (needed to get creator/assignee emails for notifications)
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

// task = full current task object (needed to route comment notification to the right party)
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
