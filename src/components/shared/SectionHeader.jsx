import { ChevronDown, ChevronRight } from 'lucide-react';

export default function SectionHeader({ open, onToggle, icon, label, count, color, accentColor }) {
  return (
    <button onClick={onToggle} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      padding: '10px 16px',
    }}>
      <span style={{ color: color || '#c9a96e', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: color || '#4a3728', flex: 1, textAlign: 'left' }}>
        {label}
        {count !== undefined && (
          <span style={{ fontWeight: 400, fontSize: 13, color: '#8a7a6a', marginLeft: 6 }}>({count})</span>
        )}
      </span>
      <span style={{ color: '#8a7a6a' }}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </span>
    </button>
  );
}
