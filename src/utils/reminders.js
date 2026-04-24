/**
 * Task reminder scheduling — shared client + server utility.
 *
 * A "reminder" is an object attached to a task that tells the Cloud
 * Function when to email the creator and assignee:
 *
 * {
 *   enabled:     true,
 *   paused:      false,
 *   startDate:   '2026-04-24',    // YYYY-MM-DD, in the reminder's timezone
 *   endDate:     '2026-05-30',    // YYYY-MM-DD | null — null means no end
 *   frequency:   'daily',         // see FREQUENCIES below
 *   daysOfWeek:  [1, 3, 5],       // 0=Sun..6=Sat, used for 'custom'|'weekly'
 *   intervalDays: 2,              // used for 'every_n_days'
 *   time:        '09:00',         // HH:MM in `timezone`
 *   timezone:    'Asia/Kolkata',  // IANA tz; default to creator's saved tz
 *   recipients:  ['creator', 'assignee'],  // who gets the email
 *   creatorEmail:'a@b.com',       // snapshot of creator email at create time
 *   creatorName: 'Alice',
 *   nextSendAt:  '2026-04-24T03:30:00.000Z',  // ISO UTC — indexed field
 *   lastSentAt:  null,
 *   totalSent:   0,
 * }
 *
 * Pure functions only — safe to import from both browser and Node.
 */

