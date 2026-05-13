/**
 * Sheet row reminders — Firestore-backed daily email reminders per row.
 *
 * Emails are sent server-side by the Firebase Cloud Function
 * `sendSheetRowReminders` in functions/index.js, which runs every hour
 * and respects the sendAtTime (IST) stored on each reminder doc.
 *
 * This module only handles:
 *  - Writing reminder docs to Firestore (create / stop / update)
 *  - The real-time hook that drives bell-icon state in SpreadsheetGrid
 */

import {
  collection, doc, addDoc, updateDoc,
  query, where, serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { useState, useEffect } from 'react';
import { db } from '../firebase';

const COLLECTION = 'sheetRowReminders';

// ─── Write helpers ────────────────────────────────────────────────────────────

export async function createRowReminder({
  sheetId, sharedSheetId, sheetTitle,
  rowIndex, rowData, columnHeaders,
  assigneeEmail, assigneeName,
  remarks,
  notifyEmails,
  sendAtTime,       // "HH:MM" IST, e.g. "09:00" — email fires within 30 min of this time
  createdBy, createdByEmail,
}) {
  return addDoc(collection(db, COLLECTION), {
    sheetId,
    sharedSheetId:  sharedSheetId  || null,
    sheetTitle:     sheetTitle     || '',
    rowIndex:       rowIndex       ?? 0,
    rowData:        rowData        || {},
    columnHeaders:  columnHeaders  || {},
    assigneeEmail:  assigneeEmail  || '',
    assigneeName:   assigneeName   || '',
    remarks:        remarks        || '',
    notifyEmails:   notifyEmails   || [],
    sendAtTime:     sendAtTime     || null,
    active:         true,
    frequency:      'daily',
    createdBy,
    createdByEmail,
    createdAt:      serverTimestamp(),
    lastSentAt:     null,
    stoppedAt:      null,
  });
}

export async function stopRowReminder(reminderId) {
  await updateDoc(doc(db, COLLECTION, reminderId), {
    active:    false,
    stoppedAt: serverTimestamp(),
  });
}

/** Update the row snapshot in an existing reminder (keeps data fresh). */
export async function updateReminderRowSnapshot(reminderId, rowData, columnHeaders) {
  await updateDoc(doc(db, COLLECTION, reminderId), { rowData, columnHeaders });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Returns active reminders for a given sheetId, keyed by rowIndex. */
export function useSheetRowReminders(sheetId) {
  const [reminders, setReminders] = useState([]);

  useEffect(() => {
    if (!sheetId) { setReminders([]); return; }
    const q = query(
      collection(db, COLLECTION),
      where('sheetId', '==', sheetId),
      where('active',  '==', true),
    );
    const unsub = onSnapshot(q,
      snap => setReminders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return unsub;
  }, [sheetId]);

  // rowIndex → reminder doc
  const byRow = {};
  reminders.forEach(r => { byRow[r.rowIndex] = r; });
  return { reminders, byRow };
}
