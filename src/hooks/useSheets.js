import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// ─── Sheets Hook ─────────────────────────────────────────────────────────
export function useSheets() {
  const { user } = useAuth();
  const [allSheets, setAllSheets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setAllSheets([]); setLoading(false); return; }
    const q = query(
      collection(db, 'users', user.uid, 'sheets'),
      orderBy('updatedAt', 'desc'),
    );
    const unsub = onSnapshot(q,
      snap  => { setAllSheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      err   => { console.error('useSheets', err); setLoading(false); },
    );
    return unsub;
  }, [user]);

  // Client-side filter into three buckets
  const sheets         = allSheets.filter(s => !s.deleted && !s.archived);
  const archivedSheets = allSheets.filter(s =>  s.archived && !s.deleted);
  const trashedSheets  = allSheets.filter(s =>  s.deleted);

  const addSheet = useCallback(async (title) => {
    if (!user) return;
    return addDoc(collection(db, 'users', user.uid, 'sheets'), {
      title: title || 'Untitled Sheet',
      data:  {},
      cols:  10,
      rows:  50,
      deleted:  false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const updateSheet = useCallback(async (id, updates) => {
    if (!user) return;
    // Optimistic update: reflect changes in the local list immediately so the
    // My Sheets card title is correct as soon as the user navigates back,
    // without waiting for the Firestore onSnapshot round-trip.
    setAllSheets(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    return updateDoc(doc(db, 'users', user.uid, 'sheets', id), {
      ...updates, updatedAt: serverTimestamp(),
    });
  }, [user]);

  // Soft-delete: moves to Recently Deleted
  const trashSheet = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'sheets', id), {
      deleted: true, archived: false, updatedAt: serverTimestamp(),
    });
  }, [user]);

  // Restore from trash back to active
  const restoreSheet = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'sheets', id), {
      deleted: false, updatedAt: serverTimestamp(),
    });
  }, [user]);

  // Permanent delete
  const purgeSheet = useCallback(async (id) => {
    if (!user) return;
    return deleteDoc(doc(db, 'users', user.uid, 'sheets', id));
  }, [user]);

  // Archive
  const archiveSheet = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'sheets', id), {
      archived: true, deleted: false, updatedAt: serverTimestamp(),
    });
  }, [user]);

  // Unarchive back to active
  const unarchiveSheet = useCallback(async (id) => {
    if (!user) return;
    return updateDoc(doc(db, 'users', user.uid, 'sheets', id), {
      archived: false, updatedAt: serverTimestamp(),
    });
  }, [user]);

  return {
    sheets, archivedSheets, trashedSheets, loading,
    addSheet, updateSheet,
    trashSheet, restoreSheet, purgeSheet,
    archiveSheet, unarchiveSheet,
  };
}
