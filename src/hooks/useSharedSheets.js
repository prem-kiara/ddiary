import { useState, useEffect } from 'react';
import {
  collection, doc, addDoc, updateDoc, setDoc, getDoc,
  query, where, onSnapshot, serverTimestamp, orderBy, limit,
  writeBatch, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import { notifySheetInvite } from '../utils/emailNotifications';

// Convert a personal sheet into a shared sheet
export async function shareSheet(sheet, owner) {
  const batch = writeBatch(db);
  const sharedRef = doc(db, 'sharedSheets', sheet.id);
  batch.set(sharedRef, {
    title:      sheet.title || 'Untitled Sheet',
    data:       sheet.data || {},
    cols:       sheet.cols || 10,
    rows:       sheet.rows || 50,
    colWidths:  sheet.colWidths || [],
    rowHeights: sheet.rowHeights || [],
    ownerId:    owner.uid,
    ownerEmail: owner.email,
    ownerName:  owner.displayName || owner.email,
    memberUids: [owner.uid],
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
  });
  // Add owner as member
  const memberRef = doc(db, 'sharedSheets', sheet.id, 'members', owner.uid);
  batch.set(memberRef, {
    uid:      owner.uid,
    email:    owner.email,
    name:     owner.displayName || owner.email,
    role:     'owner',
    joinedAt: serverTimestamp(),
  });
  // First audit log entry
  const auditRef = doc(collection(db, 'sharedSheets', sheet.id, 'auditLog'));
  batch.set(auditRef, {
    action:    'sheet_shared',
    userId:    owner.uid,
    userEmail: owner.email,
    userName:  owner.displayName || owner.email,
    timestamp: serverTimestamp(),
    details:   { sheetTitle: sheet.title },
  });
  // Mark personal sheet as shared
  const personalRef = doc(db, 'users', owner.uid, 'sheets', sheet.id);
  batch.update(personalRef, { isShared: true, sharedSheetId: sheet.id });
  await batch.commit();
  return sheet.id;
}

// Invite someone to a shared sheet by email
export async function inviteToSheet(sheetId, sheetTitle, inviter, inviteeEmail) {
  const normalised = inviteeEmail.toLowerCase().trim();
  if (normalised === inviter.email?.toLowerCase()) {
    throw new Error("You can't invite yourself.");
  }
  const inviterName = inviter.displayName || inviter.email;

  // 1. Write the invite to Firestore using a DETERMINISTIC document ID so that
  //    Firestore security rules can look it up via get() when the invitee
  //    accepts. Without this, the accept batch is rejected because the invitee
  //    isn't yet in memberUids, so isSharedMember() returns false.
  //    Format: {sheetId}_{inviteeEmail}
  const inviteId = `${sheetId}_${normalised}`;
  const docRef = doc(db, 'sheetInvites', inviteId);
  await setDoc(docRef, {
    sheetId,
    sheetTitle,
    inviterUid:   inviter.uid,
    inviterName,
    inviterEmail: inviter.email,
    inviteeEmail: normalised,
    role:         'editor',
    status:       'pending',
    createdAt:    serverTimestamp(),
  });

  // 2. Fire-and-forget email — sent from the inviter's M365 mailbox via Graph
  notifySheetInvite({
    inviteeEmail: normalised,
    inviterName,
    sheetTitle,
  }).catch(() => {
    // Email failure is non-fatal — the Firestore invite still works
    console.warn('Sheet invite email could not be sent (MS token may be unavailable).');
  });

  return docRef; // returns the DocumentReference for the invite
}

// Accept a pending sheet invite — two-phase commit
//
// WHY TWO PHASES:
// Firestore evaluates every write in a batch against the PRE-BATCH database
// state.  isSharedMember() (in rules) checks whether the user's member doc
// exists.  If we create that doc and update memberUids in the SAME batch,
// isSharedMember() is still false when the memberUids write is evaluated —
// the doc creation hasn't landed yet from the rules engine's point of view.
//
// Phase 1 — writes that are allowed WITHOUT being a member yet:
//   • member doc   (members subcollection: create if authenticated)
//   • invite update (sheetInvites: inviteeEmail == auth.token.email)
//
// Phase 2 — runs AFTER phase 1 commits, so the member doc exists.
//   isSharedMember() now returns true → memberUids update + audit log pass.
export async function acceptSheetInvite(invite, user) {
  // ── Phase 1 ──────────────────────────────────────────────────────────────
  const phase1 = writeBatch(db);

  const memberRef = doc(db, 'sharedSheets', invite.sheetId, 'members', user.uid);
  phase1.set(memberRef, {
    uid:      user.uid,
    email:    user.email,
    name:     user.displayName || user.email,
    role:     invite.role || 'editor',
    joinedAt: serverTimestamp(),
  });

  phase1.update(doc(db, 'sheetInvites', invite.id), { status: 'accepted' });

  await phase1.commit(); // member doc is now in Firestore

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  // isSharedMember() checks exists(.../members/{uid}) — true after phase 1.
  const phase2 = writeBatch(db);

  phase2.update(doc(db, 'sharedSheets', invite.sheetId), {
    memberUids: arrayUnion(user.uid),
  });

  const auditRef = doc(collection(db, 'sharedSheets', invite.sheetId, 'auditLog'));
  phase2.set(auditRef, {
    action:    'access_granted',
    userId:    user.uid,
    userEmail: user.email,
    userName:  user.displayName || user.email,
    timestamp: serverTimestamp(),
    details:   { grantedTo: user.email, grantedBy: invite.inviterEmail },
  });

  await phase2.commit();
}

// Decline / revoke an invite
export async function rejectSheetInvite(invite) {
  await updateDoc(doc(db, 'sheetInvites', invite.id), { status: 'rejected' });
}

// Sync a member's UID into the memberUids array — fixes stuck members where
// Phase 1 (member doc creation) succeeded but Phase 2 (memberUids update) was
// blocked by old Firestore rules. Owner can call this from the Share modal to
// grant access without requiring a re-invite.
export async function syncMemberAccess(sheetId, memberUid) {
  await updateDoc(doc(db, 'sharedSheets', sheetId), {
    memberUids: arrayUnion(memberUid),
  });
}

// Remove a member from a shared sheet
export async function removeSheetMember(sheetId, memberUid, removedByEmail) {
  const memberSnap = await getDoc(doc(db, 'sharedSheets', sheetId, 'members', memberUid)).catch(() => null);
  const memberEmail = memberSnap?.data()?.email || memberUid;
  const memberName  = memberSnap?.data()?.name  || memberEmail;

  const batch = writeBatch(db);
  batch.delete(doc(db, 'sharedSheets', sheetId, 'members', memberUid));
  batch.update(doc(db, 'sharedSheets', sheetId), { memberUids: arrayRemove(memberUid) });
  const auditRef = doc(collection(db, 'sharedSheets', sheetId, 'auditLog'));
  batch.set(auditRef, {
    action:    'access_revoked',
    userId:    memberUid,
    userEmail: memberEmail,
    userName:  memberName,
    timestamp: serverTimestamp(),
    details:   { revokedBy: removedByEmail, targetEmail: memberEmail },
  });
  await batch.commit();
}

// Save shared sheet + write accumulated audit events (max 20)
export async function saveSharedSheet(sheetId, updates, user, auditEvents = []) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'sharedSheets', sheetId), {
    ...updates,
    updatedBy:  user.uid,
    updatedAt:  serverTimestamp(),
  });
  auditEvents.slice(0, 20).forEach(ev => {
    const auditRef = doc(collection(db, 'sharedSheets', sheetId, 'auditLog'));
    batch.set(auditRef, {
      action:    ev.action,
      userId:    user.uid,
      userEmail: user.email,
      userName:  user.displayName || user.email,
      timestamp: serverTimestamp(),
      details:   ev.details || {},
    });
  });
  await batch.commit();
}

