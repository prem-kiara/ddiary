import { useEffect, useRef } from 'react';
import {
  collection, collectionGroup, query, where,
  onSnapshot, runTransaction, doc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { computeNextSendAt, describeSchedule } from '../utils/reminders';
import { createLogger } from '../utils/errorLogger';

/**
 * useReminderDispatcher — free-tier, browser-based task-reminder engine.
 *
 * Strategy (no Cloud Functions, no paid infra):
 *   • Subscribe (real-time) to every task *the current user created* whose
 *     `reminder.enabled` is true. Two listeners cover it:
 *       1. users/{uid}/tasks where reminder.enabled == true   (personal)
 *       2. collectionGroup('tasks') where createdBy == uid
 *          AND reminder.enabled == true                       (workspace)
 *   • On a 60-second tick (and on mount / visibility change), scan the
 *     loaded task list for any whose `reminder.nextSendAt` is in the past.
 *   • For each due task, run a Firestore transaction that:
 *       - verifies the reminder is still due (paused toggle / other tab
 *         already handled / task now done)
 *       - atomically advances nextSendAt to the next scheduled moment
 *         (so even if two tabs of the same user are open, only one fires)
 *       - bumps lastSentAt + totalSent
 *   • Only AFTER the transaction commits successfully do we send the email
 *     via the existing Graph API helper (free — uses the user's M365 token).
 *
 * Why "creator only"?
 *   The dispatching session sends FROM its own M365 mailbox, so the creator
 *   is the correct persona. If the creator never opens the app, reminders
 *   queue up until they do — acceptable trade-off for "free and no server."
 *
 * De-duplication: the transaction doubles as a lock. Second dispatcher sees
 * the new nextSendAt (no longer due) and skips silently.
 */
export function useReminderDispatcher() {
  const { user } = useAuth();
  // Mutable snapshot of every reminder-enabled task currently loaded.
  // Indexed by the DocumentReference path so we can dedupe across the two
  // listeners (a task only ever appears in one of them anyway, but this
  // keeps us robust).
  const tasksRef = useRef(new Map()); // path -> { ref, data }
  // Which paths have we successfully dispatched in the last 60s? Used as
  // an extra in-memory guard against firing twice within a single tick.
  const recentlyDispatched = useRef(new Set());

  useEffect(() => {
    if (!user?.uid) return undefined;

    const log = createLogger('reminderDispatcher', user.uid);
    tasksRef.current = new Map();

    // ── Subscribe: personal tasks the user owns ─────────────────────────
    const personalQ = query(
      collection(db, 'users', user.uid, 'tasks'),
      where('reminder.enabled', '==', true)
    );
    const unsubPersonal = onSnapshot(personalQ, (snap) => {
      snap.docChanges().forEach(c => {
        const path = c.doc.ref.path;
        if (c.type === 'removed') tasksRef.current.delete(path);
        else tasksRef.current.set(path, { ref: c.doc.ref, data: c.doc.data() });
      });
    }, (err) => log(err, { action: 'personalSubscription' }));

    // ── Subscribe: workspace tasks where the user is the creator ────────
    const workspaceQ = query(
      collectionGroup(db, 'tasks'),
      where('createdBy',        '==', user.uid),
      where('reminder.enabled', '==', true)
    );
    const unsubWorkspace = onSnapshot(workspaceQ, (snap) => {
      snap.docChanges().forEach(c => {
        const path = c.doc.ref.path;
        if (c.type === 'removed') tasksRef.current.delete(path);
        else tasksRef.current.set(path, { ref: c.doc.ref, data: c.doc.data() });
      });
    }, (err) => {
      // If the composite index isn't built yet, Firestore returns a
      // failed-precondition error with a console link to create it.
      // Log but don't crash — the personal listener still works.
      log(err, { action: 'workspaceSubscription' });
    });

    // ── Tick loop: scan every 60s for due reminders ─────────────────────
    let busy = false;
    const tick = async () => {
      if (busy) return;
      if (!user?.uid) return;
      // Graph token required to send email — skip quietly if missing
      const msToken = sessionStorage.getItem('ddiary_ms_access_token');
      if (!msToken) return;

      busy = true;
      try {
        const nowIso = new Date().toISOString();
        const due = [];
        for (const entry of tasksRef.current.values()) {
          const r = entry.data?.reminder;
          if (!r || r.enabled !== true) continue;
          if (r.paused) continue;
          if (!r.nextSendAt || r.nextSendAt > nowIso) continue;
          // Skip tasks that completed / archived / trashed. We'll also
          // auto-disable the reminder so it stops showing up here.
          if (entry.data.completed || entry.data.status === 'done' ||
              entry.data.archived   || entry.data.deletedAt) {
            due.push({ ...entry, autoDisable: true });
            continue;
          }
          if (recentlyDispatched.current.has(entry.ref.path)) continue;
          due.push(entry);
        }

        // Process sequentially so we don't spawn 30 parallel Graph calls.
        for (const entry of due) {
          try {
            if (entry.autoDisable) {
              await runTransaction(db, async (tx) => {
                const fresh = await tx.get(entry.ref);
                if (!fresh.exists()) return;
                const f = fresh.data();
                if (!f.reminder?.enabled) return;
                tx.update(entry.ref, {
                  'reminder.enabled': false,
                  'reminder.nextSendAt': null,
                });
              });
              continue;
            }
            await dispatchOne(entry.ref, user, log);
            recentlyDispatched.current.add(entry.ref.path);
            // Clear the cooldown after ~5 minutes so the same task becoming
            // due again in the future will fire normally.
            setTimeout(() => recentlyDispatched.current.delete(entry.ref.path), 5 * 60 * 1000);
          } catch (err) {
            log(err, { action: 'dispatchOne', path: entry.ref.path });
          }
        }
      } catch (err) {
        log(err, { action: 'tick' });
      } finally {
        busy = false;
      }
    };

    // Catch-up on mount + whenever the tab regains focus or regains network.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    const onOnline  = () => tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    // Small delay on mount so the initial onSnapshot load has arrived.
    const initTimer = setTimeout(tick, 5000);
    const tickTimer = setInterval(tick, 60 * 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(tickTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      unsubPersonal();
      unsubWorkspace();
      tasksRef.current.clear();
      recentlyDispatched.current.clear();
    };
  }, [user?.uid]);
}

// ── Dispatch a single due task ──────────────────────────────────────────
// Strategy:
//   1. Transaction: re-read the task, verify still due, advance nextSendAt
//      atomically. This is our "lock" — other tabs/users see the new
//      nextSendAt on their next tick and skip.
//   2. AFTER the transaction commits, send the email via Graph API.
//      (If Graph fails, we don't roll back the schedule advance. Missing
//       one reminder email is better than sending it 3 times.)
async function dispatchOne(taskRef, user, log) {
  // 1. Atomic schedule advance ("claim the send")
  const claimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists()) return null;
    const t = snap.data();
    const r = t.reminder;
    const nowIso = new Date().toISOString();
    if (!r || !r.enabled || r.paused) return null;
    if (!r.nextSendAt || r.nextSendAt > nowIso) return null;   // race lost
    if (t.completed || t.status === 'done' || t.archived || t.deletedAt) {
      tx.update(taskRef, {
        'reminder.enabled': false,
        'reminder.nextSendAt': null,
      });
      return null;
    }
    const nextIso = computeNextSendAt(r);
    const updates = {
      'reminder.nextSendAt': nextIso,
      'reminder.lastSentAt': nowIso,
      'reminder.totalSent':  (r.totalSent || 0) + 1,
    };
    // End-of-schedule — disable cleanly so the query drops it
    if (nextIso == null) updates['reminder.enabled'] = false;
    tx.update(taskRef, updates);
    return { task: t, reminder: r };
  });

  if (!claimed) return;

  // 2. Build recipient list (creator + assignee, deduped, lowercased)
  const r = claimed.reminder;
  const t = claimed.task;
  const wants = (role) => !r.recipients || r.recipients.includes(role);
  const recipients = new Set();
  if (wants('creator')) {
    const e = (r.creatorEmail || t.createdByEmail || t.ownerEmail || user.email || '').toLowerCase();
    if (e) recipients.add(e);
  }
  if (wants('assignee')) {
    const e = (t.assigneeEmail || '').toLowerCase();
    if (e) recipients.add(e);
  }
  if (recipients.size === 0) {
    log({ message: 'Reminder fired but no recipients resolved' }, { action: 'dispatchOne:noRecipients', path: taskRef.path });
    return;
  }

  // 3. Send via Graph API (dynamic import — kept lazy like other callers)
  try {
    const { notifyTaskReminder } = await import('../utils/emailNotifications');
    await notifyTaskReminder({
      recipients: [...recipients],
      taskText:      t.text || 'Untitled task',
      dueDate:       t.dueDate || null,
      priority:      t.priority || 'medium',
      assigneeName:  t.assigneeName || null,
      ownerName:     r.creatorName || t.createdByName || t.ownerName || user.displayName || user.email,
      notes:         t.notes || null,
      scheduleLabel: describeSchedule(r),
      // Deep link back — for workspace tasks the path starts with "workspaces",
      // for personal tasks it starts with "users". Append #/ so React Router
      // routes to the right view. Hosts that don't route deep will land on
      // the home page, which is fine.
      taskUrl: window.location.origin,
    });
  } catch (err) {
    log(err, { action: 'dispatchOne:sendMail', path: taskRef.path });
  }
}
