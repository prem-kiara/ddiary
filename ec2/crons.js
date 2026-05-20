'use strict';

/**
 * ddiary-crons — Scheduled email jobs for Dhanam DDiary on EC2
 *
 * Ports three Firebase Cloud Functions to node-cron:
 *   • sendTaskReminders    — every 5 min  (was Cloud Function)
 *   • sendSheetRowReminders — every hour  (was Cloud Function + GitHub Actions)
 *   • sendDailyReminders    — every hour  (was Cloud Function)
 *
 * All email delivery uses Amazon SES instead of SendGrid.
 * Firestore transaction lock (reminder.nextSendAt / lastSentAt) ensures
 * no double-sends during the parallel-run transition period.
 *
 * Start:  pm2 start ecosystem.config.js --only ddiary-crons
 * Logs:   pm2 logs ddiary-crons
 */

const cron  = require('node-cron');
const admin = require('firebase-admin');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
require('dotenv').config();

// ── Firebase Admin Init ────────────────────────────────────────────────────────
// Reuse existing admin app if server.js and crons.js run in same process;
// initialise a new one if running standalone (pm2 separate process).
let db;
try {
  db = admin.firestore();
} catch {
  const serviceAccount = require('./service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
}

// ── SES Client ────────────────────────────────────────────────────────────────
const ses    = new SESClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const FROM   = process.env.SENDER_EMAIL || 'tech@dhanam.finance';
const APP_URL = (process.env.APP_URL || 'https://workspace.dhanam.finance').replace(/\/$/, '');

// ── SES send helper ───────────────────────────────────────────────────────────
async function sendViaSES({ to, subject, html }) {
  const toAddresses = Array.isArray(to) ? to : [to];
  if (!toAddresses.length) throw new Error('No recipients');
  await ses.send(new SendEmailCommand({
    Source:      FROM,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body:    { Html: { Data: html,    Charset: 'UTF-8' } },
    },
  }));
  return toAddresses;
}

// ── Reminder helper functions (ported from src/utils/reminders.js) ─────────────

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
  const [y, m, d]  = dateStr.split('-').map(Number);
  const [hh, mm]   = (timeStr || '09:00').split(':').map(Number);
  const guessMs    = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  let tzMs;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
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

// ── Daily reminder email builders ─────────────────────────────────────────────

