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
// 📧 DAILY EMAIL REMINDER — Runs every day at 9:00 AM UTC
// Adjust the schedule to match your preferred time zone
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.sendDailyReminders = functions.pubsub
  .schedule('0 9 * * *') // Every day at 9:00 AM UTC
  .timeZone('Asia/Kolkata') // Change to your timezone
  .onRun(async (context) => {
    try {
      const sgMail = require('@sendgrid/mail');
      const config = functions.config();
      sgMail.setApiKey(config.sendgrid.key);
      const fromEmail = config.sendgrid.from;

      // Get all users with email reminders enabled
      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const settings = userData.settings || {};

        // Skip if reminders disabled
        if (!settings.emailRemindersEnabled) continue;

        const reminderEmail = settings.reminderEmail || userData.email;
        if (!reminderEmail) continue;

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

        // Build HTML email
        const html = buildReminderEmail(userData.displayName || 'there', overdue, upcoming);
        const plainText = buildReminderText(overdue, upcoming);

        const msg = {
          to: reminderEmail,
          from: fromEmail,
          subject: `📖 Diary Reminder: ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`,
          text: plainText,
          html: html,
        };

        await sgMail.send(msg);
        console.log(`Reminder sent to ${reminderEmail} (${tasks.length} tasks)`);
      }

      console.log('Daily reminder job completed');
      return null;
    } catch (error) {
      console.error('Error sending reminders:', error);
      return null;
    }
  });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📧 ON-DEMAND REMINDER — Callable function from the app
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
exports.sendReminderNow = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.data();
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
// Helper: Build HTML email template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildReminderEmail(name, overdue, upcoming) {
  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  let html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #fef9ef; padding: 32px; border-radius: 12px;">
      <h1 style="font-family: 'Caveat', cursive; color: #4a3728; font-size: 28px; text-align: center; margin-bottom: 4px;">
        📖 Daily Diary Reminder
      </h1>
      <p style="text-align: center; color: #8a7a6a; font-size: 14px; margin-bottom: 24px;">
        ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p style="color: #6b5a4a; font-size: 16px; line-height: 1.6;">Hi ${name},</p>
  `;

  if (overdue.length > 0) {
    html += `
      <div style="background: #f8d7da; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="color: #c0392b; margin: 0 0 8px;">⚠️ Overdue (${overdue.length})</h3>
        ${overdue.map(t => `
          <div style="padding: 8px 0; border-bottom: 1px solid rgba(192,57,43,0.1);">
            <strong style="color: #4a3728;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color: #c0392b; font-size: 13px;">Was due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  if (upcoming.length > 0) {
    html += `
      <div style="background: #fff3cd; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="color: #8B6914; margin: 0 0 8px;">📋 Upcoming (${upcoming.length})</h3>
        ${upcoming.map(t => `
          <div style="padding: 8px 0; border-bottom: 1px solid rgba(139,105,20,0.1);">
            <strong style="color: #4a3728;">${t.text}</strong>
            ${t.dueDate ? `<br><span style="color: #8a7a6a; font-size: 13px;">Due: ${formatDate(t.dueDate)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  html += `
      <p style="color: #8a7a6a; font-size: 14px; margin-top: 24px; text-align: center;">
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
