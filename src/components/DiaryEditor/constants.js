// ── Shared toolbar button style & hover helper ────────────────────────────────
export const toolbarBtnStyle = {
  background:     'none',
  border:         '1px solid transparent',
  borderRadius:   6,
  cursor:         'pointer',
  padding:        '4px 7px',
  color:          'var(--ink)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  transition:     'background 0.12s, border-color 0.12s',
};

export const applyHover = (e, on) => {
  e.currentTarget.style.background  = on ? 'var(--paper)' : 'none';
  e.currentTarget.style.borderColor = on ? 'var(--paper-line)' : 'transparent';
};

// ── Shared quick-key button style ─────────────────────────────────────────────
export const quickKeyStyle = {
  background:       'var(--paper-dark)',
  border:           '1px solid var(--paper-line)',
  borderRadius:     8,
  cursor:           'pointer',
  fontSize:         20,
  width:            46,
  height:           46,
  display:          'flex',
  alignItems:       'center',
  justifyContent:   'center',
  fontFamily:       'system-ui, sans-serif',
  color:            'var(--ink)',
  transition:       'background 0.15s ease',
  userSelect:       'none',
  WebkitUserSelect: 'none',
};

// Highlight colour palette
export const HIGHLIGHT_COLORS = [
  { color: '#fef08a', title: 'Yellow highlight'  },
  { color: '#bbf7d0', title: 'Green highlight'   },
  { color: '#fce7f3', title: 'Pink highlight'    },
  { color: '#bfdbfe', title: 'Blue highlight'    },
  { color: '#fed7aa', title: 'Orange highlight'  },
];

// Table cell inline style string (used when inserting / adding rows)
export const TD_STYLE = 'border:1px solid #e2e8f0;padding:4px 6px;min-width:0;vertical-align:top';
