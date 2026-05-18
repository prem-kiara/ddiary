import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { logError } from '../utils/errorLogger';

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
        data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMembers(data);
        setLoading(false);
      },
      (err) => { logError(err, { location: 'useTeamMembers', action: 'onSnapshot' }); setLoading(false); }
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

  /**
   * Upsert a phone-number override for a contact, keyed by email.
   *
   * Used by the Contacts editor on the Settings page + the silent auto-save
   * when a user manually edits a phone in the Assign task panel. Doc ID is
   * derived from the email so the same contact can't be duplicated.
   *
   * Pass `phone` as empty string / null to clear the override (deletes the
   * doc so future assignments fall back to Graph data).
   */
  const saveContactPhone = useCallback(async (email, name, phone) => {
    if (!user) return;
    const clean = (email || '').trim().toLowerCase();
    if (!clean || !/^\S+@\S+\.\S+$/.test(clean)) return;
    // Firestore doc IDs can't contain "/" or start with "__". Sanitize.
    const safeId = clean.replace(/[^a-zA-Z0-9@._-]/g, '_').replace(/^__+/, '');
    const ref   = doc(db, 'users', user.uid, 'teamMembers', safeId);
    const trimmedPhone = (phone || '').trim();
    if (!trimmedPhone) {
      // Remove the override doc entirely so we fall back to Graph.
      await deleteDoc(ref).catch(() => {});
      return;
    }
    await setDoc(ref, {
      email: clean,
      name:  (name || '').trim() || clean,
      phone: trimmedPhone,
      uid:   null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [user]);

  return { members, loading, addMember, addMembersBulk, updateMember, deleteMember, saveContactPhone };
}
