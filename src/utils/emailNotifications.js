/**
 * EmailJS-based notification system.
 *
 * Required .env variables:
 *   VITE_EMAILJS_PUBLIC_KEY      — found in EmailJS dashboard → Account → API Keys
 *   VITE_EMAILJS_SERVICE_ID      — found in EmailJS dashboard → Email Services
 *   VITE_EMAILJS_TEMPLATE_ASSIGNED  — template ID for task assignment emails
 *   VITE_EMAILJS_TEMPLATE_STATUS    — template ID for status change emails
 *   VITE_EMAILJS_TEMPLATE_COMMENT   — template ID for comment notification emails
 *   VITE_EMAILJS_TEMPLATE_REMINDER  — template ID for due date reminder emails
 *
 * See README section "Email Notifications Setup" for EmailJS template content.
 */

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const TEMPLATES   = {
  assigned: import.meta.env.VITE_EMAILJS_TEMPLATE_ASSIGNED,
  status:   import.meta.env.VITE_EMAILJS_TEMPLATE_STATUS,
  comment:  import.meta.env.VITE_EMAILJS_TEMPLATE_COMMENT,
  reminder: import.meta.env.VITE_EMAILJS_TEMPLATE_REMINDER,
};

const APP_URL = window.location.origin;

// Lazy-load emailjs only when needed
let _emailjs = null;
async function getEmailjs() {
  if (!_emailjs) {
    const mod = await import('@emailjs/browser');
    _emailjs = mod.default || mod;
    _emailjs.init(PUBLIC_KEY);
  }
  return _emailjs;
}

function isConfigured() {
  return !!(SERVICE_ID && PUBLIC_KEY && TEMPLATES.assigned);
}

function friendlyDate(iso) {
  if (!iso) return 'No due date';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function friendlyStatus(status) {
  return { open: 'Open', in_progress: 'In Progress', review: 'Review', done: 'Done ✅' }[status] || status;
}

async function send(templateId, params) {
  if (!isConfigured() || !templateId) {
    console.warn('[Email] EmailJS not configured — skipping notification');
    return;
  }
  try {
    const ejs = await getEmailjs();
    await ejs.send(SERVICE_ID, templateId, { ...params, app_url: APP_URL });
    console.log('[Email] Sent:', templateId, '→', params.to_email);
  } catch (err) {
    // Non-fatal — email failure should never break app flow
    console.warn('[Email] Failed to send:', err?.text || err);
  }
}

// ── Notification functions ────────────────────────────────────────────────────

/**
 * Notify the assignee when a task is assigned to them.
 * Skip if the actor IS the assignee (self-assignment).
 */
export async function notifyTaskAssigned({ toEmail, toName, taskText, priority, dueDate, assignedBy, assignedByEmail }) {
  if (!toEmail || toEmail === assignedByEmail) return;
  await send(TEMPLATES.assigned, {
    to_email:      toEmail,
    assignee_name: toName || toEmail.split('@')[0],
    task_text:     taskText,
    priority:      (priority || 'medium').charAt(0).toUpperCase() + (priority || 'medium').slice(1),
    due_date:      friendlyDate(dueDate),
    assigned_by:   assignedBy,
  });
}

/**
 * Notify the task creator when an assignee moves the task to a new status.
 * Skip if the actor IS the creator (self-status-change).
 */
export async function notifyStatusChanged({ toEmail, toName, taskText, newStatus, changedBy, changedByEmail }) {
  if (!toEmail || toEmail === changedByEmail) return;
  await send(TEMPLATES.status, {
    to_email:       toEmail,
    recipient_name: toName || toEmail.split('@')[0],
    task_text:      taskText,
    new_status:     friendlyStatus(newStatus),
    changed_by:     changedBy,
  });
}

/**
 * Notify the other party when someone adds a comment.
 * If commenter is creator → notify assignee, and vice versa.
 */
export async function notifyCommentAdded({
  commenterEmail, commenterName, commentText,
  creatorEmail, creatorName,
  assigneeEmail, assigneeName,
  taskText,
}) {
  // Determine who to notify (the party that did NOT write the comment)
  let toEmail, toName;
  if (commenterEmail === creatorEmail) {
    toEmail = assigneeEmail;
    toName  = assigneeName;
  } else {
    toEmail = creatorEmail;
    toName  = creatorName;
  }

  if (!toEmail || toEmail === commenterEmail) return;

  await send(TEMPLATES.comment, {
    to_email:        toEmail,
    recipient_name:  toName || toEmail.split('@')[0],
    task_text:       taskText,
    commenter_name:  commenterName,
    comment_preview: commentText.length > 150 ? commentText.slice(0, 150) + '…' : commentText,
  });
}

/**
 * Notify an assignee that their task is due tomorrow.
 * Uses localStorage to avoid sending the same reminder twice in one day.
 */
export async function notifyDueReminder({ taskId, toEmail, toName, taskText, dueDate, status }) {
  if (!toEmail || !dueDate) return;

  // Deduplicate: only send once per task per calendar day
  const todayKey = `duereminder_${taskId}_${new Date().toISOString().slice(0, 10)}`;
  if (localStorage.getItem(todayKey)) return;

  await send(TEMPLATES.reminder, {
    to_email:      toEmail,
    assignee_name: toName || toEmail.split('@')[0],
    task_text:     taskText,
    due_date:      friendlyDate(dueDate),
    current_status: friendlyStatus(status || 'open'),
  });

  localStorage.setItem(todayKey, '1');
}

/**
 * Check all workspace tasks and send due-tomorrow reminders.
 * Call this once on app load.
 */
export async function checkAndSendDueReminders(tasks) {
  if (!tasks?.length) return;

  const now      = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

  const dueTomorrow = tasks.filter(t => {
    if (!t.assigneeEmail || t.status === 'done' || t.completed) return false;
    if (!t.dueDate) return false;
    const taskDate = new Date(t.dueDate).toISOString().slice(0, 10);
    return taskDate === tomorrowStr;
  });

  for (const task of dueTomorrow) {
    await notifyDueReminder({
      taskId:   task.id,
      toEmail:  task.assigneeEmail,
      toName:   task.assigneeName,
      taskText: task.text,
      dueDate:  task.dueDate,
      status:   task.status,
    });
  }
}
