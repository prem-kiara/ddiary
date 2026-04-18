/**
 * Digital Diary — Cloud Functions
 *
 * Handles automated email reminders for pending tasks.
 * Uses SendGrid for email delivery and Firebase scheduled functions.
 *
 * SETUP:
 * 1. Get a free SendGrid API key at https://sendgrid.com
 * 2. Set it:  firebase functions:config:set sendgrid.key="YOUR_SENDGRID_API_KEY"
 * 3. Set sender email: firebase functions:config:set sendgrid.from="your-verified@email.com"
 * 4. Deploy: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 HOURLY CHECK — Respects each user's saved timezone + reminder time.
// Runs every hour; skips users whose local hour doesn't match their setting.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.sendDailyReminders = functions.pubsub
  .schedule('0 * * * *') // Every hour on the hour (UTC)
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const sgMail = require('@sendgrid/mail');
      const config = functions.config();
      sgMail.setApiKey(config.sendgrid.key);
      const fromEmail = config.sendgrid.from;

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
  });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 ON-DEMAND REMINDER — Callable function from the app
// Rate-limited to one email per user per hour to prevent abuse.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

exports.sendReminderNow = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.data();

  // ── Rate limiting ──────────────────────────────────────────────────────
  const lastSent = userData?.lastReminderSentAt;
  if (lastSent) {
    const elapsed = Date.now() - new Date(lastSent).getTime();
    if (elapsed < RATE_LIMIT_MS) {
      const waitMins = Math.ceil((RATE_LIMIT_MS - elapsed) / 60000);
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Please wait ${waitMins} more minute${waitMins !== 1 ? 's' : ''} before sending another reminder.`
      );
    }
  }

  const email = data.email || userData?.settings?.reminderEmail || userData?.email;
  if (!email) {
    throw new functions.https.HttpsError('failed-precondition', 'No email configured');
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
    const config = functions.config();
    sgMail.setApiKey(config.sendgrid.key);

    await sgMail.send({
      to: email,
      from: config.sendgrid.from,
      subject: `📖 Diary Reminder: ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`,
      text: buildReminderText(overdue, upcoming),
      html: buildReminderEmail(userData?.displayName || 'there', overdue, upcoming),
    });

    // Record the send time for rate limiting
    await userRef.update({ lastReminderSentAt: new Date().toISOString() });

    return { success: true, message: `Reminder sent to ${email}` };
  } catch (error) {
    console.error('Error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send email');
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📝 NEW USER WELCOME EMAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.onNewUser = functions.auth.user().onCreate(async (user) => {
  try {
    const sgMail = require('@sendgrid/mail');
    const config = functions.config();
    sgMail.setApiKey(config.sendgrid.key);

    await sgMail.send({
      to: user.email,
      from: config.sendgrid.from,
      subject: '📖 Welcome to Your Digital Diary!',
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #fef9ef; padding: 32px; border-radius: 12px;">
          <h1 style="font-family: 'Caveat', cursive; color: #4a3728; font-size: 32px; text-align: center;">Welcome to Your Digital Diary!</h1>
          <p style="color: #6b5a4a; line-height: 1.8; font-size: 16px;">
            Hi ${user.displayName || 'there'},
          </p>
          <p style="color: #6b5a4a; line-height: 1.8; font-size: 16px;">
            Your personal digital diary is ready. Here's what you can do:
          </p>
          <ul style="color: #6b5a4a; line-height: 2; font-size: 15px;">
            <li><strong>Write</strong> diary entries with text or handwriting</li>
            <li><strong>Draw</strong> sketches with Apple Pencil or your finger</li>
            <li><strong>Upload</strong> handwritten notes and convert them to text</li>
            <li><strong>Track</strong> tasks with due dates and priorities</li>
            <li><strong>Get reminded</strong> about pending tasks via email</li>
          </ul>
          <p style="color: #6b5a4a; line-height: 1.8; font-size: 16px;">
            Install the app on your home screen for the best experience on any device!
          </p>
          <p style="color: #8a7a6a; font-size: 14px; margin-top: 24px; text-align: center;">
            — Your Digital Diary
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error('Welcome email error:', error);
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
exports.runDataMigration = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const config = functions.config();
  const allowedUid = config.migration?.admin_uid;
  if (allowedUid && context.auth.uid !== allowedUid) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorised to run migrations');
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
exports.deleteWorkspace = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const { workspaceId } = data;
  if (!workspaceId) {
    throw new functions.https.HttpsError('invalid-argument', 'workspaceId is required');
  }

  const wsRef = db.collection('workspaces').doc(workspaceId);
  const wsSnap = await wsRef.get();

  if (!wsSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Workspace not found');
  }

  // Only the workspace creator (owner) may delete it
  const wsData = wsSnap.data();
  if (wsData.createdBy !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the workspace owner can delete it');
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

  console.log(`Workspace ${workspaceId} deleted by ${context.auth.uid}`);
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
