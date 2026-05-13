/**
 * Sheet row reminders — Firestore-backed daily email reminders per row.
 *
 * Design: reminders are stored in the top-level `sheetRowReminders` collection.
 * On sheet open, checkAndFireReminders() queries for active, due reminders for
 * that sheet and sends emails via the signed-in user's M365 mailbox (Graph API).
 * lastSentAt is updated atomically to prevent double-sending in multi-tab scenarios.
 */

import {
  collection, doc, addDoc, updateDoc, runTransaction,
  getDocs, query, where, serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { sendRowReminderEmail } from './emailNotifications';

const COLLECTION = 'sheetRowReminders';
const COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 h — fires once per calendar day

// ─── Write helpers ────────────────────────────────────────────────────────────

export async function createRowReminder({
  sheetId, sharedSheetId, sheetTitle,
  rowIndex, rowData, columnHeaders,
  assigneeEmail, assigneeName,
  remarks,
  notifyEmails,
  sendAtTime,       // "HH:MM" local time, e.g. "09:00" — null = fire any time sheet opens
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

// ─── Dispatcher (client-side, called on sheet open) ─────────────────────────

/**
 * Check for due reminders for `sheetId` and fire emails.
 * Uses a Firestore transaction to atomically claim each reminder,
 * preventing double-sends across multiple open tabs / team members.
 */
export async function checkAndFireReminders(sheetId, user) {
  if (!user?.email || !sheetId) return;

  try {
    const q = query(
      collection(db, COLLECTION),
      where('sheetId', '==', sheetId),
      where('active',  '==', true),
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const cutoff = new Date(Date.now() - COOLDOWN_MS);

    for (const d of snap.docs) {
      const rem = d.data();
      const lastSent = rem.lastSentAt?.toDate?.() ?? null;
      if (lastSent && lastSent > cutoff) continue; // still within 23h cooldown

      // If a delivery time is set, only fire within a 30-min window around that time.
      // This turns the on-open trigger into an approximate scheduled delivery.
      if (rem.sendAtTime) {
        const [hh, mm] = rem.sendAtTime.split(':').map(Number);
        if (!isNaN(hh) && !isNaN(mm)) {
          const now         = new Date();
          const nowMins     = now.getHours() * 60 + now.getMinutes();
          const targetMins  = hh * 60 + mm;
          // Circular distance (handles midnight wrap)
          const diff = Math.min(
            Math.abs(nowMins - targetMins),
            1440 - Math.abs(nowMins - targetMins),
          );
          if (diff > 30) continue; // outside delivery window
        }
      }

      // Atomically claim this send slot
      let shouldSend = false;
      try {
        await runTransaction(db, async (tx) => {
          const fresh = await tx.get(d.ref);
          if (!fresh.exists()) return;
          const freshData = fresh.data();
          if (!freshData.active) return;
          const freshLast = freshData.lastSentAt?.toDate?.() ?? null;
          if (freshLast && freshLast > cutoff) return; // another tab already sent
          tx.update(d.ref, { lastSentAt: serverTimestamp() });
          shouldSend = true;
        });
      } catch { continue; }

      if (!shouldSend) continue;

      try {
        await sendRowReminderEmail({
          toEmails:      rem.notifyEmails?.length ? rem.notifyEmails : [user.email],
          sheetTitle:    rem.sheetTitle,
          rowIndex:      rem.rowIndex,
          rowData:       rem.rowData       || {},
          columnHeaders: rem.columnHeaders || {},
          remarks:       rem.remarks,
          assigneeName:  rem.assigneeName,
        });
      } catch (err) {
        console.warn('[sheetReminders] email failed:', err);
      }
    }
  } catch (err) {
    console.warn('[sheetReminders] checkAndFireReminders error:', err);
  }
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