function buildReminderEmail(name, overdue, upcoming) {
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  let html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f5f3ff;padding:32px;border-radius:12px;">
      <h1 style="color:#5b21b6;font-size:24px;text-align:center;margin:0 0 4px;">Daily Diary Reminder</h1>
      <p style="text-align:center;color:#64748b;font-size:14px;margin-bottom:24px;">
        ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p style="color:#334155;font-size:16px;line-height:1.6;">Hi ${name},</p>`;

  if (overdue.length > 0) {
    html += `
      <div style="background:#fee2e2;padding:16px;border-radius:8px;margin:16px 0;">
        <h3 style="color:#b91c1c;margin:0 0 8px;">Overdue (${overdue.length})</h3>
        ${overdue.map(t => `
          <div style="padding:8px 0;border-bottom:1px solid rgba(185,28,28,0.1);">
            <strong style="color:#334155;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color:#b91c1c;font-size:13px;">Was due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>`).join('')}
      </div>`;
  }

  if (upcoming.length > 0) {
    html += `
      <div style="background:#ede9fe;padding:16px;border-radius:8px;margin:16px 0;">
        <h3 style="color:#6d28d9;margin:0 0 8px;">Upcoming (${upcoming.length})</h3>
        ${upcoming.map(t => `
          <div style="padding:8px 0;border-bottom:1px solid rgba(109,40,217,0.1);">
            <strong style="color:#334155;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color:#64748b;font-size:13px;">Due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>`).join('')}
      </div>`;
  }

  html += `
      <p style="color:#64748b;font-size:14px;margin-top:24px;text-align:center;">
        Open your Dhanam Workspace to mark tasks complete.
      </p>
    </div>`;
  return html;
}

function buildReminderText(overdue, upcoming) {
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⏰ TASK REMINDERS — every 5 minutes
// Exact port of sendTaskReminders Cloud Function.
// Firestore transaction lock on reminder.nextSendAt prevents double-sends
// while Cloud Functions and this cron run in parallel during transition.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendTaskReminders() {
  const nowIso = new Date().toISOString();
  let processed = 0, sent = 0, errors = 0;

  try {
    const snap = await db.collectionGroup('tasks')
      .where('reminder.enabled',    '==', true)
      .where('reminder.nextSendAt', '<=', nowIso)
      .get();

    if (snap.empty) {
      console.log('[taskReminders] no tasks due');
    } else {
      console.log(`[taskReminders] ${snap.size} task(s) due`);
    }

    for (const taskDoc of snap.docs) {
      processed++;
      const taskRef = taskDoc.ref;

      // ── Atomic claim via Firestore transaction ────────────────────────────
      let claimed = null;
      try {
        claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(taskRef);
          if (!fresh.exists) return null;
          const t = fresh.data();
          const r = t.reminder;
          const now2 = new Date().toISOString();
          if (!r || !r.enabled || r.paused)         return null;
          if (!r.nextSendAt || r.nextSendAt > now2) return null; // already claimed
          if (t.completed || t.status === 'done' || t.archived || t.deletedAt) {
            tx.update(taskRef, { 'reminder.enabled': false, 'reminder.nextSendAt': null });
            return null;
          }
          const nextIso = computeNextSendAt(r, new Date(now2));
          const updates = {
            'reminder.lastSentAt': now2,
            'reminder.nextSendAt': nextIso,
            'reminder.totalSent':  (r.totalSent || 0) + 1,
          };
          if (nextIso == null) updates['reminder.enabled'] = false;
          tx.update(taskRef, updates);
          return { task: t, reminder: r };
        });
      } catch (txErr) {
        console.warn(`[taskReminders] tx failed ${taskRef.path}:`, txErr.message);
        errors++;
        continue;
      }

      if (!claimed) continue;

      // ── Build recipient list ──────────────────────────────────────────────
      const { task: t, reminder: r } = claimed;
      const wants   = (role) => !r.recipients || r.recipients.includes(role);
      const rcptSet = new Set();
      if (wants('creator')) {
        const e = (r.creatorEmail || t.createdByEmail || t.ownerEmail || '').toLowerCase().trim();
        if (e) rcptSet.add(e);
      }
      if (wants('assignee')) {
        const e = (t.assigneeEmail || '').toLowerCase().trim();
        if (e) rcptSet.add(e);
        if (Array.isArray(t.allAssigneeEmails)) {
          t.allAssigneeEmails.forEach(ae => { if (ae) rcptSet.add(ae.toLowerCase().trim()); });
        }
      }
      if (rcptSet.size === 0) {
        console.warn(`[taskReminders] no recipients for ${taskRef.path}`);
        continue;
      }

      // ── Build deep link — includes wsId for workspace tasks ───────────────
      const parts  = taskRef.path.split('/');
      const wsIdx  = parts.indexOf('workspaces');
      const wsId   = wsIdx >= 0 ? parts[wsIdx + 1] : null;
      const taskUrl = wsId
        ? `${APP_URL}/tasks?task=${encodeURIComponent(taskRef.id)}&wsId=${encodeURIComponent(wsId)}`
        : `${APP_URL}/tasks?task=${encodeURIComponent(taskRef.id)}`;

      // ── Build email ───────────────────────────────────────────────────────
      const taskText     = t.text || 'Untitled task';
      const dueDate      = t.dueDate || null;
      const priority     = t.priority || 'medium';
      const assigneeName = t.assigneeName || null;
      const assigneeEmail = t.assigneeEmail || null;
      const allAssignees = (() => {
        const names = new Set();
        if (assigneeName) names.add(assigneeName);
        if (Array.isArray(t.allAssigneeNames))  t.allAssigneeNames.forEach(n => { if (n) names.add(n); });
        if (Array.isArray(t.allAssigneeEmails)) t.allAssigneeEmails.forEach(e => { if (e) names.add(e); });
        if (names.size === 0 && assigneeEmail)  names.add(assigneeEmail);
        return [...names].join(', ') || null;
      })();
      const ownerName  = r.creatorName || t.createdByName || t.ownerName || 'your team';
      const notes      = t.notes || null;
      const schedule   = describeSchedule(r);

      const rawStatus  = t.status || (t.completed ? 'done' : 'todo');
      const statusLabel = {
        todo: 'To Do', in_progress: 'In Progress', inprogress: 'In Progress',
        done: 'Done', completed: 'Done', blocked: 'Blocked', review: 'In Review',
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

      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:0;border-radius:12px;overflow:hidden">
  <div style="background-color:#6d28d9;background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:24px 28px">
    <p style="margin:0 0 6px;color:#ddd6fe;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">⏰ Task Reminder &nbsp;·&nbsp; ${schedule}</p>
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3">${taskText}</h1>
  </div>
  <div style="background:#ffffff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none">
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
    <a href="${taskUrl}" style="display:inline-block;background:#6d28d9;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:20px">
      View Task
    </a>
    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">
      Automated reminder from Dhanam Workspace. To stop, open the task and turn off its reminder.
    </p>
  </div>
</div>`;

      try {
        const recipients = [...rcptSet];
        await sendViaSES({
          to:      recipients,
          subject: `⏰ Reminder: ${taskText}${dueDate ? ` — due ${formatDate(dueDate)}` : ''}`,
          html,
        });
        sent++;
        console.log(`[taskReminders] ✓ ${taskRef.path} → ${recipients.join(', ')}`);
      } catch (emailErr) {
        errors++;
        console.error(`[taskReminders] ✗ email failed ${taskRef.path}:`, emailErr.message);
        // Reset nextSendAt so it retries in 5 min instead of being skipped until tomorrow
        try {
          const retryIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await taskRef.update({ 'reminder.nextSendAt': retryIso });
        } catch { /* best-effort */ }
      }
    }

    // ── One-time scheduled emails (scheduledEmailTime field) ─────────────────
    try {
      const scheduledSnap = await db.collectionGroup('tasks')
        .where('scheduledEmailTime', '<=', nowIso)
        .get();

      for (const taskDoc of scheduledSnap.docs) {
        const t = taskDoc.data();
        if (t.scheduledEmailSent) continue;
        if (t.completed || t.archived || t.deletedAt) {
          await taskDoc.ref.update({ scheduledEmailTime: null, scheduledEmailSent: true });
          continue;
        }
        const assigneeEmail = (t.assigneeEmail || '').trim().toLowerCase();
        if (!assigneeEmail) continue;

        // Atomic claim
        try {
          let proceed = false;
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(taskDoc.ref);
            if (!fresh.exists || fresh.data().scheduledEmailSent) return;
            tx.update(taskDoc.ref, { scheduledEmailSent: true });
            proceed = true;
          });
          if (!proceed) continue;
        } catch { continue; }

        const taskText     = t.text || 'Untitled task';
        const assigneeName = t.assigneeName || null;
        const ownerName    = t.ownerName || t.createdByName || 'your team';
        const dueDate      = t.dueDate || null;
        const priority     = t.priority || 'medium';
        const priorityColor = priority === 'high' ? '#dc2626' : priority === 'low' ? '#16a34a' : '#d97706';
        const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
        const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };

        const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:0;border-radius:12px;overflow:hidden">
  <div style="background-color:#6d28d9;background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:24px 28px">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700">📋 Task Notification</h1>
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
        <td style="padding:6px 12px;border:1px solid #e2e8f0">${fmtDate(dueDate)}</td>
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
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">Automated task notification from Dhanam Workspace.</p>
  </div>
