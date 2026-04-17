/**
 * Avatar + AvatarStack — consistent initials-based avatars across the app.
 *
 * Colors are picked deterministically from the identity (uid or email) via a
 * FNV-1a-ish hash, so the same person always gets the same color.
 */

const BG_CLASSES = [
  'bg-violet-500',
  'bg-indigo-500',
  'bg-blue-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-orange-500',
  'bg-rose-500',
  'bg-fuchsia-500',
];

function hashIdx(str = '') {
  const s = String(str);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % BG_CLASSES.length;
}

const SIZE = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
  xl: 'w-14 h-14 text-lg',
};

export function toInitials(nameOrEmail = '') {
  if (!nameOrEmail) return '?';
  const s = String(nameOrEmail).trim();
  if (s.includes('@')) {
    const local = s.split('@')[0];
    return local.slice(0, 2).toUpperCase();
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Single avatar. Prefer passing `id` (uid / email) for stable color hashing.
 */
export default function Avatar({
  id,
  name,
  email,
  size = 'md',
  ring = false,
  className = '',
  title,
}) {
  const label = name || email || id || '';
  const initials = toInitials(label);
  const bg = BG_CLASSES[hashIdx(id || email || name || 'anon')];
  const sz = SIZE[size] || SIZE.md;
  return (
    <span
      className={`avatar inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0 ${bg} ${sz} ${ring ? 'ring-2 ring-white' : ''} ${className}`}
      title={title || label}
    >
      {initials}
    </span>
  );
}

/**
 * Stacked avatars with overlap, showing +N overflow chip when needed.
 */
export function AvatarStack({ people = [], max = 4, size = 'sm', className = '' }) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <div className={`inline-flex items-center ${className}`}>
      {shown.map((p, i) => (
        <div key={p.id || p.uid || p.email || i} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar
            id={p.id || p.uid || p.email}
            name={p.displayName || p.name}
            email={p.email}
            size={size}
            ring
          />
        </div>
      ))}
      {overflow > 0 && (
        <span
          className="avatar avatar-sm bg-slate-200 text-slate-700 ring-2 ring-white"
          style={{ marginLeft: -8 }}
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
