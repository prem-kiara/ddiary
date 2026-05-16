/**
 * useSharedDiaries — mirrors useSharedSheets.js for diary-entry collaboration.
 *
 * Firestore layout
 *   sharedDiaries/{entryId}          — shared diary document
 *   sharedDiaries/{entryId}/members/{uid}  — per-member docs
 * diaryInvites/{inviteId}            — pending invitations (deterministic ID)
 */
import { useState, useEffect } from 'react';
import {
  collection, doc, addDoc, updateDoc, setDoc, getDoc,
  query, where, onSnapshot, serverTimestamp,
  writeBatch, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import { notifyDiaryInvite } from '../utils/emailNotifications';

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Convert a personal diary entry into a shared entry.
 * Creates sharedDiaries/{entryId} and marks the personal entry as shared.
 */
export async function shareDiary(entry, owner) {
  const batch    = writeBatch(db);
  const sharedRef = doc(db, 'sharedDiaries', entry.id);

  batch.set(sharedRef, {
    title:     entry.title     || '',
    content:   entry.content   || '',
    tag:       entry.tag       || null,
    drawings:  entry.drawings  || [],
    ownerId:   owner.uid,
    ownerEmail: owner.email,
    ownerName: owner.displayName || owner.email,
    memberUids: [owner.uid],
    createdAt: entry.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Owner member doc
  const memberRef = doc(db, 'sharedDiaries', entry.id, 'members', owner.uid);
  batch.set(memberRef, {
    uid:      owner.uid,
    email:    owner.email,
    name:     owner.displayName || owner.email,
    role:     'owner',
    joinedAt: serverTimestamp(),
  });

  // Mark personal entry as shared
  const personalRef = doc(db, 'users', owner.uid, 'entries', entry.id);
  batch.update(personalRef, { isShared: true, sharedDiaryId: entry.id });

  await batch.commit();
  return entry.id;
}

/**
 * Invite someone to a shared diary by email.
 * Uses a deterministic invite ID: {diaryId}_{inviteeEmail}
 */
export async function inviteToDiary(diaryId, diaryTitle, inviter, inviteeEmail) {
  const normalised = inviteeEmail.toLowerCase().trim();
  if (normalised === inviter.email?.toLowerCase()) {
    throw new Error("You can't invite yourself.");
  }
  const inviterName = inviter.displayName || inviter.email;
  const inviteId    = `${diaryId}_${normalised}`;
  const docRef      = doc(db, 'diaryInvites', inviteId);

  await setDoc(docRef, {
    diaryId,
    diaryTitle,
    inviterUid:   inviter.uid,
    inviterName,
    inviterEmail: inviter.email,
    inviteeEmail: normalised,
    role:         'editor',
    status:       'pending',
    createdAt:    serverTimestamp(),
  });

  notifyDiaryInvite({
    inviteeEmail: normalised,
    inviterName,
    diaryTitle,
    inviteId,
  }).catch(() => {
    console.warn('Diary invite email could not be sent (MS token may be unavailable).');
  });

  return docRef;
}

/**
 * Accept a pending diary invite — same two-phase pattern as acceptSheetInvite.
 */
export async function acceptDiaryInvite(invite, user) {
  // Phase 1: create member doc + mark invite accepted
  const phase1 = writeBatch(db);
  const memberRef = doc(db, 'sharedDiaries', invite.diaryId, 'members', user.uid);
  phase1.set(memberRef, {
    uid:      user.uid,
    email:    user.email,
    name:     user.displayName || user.email,
    role:     invite.role || 'editor',
    joinedAt: serverTimestamp(),
  });
  phase1.update(doc(db, 'diaryInvites', invite.id), { status: 'accepted' });
  await phase1.commit();

  // Phase 2: add uid to memberUids (now that member doc exists, rules allow it)
  const phase2 = writeBatch(db);
  phase2.update(doc(db, 'sharedDiaries', invite.diaryId), {
    memberUids: arrayUnion(user.uid),
  });
  await phase2.commit();
}

/**
 * Decline / revoke an invite.
 */
export async function rejectDiaryInvite(invite) {
  await updateDoc(doc(db, 'diaryInvites', invite.id), { status: 'rejected' });
}

/**
 * Remove a member from a shared diary.
 */
export async function removeSharedDiaryMember(diaryId, memberUid) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'sharedDiaries', diaryId, 'members', memberUid));
  batch.update(doc(db, 'sharedDiaries', diaryId), { memberUids: arrayRemove(memberUid) });
  await batch.commit();
}

/**
 * Save content changes to a shared diary entry.
 */
export async function saveSharedDiary(diaryId, updates, user) {
  await updateDoc(doc(db, 'sharedDiaries', diaryId), {
    ...updates,
    updatedBy:  user.uid,
    updatedAt:  serverTimestamp(),
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Pending diary invites for current user (by email). */
export function usePendingDiaryInvites(email) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!email) { setInvites([]); setLoading(false); return; }
    const q = query(
      collection(db, 'diaryInvites'),
      where('inviteeEmail', '==', email.toLowerCase()),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q,
      snap => { setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [email]);
  return { invites, loading };
}

/** All shared diaries where uid is a member (own + collaborated). */
export function useMySharedDiaries(uid) {
  const [sharedDiaries, setSharedDiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) { setSharedDiaries([]); setLoading(false); return; }
    const q = query(
      collection(db, 'sharedDiaries'),
      where('memberUids', 'array-contains', uid),
    );
    const unsub = onSnapshot(q,
      snap => { setSharedDiaries(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [uid]);
  return { sharedDiaries, loading };
}

/** Real-time subscription to one shared diary + its members. */
export function useSharedDiaryLive(diaryId) {
  const [diary,   setDiary]   = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!diaryId) return;
    const diaryUnsub = onSnapshot(
      doc(db, 'sharedDiaries', diaryId),
      snap => { if (snap.exists()) setDiary({ id: snap.id, ...snap.data() }); setLoading(false); },
      () => setLoading(false),
    );
    const membersUnsub = onSnapshot(
      collection(db, 'sharedDiaries', diaryId, 'members'),
      snap => setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { diaryUnsub(); membersUnsub(); };
  }, [diaryId]);

  return { diary, members, loading };
}

/** Pending invites for a specific diary (used in ShareDiaryModal). */
export function useDiaryPendingInvites(diaryId) {
  const [invites, setInvites] = useState([]);
  useEffect(() => {
    if (!diaryId) return;
    const q = query(
      collection(db, 'diaryInvites'),
      where('diaryId', '==', diaryId),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q,
      snap => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return unsub;
  }, [diaryId]);
  return invites;
}
