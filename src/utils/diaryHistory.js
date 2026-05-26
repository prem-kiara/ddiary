/**
 * diaryHistory.js — version snapshot system for diary entries
 *
 * Snapshots are stored in a `history` subcollection:
 *   Personal:  users/{uid}/entries/{entryId}/history/{autoId}
 *   Shared:    sharedDiaries/{entryId}/history/{autoId}
 *
 * Each snapshot stores the full HTML content + title + metadata.
 * The 20 most recent snapshots are kept; older ones are pruned automatically.
 *
 * Snapshot triggers (wired up externally):
 *   1. Every manual "Save Entry" click — always snapshots
 *   2. Shared-diary autosave — snapshots at most every 5 minutes
 */
import {
  collection, addDoc, getDocs, deleteDoc,
  serverTimestamp, query, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../firebase';

const MAX_SNAPSHOTS = 20;

/**
 * Save a snapshot of the current editor state.
 *
 * @param {object} opts
 * @param {string}  opts.uid        - Firebase user uid (for personal entries)
 * @param {string}  opts.entryId    - Firestore document id of the entry
 * @param {boolean} opts.isShared   - true when editing a sharedDiaries entry
 * @param {string}  opts.title      - current entry title
 * @param {string}  opts.content    - current editor innerHTML
 * @param {string}  opts.savedBy    - display name / email of the user saving
 * @param {'manual'|'periodic'} [opts.type='manual']
 */
export async function saveSnapshot({ uid, entryId, isShared, title, content, savedBy, type = 'manual' }) {
  if (!entryId || entryId === 'new') return;
  if (!content || content.replace(/<[^>]+>/g, '').trim() === '') return; // skip empty saves

  const colRef = isShared
    ? collection(db, 'sharedDiaries', entryId, 'history')
    : collection(db, 'users', uid, 'entries', entryId, 'history');

  // Write the snapshot
  await addDoc(colRef, {
    title:   title   || '',
    content: content || '',
    savedAt: serverTimestamp(),
    savedBy: savedBy || '',
    type,
  });

  // Prune: keep only the most recent MAX_SNAPSHOTS
  try {
    const snap = await getDocs(query(colRef, orderBy('savedAt', 'asc')));
    if (snap.size > MAX_SNAPSHOTS) {
      const excess = snap.docs.slice(0, snap.size - MAX_SNAPSHOTS);
      await Promise.all(excess.map(d => deleteDoc(d.ref)));
    }
  } catch {
    // Pruning is best-effort — don't let it block the save
  }
}

/**
 * Load the most recent snapshots for an entry, newest first.
 *
 * @returns {Array<{id, title, content, savedAt, savedBy, type}>}
 */
export async function loadSnapshots({ uid, entryId, isShared }) {
  if (!entryId || entryId === 'new') return [];

  const colRef = isShared
    ? collection(db, 'sharedDiaries', entryId, 'history')
    : collection(db, 'users', uid, 'entries', entryId, 'history');

  const snap = await getDocs(
    query(colRef, orderBy('savedAt', 'desc'), limit(MAX_SNAPSHOTS))
  );

  return snap.docs.map(d => {
    const data = d.data();
    return {
      id:      d.id,
      title:   data.title   || '',
      content: data.content || '',
      savedBy: data.savedBy || '',
      type:    data.type    || 'manual',
      savedAt: data.savedAt?.toDate?.() || new Date(0),
    };
  });
}
