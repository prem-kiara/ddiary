/**
 * WhatsApp helpers — single source of truth for the wa.me deep-link flow
 * used by TaskManager and Reminders. If the message template, link, or
 * phone formatting needs to change, update it here.
 */
import { formatDate } from './dates';

// ── Config ────────────────────────────────────────────────────────────────────
// Production app URL — used to build the "View in app" link inside the
// WhatsApp message. Kept as a module constant so a future env-var swap is
// trivial.
const APP_URL = 'https://dhanamdiary.web.app';

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
 * Build the link the recipient should land on. Prefers the workspace-scoped
 * tasks page when the task belongs to a workspace, otherwise the plain
 * /tasks page.
 */
export function buildTaskAppLink(task) {
  if (task?.workspaceId) {
    return `${APP_URL}/tasks?workspace=${encodeURIComponent(task.workspaceId)}`;
  }
  return `${APP_URL}/tasks`;
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
