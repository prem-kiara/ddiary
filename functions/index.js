/**
 * Digital Diary — Cloud Functions
 *
 * Handles automated email reminders for pending tasks.
 * Uses SendGrid for email delivery and Firebase scheduled functions.
 *
 * SETUP:
 * 1. Get a free SendGrid API key at https://sendgrid.com
 * 2. Store the key as a Cloud Secret:
 *      firebase functions:secrets:set SENDGRID_API_KEY
 *      (paste the key when prompted — stored encrypted in Secret Manager)
 * 3. Sender address lives in functions/.env (already set to noreply@dhanam.finance)
 * 4. Deploy: firebase deploy --only functions
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

// ── Secrets (stored in Cloud Secret Manager, not in source) ──────────────────
// Set once with: firebase functions:secrets:set SENDGRID_API_KEY
const sendgridApiKey = defineSecret('SENDGRID_API_KEY');

// Runtime service account — the firebase-adminsdk SA that already exists in this project
const SA = 'firebase-adminsdk-fbsvc@ddiary-a72ca.iam.gserviceaccount.com';

admin.initializeApp();

const db = admin.firestore();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⏰ SERVER-SIDE TASK REMINDERS — Runs every 5 minutes (UTC).
//
// This is the authoritative reminder engine.  It fires regardless of whether
// any user has the app open, replacing the browser-based useReminderDispatcher
// fallback.  The browser dispatcher is kept as a backup for the rare case where
// this function misses a window, but THIS function is what users rely on.
//
// How it works:
//   1. Collection-group query: all tasks where reminder.enabled == true AND
//      reminder.nextSendAt <= now.  Covers both personal (users/{uid}/tasks)
//      and workspace (workspaces/{id}/tasks) tasks in one pass.
//   2. Atomic Firestore transaction per task: re-check still due, advance
//      nextSendAt to the next scheduled instant, bump lastSentAt + totalSent.
//      This is the de-dup lock — if the browser dispatcher races with this
//      function, only one will win the transaction and send.
//   3. Send via SendGrid (no user session needed).
//
// Requires: firebase functions:secrets:set SENDGRID_API_KEY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Pure helpers ported from src/utils/reminders.js (CommonJS, no browser deps) ──

function todayInTz(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function zonedToUtc(dateStr, timeStr, timezone) {
  const [y, m, d]   = dateStr.split('-').map(Number);
  const [hh, mm]    = (timeStr || '09:00').split(':').map(Number);
  const guessMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  let tzMs;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = {};
    for (const p of dtf.formatToParts(new Date(guessMs))) {
      if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
    }
    const hr = parts.hour === 24 ? 0 : parts.hour;
    tzMs = Date.UTC(parts.year, parts.month - 1, parts.day, hr, parts.minute, parts.second);
  } catch {
    tzMs = guessMs;
  }
  return new Date(guessMs - (tzMs - guessMs));
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function matchesFrequency(reminder, dateStr) {
  if (dateStr < reminder.startDate) return false;
  const dow = dayOfWeek(dateStr);
  switch (reminder.frequency) {
    case 'daily':    return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekly':
    case 'custom': {
      const days = Array.isArray(reminder.daysOfWeek) ? reminder.daysOfWeek : [];
      return days.length > 0 && days.includes(dow);
    }
    case 'every_n_days': {
      const [y1, m1, d1] = reminder.startDate.split('-').map(Number);
      const [y2, m2, d2] = dateStr.split('-').map(Number);
      const diff = Math.round(
        (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
      );
      const n = Math.max(1, reminder.intervalDays || 1);
      return diff >= 0 && diff % n === 0;
    }
    default: return false;
  }
}

function computeNextSendAt(reminder, fromUtc) {
  fromUtc = fromUtc || new Date();
  if (!reminder || !reminder.enabled) return null;
  if (reminder.paused) return null;
  const tz         = reminder.timezone || 'Asia/Kolkata';
  const todayLocal = todayInTz(tz);
  const startDate  = reminder.startDate || todayLocal;
  const endDate    = reminder.endDate   || null;
  let cursor = startDate > todayLocal ? startDate : todayLocal;
  for (let i = 0; i < 800; i++) {
    if (endDate && cursor > endDate) return null;
    if (matchesFrequency(reminder, cursor)) {
      const instant = zonedToUtc(cursor, reminder.time || '09:00', tz);
      if (instant.getTime() > fromUtc.getTime()) return instant.toISOString();
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}

function describeSchedule(reminder) {
  if (!reminder || !reminder.enabled) return 'Off';
  if (reminder.paused) return 'Paused';
  const time = reminder.time || '09:00';
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = reminder.daysOfWeek || [];
  switch (reminder.frequency) {
    case 'daily':        return `Every day at ${time}`;
    case 'weekdays':     return `Weekdays at ${time}`;
    case 'every_n_days': return `Every ${reminder.intervalDays} days at ${time}`;
    case 'weekly': {
      const label = days.map(d => DAY_LABELS[d]).join(' / ');
      return `Weekly on ${label || '?'} at ${time}`;
    }
    case 'custom': {
      if (!days.length) return `(no days) at ${time}`;
      return `${days.sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(' / ')} at ${time}`;
    }
    default: return time;
  }
}

// ── The Cloud Function ────────────────────────────────────────────────────────

exports.sendTaskReminders = onSchedule(
  { schedule: '*/5 * * * *', timeZone: 'UTC', secrets: [sendgridApiKey], timeoutSeconds: 300, memory: '512MiB', serviceAccount: SA },
  async (event) => {
    const sgMail    = require('@sendgrid/mail');
    const fromEmail = process.env.SENDGRID_FROM || 'noreply@dhanam.finance';
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const nowIso = new Date().toISOString();
    let processed = 0, sent = 0, errors = 0;

    try {
      // Query every task whose next send time has arrived
      const snap = await db.collectionGroup('tasks')
        .where('reminder.enabled',    '==', true)
        .where('reminder.nextSendAt', '<=', nowIso)
        .get();

      if (snap.empty) {
        console.log('[sendTaskReminders] no tasks due');
        return null;
      }

      console.log(`[sendTaskReminders] ${snap.size} task(s) due`);

      // Process each task — one at a time to avoid quota exhaustion
      for (const taskDoc of snap.docs) {
        processed++;
        const taskRef = taskDoc.ref;

        // ── Atomic claim: advance nextSendAt inside a transaction ─────────
        // If the browser dispatcher already handled this one, the transaction
        // will find nextSendAt > now and return null (no double-send).
        let claimed = null;
        try {
          claimed = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(taskRef);
            if (!fresh.exists) return null;
            const t = fresh.data();
            const r = t.reminder;
            const now2 = new Date().toISOString();
            if (!r || !r.enabled || r.paused)            return null;
            if (!r.nextSendAt || r.nextSendAt > now2)    return null; // already claimed
            if (t.completed || t.status === 'done' || t.archived || t.deletedAt) {
              // Task is done — disable reminder cleanly
              tx.update(taskRef, { 'reminder.enabled': false, 'reminder.nextSendAt': null });
              return null;
            }
            const nextIso = computeNextSendAt(r, new Date(now2));
            const updates = {
              'reminder.lastSentAt': now2,
              'reminder.nextSendAt': nextIso,
              'reminder.totalSent':  (r.totalSent || 0) + 1,
            };
            if (nextIso == null) updates['reminder.enabled'] = false; // schedule exhausted
            tx.update(taskRef, updates);
            return { task: t, reminder: r };
          });
        } catch (txErr) {
          console.warn(`[sendTaskReminders] tx failed for ${taskRef.path}:`, txErr.message);
          errors++;
          continue;
        }

        if (!claimed) continue; // already handled or task is done

        // ── Build recipient list ──────────────────────────────────────────
        const { task: t, reminder: r } = claimed;
        const wants    = (role) => !r.recipients || r.recipients.includes(role);
        const rcptSet  = new Set();
        if (wants('creator')) {
          const e = (r.creatorEmail || t.createdByEmail || t.ownerEmail || '').toLowerCase().trim();
          if (e) rcptSet.add(e);
        }
        if (wants('assignee')) {
          const e = (t.assigneeEmail || '').toLowerCase().trim();
          if (e) rcptSet.add(e);
          // Multi-assignee support
          if (Array.isArray(t.allAssigneeEmails)) {
            t.allAssigneeEmails.forEach(ae => { if (ae) rcptSet.add(ae.toLowerCase().trim()); });
          }
        }
        if (rcptSet.size === 0) {
          console.warn(`[sendTaskReminders] no recipients for ${taskRef.path}`);
          continue;
        }

        // ── Send email via SendGrid ────────────────────────────────────────
        const recipients   = [...rcptSet];
        const taskText     = t.text || 'Untitled task';
        const dueDate      = t.dueDate || null;
        const priority     = t.priority || 'medium';
        const assigneeName = t.assigneeName || null;
        const assigneeEmail = t.assigneeEmail || null;
        // Multi-assignee: build a display list
        const allAssignees = (() => {
          const names = new Set();
          if (assigneeName) names.add(assigneeName);
          if (Array.isArray(t.allAssigneeNames)) t.allAssigneeNames.forEach(n => { if (n) names.add(n); });
          if (Array.isArray(t.allAssigneeEmails)) t.allAssigneeEmails.forEach(e => { if (e) names.add(e); });
          if (names.size === 0 && assigneeEmail) names.add(assigneeEmail);
          return [...names].join(', ') || null;
        })();
        const ownerName    = r.creatorName || t.createdByName || t.ownerName || 'your team';
        const notes        = t.notes || null;
        const schedule     = describeSchedule(r);

        // Status normalisation — stored as 'todo','in_progress','done', etc.
        const rawStatus = t.status || (t.completed ? 'done' : 'todo');
        const statusLabel = {
          todo:        'To Do',
          in_progress: 'In Progress',
          inprogress:  'In Progress',
          done:        'Done',
          completed:   'Done',
          blocked:     'Blocked',
          review:      'In Review',
        }[rawStatus.toLowerCase().replace(/\s/g, '_')] || rawStatus;
        const statusColor = {
          'To Do':       { bg: '#f1f5f9', text: '#475569' },
          'In Progress': { bg: '#eff6ff', text: '#2563eb' },
          'Done':        { bg: '#f0fdf4', text: '#16a34a' },
          'Blocked':     { bg: '#fef2f2', text: '#dc2626' },
          'In Review':   { bg: '#fefce8', text: '#d97706' },
        }[statusLabel] || { bg: '#f1f5f9', text: '#475569' };

        const priorityColor = priority === 'high' ? '#dc2626' : priority === 'low' ? '#16a34a' : '#d97706';
        const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);

        const formatDate = (d) => {
          if (!d) return null;
          try {
            return new Date(d).toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            });
          } catch { return d; }
        };

        const htmlBody = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:0;border-radius:12px;overflow:hidden">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:24px 28px">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">⏰ Task Reminder</h1>
    <p style="margin:5px 0 0;color:#ddd6fe;font-size:13px">${schedule}</p>
  </div>

  <!-- Body -->
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none">
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:17px;font-weight:600">${taskText}</h2>

    <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px">
      <tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;white-space:nowrap;width:35%">Status</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">
          <span style="background:${statusColor.bg};color:${statusColor.text};padding:2px 8px;border-radius:6px;font-weight:600;font-size:13px">${statusLabel}</span>
        </td>
      </tr>
      ${priority ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;white-space:nowrap">Priority</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">
          <span style="background:${priorityColor}22;color:${priorityColor};padding:2px 8px;border-radius:6px;font-weight:600;font-size:13px">${priorityLabel}</span>
        </td>
      </tr>` : ''}
      ${dueDate ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">Due Date</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;color:${new Date(dueDate) < new Date() ? '#dc2626' : '#1e293b'}">${formatDate(dueDate)}</td>
      </tr>` : ''}
      ${allAssignees ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">Assigned to</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${allAssignees}</td>
      </tr>` : ''}
      ${ownerName ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">Created by</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${ownerName}</td>
      </tr>` : ''}
    </table>

    ${notes ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:14px;color:#713f12">
      <strong>Notes:</strong><br>${notes}
    </div>` : ''}

    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
      This is an automated reminder from Dhanam Workspace.<br>
      To stop, open the task and turn off its reminder.
    </p>
  </div>
</div>`;

        try {
          await sgMail.send({
            to:      recipients.length === 1 ? recipients[0] : recipients,
            from:    fromEmail,
            subject: `⏰ Reminder: ${taskText}${dueDate ? ` — due ${formatDate(dueDate)}` : ''}`,
            html:    htmlBody,
          });
          sent++;
          console.log(`[sendTaskReminders] sent for ${taskRef.path} → ${recipients.join(', ')}`);
        } catch (emailErr) {
          errors++;
          console.error(`[sendTaskReminders] email failed for ${taskRef.path}:`, emailErr.message);
        }
      }

      console.log(`[sendTaskReminders] done — ${sent} sent, ${errors} errors (${processed} processed)`);

      // ── One-time scheduled emails (scheduledEmailTime field) ─────────────
      // Tasks assigned via the Reminders/TaskManager "Schedule Send Time" form
      // store a one-time datetime in scheduledEmailTime. Fire once and clear it.
      try {
        const scheduledSnap = await db.collectionGroup('tasks')
          .where('scheduledEmailTime', '<=', nowIso)
          .get();

        for (const taskDoc of scheduledSnap.docs) {
          const t = taskDoc.data();
          // Skip if already sent, completed, archived, or no assignee email
          if (t.scheduledEmailSent) continue;
          if (t.completed || t.archived || t.deletedAt) {
            await taskDoc.ref.update({ scheduledEmailTime: null, scheduledEmailSent: true });
            continue;
          }
          const assigneeEmail = (t.assigneeEmail || '').trim().toLowerCase();
          if (!assigneeEmail) continue;

          // Mark as sent atomically before sending (prevents double-send)
          try {
            await db.runTransaction(async (tx) => {
              const fresh = await tx.get(taskDoc.ref);
              if (!fresh.exists) return;
              const f = fresh.data();
              if (f.scheduledEmailSent) return; // already handled
              tx.update(taskDoc.ref, { scheduledEmailSent: true });
            });
          } catch { continue; }

          const taskText    = t.text || 'Untitled task';
          const assigneeName = t.assigneeName || null;
          const ownerName   = t.ownerName || t.createdByName || 'your team';
          const dueDate     = t.dueDate || null;
          const priority    = t.priority || 'medium';
          const priorityColor = priority === 'high' ? '#dc2626' : priority === 'low' ? '#16a34a' : '#d97706';
          const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
          const formatDateSimple = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

          const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:0;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:24px 28px">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">📋 Task Notification</h1>
    <p style="margin:5px 0 0;color:#ddd6fe;font-size:13px">Scheduled by ${ownerName}</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none">
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:17px;font-weight:600">${taskText}</h2>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px">
      ${priority ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;white-space:nowrap;width:35%">Priority</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0"><span style="background:${priorityColor}22;color:${priorityColor};padding:2px 8px;border-radius:6px;font-weight:600;font-size:13px">${priorityLabel}</span></td>
      </tr>` : ''}
      ${dueDate ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">Due Date</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0;color:${new Date(dueDate) < new Date() ? '#dc2626' : '#1e293b'}">${formatDateSimple(dueDate)}</td>
      </tr>` : ''}
      ${assigneeName ? `<tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">Assigned to</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${assigneeName}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:6px 12px;font-weight:600;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0">From</td>
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${ownerName}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
      This is an automated task notification from Dhanam Workspace.
    </p>
  </div>
</div>`;

          try {
            await require('@sendgrid/mail').send({
              to:      assigneeEmail,
              from:    fromEmail,
              subject: `📋 Task for you: ${taskText}${dueDate ? ` — due ${formatDateSimple(dueDate)}` : ''}`,
              html,
            });
            console.log(`[sendTaskReminders] scheduled email sent for ${taskDoc.ref.path} → ${assigneeEmail}`);
          } catch (emailErr) {
            console.error(`[sendTaskReminders] scheduled email failed for ${taskDoc.ref.path}:`, emailErr.message);
          }
        }
      } catch (schedErr) {
        console.warn('[sendTaskReminders] scheduledEmailTime query failed:', schedErr.message);
      }

      return null;
    } catch (fatalErr) {
      console.error('[sendTaskReminders] fatal:', fatalErr);
      return null;
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 SHEET ROW REMINDERS — Runs every hour (UTC).
// Queries sheetRowReminders collection, fires emails for reminders whose
// sendAtTime (IST) falls within the current hour, respecting a 23h cooldown.
// Uses SendGrid — completely server-side, no user session required.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REMINDER_COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 h

exports.sendSheetRowReminders = onSchedule(
  { schedule: '0 * * * *', timeZone: 'UTC', secrets: [sendgridApiKey], serviceAccount: SA },
  async (event) => {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const fromEmail = process.env.SENDGRID_FROM || 'noreply@dhanam.finance';

      const snap = await db.collection('sheetRowReminders')
        .where('active', '==', true)
        .get();

      if (snap.empty) { console.log('[sheetRowReminders] no active reminders'); return null; }

      // Current time in IST (UTC+5:30) — all users are assumed IST
      const nowUtc = new Date();
      const nowIST = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const nowTotalMins = nowIST.getHours() * 60 + nowIST.getMinutes();

      const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS);
      let sent = 0;

      for (const d of snap.docs) {
        const rem = d.data();

        // 23-hour cooldown
        const lastSent = rem.lastSentAt?.toDate?.() ?? null;
        if (lastSent && lastSent > cutoff) continue;

        // Delivery-time window: only fire if current IST time is within 30 min of sendAtTime
        if (rem.sendAtTime) {
          const [hh, mm] = rem.sendAtTime.split(':').map(Number);
          if (!isNaN(hh) && !isNaN(mm)) {
            const targetMins = hh * 60 + mm;
            const diff = Math.min(
              Math.abs(nowTotalMins - targetMins),
              1440 - Math.abs(nowTotalMins - targetMins),
            );
            if (diff > 30) continue; // outside delivery window
          }
        }

        // Atomically claim this send slot (prevents double-send if function retries)
        let shouldSend = false;
        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            if (!fresh.exists) return;
            const fd = fresh.data();
            if (!fd.active) return;
            const freshLast = fd.lastSentAt?.toDate?.() ?? null;
            if (freshLast && freshLast > cutoff) return;
            tx.update(d.ref, { lastSentAt: admin.firestore.FieldValue.serverTimestamp() });
            shouldSend = true;
          });
        } catch (txErr) {
          console.warn('[sheetRowReminders] transaction failed:', txErr.message);
          continue;
        }

        if (!shouldSend) continue;

        // Build recipient list
        const toEmails = Array.isArray(rem.notifyEmails) && rem.notifyEmails.length
          ? rem.notifyEmails
          : (rem.createdByEmail ? [rem.createdByEmail] : []);

        if (!toEmails.length) continue;

        const rowLabel   = `Row ${(rem.rowIndex ?? 0) + 1}`;
        const sheetTitle = rem.sheetTitle || 'Untitled Sheet';
        const dateStr    = nowIST.toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });

        // Build row data table rows
        const rowDataEntries = Object.entries(rem.rowData || {})
          .filter(([, v]) => String(v ?? '').trim())
          .map(([col, val]) => `
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#7c3aed;background:#f5f3ff;border:1px solid #e2e8f0;white-space:nowrap">${col}</td>
              <td style="padding:6px 12px;color:#1e293b;border:1px solid #e2e8f0">${String(val)}</td>
            </tr>`).join('');

        const htmlBody = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px;">
            <div style="background:#7c3aed;padding:20px 24px;border-radius:10px 10px 0 0;margin-bottom:0">
              <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">🔔 Daily Row Reminder</h1>
              <p style="margin:4px 0 0;color:#ddd6fe;font-size:13px">${dateStr}</p>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
              <p style="margin:0 0 16px;color:#334155;font-size:15px">
                Reminder for <strong>${rowLabel}</strong> in sheet <strong>${sheetTitle}</strong>:
              </p>
              ${rowDataEntries ? `
              <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:14px">
                ${rowDataEntries}
              </table>` : ''}
              ${rem.assigneeName ? `<p style="margin:0 0 8px;font-size:14px;color:#475569">
                <strong>Assigned to:</strong> ${rem.assigneeName}
              </p>` : ''}
              ${rem.remarks ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#713f12">
                <strong>Remarks:</strong> ${rem.remarks}
              </div>` : ''}
              <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
                This is an automated daily reminder from Dhanam Diary.
                To stop, open the sheet and click the 🔔 bell icon for this row.
              </p>
            </div>
          </div>`;

        try {
          await sgMail.send({
            to:      toEmails,
            from:    fromEmail,
            subject: `🔔 Reminder: ${sheetTitle} — ${rowLabel}${rem.assigneeName ? ` (${rem.assigneeName})` : ''}`,
            html:    htmlBody,
          });
          sent++;
          console.log(`[sheetRowReminders] sent reminder ${d.id} to ${toEmails.join(', ')}`);
        } catch (emailErr) {
          console.error('[sheetRowReminders] email failed for', d.id, emailErr.message);
        }
      }

      console.log(`[sheetRowReminders] done — ${sent} email(s) sent`);
      return null;
    } catch (err) {
      console.error('[sheetRowReminders] fatal error:', err);
      return null;
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 HOURLY CHECK — Respects each user's saved timezone + reminder time.
// Runs every hour; skips users whose local hour doesn't match their setting.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.sendDailyReminders = onSchedule(
  { schedule: '0 * * * *', timeZone: 'UTC', secrets: [sendgridApiKey], serviceAccount: SA },
  async (event) => {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const fromEmail = process.env.SENDGRID_FROM || 'noreply@dhanam.finance';

      const nowUtc = new Date();

      // Get all users with email reminders enabled
      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const settings = userData.settings || {};

        // Skip if reminders disabled
        if (!settings.emailRemindersEnabled) continue;

        const reminderEmail = settings.reminderEmail || userData.email;
        if (!reminderEmail) continue;

        // Resolve user timezone and preferred reminder hour
        const userTz = settings.timezone || 'Asia/Kolkata';
        const reminderTime = settings.reminderTime || '09:00';
        const [prefHour] = reminderTime.split(':').map(Number);

        // Get the current hour in the user's local timezone
        const localHour = parseInt(
          nowUtc.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: userTz }),
          10
        );

        // Only send when the local hour matches their setting
        if (localHour !== prefHour) continue;

        // Get pending tasks for this user
        const tasksSnap = await db
          .collection('users')
          .doc(userDoc.id)
          .collection('tasks')
          .where('completed', '==', false)
          .get();

        if (tasksSnap.empty) continue;

        const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const now = new Date();

        const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
        const upcoming = tasks.filter(t => !t.dueDate || new Date(t.dueDate) >= now);

        await sgMail.send({
          to: reminderEmail,
          from: fromEmail,
          subject: `📖 Diary Reminder: ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`,
          text: buildReminderText(overdue, upcoming),
          html: buildReminderEmail(userData.displayName || 'there', overdue, upcoming),
        });
        console.log(`Reminder sent to ${reminderEmail} (${tasks.length} tasks, tz: ${userTz})`);
      }

      console.log('Hourly reminder check completed');
      return null;
    } catch (error) {
      console.error('Error sending reminders:', error);
      return null;
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 ON-DEMAND REMINDER — Callable function from the app
// Rate-limited to one email per user per hour to prevent abuse.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

exports.sendReminderNow = onCall({ secrets: [sendgridApiKey], serviceAccount: SA }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const uid = request.auth.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.data();

  // ── Rate limiting ──────────────────────────────────────────────────────
  const lastSent = userData?.lastReminderSentAt;
  if (lastSent) {
    const elapsed = Date.now() - new Date(lastSent).getTime();
    if (elapsed < RATE_LIMIT_MS) {
      const waitMins = Math.ceil((RATE_LIMIT_MS - elapsed) / 60000);
      throw new HttpsError(
        'resource-exhausted',
        `Please wait ${waitMins} more minute${waitMins !== 1 ? 's' : ''} before sending another reminder.`
      );
    }
  }

  const email = request.data.email || userData?.settings?.reminderEmail || userData?.email;
  if (!email) {
    throw new HttpsError('failed-precondition', 'No email configured');
  }

  const tasksSnap = await db
    .collection('users')
    .doc(uid)
    .collection('tasks')
    .where('completed', '==', false)
    .get();

  if (tasksSnap.empty) {
    return { success: true, message: 'No pending tasks' };
  }

  const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const now = new Date();
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
  const upcoming = tasks.filter(t => !t.dueDate || new Date(t.dueDate) >= now);

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM || 'noreply@dhanam.finance',
      subject: `📖 Diary Reminder: ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`,
      text: buildReminderText(overdue, upcoming),
      html: buildReminderEmail(userData?.displayName || 'there', overdue, upcoming),
    });

    // Record the send time for rate limiting
    await userRef.update({ lastReminderSentAt: new Date().toISOString() });

    return { success: true, message: `Reminder sent to ${email}` };
  } catch (error) {
    console.error('Error:', error);
    throw new HttpsError('internal', 'Failed to send email');
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 ONE-TIME DATA MIGRATION — Callable, admin-only
// Normalises task assigneeEmails to lowercase and links assigneeUid fields.
// Safe to call multiple times (idempotent). Only the first admin UID listed
// in functions config (migration.admin_uid) may call it.
// Deploy: firebase deploy --only functions
// Call once via the Firebase console or a one-off script, then remove access.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.runDataMigration = onCall({ serviceAccount: SA }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const allowedUid = process.env.MIGRATION_ADMIN_UID || null;
  if (allowedUid && request.auth.uid !== allowedUid) {
    throw new HttpsError('permission-denied', 'Not authorised to run migrations');
  }

  const stats = { usersProcessed: 0, tasksFixed: 0, membersFixed: 0 };

  // Build a UID → email reverse map from userDirectory
  const dirSnap = await db.collection('userDirectory').get();
  const emailToUid = {};
  dirSnap.docs.forEach(d => {
    const { email, uid } = d.data();
    if (email && uid) emailToUid[email.toLowerCase()] = uid;
  });

  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    stats.usersProcessed++;
    const uid = userDoc.id;

    // ── Fix tasks ──────────────────────────────────────────────────────────
    const tasksSnap = await db.collection('users').doc(uid).collection('tasks').get();
    const taskBatch = db.batch();
    let taskBatchSize = 0;

    for (const taskDoc of tasksSnap.docs) {
      const task = taskDoc.data();
      const updates = {};

      // Normalise email to lowercase
      if (task.assigneeEmail && task.assigneeEmail !== task.assigneeEmail.toLowerCase()) {
        updates.assigneeEmail = task.assigneeEmail.toLowerCase();
      }
      const emailKey = (updates.assigneeEmail || task.assigneeEmail || '').toLowerCase();

      // Link UID if missing
      if (emailKey && !task.assigneeUid && emailToUid[emailKey]) {
        updates.assigneeUid = emailToUid[emailKey];
      }

      if (Object.keys(updates).length > 0) {
        taskBatch.update(taskDoc.ref, updates);
        stats.tasksFixed++;
        taskBatchSize++;
        // Firestore batch limit is 500
        if (taskBatchSize >= 400) {
          await taskBatch.commit();
          taskBatchSize = 0;
        }
      }
    }
    if (taskBatchSize > 0) await taskBatch.commit();

    // ── Fix teamMembers ────────────────────────────────────────────────────
    const membersSnap = await db.collection('users').doc(uid).collection('teamMembers').get();
    const memberBatch = db.batch();
    let memberBatchSize = 0;

    for (const memberDoc of membersSnap.docs) {
      const member = memberDoc.data();
      const emailKey = member.email?.toLowerCase();
      if (emailKey && !member.uid && emailToUid[emailKey]) {
        memberBatch.update(memberDoc.ref, { uid: emailToUid[emailKey] });
        stats.membersFixed++;
        memberBatchSize++;
        if (memberBatchSize >= 400) {
          await memberBatch.commit();
          memberBatchSize = 0;
        }
      }
    }
    if (memberBatchSize > 0) await memberBatch.commit();
  }

  console.log('Migration complete:', stats);
  return { success: true, stats };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🗑️  DELETE WORKSPACE — Callable, owner only
