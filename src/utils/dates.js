/**
 * Unified date parsing utility.
 * Handles Firestore Timestamps, ISO strings, and native Date objects
 * so every component uses the same logic instead of duplicating it.
 */

/** Convert any date-like value to a native Date, or null if falsy.
 *
 * Handles:
 *   - live Firestore Timestamp instances (have .toDate())
 *   - serialized Firestore Timestamps: {seconds, nanoseconds} or
 *     {_seconds, _nanoseconds} (prototype is lost after structuredClone,
 *     e.g. when an entry is passed through react-router location.state)
 *   - native Date instances
 *   - ISO strings / epoch ms numbers
 * Returns null for falsy input or unparseable values (never "Invalid Date").
 */
export function parseDate(d) {
  if (!d) return null;
  if (typeof d.toDate === 'function') return d.toDate();
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  if (typeof d === 'object') {
    const s  = typeof d.seconds     === 'number' ? d.seconds     : d._seconds;
    const ns = typeof d.nanoseconds === 'number' ? d.nanoseconds : d._nanoseconds;
    if (typeof s === 'number') {
      return new Date(s * 1000 + Math.floor((ns || 0) / 1e6));
    }
  }
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
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

/**
 * Short absolute timestamp — "Apr 18, 3:42 PM" — for when the task was created.
 * Shown once in the row so users can see the concrete moment the task entered
 * the system without opening the task.
 */
export function formatShortStamp(d) {
  const date = parseDate(d);
  if (!date) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  return `${datePart}, ${timePart}`;
}

/**
 * Compact "elapsed since" label for incomplete tasks — used as a productivity
 * signal so a glance at the row tells you whether a task has been sitting there
 * for hours or days. Returns "just now" / "12m" / "4h" / "3d" / "2w".
 * Pass `{ longer: true }` for "3 days" / "4 hours" prose form.
 */
export function elapsedSince(d, { longer = false } = {}) {
  const date = parseDate(d);
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return longer ? 'just now' : 'now';

  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (longer) {
    if (mins  < 1)  return 'just now';
    if (mins  < 60) return `${mins} min${mins  === 1 ? '' : 's'}`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    if (days  < 7)  return `${days} day${days  === 1 ? '' : 's'}`;
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (mins  < 1)  return 'now';
  if (mins  < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days  < 7)  return `${days}d`;
  return `${weeks}w`;
}
