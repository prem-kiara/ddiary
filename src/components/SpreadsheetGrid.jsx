/**
 * SpreadsheetGrid
 * A lightweight Excel-like grid with:
 *   - Editable cells, formula bar
 *   - Formulas: =SUM, =AVERAGE, =COUNT, =MIN, =MAX, =AVG, arithmetic, cell refs
 *   - Per-cell Bold / Italic formatting
 *   - Column text filters (hide rows that don't match)
 *   - Add rows / add columns
 *   - Auto-save callback (debounced by parent)
 *   - Full keyboard navigation
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Bold, Italic, Plus, Filter, Save } from 'lucide-react';

// ─── Formula engine ───────────────────────────────────────────────────────────
const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

/** Build the cell key string, e.g. colIdx=0, rowIdx=0 → "A1" */
export function ck(c, r) { return `${LETTERS[c] ?? '?'}${r + 1}`; }

/** Parse "A1" → { col: 0, row: 0 } or null */
function parseRef(ref) {
  const m = String(ref).trim().match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = m[1].toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: parseInt(m[2]) - 1 };
}

/** Expand "A1:C3" to all { col, row } pairs in the rectangle */
function expandRange(str) {
  const [s, e] = str.split(':');
  const a = parseRef(s);
  const b = e ? parseRef(e) : a;
  if (!a || !b) return [];
  const out = [];
  for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++)
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++)
      out.push({ col: c, row: r });
  return out;
}

/** Evaluate a single cell (handles formulas recursively, guarded by depth) */
function evalCell(col, row, data, depth = 0) {
  if (depth > 16 || col < 0 || row < 0) return '#REF!';
  const cell = data[ck(col, row)];
  if (!cell?.v && cell?.v !== 0) return '';
  const raw = String(cell.v).trim();
  if (!raw.startsWith('=')) {
    if (raw === '') return '';
    return isNaN(raw) ? raw : +raw;
  }

  const expr = raw.slice(1).toUpperCase().trim();

  // ── Named function: SUM(...), AVERAGE(...), etc. ──────────────────────────
  const fnM = expr.match(/^(SUM|AVERAGE|AVG|COUNT|COUNTA|MIN|MAX)\((.+)\)$/);
  if (fnM) {
    const [, fn, argsRaw] = fnM;
    const nums = [];
    argsRaw.split(',').forEach(part => {
      part = part.trim();
      const cells = part.includes(':') ? expandRange(part) : (() => { const r = parseRef(part); return r ? [r] : []; })();
      cells.forEach(({ col: c, row: r }) => {
        const v = evalCell(c, r, data, depth + 1);
        if (v !== '' && !isNaN(+v)) nums.push(+v);
      });
    });
    if (fn === 'SUM')                   return nums.reduce((a, b) => a + b, 0);
    if (fn === 'AVERAGE' || fn === 'AVG') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    if (fn === 'COUNT' || fn === 'COUNTA') return nums.length;
    if (fn === 'MIN') return nums.length ? Math.min(...nums) : 0;
    if (fn === 'MAX') return nums.length ? Math.max(...nums) : 0;
  }

  // ── Arithmetic with cell refs ─────────────────────────────────────────────
  const substituted = expr.replace(/([A-Z]+\d+)/g, ref => {
    const r = parseRef(ref);
    if (!r) return '0';
    const v = evalCell(r.col, r.row, data, depth + 1);
    return (v === '' || isNaN(+v)) ? '0' : +v;
  });

  if (!/^[0-9+\-*/.() %]+$/.test(substituted)) return '#ERROR';
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + substituted + ')')();
    if (!Number.isFinite(result)) return result === Infinity ? '#DIV/0!' : '#ERROR';
    return Math.round(result * 1e10) / 1e10;
  } catch {
    return '#ERROR';
  }
}

