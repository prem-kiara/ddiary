import { Circle, Clock, Eye, CheckCircle } from 'lucide-react';

// ── Status config ─────────────────────────────────────────────────────────────
export const STATUSES = [
  { value: 'open',        label: 'Open',        color: '#475569', bg: '#f1f5f9', Icon: Circle       },
  { value: 'in_progress', label: 'In Progress', color: '#2563eb', bg: '#eff6ff', Icon: Clock        },
  { value: 'review',      label: 'Review',      color: '#7c3aed', bg: '#f5eef8', Icon: Eye          },
  { value: 'done',        label: 'Done',        color: '#15803d', bg: '#eafaf1', Icon: CheckCircle  },
];

export const PRIORITY_COLORS = { high: '#dc2626', medium: '#d97706', low: '#15803d' };

export const formatDate = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
