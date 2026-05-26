/**
 * sheetHistory.js
 *
 * Snapshot / restore utilities for the SpreadsheetGrid.
 *
 * Snapshots are stored as Firestore sub-collections:
 *   Personal sheet:  users/{uid}/sheets/{sheetId}/history/{histId}
 *   Shared sheet:    sharedSheets/{sharedSheetId}/history/{histId}
 *
 * Each snapshot stores the full grid data, dimensions, and metadata so the
 * user can roll back to any of the last MAX_SNAPSHOTS versions.
 *
 * Pruning: after every write the oldest documents beyond MAX_SNAPSHOTS are
 * deleted so storage stays bounded.
 */

import {
  collection, addDoc, getDocs, deleteDoc,
  query, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const MAX_SNAPSHOTS = 20;

/**
 * Save a new snapshot for a spreadsheet.
 *
 * @param {object} opts
 * @param {string}  opts.uid          - owner's Firebase UID (required for personal sheets)
 * @param {string}  opts.sheetId      - personal sheet doc ID
 * @param {boolean} opts.isShared     - true if this is a sharedSheets entry
 * @param {string}  opts.sharedId     - sharedSheets doc ID (required when isShared = true)
 * @param {string}  opts.title        - sheet title at snapshot time
 * @param {object}  opts.data         - full grid data object { 'A1': {...}, ... }
 * @param {number}  opts.cols         - column count
 * @param {number}  opts.rows         - row count
 * @param {string}  opts.savedBy      - displayName or email of the user who triggered the save
 * @param {'manual'|'periodic'} opts.type - how this snapshot was triggered
 */
export async function saveSheetSnapshot({
  uid,
  sheetId,
  isShared,
  sharedId,
  title,
  data,
  cols,
  rows,
  savedBy,
  type = 'manual',
}) {
  const id = isShared ? sharedId : sheetId;
  if (!id || id === 'new') return;

  // Don't snapshot completely empty sheets
  const hasContent = Object.values(data || {}).some(cell => cell?.v != null && cell.v !== '');
  if (!hasContent) return;

  const colRef = isShared
    ? collection(db, 'sharedSheets', id, 'history')
    : collection(db, 'users', uid, 'sheets', id, 'history');

  await addDoc(colRef, {
    title:   title  || 'Untitled Sheet',
    data:    data   || {},
    cols:    cols   || 10,
    rows:    rows   || 50,
    savedAt: serverTimestamp(),
    savedBy: savedBy || '',
    type,
  });

  // Prune: keep only the MAX_SNAPSHOTS most recent documents
  const snap = await getDocs(query(colRef, orderBy('savedAt', 'asc')));
  if (snap.size > MAX_SNAPSHOTS) {
    const excess = snap.docs.slice(0, snap.size - MAX_SNAPSHOTS);
    await Promise.all(excess.map(d => deleteDoc(d.ref)));
  }
}

/**
 * Load all snapshots for a spreadsheet, newest first.
 *
 * @param {object} opts
 * @param {string}  opts.uid      - owner UID (personal sheets)
 * @param {string}  opts.sheetId  - personal sheet ID
 * @param {boolean} opts.isShared
 * @param {string}  opts.sharedId - sharedSheets ID
 * @returns {Promise<Array>} array of snapshot objects, most recent first
 */
export async function loadSheetSnapshots({ uid, sheetId, isShared, sharedId }) {
  const id = isShared ? sharedId : sheetId;
  if (!id || id === 'new') return [];

  const colRef = isShared
    ? collection(db, 'sharedSheets', id, 'history')
    : collection(db, 'users', uid, 'sheets', id, 'history');

  const snap = await getDocs(
    query(colRef, orderBy('savedAt', 'desc'), limit(MAX_SNAPSHOTS))
  );

  return snap.docs.map(d => ({
    id:      d.id,
    ...d.data(),
    savedAt: d.data().savedAt?.toDate?.() ?? new Date(0),
  }));
}