// Log a sheet-opened event
export async function logSheetOpen(sheetId, user) {
  return addDoc(collection(db, 'sharedSheets', sheetId, 'auditLog'), {
    action:    'sheet_opened',
    userId:    user.uid,
    userEmail: user.email,
    userName:  user.displayName || user.email,
    timestamp: serverTimestamp(),
    details:   {},
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

// Pending sheet invites for current user
export function usePendingSheetInvites(email) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!email) { setInvites([]); setLoading(false); return; }
    const q = query(
      collection(db, 'sheetInvites'),
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

// Shared sheets where uid is a member (includes own + collaborated)
export function useMySharedSheets(uid) {
  const [sharedSheets, setSharedSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) { setSharedSheets([]); setLoading(false); return; }
    const q = query(
      collection(db, 'sharedSheets'),
      where('memberUids', 'array-contains', uid),
    );
    const unsub = onSnapshot(q,
      snap => { setSharedSheets(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [uid]);
  return { sharedSheets, loading };
}

// Real-time subscription to one shared sheet + its members + audit log
export function useSharedSheetLive(sheetId) {
  const [sheet,    setSheet]    = useState(null);
  const [members,  setMembers]  = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!sheetId) return;
    const sheetUnsub = onSnapshot(
      doc(db, 'sharedSheets', sheetId),
      snap => { if (snap.exists()) setSheet({ id: snap.id, ...snap.data() }); setLoading(false); },
      () => setLoading(false),
    );
    const membersUnsub = onSnapshot(
      collection(db, 'sharedSheets', sheetId, 'members'),
      snap => setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    const auditUnsub = onSnapshot(
      query(
        collection(db, 'sharedSheets', sheetId, 'auditLog'),
        orderBy('timestamp', 'desc'),
        limit(100),
      ),
      snap => setAuditLog(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { sheetUnsub(); membersUnsub(); auditUnsub(); };
  }, [sheetId]);

  return { sheet, members, auditLog, loading };
}

// Pending invites for a sheet (for the Share modal)
export function useSheetPendingInvites(sheetId) {
  const [invites, setInvites] = useState([]);
  useEffect(() => {
    if (!sheetId) return;
    const q = query(
      collection(db, 'sheetInvites'),
      where('sheetId', '==', sheetId),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q,
      snap => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return unsub;
  }, [sheetId]);
  return invites;
}
