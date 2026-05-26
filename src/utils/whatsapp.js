/**
 * WhatsApp helpers — single source of truth for the wa.me deep-link flow
 * used by TaskManager and Reminders. If the message template, link, or
 * phone formatting needs to change, update it here.
 */
import { formatDate } from './dates';

// ── Config ────────────────────────────────────────────────────────────────────
// Production app URL — used to build the "View in app" deep link inside the
// WhatsApp message. Points to the primary EC2-hosted domain.
const APP_URL = 'https://diary.dhanamfinance.com';

// ── Phone number ──────────────────────────────────────────────────────────────
/**
 * Strip non-digits and prepend India country code (91) for bare 10-digit
 * mobile numbers starting with 6–9. Already-prefixed numbers are returned
 * as-is (sans non-digits).
 */
export function formatWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  return digits;
}

// ── Link ──────────────────────────────────────────────────────────────────────
/**
 * Build the deep link for a task so the recipient lands directly on it.
 *
 * Deep link format (must match App.jsx / TasksPage.jsx param handling):
 *   Personal task:   /tasks?task=<taskId>
 *   Workspace task:  /tasks?task=<taskId>&wsId=<workspaceId>
 *
 * Without ?task= the app just opens the My Tasks list with nothing highlighted.
 */
export function buildTaskAppLink(task) {
  if (!task?.id) return `${APP_URL}/tasks`;
  const base = `${APP_URL}/tasks?task=${encodeURIComponent(task.id)}`;
  if (task?.workspaceId) {
    return `${base}&wsId=${encodeURIComponent(task.workspaceId)}`;
  }
  return base;
}

// ── Message body ──────────────────────────────────────────────────────────────
/**
 * Compose the WhatsApp message body. Pure function so it can be unit-tested
 * or previewed in the UI without firing the deep link.
 */
export function buildTaskWhatsAppMessage(task, { fromName = 'Your manager' } = {}) {
  const greeting = task?.assigneeName ? `Hi ${task.assigneeName},` : 'Hi there,';
  const due      = task?.dueDate  ? `\n📅 Due: ${formatDate(task.dueDate)}` : '';
  const priority = task?.priority ? `\n⚡ Priority: ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` : '';
  const link     = buildTaskAppLink(task);

  return (
    `${greeting}\n\n` +
    `You have been assigned a task:\n\n` +
    `📋 *${task?.text || ''}*${due}${priority}\n\n` +
    `🔗 View in app: ${link}\n\n` +
    `Please action this at your earliest convenience.\n\n` +
    `— ${fromName}`
  );
}

// ── Send ──────────────────────────────────────────────────────────────────────
/**
 * Open WhatsApp (web or installed app via wa.me) prefilled with the task
 * message and link. Returns true if the deep link was opened, false if it
 * was blocked by missing data (a toast is shown via the optional callback).
 */
export function sendTaskWhatsApp(task, { user, showToast, fromFallback = 'Your manager' } = {}) {
  if (!task?.assigneePhone) {
    showToast?.('No phone number set for this task.', 'warning');
    return false;
  }
  const phone    = formatWhatsAppPhone(task.assigneePhone);
  const fromName = user?.displayName || user?.email || fromFallback;
  const msg      = buildTaskWhatsAppMessage(task, { fromName });
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  return true;
}
