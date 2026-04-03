/**
 * Unified date parsing utility.
 * Handles Firestore Timestamps, ISO strings, and native Date objects
 * so every component uses the same logic instead of duplicating it.
 */

/** Convert any date-like value to a native Date, or null if falsy. */
export function parseDate(d) {
  if (!d) return null;
  if (d.toDate) return d.toDate();   // Firestore Timestamp
  if (d instanceof Date) return d;
  return new Date(d);                // ISO string or epoch ms
}

/** "Mon, Apr 3" */
export function formatDate(d) {
  const date = parseDate(d);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "Mon, Apr 3, 2026" */
export function formatDateTime(d) {
  const date = parseDate(d);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** "09:41 AM" */
export function formatTime(d) {
  const date = parseDate(d);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** True when the date is in the past AND not today. */
export function isOverdue(dueDate) {
  const date = parseDate(dueDate);
  if (!date) return false;
  const now = new Date();
  return date < now && date.toDateString() !== now.toDateString();
}

/** True when the date falls on today. */
export function isDueToday(dueDate) {
  const date = parseDate(dueDate);
  if (!date) return false;
  return date.toDateString() === new Date().toDateString();
}

/** Returns "YYYY-MM-DD" suitable for an <input type="date"> value. */
export function toDateInputValue(d) {
  const dt = d ? parseDate(d) : new Date(Date.now() + 86_400_000);
  return dt.toISOString().split('T')[0];
}