/** Get the display string for a cell (evaluated) */
function displayVal(c, r, data) {
  const v = evalCell(c, r, data);
  return v === '' || v === null || v === undefined ? '' : String(v);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpreadsheetGrid({ sheet, onSave, onBack }) {
  const { id: sheetId, title: initialTitle } = sheet;

  // ── State ──────────────────────────────────────────────────────────────────
  const [title,    setTitle]   = useState(initialTitle || 'Untitled Sheet');
  const [data,     setData]    = useState(() => sheet.data || {});
  const [cols,     setCols]    = useState(() => Math.max(sheet.cols || 10, 1));
  const [rows,     setRows]    = useState(() => Math.max(sheet.rows || 50, 1));
  const [sel,      setSel]     = useState({ c: 0, r: 0 });   // selected cell
  const [editCell, setEditCell]= useState(null);              // { c, r } or null
  const [editVal,  setEditVal] = useState('');
  const [filters,  setFilters] = useState({});                // { colIdx: filterStr }
  const [showFilter, setShowFilter] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');      // 'saving'|'saved'|'unsaved'

  const inputRef   = useRef(null);   // cell input
  const fbarRef    = useRef(null);   // formula bar input
  const saveTimer  = useRef(null);

  // Focus cell input when editing
  useEffect(() => {
    if (editCell) setTimeout(() => inputRef.current?.focus(), 0);
  }, [editCell]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedKey = ck(sel.c, sel.r);
  const selectedRaw = data[selectedKey]?.v ?? '';

  /** Rows visible after applying column text filters */
  const visibleRows = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (!active.length) return Array.from({ length: rows }, (_, i) => i);
    return Array.from({ length: rows }, (_, r) => r).filter(r =>
      active.every(([c, f]) => displayVal(+c, r, data).toLowerCase().includes(f.toLowerCase()))
    );
  }, [rows, filters, data]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((newData, newCols, newRows, newTitle) => {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus('saving');
      onSave(sheetId, {
        title: newTitle,
        data:  newData,
        cols:  newCols,
        rows:  newRows,
      }).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('unsaved'));
    }, 1500);
  }, [sheetId, onSave]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ── Cell mutation helpers ──────────────────────────────────────────────────
  const updateCell = useCallback((c, r, patch) => {
    setData(prev => {
      const key  = ck(c, r);
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      // Prune empty cells
      if (!next[key].v && !next[key].b && !next[key].i) delete next[key];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave]);

  const commitEdit = useCallback((c, r, val) => {
    updateCell(c, r, { v: val });
    setEditCell(null);
    setEditVal('');
  }, [updateCell]);

  const clearCell = useCallback((c, r) => {
    setData(prev => {
      const next = { ...prev };
      delete next[ck(c, r)];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const moveSel = useCallback((dc, dr) => {
    setSel(prev => ({
      c: Math.max(0, Math.min(cols - 1, prev.c + dc)),
      r: Math.max(0, Math.min(rows - 1, prev.r + dr)),
    }));
  }, [cols, rows]);

  // ── Grid keyboard handler (navigation mode) ────────────────────────────────
  const onGridKeyDown = useCallback((e) => {
    if (editCell) return; // handled by cell input
    const { key, shiftKey } = e;
    if (key === 'ArrowRight')       { e.preventDefault(); moveSel(1, 0);  }
    else if (key === 'ArrowLeft')   { e.preventDefault(); moveSel(-1, 0); }
    else if (key === 'ArrowDown')   { e.preventDefault(); moveSel(0, 1);  }
    else if (key === 'ArrowUp')     { e.preventDefault(); moveSel(0, -1); }
    else if (key === 'Tab')         { e.preventDefault(); moveSel(shiftKey ? -1 : 1, 0); }
    else if (key === 'Enter')       { e.preventDefault(); moveSel(0, shiftKey ? -1 : 1); }
    else if (key === 'F2')          { setEditCell(sel); setEditVal(String(selectedRaw)); }
    else if (key === 'Delete' || key === 'Backspace') { clearCell(sel.c, sel.r); }
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // Start typing → enter edit mode with this char
      setEditCell(sel);
      setEditVal(key === '=' ? '=' : key);
    }
  }, [editCell, moveSel, sel, selectedRaw, clearCell]);

  // ── Cell input keyboard handler (edit mode) ───────────────────────────────
  const onCellKeyDown = useCallback((e) => {
    const { key, shiftKey } = e;
    if (key === 'Escape') { setEditCell(null); setEditVal(''); }
    else if (key === 'Enter') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: editCell.c, r: Math.min(rows - 1, editCell.r + 1) });
    } else if (key === 'Tab') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: Math.min(cols - 1, editCell.c + (shiftKey ? -1 : 1)), r: editCell.r });
    }
  }, [editCell, editVal, commitEdit, cols, rows]);

  // ── Format toggle (bold / italic) ─────────────────────────────────────────
  const toggleFmt = useCallback((fmt) => {
    const key  = selectedKey;
    const cell = data[key] || {};
    updateCell(sel.c, sel.r, { [fmt]: !cell[fmt], v: cell.v ?? '' });
  }, [selectedKey, data, sel, updateCell]);

  // ── Add row / column ───────────────────────────────────────────────────────
  const addRow = () => {
    const r = rows + 10;
    setRows(r);
    scheduleSave(data, cols, r, title);
  };
  const addCol = () => {
    if (cols >= 26) return;
    const c = cols + 1;
    setCols(c);
    scheduleSave(data, c, rows, title);
  };

  // ── Title change ───────────────────────────────────────────────────────────
  const handleTitleChange = (v) => {
    setTitle(v);
    scheduleSave(data, cols, rows, v);
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
  const isEditing  = (c, r) => editCell?.c === c && editCell?.r === r;
  const isSelected = (c, r) => sel.c === c && sel.r === r;
  const cellFmt    = (c, r) => data[ck(c, r)] || {};

  const selCell = data[selectedKey] || {};

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ flexShrink: 0 }}>
          ← Back
        </button>
        <input
          className="input input-title"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          style={{ flex: 1, marginBottom: 0, fontSize: 18 }}
        />
        <span style={{ fontSize: 12, color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'saving' ? 'var(--ink-lighter)' : '#d97706', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
          {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}
        </span>
      </div>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8,
        padding: '4px 8px', background: 'var(--paper-dark)',
        border: '1px solid var(--paper-line)', borderRadius: 8, flexWrap: 'wrap',
      }}>
        {/* Bold / Italic */}
        {[
          { icon: <Bold size={14} />,   fmt: 'b', title: 'Bold'   },
          { icon: <Italic size={14} />, fmt: 'i', title: 'Italic' },
        ].map(({ icon, fmt, title: t }) => (
          <button
            key={fmt}
            onMouseDown={e => { e.preventDefault(); toggleFmt(fmt); }}
            title={t}
            style={{
              padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex',
              alignItems: 'center', border: '1px solid transparent',
              background: selCell[fmt] ? 'var(--paper-line)' : 'none',
              color: 'var(--ink)', fontWeight: fmt === 'b' ? 700 : 400,
            }}
          >{icon}</button>
        ))}

        <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' }} />

        {/* Filter toggle */}
        <button
          onMouseDown={e => { e.preventDefault(); setShowFilter(f => !f); setFilters({}); }}
          title="Toggle column filters"
          style={{
            padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 4, border: '1px solid transparent',
            background: showFilter ? 'var(--paper-line)' : 'none', color: 'var(--ink)',
            fontSize: 12, fontFamily: 'var(--font-body)',
          }}
        ><Filter size={13} /> Filter</button>

        <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' }} />

        {/* Add row / col */}
        <button onMouseDown={e => { e.preventDefault(); addRow(); }} title="Add 10 rows"
          style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid transparent', background: 'none', color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-body)' }}
        ><Plus size={13} /> Row</button>

        {cols < 26 && (
          <button onMouseDown={e => { e.preventDefault(); addCol(); }} title="Add column"
            style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid transparent', background: 'none', color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-body)' }}
          ><Plus size={13} /> Col</button>
        )}

        <div style={{ flex: 1 }} />

        {/* Selected cell ref + formula bar */}
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--ink-light)', minWidth: 36, textAlign: 'center', fontWeight: 700 }}>
          {selectedKey}
        </span>
        <input
          ref={fbarRef}
          value={editCell && isEditing(sel.c, sel.r) ? editVal : String(selectedRaw)}
          onChange={e => {
            if (!editCell || !isEditing(sel.c, sel.r)) {
              setEditCell(sel);
              setEditVal(e.target.value);
            } else {
              setEditVal(e.target.value);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              commitEdit(sel.c, sel.r, editVal || (editCell ? editVal : String(selectedRaw)));
              e.preventDefault();
            } else if (e.key === 'Escape') {
              setEditCell(null); setEditVal('');
            }
          }}
          onFocus={() => { setEditCell(sel); setEditVal(String(selectedRaw)); }}
          placeholder="Enter value or =formula"
          style={{
            width: 220, height: 28, padding: '0 8px', fontSize: 13, fontFamily: 'monospace',
            border: '1px solid var(--paper-line)', borderRadius: 6, outline: 'none',
            background: '#fff',
          }}
        />
      </div>

      {/* ── Grid ── */}
      <div
        style={{ flex: 1, overflow: 'auto', border: '1px solid var(--paper-line)', borderRadius: 8, background: '#fff' }}
        onKeyDown={onGridKeyDown}
        tabIndex={0}
        onClick={() => { if (!editCell) fbarRef.current?.blur(); }}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: cols * 100 + 50 }}>
          <colgroup>
            <col style={{ width: 42 }} />
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} style={{ width: 110 }} />
            ))}
          </colgroup>

          {/* ── Column headers ── */}
          <thead>
            <tr>
              <th style={thStyle()}>#</th>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} style={thStyle(sel.c === c)}>
                  {LETTERS[c]}
                </th>
              ))}
            </tr>

            {/* ── Filter row ── */}
            {showFilter && (
              <tr>
                <td style={thStyle()} />
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} style={{ ...thStyle(), padding: '2px 4px' }}>
                    <input
                      value={filters[c] || ''}
                      onChange={e => setFilters(prev => ({ ...prev, [c]: e.target.value }))}
                      placeholder="filter…"
                      style={{
                        width: '100%', fontSize: 11, padding: '2px 4px', fontFamily: 'var(--font-body)',
                        border: '1px solid var(--paper-line)', borderRadius: 4, outline: 'none', background: '#fffbe6',
                      }}
                    />
                  </td>
                ))}
              </tr>
            )}
          </thead>

          {/* ── Body ── */}
          <tbody>
            {visibleRows.map(r => (
              <tr key={r}>
                {/* Row number */}
                <td style={{ ...tdStyle(false, false), background: 'var(--paper-dark)', color: 'var(--ink-lighter)', fontSize: 11, textAlign: 'center', userSelect: 'none', padding: '0 4px' }}>
                  {r + 1}
                </td>

                {Array.from({ length: cols }, (_, c) => {
                  const fmt     = cellFmt(c, r);
                  const editing = isEditing(c, r);
                  const selected= isSelected(c, r);
                  const dv      = displayVal(c, r, data);
                  const isNum   = !isNaN(+dv) && dv !== '';
                  const isErr   = String(dv).startsWith('#');

                  return (
                    <td
                      key={c}
                      style={tdStyle(selected, editing)}
                      onClick={() => {
                        if (editCell && !editing) { commitEdit(editCell.c, editCell.r, editVal); }
                        setSel({ c, r });
                        setEditCell(null);
                        setEditVal('');
                      }}
                      onDoubleClick={() => {
                        setSel({ c, r });
                        setEditCell({ c, r });
                        setEditVal(String(data[ck(c, r)]?.v ?? ''));
                      }}
                    >
                      {editing ? (
                        <input
                          ref={inputRef}
                          value={editVal}
                          onChange={e => { setEditVal(e.target.value); }}
                          onKeyDown={onCellKeyDown}
                          onBlur={() => commitEdit(c, r, editVal)}
                          style={{
                            width: '100%', height: '100%', border: 'none', outline: 'none',
                            padding: '0 4px', fontFamily: 'var(--font-body)', fontSize: 13,
                            background: 'transparent',
                            fontWeight: fmt.b ? 700 : 400,
                            fontStyle:  fmt.i ? 'italic' : 'normal',
                          }}
                        />
                      ) : (
                        <span style={{
                          display: 'block', overflow: 'hidden', whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis', padding: '0 4px',
                          fontWeight: fmt.b ? 700 : 400,
                          fontStyle:  fmt.i ? 'italic' : 'normal',
                          textAlign:  isErr ? 'center' : isNum ? 'right' : 'left',
                          color: isErr ? '#dc2626' : 'inherit',
                          fontSize: 13,
                        }}>
                          {dv}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Usage hint ── */}
      <p style={{ fontSize: 11, color: 'var(--ink-lighter)', marginTop: 6, fontFamily: 'var(--font-body)' }}>
        Click to select · Double-click or F2 to edit · Arrow keys / Tab / Enter to navigate · Supported formulas: =SUM(A1:A10)&nbsp;&nbsp;=AVERAGE(B1:B5)&nbsp;&nbsp;=COUNT(A1:C5)&nbsp;&nbsp;=MIN(A1:A10)&nbsp;&nbsp;=MAX(A1:A10)
      </p>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function thStyle(highlight = false) {
  return {
    position: 'sticky', top: 0, zIndex: 2,
    background: highlight ? '#ede9fe' : 'var(--paper-dark)',
    borderBottom: '2px solid var(--paper-line)',
    borderRight: '1px solid var(--paper-line)',
    padding: '4px 6px',
    fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font-body)',
    color: 'var(--ink-light)',
    textAlign: 'center',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
}

function tdStyle(selected, editing) {
  return {
    border: '1px solid var(--paper-line)',
    height: 28,
    padding: 0,
    cursor: 'default',
    background: editing ? '#faf5ff' : selected ? '#ede9fe' : 'transparent',
    outline: selected ? '2px solid #7c3aed' : 'none',
    outlineOffset: -1,
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };
}