</div>`;

        try {
          await sendViaSES({
            to:      assigneeEmail,
            subject: `📋 Task for you: ${taskText}${dueDate ? ` — due ${fmtDate(dueDate)}` : ''}`,
            html,
          });
          console.log(`[taskReminders] ✓ scheduled email ${taskDoc.ref.path} → ${assigneeEmail}`);
        } catch (emailErr) {
          console.error(`[taskReminders] ✗ scheduled email failed ${taskDoc.ref.path}:`, emailErr.message);
        }
      }
    } catch (schedErr) {
      console.warn('[taskReminders] scheduledEmailTime query failed:', schedErr.message);
    }

    if (processed > 0) {
      console.log(`[taskReminders] done — ${sent} sent, ${errors} errors (${processed} processed)`);
    }
  } catch (fatalErr) {
    console.error('[taskReminders] fatal:', fatalErr);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 SHEET ROW REMINDERS — every hour
// Replaces both the Cloud Function AND the GitHub Actions workflow.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 hours

async function sendSheetRowReminders() {
  try {
    const snap = await db.collection('sheetRowReminders')
      .where('active', '==', true)
      .get();

    if (snap.empty) {
      console.log('[sheetReminders] no active reminders');
      return;
    }

    const nowUtc      = new Date();
    const nowIST      = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const nowTotalMin = nowIST.getHours() * 60 + nowIST.getMinutes();
    const cutoff      = new Date(Date.now() - COOLDOWN_MS);

    console.log(`[sheetReminders] checking ${snap.size} active reminder(s) at ${nowIST.toISOString()} IST`);

    let sent = 0;

    for (const d of snap.docs) {
      const rem = d.data();

      // 23-hour cooldown
      const lastSent = rem.lastSentAt?.toDate?.() ?? null;
      if (lastSent && lastSent > cutoff) continue;

      // Delivery-time window (±30 min around sendAtTime IST)
      if (rem.sendAtTime) {
        const [hh, mm] = rem.sendAtTime.split(':').map(Number);
        if (!isNaN(hh) && !isNaN(mm)) {
          const target = hh * 60 + mm;
          const diff   = Math.min(Math.abs(nowTotalMin - target), 1440 - Math.abs(nowTotalMin - target));
          if (diff > 30) continue;
        }
      }

      // Atomic claim
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
        console.warn(`[sheetReminders] tx failed ${d.id}:`, txErr.message);
        continue;
      }

      if (!shouldSend) continue;

      const toEmails = Array.isArray(rem.notifyEmails) && rem.notifyEmails.length
        ? rem.notifyEmails
        : (rem.createdByEmail ? [rem.createdByEmail] : []);

      if (!toEmails.length) continue;

      const rowLabel   = `Row ${(rem.rowIndex ?? 0) + 1}`;
      const sheetTitle = rem.sheetTitle || 'Untitled Sheet';
      const dateStr    = nowIST.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      const headers   = rem.columnHeaders || {};
      const tableRows = Object.entries(rem.rowData || {})
        .filter(([, v]) => String(v ?? '').trim())
        .map(([col, val]) => `
          <tr>
            <td style="padding:6px 12px;font-weight:600;color:#7c3aed;background:#f5f3ff;border:1px solid #e2e8f0;white-space:nowrap">${headers[col] || col}</td>
            <td style="padding:6px 12px;color:#1e293b;border:1px solid #e2e8f0">${String(val)}</td>
          </tr>`).join('');

      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px;">
  <div style="background:#7c3aed;padding:20px 24px;border-radius:10px 10px 0 0">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">🔔 Daily Row Reminder</h1>
    <p style="margin:4px 0 0;color:#ddd6fe;font-size:13px">${dateStr}</p>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    <p style="margin:0 0 16px;color:#334155;font-size:15px">
      Reminder for <strong>${rowLabel}</strong> in sheet <strong>${sheetTitle}</strong>:
    </p>
    ${tableRows ? `<table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:14px">${tableRows}</table>` : ''}
    ${rem.assigneeName ? `<p style="margin:0 0 8px;font-size:14px;color:#475569"><strong>Assigned to:</strong> ${rem.assigneeName}</p>` : ''}
    ${rem.remarks ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#713f12"><strong>Remarks:</strong> ${rem.remarks}</div>` : ''}
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
      Automated daily reminder from Dhanam Workspace. To stop, open the sheet and click the 🔔 bell icon.
    </p>
  </div>
</div>`;

      try {
        await sendViaSES({
          to:      toEmails,
          subject: `🔔 Reminder: ${sheetTitle} — ${rowLabel}${rem.assigneeName ? ` (${rem.assigneeName})` : ''}`,
          html,
        });
        sent++;
        console.log(`[sheetReminders] ✓ ${d.id} → ${toEmails.join(', ')}`);
      } catch (emailErr) {
        console.error(`[sheetReminders] ✗ ${d.id}:`, emailErr.message);
        // Roll back lastSentAt so it retries next hour
        await d.ref.update({ lastSentAt: null }).catch(() => {});
      }
    }

    console.log(`[sheetReminders] done — ${sent} email(s) sent`);
  } catch (err) {
    console.error('[sheetReminders] fatal:', err);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 DAILY DIGEST REMINDERS — every hour (fires only when local hour matches)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendDailyReminders() {
  try {
    const nowUtc  = new Date();
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const settings = userData.settings || {};

      if (settings.emailRemindersEnabled === false) continue;

      const reminderEmail = settings.reminderEmail || userData.email;
      if (!reminderEmail) continue;

      const userTz      = settings.timezone || 'Asia/Kolkata';
      const reminderTime = settings.reminderTime || '09:00';
      const [prefHour]   = reminderTime.split(':').map(Number);

      const localHour = parseInt(
        nowUtc.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: userTz }),
        10
      );

      if (localHour !== prefHour) continue;

      // 23-hour cooldown
      const lastDaily = userData.lastDailyReminderAt;
      if (lastDaily && (Date.now() - new Date(lastDaily).getTime()) < 23 * 60 * 60 * 1000) continue;

      const tasksSnap = await db.collection('users').doc(userDoc.id)
        .collection('tasks').where('completed', '==', false).get();

      if (tasksSnap.empty) continue;

      const tasks    = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const now      = new Date();
      const overdue  = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
      const upcoming = tasks.filter(t => !t.dueDate || new Date(t.dueDate) >= now);

      try {
        await sendViaSES({
          to:      reminderEmail,
          subject: `📖 Diary Reminder: ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`,
          html:    buildReminderEmail(userData.displayName || 'there', overdue, upcoming),
        });
        await userDoc.ref.update({ lastDailyReminderAt: new Date().toISOString() });
        console.log(`[dailyReminders] ✓ ${reminderEmail} (${tasks.length} tasks)`);
      } catch (emailErr) {
        console.error(`[dailyReminders] ✗ ${reminderEmail}:`, emailErr.message);
      }
    }
  } catch (err) {
    console.error('[dailyReminders] fatal:', err);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🗓️  SCHEDULE ALL CRONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Every 5 minutes — task reminders
cron.schedule('*/5 * * * *', () => {
  sendTaskReminders().catch(err => console.error('[cron] taskReminders unhandled:', err));
});

// Every hour — sheet row reminders
cron.schedule('0 * * * *', () => {
  sendSheetRowReminders().catch(err => console.error('[cron] sheetReminders unhandled:', err));
});

// Every hour — daily digest reminders
cron.schedule('0 * * * *', () => {
  sendDailyReminders().catch(err => console.error('[cron] dailyReminders unhandled:', err));
});

console.log('[ddiary-crons] Scheduled: taskReminders(*/5), sheetReminders(0 * *), dailyReminders(0 * *)');
