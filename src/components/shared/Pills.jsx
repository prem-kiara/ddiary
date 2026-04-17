/**
 * Shared pill / badge primitives — consistent status, priority, and tag chips.
 *
 * `.pill--*` classes are defined in diary.css; here we map semantic input
 * (status codes, priority levels, tag strings) to the right color token.
 */

/* ── Status ────────────────────────────────────────────────────────────────── */
// Normalizes both raw codes ("in_progress") and human labels ("In Progress").
const STATUS_MAP = {
  open:        { label: 'Open',        tone: 'slate'  },
  'in_progress': { label: 'In Progress', tone: 'blue'  },
  'in progress': { label: 'In Progress', tone: 'blue'  },
  review:      { label: 'Review',      tone: 'amber'  },
  done:        { label: 'Done',        tone: 'green'  },
  blocked:     { label: 'Blocked',     tone: 'red'    },
  todo:        { label: 'To Do',       tone: 'slate'  },
};

export function StatusPill({ status, className = '' }) {
  const key = String(status || 'open').toLowerCase();
  const cfg = STATUS_MAP[key] || { label: status || 'Open', tone: 'slate' };
  return <span className={`pill pill--${cfg.tone} ${className}`}>{cfg.label}</span>;
}

/* ── Priority ──────────────────────────────────────────────────────────────── */
const PRIORITY_MAP = {
  high:   { label: 'High',   tone: 'red'    },
  medium: { label: 'Medium', tone: 'amber'  },
  low:    { label: 'Low',    tone: 'slate'  },
  urgent: { label: 'Urgent', tone: 'red'    },
};

export function PriorityPill({ priority, className = '' }) {
  const key = String(priority || 'medium').toLowerCase();
  const cfg = PRIORITY_MAP[key] || { label: priority || 'Medium', tone: 'slate' };
  return <span className={`pill pill--${cfg.tone} ${className}`}>{cfg.label}</span>;
}

/* ── Tag ───────────────────────────────────────────────────────────────────── */
const TONES = ['violet', 'blue', 'green', 'amber', 'red', 'indigo', 'rose', 'teal', 'emerald'];
// Preset tones for known tags; unknown ones get hashed.
const TAG_PRESETS = {
  work:     'indigo',
  personal: 'violet',
  idea:     'amber',
  urgent:   'red',
  meeting:  'blue',
  note:     'slate',
  todo:     'slate',
  dream:    'rose',
  journal:  'teal',
};

function hashTone(s = '') {
  const str = String(s).toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return TONES[h % TONES.length];
}

export function TagBadge({ tag, className = '' }) {
  if (!tag) return null;
  const lower = String(tag).toLowerCase();
  const tone = TAG_PRESETS[lower] || hashTone(lower);
  return <span className={`pill pill--${tone} ${className}`}>{tag}</span>;
}

/* ── Generic Pill ──────────────────────────────────────────────────────────── */
export function Pill({ tone = 'slate', children, className = '' }) {
  return <span className={`pill pill--${tone} ${className}`}>{children}</span>;
}