export const FREQUENCIES = [
  { value: 'daily',         label: 'Every day' },
  { value: 'weekdays',      label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly',        label: 'Weekly (pick a day)' },
  { value: 'custom',        label: 'Specific days of the week' },
  { value: 'every_n_days',  label: 'Every N days' },
];

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Parse & defaults ────────────────────────────────────────────────────────

/** Return a safe, fully-populated reminder object from a partial one.
 *
 * Safe against legacy values: older task docs stored `reminder: true` as a
 * boolean flag. Anything that isn't a plain object is treated as "no
 * reminder" and normalized to a fresh disabled template.
 */
export function normalizeReminder(r = {}, fallback = {}) {
  if (r == null || typeof r !== 'object') r = {};
  return {
    enabled:      !!r.enabled,
    paused:       !!r.paused,
    startDate:    r.startDate     || fallback.startDate || todayInTz(r.timezone || fallback.timezone || 'UTC'),
    endDate:      r.endDate       || null,
    frequency:    r.frequency     || 'daily',
    daysOfWeek:   Array.isArray(r.daysOfWeek) ? r.daysOfWeek.filter(n => n >= 0 && n <= 6) : [],
    intervalDays: Math.max(1, Math.min(90, Number(r.intervalDays) || 1)),
    time:         r.time          || '09:00',
    timezone:     r.timezone      || fallback.timezone || 'Asia/Kolkata',
    recipients:   Array.isArray(r.recipients) && r.recipients.length ? r.recipients : ['creator', 'assignee'],
    creatorEmail: r.creatorEmail  || fallback.creatorEmail || null,
    creatorName:  r.creatorName   || fallback.creatorName  || null,
    nextSendAt:   r.nextSendAt    || null,
    lastSentAt:   r.lastSentAt    || null,
    totalSent:    Number(r.totalSent) || 0,
  };
}

/** An "empty" reminder that the editor uses as a starting point. */
export function blankReminder({ timezone = 'Asia/Kolkata', time = '09:00', creatorEmail = null, creatorName = null } = {}) {
  return normalizeReminder({
    enabled:    false,
    frequency:  'daily',
    daysOfWeek: [1, 2, 3, 4, 5],   // Mon–Fri as a sensible default for `custom`
    intervalDays: 2,
    time,
    timezone,
    creatorEmail,
    creatorName,
  });
}

// ─── Timezone math ──────────────────────────────────────────────────────────

/** Return today's YYYY-MM-DD in the given IANA timezone. */
export function todayInTz(timezone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return dtf.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Convert a (YYYY-MM-DD, HH:MM, timezone) tuple into a UTC Date representing
 * that instant. Handles DST correctly via Intl.
 *
 * Example:
 *   zonedToUtc('2026-04-24', '09:00', 'Asia/Kolkata')
 *   → Date representing 2026-04-24T03:30:00Z
 */
export function zonedToUtc(dateStr, timeStr, timezone) {
  const [y, m, d]   = dateStr.split('-').map(Number);
  const [hh, mm]    = timeStr.split(':').map(Number);
  // Build a "guess" UTC instant with the same wall-clock numbers.
  const guessMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  // Ask what wall-clock time that guess displays AS in the target tz.
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
    // `hour` can be "24" in some locales for midnight — normalize.
    const hr = parts.hour === 24 ? 0 : parts.hour;
    tzMs = Date.UTC(parts.year, parts.month - 1, parts.day, hr, parts.minute, parts.second);
  } catch {
    // If Intl rejects the tz, fall back to UTC.
    tzMs = guessMs;
  }
  // Offset the guess by the difference between tz-wall and guess-wall.
  const offset = tzMs - guessMs;
  return new Date(guessMs - offset);
}

/** What day-of-week (0=Sun..6=Sat) is this YYYY-MM-DD in UTC (date-only)? */
function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Advance YYYY-MM-DD by N days (UTC arithmetic — no DST ambiguity on dates). */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function dateStrCmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Frequency matching ─────────────────────────────────────────────────────

/**
 * Does `dateStr` fall on a day that this reminder should fire, *given its
 * frequency pattern and the anchor `startDate`*? Doesn't consider endDate
 * or paused — those are handled separately in computeNextSendAt.
 */
function matchesFrequency(reminder, dateStr) {
  if (dateStr < reminder.startDate) return false;
  const dow = dayOfWeek(dateStr);

  switch (reminder.frequency) {
    case 'daily':
      return true;

    case 'weekdays':
      return dow >= 1 && dow <= 5;

    case 'weekly':
    case 'custom': {
      const days = Array.isArray(reminder.daysOfWeek) ? reminder.daysOfWeek : [];
      if (!days.length) return false;
      return days.includes(dow);
    }

    case 'every_n_days': {
      const [y1, m1, d1] = reminder.startDate.split('-').map(Number);
      const [y2, m2, d2] = dateStr.split('-').map(Number);
      const msPerDay = 86_400_000;
      const diffDays = Math.round(
        (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / msPerDay
      );
      const n = Math.max(1, reminder.intervalDays || 1);
      return diffDays >= 0 && diffDays % n === 0;
    }

    default:
      return false;
  }
}

// ─── Core: compute next UTC send timestamp ──────────────────────────────────

/**
 * Return the ISO UTC string when this reminder should next fire, or null
 * if the schedule has ended / is disabled / is paused.
 *
 * @param {object} reminder   — normalized reminder object
 * @param {Date=}  fromUtc    — "now" (UTC). Tests can pass a fixed time. Defaults to new Date().
 * @returns {string|null}
 */
export function computeNextSendAt(reminder, fromUtc = new Date()) {
  if (!reminder || !reminder.enabled) return null;
  if (reminder.paused) return null;

  const tz = reminder.timezone || 'Asia/Kolkata';
  const todayLocal = todayInTz(tz);
  const startDate = reminder.startDate || todayLocal;
  const endDate   = reminder.endDate || null;

  // Which local calendar day to start scanning from? Never earlier than
  // startDate; never earlier than today.
  let cursor = dateStrCmp(startDate, todayLocal) >= 0 ? startDate : todayLocal;

  // Scan up to ~2 years of days for a match — caps worst-case cost.
  // (A reminder that fires "Jan 1 only every 3 years" will return null; fine.)
  for (let i = 0; i < 800; i++) {
    // If we've scrolled past the endDate, schedule has ended.
    if (endDate && dateStrCmp(cursor, endDate) > 0) return null;

    if (matchesFrequency(reminder, cursor)) {
      const sendInstant = zonedToUtc(cursor, reminder.time || '09:00', tz);
      // If today's match is already in the past (e.g. user set 09:00 but it's
      // already 11am), skip to the next matching day instead of firing now.
      if (sendInstant.getTime() > fromUtc.getTime()) {
        return sendInstant.toISOString();
      }
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}

// ─── Labels for UI preview ──────────────────────────────────────────────────

/** Short human summary of a reminder's recurrence + time, e.g. "Mon/Wed/Fri 09:00". */
export function describeSchedule(reminder) {
  if (!reminder || !reminder.enabled) return 'Off';
  if (reminder.paused) return 'Paused';

  const time = reminder.time || '09:00';
  const days = reminder.daysOfWeek || [];

  switch (reminder.frequency) {
    case 'daily':         return `Every day at ${time}`;
    case 'weekdays':      return `Weekdays at ${time}`;
    case 'every_n_days':  return `Every ${reminder.intervalDays} days at ${time}`;
    case 'weekly': {
      const labels = days.map(d => DAY_LABELS[d]).join(' / ');
      return labels ? `Weekly on ${labels} at ${time}` : `Weekly at ${time}`;
    }
    case 'custom': {
      if (!days.length) return `(no days picked)`;
      if (days.length === 7) return `Every day at ${time}`;
      const labels = days.sort((a, b) => a - b).map(d => DAY_LABELS[d]).join(' / ');
      return `${labels} at ${time}`;
    }
    default:
      return '';
  }
}

/**
 * "in 3 hours" / "tomorrow at 9:00 AM" / "Jun 14 at 9:00 AM" etc.
 * Feed the UTC ISO string from reminder.nextSendAt.
 */
export function describeNextSend(isoUtc, timezone) {
  if (!isoUtc) return null;
  const target = new Date(isoUtc);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  // Past (shouldn't normally happen — function catches up on next tick)
  if (diffMs < 0) return 'due shortly';

  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60)  return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24)    return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1)    return 'tomorrow';
  if (days < 7)      return `in ${days} days`;

  // Far out — show the calendar date in the reminder's timezone
  try {
    return target.toLocaleDateString('en-US', {
      timeZone: timezone || 'UTC',
      month: 'short', day: 'numeric',
    });
  } catch {
    return target.toISOString().slice(0, 10);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Returns a human error string if the reminder configuration is incomplete,
 * or null if valid. The editor uses this to block Save when needed.
 */
export function validateReminder(r) {
  if (!r || !r.enabled) return null;   // disabled = nothing to validate
  if (!r.startDate) return 'Pick a start date.';
  if (r.endDate && r.endDate < r.startDate) return 'End date must be after start date.';
  if (!r.time || !/^\d{2}:\d{2}$/.test(r.time)) return 'Pick a time of day.';
  if (r.frequency === 'custom' && (!r.daysOfWeek || r.daysOfWeek.length === 0)) {
    return 'Pick at least one day of the week.';
  }
  if (r.frequency === 'weekly' && (!r.daysOfWeek || r.daysOfWeek.length !== 1)) {
    return 'Pick exactly one day for weekly reminders.';
  }
  if (r.frequency === 'every_n_days' && (!r.intervalDays || r.intervalDays < 1)) {
    return 'Set the interval (at least 1 day).';
  }
  return null;
}
