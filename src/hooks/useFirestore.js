import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { createLogger } from '../utils/errorLogger';

// ─── Cloudinary upload (replaces Firebase Storage) ────────────────────────
const CLOUDINARY_CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
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

// ─── Diary Entries Hook ────────────────────────────────────────────────────
export function useEntries() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [trashedEntries, setTrashedEntries] = useState([]);
  const [archivedEntries, setArchivedEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setEntries([]); setTrashedEntries([]); setLoading(false); return; }

    const log = createLogger('useEntries', user.uid);

    const q = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Split into active, archived, and soft-deleted
      setEntries(data.filter(e => !e.deletedAt && !e.archived));
      setArchivedEntries(data.filter(e => !e.deletedAt && !!e.archived));
      setTrashedEntries(data.filter(e => !!e.deletedAt));
      setLoading(false);
    }, (err) => {
      log(err, { action: 'onSnapshot' });
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const col = collection(db, 'users', user.uid, 'entries');

    // Upload drawings to Cloudinary if present
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        try {
          const url = await uploadToCloudinary(entry.drawings[i]);
          drawingUrls.push(url);
        } catch (err) {
          log(err, { action: 'uploadDrawing', index: i });
        }
      }
    }

    return addDoc(col, {
      ...entry,
      drawings: drawingUrls,
      deletedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const log = createLogger('useEntries', user.uid);
    const docRef = doc(db, 'users', user.uid, 'entries', id);

    // Upload any new base64 drawings
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          try {
            const url = await uploadToCloudinary(drawing);
            drawingUrls.push(url);
          } catch (err) {
            log(err, { action: 'uploadDrawing' });
          }
        } else {
          drawingUrls.push(drawing); // already a Cloudinary URL
        }
      }
      updates.drawings = drawingUrls;
    }

    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user]);

  /** Soft delete — moves entry to trash (recoverable for 30 days). */
  const deleteEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), {
      deletedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  /** Restore a soft-deleted entry back to the main list. */
  const restoreEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), {
      deletedAt: null,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  /** Permanent delete — only callable from the trash view. */
  const purgeEntry = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'entries', id));
  }, [user]);

  /** Archive an entry — moves it to the archive section. */
  const archiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), {
      archived: true,
      archivedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  /** Unarchive an entry — restores it to the main list. */
  const unarchiveEntry = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'entries', id), {
      archived: false,
      archivedAt: null,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  return {
    entries, trashedEntries, archivedEntries, loading,
    addEntry, updateEntry, deleteEntry, restoreEntry, purgeEntry,
    archiveEntry, unarchiveEntry,
  };
}

// ─── Tasks Hook ────────────────────────────────────────────────────────────
export function useTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setTasks([]); setLoading(false); return; }

    const q = query(
      collection(db, 'users', user.uid, 'tasks'),
      orderBy('createdAt', 'desc')
    );

    const log = createLogger('useTasks', user.uid);

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort: incomplete first (by due date), then completed
      data.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDate - bDate;
      });
      setTasks(data);
      setLoading(false);
    }, (err) => {
      log(err, { action: 'onSnapshot' });
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const addTask = useCallback(async (task) => {
    if (!user) return;
    return addDoc(collection(db, 'users', user.uid, 'tasks'), {
      ...task,
      completed: false,
      reminder: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }, [user]);

  const updateTask = useCallback(async (id, updates) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      ...updates,
      updatedAt: serverTimestamp()
    });
  }, [user]);

  const toggleTask = useCallback(async (id, currentState) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'tasks', id), {
      completed: !currentState,
      completedAt: !currentState ? new Date().toISOString() : null,
      updatedAt: serverTimestamp()
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

// ─── Team Members Hook ─────────────────────────────────────────────────────
export function useTeamMembers() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setMembers([]); setLoading(false); return; }

    const q = query(
      collection(db, 'users', user.uid, 'teamMembers'),
      orderBy('name')
    );

    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [user]);

  const addMember = useCallback(async (member) => {
    if (!user) return;
    return addDoc(collection(db, 'users', user.uid, 'teamMembers'), {
      ...member,
      createdAt: serverTimestamp(),
    });
  }, [user]);

  const addMembersBulk = useCallback(async (newMembers) => {
    if (!user || !newMembers.length) return;
    const batch = writeBatch(db);
    newMembers.forEach(m => {
      const ref = doc(collection(db, 'users', user.uid, 'teamMembers'));
      batch.set(ref, { ...m, createdAt: serverTimestamp() });
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