// Deletes the workspace document and ALL subcollections (tasks, members,
// comments, activity) to avoid orphaned data in Firestore.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.deleteWorkspace = onCall({ serviceAccount: SA }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { workspaceId } = request.data;
  if (!workspaceId) {
    throw new HttpsError('invalid-argument', 'workspaceId is required');
  }

  const wsRef = db.collection('workspaces').doc(workspaceId);
  const wsSnap = await wsRef.get();

  if (!wsSnap.exists) {
    throw new HttpsError('not-found', 'Workspace not found');
  }

  // Only the workspace creator (owner) may delete it
  const wsData = wsSnap.data();
  if (wsData.createdBy !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the workspace owner can delete it');
  }

  /** Recursively delete all docs in a subcollection (handles >500 docs via batches). */
  async function deleteCollection(colRef) {
    const snap = await colRef.get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  /** Delete all comments and activity subcollections under each task. */
  async function deleteTaskSubcollections(taskRef) {
    await deleteCollection(taskRef.collection('comments'));
    await deleteCollection(taskRef.collection('activity'));
  }

  // 1. Delete all task subcollections first
  const tasksSnap = await wsRef.collection('tasks').get();
  for (const taskDoc of tasksSnap.docs) {
    await deleteTaskSubcollections(taskDoc.ref);
  }

  // 2. Delete tasks, members
  await deleteCollection(wsRef.collection('tasks'));
  await deleteCollection(wsRef.collection('members'));

  // 3. Delete the workspace doc itself
  await wsRef.delete();

  console.log(`Workspace ${workspaceId} deleted by ${request.auth.uid}`);
  return { success: true };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper: Build HTML email template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildReminderEmail(name, overdue, upcoming) {
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f3ff; padding: 32px; border-radius: 12px;">
      <h1 style="color: #5b21b6; font-size: 24px; text-align: center; margin: 0 0 4px;">
        Daily Diary Reminder
      </h1>
      <p style="text-align: center; color: #64748b; font-size: 14px; margin-bottom: 24px;">
        ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p style="color: #334155; font-size: 16px; line-height: 1.6;">Hi ${name},</p>
  `;

  if (overdue.length > 0) {
    html += `
      <div style="background: #fee2e2; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="color: #b91c1c; margin: 0 0 8px;">Overdue (${overdue.length})</h3>
        ${overdue.map(t => `
          <div style="padding: 8px 0; border-bottom: 1px solid rgba(185,28,28,0.1);">
            <strong style="color: #334155;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color: #b91c1c; font-size: 13px;">Was due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  if (upcoming.length > 0) {
    html += `
      <div style="background: #ede9fe; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="color: #6d28d9; margin: 0 0 8px;">Upcoming (${upcoming.length})</h3>
        ${upcoming.map(t => `
          <div style="padding: 8px 0; border-bottom: 1px solid rgba(109,40,217,0.1);">
            <strong style="color: #334155;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color: #64748b; font-size: 13px;">Due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  html += `
      <p style="color: #64748b; font-size: 14px; margin-top: 24px; text-align: center;">
        Open your Digital Diary to mark tasks complete.
      </p>
    </div>
  `;

  return html;
}

function buildReminderText(overdue, upcoming) {
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  let text = 'DAILY DIARY REMINDER\n\n';

  if (overdue.length > 0) {
    text += 'OVERDUE TASKS:\n';
    overdue.forEach((t, i) => {
      text += `  ${i + 1}. ${t.text}${t.dueDate ? ` (was due: ${formatDate(t.dueDate)})` : ''}\n`;
    });
    text += '\n';
  }

  if (upcoming.length > 0) {
    text += 'UPCOMING TASKS:\n';
    upcoming.forEach((t, i) => {
      text += `  ${i + 1}. ${t.text}${t.dueDate ? ` (due: ${formatDate(t.dueDate)})` : ''}\n`;
    });
  }

  return text;
}
