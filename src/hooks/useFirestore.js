import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// ─── Diary Entries Hook ────────────────────────────────────────────────────
export function useEntries() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setEntries([]); setLoading(false); return; }

    const q = query(
      collection(db, 'users', user.uid, 'entries'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEntries(data);
      setLoading(false);
    }, (err) => {
      console.error('Entries listener error:', err);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const addEntry = useCallback(async (entry) => {
    if (!user) return;
    const col = collection(db, 'users', user.uid, 'entries');

    // Upload drawings to Storage if present
    const drawingUrls = [];
    if (entry.drawings?.length) {
      for (let i = 0; i < entry.drawings.length; i++) {
        const storageRef = ref(storage, `users/${user.uid}/drawings/${Date.now()}_${i}.png`);
        await uploadString(storageRef, entry.drawings[i], 'data_url');
        const url = await getDownloadURL(storageRef);
        drawingUrls.push(url);
      }
    }

    return addDoc(col, {
      ...entry,
      drawings: drawingUrls,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }, [user]);

  const updateEntry = useCallback(async (id, updates) => {
    if (!user) return;
    const docRef = doc(db, 'users', user.uid, 'entries', id);

    // Upload any new base64 drawings
    if (updates.drawings) {
      const drawingUrls = [];
      for (const drawing of updates.drawings) {
        if (drawing.startsWith('data:')) {
          const storageRef = ref(storage, `users/${user.uid}/drawings/${Date.now()}_${Math.random().toString(36).substr(2)}.png`);
          await uploadString(storageRef, drawing, 'data_url');
          const url = await getDownloadURL(storageRef);
          drawingUrls.push(url);
        } else {
          drawingUrls.push(drawing); // already a URL
        }
      }
      updates.drawings = drawingUrls;
    }

    return updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  }, [user]);

  const deleteEntry = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'entries', id));
  }, [user]);

  return { entries, loading, addEntry, updateEntry, deleteEntry };
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
      console.error('Tasks listener error:', err);
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
