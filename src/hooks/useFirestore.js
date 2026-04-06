import { useState, useEffect, useCallback } from 'react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  query, orderBy, where, onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { createLogger } from '../utils/errorLogger';

// ─── Cloudinary upload ────────────────────────────────────────────────────
const CLOUDINARY_CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

async function uploadToCloudinary(dataUrl) {
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: dataUrl, upload_preset: CLOUDINARY_PRESET }),
    }
  );
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`);
  const data = await res.json();
  return data.secure_url;
}

// ─── Diary Entries Hook ───────────────────────────────────────────────────
export function useEntries() {
  const { user } = useAuth();
  const [entries, setEntries]               = useState([]);
  const [trashedEntries, setTrashedEntries] = useState([]);
  const [archivedEntries, setArchivedEntries] = useState([]);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    if (!user) { setEntries([]); setTrashedEntries([]); setLoading(false); return; }

    const log = createLogger('useEntries', user.uid);
    const q   = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEntries(data.filter(e => !e.deletedAt && !e.archived));
      setArchivedEntries(data.filter(e => !e.deletedAt && !!e.archived));
      setTrashedEntries(data.filter(e => !!e.deletedAt));
      setLoading(false);
    }, (err) => { log(err, { action: 'onSnapshot' }); setLoading(false); });

    return unsub;
  }, [user]);

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const col = collection(db, 'users', user.uid, 'entries');
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        try { drawingUrls.push(await uploadToCloudinary(entry.drawings[i])); }
        catch (err) { log(err, { action: 'uploadDrawing', index: i }); }
      }
    }
    return addDoc(col, { ...entry, drawings: drawingUrls, deletedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }, [user]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const docRef = doc(db, 'users', user.uid, 'entries', id);
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          try { drawingUrls.push(await uploadToCloudinary(drawing)); }
          catch (err) { log(err, { action: 'uploadDrawing' }); }
        } else { drawingUrls.push(drawing); }
      }
      updates.drawings = drawingUrls;
    }
    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user]);

  const deleteEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const restoreEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { deletedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  const purgeEntry = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'entries', id));
  }, [user]);

  const archiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: true, archivedAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  }, [user]);

  const unarchiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
  }, [user]);

  return {
    entries, trashedEntries, archivedEntries, loading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry, archiveEntry, unarchiveEntry,
  };
}

// ─── Tasks Hook (owner) ───────────────────────────────────────────────────
export function useTasks() {
  const { user } = useAuth();
  const [tasks, setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setTasks([]); setLoading(false); return; }

    const log = createLogger('useTasks', user.uid);
    const q   = query(collection(db, 'users', user.uid, 'tasks'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDate - bDate;
      });
      setTasks(data);
      setLoading(false);
    }, (err) => { log(err, { action: 'onSnapshot' }); setLoading(false); });

    return unsub;
  }, [user]);

  const addTask = useCallback(async (task) => {
    if (!user) return;
    // Always lowercase the email so Firestore where-equality queries match reliably
    const assigneeEmail = task.assigneeEmail?.trim().toLowerCase() || null;
    const assigneeName  = task.assigneeName?.trim() || null;
    const ref = await addDoc(collection(db, 'users', user.uid, 'tasks'), {
      text:          task.text?.trim() || '',
      dueDate:       task.dueDate || null,
      priority:      task.priority || 'medium',
      reminder:      true,
      assigneeEmail,
      assigneeName,
      assigneePhone: task.assigneePhone?.trim() || null,
      assigneeUid:   null,
      ownerId:       user.uid,
      ownerName:     user.displayName || user.email,
      status:        'open',
      completed:     false,
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
    });
    await _logActivity(user.uid, ref.id, {
      actorUid:  user.uid,
      actorName: user.displayName || user.email,
      action:    'created',
      detail:    assigneeName
        ? `Task created and assigned to ${assigneeName}`
        : 'Task created',
    });
    return ref;
  }, [user]);

  const updateTask = useCallback(async (id, updates) => {
    if (!user) return;
    const sanitized = { ...updates };
    // Ensure assigneeEmail is always lowercase so queries match
    if (sanitized.assigneeEmail !== undefined) {
      sanitized.assigneeEmail = sanitized.assigneeEmail?.trim().toLowerCase() || null;
    }
    return updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const toggleTask = useCallback(async (id, currentState) => {
    if (!user) return;
    const newCompleted = !currentState;
    await updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      completed:   newCompleted,
      status:      newCompleted ? 'done' : 'open',
      completedAt: newCompleted ? new Date().toISOString() : null,
      updatedAt:   serverTimestamp(),
    });
    await _logActivity(user.uid, id, {
      actorUid:  user.uid,
      actorName: user.displayName || user.email,
      action:    newCompleted ? 'completed' : 'reopened',
      detail:    newCompleted ? 'Marked as done' : 'Reopened',
    });
  }, [user]);

  const deleteTask = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
  }, [user]);

  const clearCompleted = useCallback(async () => {
    if (!user) return;
    const batch = writeBatch(db);
    tasks.filter(t => t.completed).forEach(t => {
      batch.delete(doc(db, 'users', user.uid, 'tasks', t.id));
    });
    return batch.commit();
  }, [user, tasks]);

  return { tasks, loading, addTask, updateTask, toggleTask, deleteTask, clearCompleted };
}

// ─── Assigned Tasks Hook (team member view) ───────────────────────────────
// Queries the specific owner's task collection by assigneeEmail.
// This is reliable from day one — no UID-linking step required, and no
// collection-group index dependency.
// user.invitedBy (set during member signup) tells us whose task list to read.
export function useAssignedTasks() {
  const { user } = useAuth();
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!user) { setTasks([]); setLoading(false); return; }

    // invitedBy is the owner's UID, stored on the member's profile at signup
    const ownerUid = user.invitedBy;
    if (!ownerUid || !user.email) {
      console.warn('useAssignedTasks: user.invitedBy or user.email not set', user);
      setTasks([]); setLoading(false); return;
    }

    // Query directly on the owner's task collection — no collection-group index needed.
    // assigneeEmail is set by the owner in Reminders and has always been reliable.
    const q = query(
      collection(db, 'users', ownerUid, 'tasks'),
      where('assigneeEmail', '==', user.email),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({
        id:        d.id,
        _ownerUid: ownerUid,
        ...d.data(),
      }));
      setTasks(data);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error('useAssignedTasks error:', err);
      setError(err.message);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  return { tasks, loading, error };
}

// ─── Task Comments Hook ───────────────────────────────────────────────────
export function useTaskComments(ownerUid, taskId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!ownerUid || !taskId) { setComments([]); setLoading(false); return; }

    const q = query(
      collection(db, 'users', ownerUid, 'tasks', taskId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [ownerUid, taskId]);

  return { comments, loading };
}

// ─── Task Activity Hook ───────────────────────────────────────────────────
export function useTaskActivity(ownerUid, taskId) {
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (!ownerUid || !taskId) { setActivity([]); return; }

    const q = query(
      collection(db, 'users', ownerUid, 'tasks', taskId, 'activity'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return unsub;
  }, [ownerUid, taskId]);

  return { activity };
}

// ─── User Directory Hook (owner sees who has joined) ─────────────────────
// Reads /userDirectory where invitedBy == ownerUid, then auto-links
// to teamMembers by email if not already linked.
export function useUserDirectory(ownerUid) {
  const [directory, setDirectory] = useState([]);

  useEffect(() => {
    if (!ownerUid) { setDirectory([]); return; }

    const q = query(
      collection(db, 'userDirectory'),
      where('invitedBy', '==', ownerUid)
    );
    const unsub = onSnapshot(q, (snap) => {
      setDirectory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return unsub;
  }, [ownerUid]);

  return { directory };
}

// ─── Standalone helpers (callable outside hooks) ─────────────────────────

/** Add a comment to a task. */
export async function addComment(ownerUid, taskId, { authorUid, authorName, text }) {
  await addDoc(
    collection(db, 'users', ownerUid, 'tasks', taskId, 'comments'),
    { authorUid, authorName, text, createdAt: serverTimestamp() }
  );
  // Mirror as an activity entry
  await _logActivity(ownerUid, taskId, {
    actorUid: authorUid, actorName: authorName,
    action: 'commented', detail: text,
  });
}

/** Update a task's status and log the change. */
export async function updateTaskStatus(ownerUid, taskId, { status, actorUid, actorName }) {
  const label = { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done' };
  await updateDoc(doc(db, 'users', ownerUid, 'tasks', taskId), {
    status,
    completed:   status === 'done',
    completedAt: status === 'done' ? new Date().toISOString() : null,
    updatedAt:   serverTimestamp(),
  });
  await _logActivity(ownerUid, taskId, {
    actorUid, actorName,
    action: 'status_changed',
    detail: `Status → ${label[status] || status}`,
  });
}

/** Log an activity event (internal helper, also exported for external use). */
export async function _logActivity(ownerUid, taskId, { actorUid, actorName, action, detail }) {
  await addDoc(
    collection(db, 'users', ownerUid, 'tasks', taskId, 'activity'),
    { actorUid, actorName, action, detail, createdAt: serverTimestamp() }
  );
}

/** Write a user-directory entry so the owner can discover this member. */
export async function writeUserDirectory(uid, { email, displayName, invitedBy }) {
  await setDoc(doc(db, 'userDirectory', uid), {
    uid, email, displayName, invitedBy, createdAt: new Date().toISOString(),
  });
}

/** Fetch a single task doc (used when syncing status from team member side). */
export async function getTask(ownerUid, taskId) {
  const snap = await getDoc(doc(db, 'users', ownerUid, 'tasks', taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ─── Team Members Hook ────────────────────────────────────────────────────
export function useTeamMembers() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setMembers([]); setLoading(false); return; }

    const unsub = onSnapshot(
      collection(db, 'users', user.uid, 'teamMembers'),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => a.name.localeCompare(b.name));
        setMembers(data);
        setLoading(false);
      },
      (err) => { console.error('teamMembers snapshot error:', err); setLoading(false); }
    );

    return unsub;
  }, [user]);

  const addMember = useCallback(async (member) => {
    if (!user) return;
    return addDoc(collection(db, 'users', user.uid, 'teamMembers'), {
      ...member, uid: null, createdAt: serverTimestamp(),
    });
  }, [user]);

  const addMembersBulk = useCallback(async (newMembers) => {
    if (!user || !newMembers.length) return;
    const batch = writeBatch(db);
    newMembers.forEach(m => {
      const ref = doc(collection(db, 'users', user.uid, 'teamMembers'));
      batch.set(ref, { ...m, uid: null, createdAt: serverTimestamp() });
    });
    return batch.commit();
  }, [user]);

  const updateMember = useCallback(async (id, updates) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'teamMembers', id), updates);
  }, [user]);

  const deleteMember = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'teamMembers', id));
  }, [user]);

  return { members, loading, addMember, addMembersBulk, updateMember, deleteMember };
}
