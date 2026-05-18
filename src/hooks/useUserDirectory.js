import { useState, useEffect } from 'react';
import {
  collection, doc, setDoc,
  query, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

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

/** Write a user-directory entry so the owner can discover this member. */
export async function writeUserDirectory(uid, { email, displayName, invitedBy }) {
  await setDoc(doc(db, 'userDirectory', uid), {
    uid, email, displayName, invitedBy, createdAt: new Date().toISOString(),
  });
}
