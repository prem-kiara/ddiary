import { ChevronDown, ChevronRight } from 'lucide-react';

export default function SectionHeader({ open, onToggle, icon, label, count, color, accentColor }) {
  return (
    <button onClick={onToggle} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      padding: '10px 16px',
    }}>
      <span style={{ color: color || '#7c3aed', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: color || '#0f172a', flex: 1, textAlign: 'left' }}>
        {label}
        {count !== undefined && (
          <span style={{ fontWeight: 400, fontSize: 13, color: '#475569', marginLeft: 6 }}>({count})</span>
        )}
      </span>
      <span style={{ color: '#475569' }}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </span>
    </button>
  );
}
