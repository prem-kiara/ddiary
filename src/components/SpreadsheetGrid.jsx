/**
 * SpreadsheetGrid — Excel-like grid
 *
 * Features:
 *  - Editable cells + formula bar
 *  - Formulas: =SUM, =AVERAGE, =COUNT, =MIN, =MAX, arithmetic, cell refs
 *  - Per-cell Bold / Italic
 *  - Multi-cell selection (click, Shift+click, Shift+Arrow)
 *  - Column text filters
 *  - Drag-to-reorder rows and columns
 *  - Add rows / columns
 *  - Auto-save (debounced)
 *  - Full keyboard navigation — focus is preserved so typing always works
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Bold, Italic, Plus, Filter } from 'lucide-react';

// ─── Formula engine ───────────────────────────────────────────────────────────
const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export function ck(c, r) { return `${LETTERS[c] ?? '?'}${r + 1}`; }

function parseRef(ref) {
  const m = String(ref).trim().match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = m[1].toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: parseInt(m[2]) - 1 };
}

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

function evalCell(col, row, data, depth = 0) {
  if (depth > 16 || col < 0 || row < 0) return '#REF!';
  const cell = data[ck(col, row)];
  if (!cell?.v && cell?.v !== 0) return '';
  const raw = String(cell.v).trim();
  if (!raw.startsWith('=')) return raw === '' ? '' : isNaN(raw) ? raw : +raw;

  const expr = raw.slice(1).toUpperCase().trim();
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
    if (fn === 'SUM')                      return nums.reduce((a, b) => a + b, 0);
    if (fn === 'AVERAGE' || fn === 'AVG')  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    if (fn === 'COUNT' || fn === 'COUNTA') return nums.length;
    if (fn === 'MIN') return nums.length ? Math.min(...nums) : 0;
    if (fn === 'MAX') return nums.length ? Math.max(...nums) : 0;
  }

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
  } catch { return '#ERROR'; }
}

function displayVal(c, r, data) {
  const v = evalCell(c, r, data);
  return v === '' || v === null || v === undefined ? '' : String(v);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpreadsheetGrid({ sheet, onSave, onBack }) {
  const { id: sheetId, title: initialTitle } = sheet;

  // ── State ──────────────────────────────────────────────────────────────────
  const [title,      setTitle]     = useState(initialTitle || 'Untitled Sheet');
  const [data,       setData]      = useState(() => sheet.data || {});
  const [cols,       setCols]      = useState(() => Math.max(sheet.cols || 10, 1));
  const [rows,       setRows]      = useState(() => Math.max(sheet.rows || 50, 1));
  const [sel,        setSel]       = useState({ c: 0, r: 0 });   // anchor cell
  const [selEnd,     setSelEnd]    = useState(null);              // range end (null = single)
  const [editCell,   setEditCell]  = useState(null);
  const [editVal,    setEditVal]   = useState('');
  const [filters,    setFilters]   = useState({});
  const [showFilter, setShowFilter]= useState(false);
  const [saveStatus, setSaveStatus]= useState('saved');
  // Drag-to-reorder
  const [dragRow,    setDragRow]   = useState(null);
  const [dragOverRow,setDragOverRow]= useState(null);
  const [dragCol,    setDragCol]   = useState(null);
  const [dragOverCol,setDragOverCol]= useState(null);

  const gridRef  = useRef(null);   // outer focusable div
  const inputRef = useRef(null);   // cell input
  const fbarRef  = useRef(null);   // formula bar
  const saveTimer= useRef(null);

  // Focus cell input when entering edit mode
  useEffect(() => {
    if (editCell) setTimeout(() => inputRef.current?.focus(), 0);
  }, [editCell]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedKey = ck(sel.c, sel.r);
  const selectedRaw = data[selectedKey]?.v ?? '';

  // The bounding rectangle of the current selection (always defined)
  const selRange = useMemo(() => ({
    c1: selEnd ? Math.min(sel.c, selEnd.c) : sel.c,
    r1: selEnd ? Math.min(sel.r, selEnd.r) : sel.r,
    c2: selEnd ? Math.max(sel.c, selEnd.c) : sel.c,
    r2: selEnd ? Math.max(sel.r, selEnd.r) : sel.r,
  }), [sel, selEnd]);

  const isInRange = useCallback((c, r) =>
    c >= selRange.c1 && c <= selRange.c2 && r >= selRange.r1 && r <= selRange.r2,
  [selRange]);

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
      onSave(sheetId, { title: newTitle, data: newData, cols: newCols, rows: newRows })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('unsaved'));
    }, 1500);
  }, [sheetId, onSave]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ── Cell helpers ───────────────────────────────────────────────────────────
  const updateCell = useCallback((c, r, patch) => {
    setData(prev => {
      const key  = ck(c, r);
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      if (!next[key].v && !next[key].b && !next[key].i) delete next[key];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave]);

  const commitEdit = useCallback((c, r, val) => {
    updateCell(c, r, { v: val });
    setEditCell(null);
    setEditVal('');
    // Return focus to grid so keyboard nav keeps working
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [updateCell]);

  const clearRange = useCallback(() => {
    setData(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++)
        for (let r = selRange.r1; r <= selRange.r2; r++)
          delete next[ck(c, r)];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [selRange, cols, rows, title, scheduleSave]);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const clampC = (c) => Math.max(0, Math.min(cols - 1, c));
  const clampR = (r) => Math.max(0, Math.min(rows - 1, r));

  const moveSel = useCallback((dc, dr, extend = false) => {
    if (extend) {
      const base = selEnd ?? sel;
      const next = { c: clampC(base.c + dc), r: clampR(base.r + dr) };
      setSelEnd(next);
    } else {
      setSel(prev => ({ c: clampC(prev.c + dc), r: clampR(prev.r + dr) }));
      setSelEnd(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows, sel, selEnd]);

  // ── Grid keydown (navigation mode) ────────────────────────────────────────
  const onGridKeyDown = useCallback((e) => {
    if (editCell) return;
    const { key, shiftKey } = e;
    if      (key === 'ArrowRight') { e.preventDefault(); moveSel(1,  0, shiftKey); }
    else if (key === 'ArrowLeft')  { e.preventDefault(); moveSel(-1, 0, shiftKey); }
    else if (key === 'ArrowDown')  { e.preventDefault(); moveSel(0,  1, shiftKey); }
    else if (key === 'ArrowUp')    { e.preventDefault(); moveSel(0, -1, shiftKey); }
    else if (key === 'Tab')        { e.preventDefault(); moveSel(shiftKey ? -1 : 1, 0); }
    else if (key === 'Enter')      { e.preventDefault(); moveSel(0, shiftKey ? -1 : 1); }
    else if (key === 'F2')         { setEditCell(sel); setEditVal(String(selectedRaw)); }
    else if (key === 'Escape')     { setSelEnd(null); }
    else if (key === 'Delete' || key === 'Backspace') { clearRange(); }
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey) {
      setEditCell(sel);
      setEditVal(key === '=' ? '=' : key);
    }
  }, [editCell, moveSel, sel, selectedRaw, clearRange]);

  // ── Cell input keydown (edit mode) ────────────────────────────────────────
  const onCellKeyDown = useCallback((e) => {
    const { key, shiftKey } = e;
    if (key === 'Escape') { setEditCell(null); setEditVal(''); requestAnimationFrame(() => gridRef.current?.focus()); }
    else if (key === 'Enter') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: editCell.c, r: clampR(editCell.r + 1) });
    } else if (key === 'Tab') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: clampC(editCell.c + (shiftKey ? -1 : 1)), r: editCell.r });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCell, editVal, commitEdit, cols, rows]);

  // ── Format toggle ──────────────────────────────────────────────────────────
  const toggleFmt = useCallback((fmt) => {
    // Apply to entire selection range
    const cell = data[selectedKey] || {};
    const newVal = !cell[fmt];
    setData(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        for (let r = selRange.r1; r <= selRange.r2; r++) {
          const k = ck(c, r);
          next[k] = { ...(next[k] || {}), [fmt]: newVal, v: (next[k]?.v ?? '') };
          if (!next[k].v && !next[k].b && !next[k].i) delete next[k];
        }
      }
      scheduleSave(next, cols, rows, title);
      return next;
    });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [selectedKey, data, selRange, cols, rows, title, scheduleSave]);

  // ── Add rows / columns ─────────────────────────────────────────────────────
  const addRow = () => { const r = rows + 10; setRows(r); scheduleSave(data, cols, r, title); };
  const addCol = () => {
    if (cols >= 26) return;
    const c = cols + 1; setCols(c); scheduleSave(data, c, rows, title);
  };

  // ── Title change ───────────────────────────────────────────────────────────
  const handleTitleChange = (v) => { setTitle(v); scheduleSave(data, cols, rows, v); };

  // ── Drag-to-reorder rows ───────────────────────────────────────────────────
  const moveRowInsert = useCallback((fromRow, toRow) => {
    if (fromRow === toRow || fromRow == null || toRow == null) return;
    setData(prev => {
      const minR = Math.min(fromRow, toRow), maxR = Math.max(fromRow, toRow);
      const next = {};
      // Copy unaffected cells
      Object.entries(prev).forEach(([key, val]) => {
        const ref = parseRef(key);
        if (!ref || ref.row < minR || ref.row > maxR) next[key] = val;
      });
      // Remap affected rows
      for (let c = 0; c < cols; c++) {
        for (let r = minR; r <= maxR; r++) {
          const srcVal = prev[ck(c, r)];
          if (!srcVal) continue;
          let destR;
          if (r === fromRow)         destR = toRow;
          else if (fromRow < toRow)  destR = r - 1;
          else                       destR = r + 1;
          next[ck(c, destR)] = srcVal;
        }
      }
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave]);

  const moveColInsert = useCallback((fromCol, toCol) => {
    if (fromCol === toCol || fromCol == null || toCol == null) return;
    setData(prev => {
      const minC = Math.min(fromCol, toCol), maxC = Math.max(fromCol, toCol);
      const next = {};
      Object.entries(prev).forEach(([key, val]) => {
        const ref = parseRef(key);
        if (!ref || ref.col < minC || ref.col > maxC) next[key] = val;
      });
      for (let r = 0; r < rows; r++) {
        for (let c = minC; c <= maxC; c++) {
          const srcVal = prev[ck(c, r)];
          if (!srcVal) continue;
          let destC;
          if (c === fromCol)         destC = toCol;
          else if (fromCol < toCol)  destC = c - 1;
          else                       destC = c + 1;
          next[ck(destC, r)] = srcVal;
        }
      }
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const isEditing  = (c, r) => editCell?.c === c && editCell?.r === r;
  const selCell    = data[selectedKey] || {};

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
        <span style={{
          fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
          color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'saving' ? 'var(--ink-lighter)' : '#d97706',
        }}>
          {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}
        </span>
      </div>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8,
        padding: '4px 8px', background: 'var(--paper-dark)',
        border: '1px solid var(--paper-line)', borderRadius: 8, flexWrap: 'wrap',
      }}>
        {[
          { icon: <Bold size={14} />,   fmt: 'b', label: 'Bold'   },
          { icon: <Italic size={14} />, fmt: 'i', label: 'Italic' },
        ].map(({ icon, fmt, label }) => (
          <button
            key={fmt}
            onMouseDown={e => { e.preventDefault(); toggleFmt(fmt); }}
            title={label}
            style={{
              padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex',
              alignItems: 'center', border: '1px solid transparent',
              background: selCell[fmt] ? 'var(--paper-line)' : 'none',
              color: 'var(--ink)', fontWeight: fmt === 'b' ? 700 : 400,
            }}
          >{icon}</button>
        ))}

        <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' }} />

        <button
          onMouseDown={e => { e.preventDefault(); setShowFilter(f => !f); setFilters({}); }}
          title="Toggle column filters"
          style={tbtnStyle(showFilter)}
        ><Filter size={13} /> Filter</button>

        <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' }} />

        <button onMouseDown={e => { e.preventDefault(); addRow(); }} title="Add 10 rows" style={tbtnStyle(false)}>
          <Plus size={13} /> Row
        </button>
        {cols < 26 && (
          <button onMouseDown={e => { e.preventDefault(); addCol(); }} title="Add column" style={tbtnStyle(false)}>
            <Plus size={13} /> Col
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Cell reference + formula bar */}
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--ink-light)', minWidth: 36, textAlign: 'center', fontWeight: 700 }}>
          {selEnd
            ? `${ck(selRange.c1, selRange.r1)}:${ck(selRange.c2, selRange.r2)}`
            : selectedKey}
        </span>
        <input
          ref={fbarRef}
          value={editCell && isEditing(sel.c, sel.r) ? editVal : String(selectedRaw)}
          onChange={e => {
            if (!editCell || !isEditing(sel.c, sel.r)) { setEditCell(sel); setEditVal(e.target.value); }
            else { setEditVal(e.target.value); }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') { commitEdit(sel.c, sel.r, editVal || String(selectedRaw)); e.preventDefault(); }
            else if (e.key === 'Escape') { setEditCell(null); setEditVal(''); requestAnimationFrame(() => gridRef.current?.focus()); }
          }}
          onFocus={() => { setEditCell(sel); setEditVal(String(selectedRaw)); }}
          placeholder="Enter value or =formula"
          style={{
            width: 220, height: 28, padding: '0 8px', fontSize: 13, fontFamily: 'monospace',
            border: '1px solid var(--paper-line)', borderRadius: 6, outline: 'none', background: '#fff',
          }}
        />
      </div>

      {/* ── Grid ── */}
      <div
        ref={gridRef}
        style={{ flex: 1, overflow: 'auto', border: '1px solid var(--paper-line)', borderRadius: 8, background: '#fff', outline: 'none' }}
        onKeyDown={onGridKeyDown}
        tabIndex={0}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: cols * 100 + 50 }}>
          <colgroup>
            <col style={{ width: 42 }} />
            {Array.from({ length: cols }, (_, c) => <col key={c} style={{ width: 110 }} />)}
          </colgroup>

          {/* ── Column headers (draggable) ── */}
          <thead>
            <tr>
              <th style={thStyle(false)}>#</th>
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  style={{
                    ...thStyle(selRange.c1 <= c && c <= selRange.c2),
                    cursor: 'grab',
                    background: dragOverCol === c ? '#ddd6fe'
                      : (selRange.c1 <= c && c <= selRange.c2) ? '#ede9fe'
                      : 'var(--paper-dark)',
                  }}
                  draggable
                  onDragStart={() => setDragCol(c)}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={e => { e.preventDefault(); moveColInsert(dragCol, c); setDragCol(null); setDragOverCol(null); }}
                  onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                  onClick={() => {
                    // Select entire column
                    setSel({ c, r: 0 });
                    setSelEnd({ c, r: rows - 1 });
                    gridRef.current?.focus();
                  }}
                  title="Click to select column · Drag to reorder"
                >
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
              <tr
                key={r}
                style={{ background: dragOverRow === r ? '#ede9fe' : 'transparent' }}
              >
                {/* Row number — draggable, click-to-select-row */}
                <td
                  style={{
                    ...tdStyle(false, false),
                    background: dragOverRow === r ? '#ddd6fe'
                      : (selRange.r1 <= r && r <= selRange.r2) ? '#ede9fe'
                      : 'var(--paper-dark)',
                    color: 'var(--ink-lighter)', fontSize: 11, textAlign: 'center',
                    userSelect: 'none', padding: '0 4px', cursor: 'grab',
                  }}
                  draggable
                  onDragStart={() => setDragRow(r)}
                  onDragOver={e => { e.preventDefault(); setDragOverRow(r); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => { e.preventDefault(); moveRowInsert(dragRow, r); setDragRow(null); setDragOverRow(null); }}
                  onDragEnd={() => { setDragRow(null); setDragOverRow(null); }}
                  onClick={() => {
                    // Select entire row
                    setSel({ c: 0, r });
                    setSelEnd({ c: cols - 1, r });
                    gridRef.current?.focus();
                  }}
                  title="Click to select row · Drag to reorder"
                >
                  {r + 1}
                </td>

                {Array.from({ length: cols }, (_, c) => {
                  const fmt     = data[ck(c, r)] || {};
                  const editing = isEditing(c, r);
                  const inRange = isInRange(c, r);
                  const isAnchor= sel.c === c && sel.r === r;
                  const dv      = displayVal(c, r, data);
                  const isNum   = !isNaN(+dv) && dv !== '';
                  const isErr   = String(dv).startsWith('#');

                  return (
                    <td
                      key={c}
                      style={{
                        border: '1px solid var(--paper-line)',
                        height: 28, padding: 0, cursor: 'default',
                        background: editing ? '#faf5ff' : inRange ? '#ede9fe' : 'transparent',
                        outline: isAnchor && !selEnd ? '2px solid #7c3aed' : inRange ? '1px solid #a78bfa' : 'none',
                        outlineOffset: isAnchor && !selEnd ? -1 : 0,
                        position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
                      }}
                      onClick={e => {
                        if (editCell && !editing) commitEdit(editCell.c, editCell.r, editVal);
                        if (e.shiftKey) {
                          setSelEnd({ c, r });
                        } else {
                          setSel({ c, r });
                          setSelEnd(null);
                          setEditCell(null);
                          setEditVal('');
                        }
                        gridRef.current?.focus();
                      }}
                      onDoubleClick={() => {
                        setSel({ c, r });
                        setSelEnd(null);
                        setEditCell({ c, r });
                        setEditVal(String(data[ck(c, r)]?.v ?? ''));
                      }}
                    >
                      {editing ? (
                        <input
                          ref={inputRef}
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
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
        Click to select · Shift+click or Shift+Arrow to extend selection · Double-click or F2 to edit · Drag row/column headers to reorder · Formulas: =SUM(A1:A10) =AVERAGE(B1:B5) =COUNT =MIN =MAX
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
    padding: '4px 6px', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--font-body)', color: 'var(--ink-light)',
    textAlign: 'center', userSelect: 'none', whiteSpace: 'nowrap',
  };
}

function tdStyle(selected, editing) {
  return {
    border: '1px solid var(--paper-line)', height: 28, padding: 0, cursor: 'default',
    background: editing ? '#faf5ff' : selected ? '#ede9fe' : 'transparent',
    outline: selected ? '2px solid #7c3aed' : 'none', outlineOffset: -1,
    position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
  };
}

function tbtnStyle(active) {
  return {
    padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex',
    alignItems: 'center', gap: 4, border: '1px solid transparent',
    background: active ? 'var(--paper-line)' : 'none', color: 'var(--ink)',
    fontSize: 12, fontFamily: 'var(--font-body)',
  };
}
