/**
 * SpreadsheetGrid v3
 *
 * Features:
 *  - Editable cells + formula bar with proper cursor positioning
 *  - Formulas: =SUM, =AVERAGE, =COUNT, =MIN, =MAX, arithmetic, cell refs
 *  - Per-cell Bold / Italic formatting
 *  - Click-and-drag multi-cell selection (like Excel)
 *  - Shift+click / Shift+Arrow range selection
 *  - Sort columns ascending/descending (▲▼ on column headers)
 *  - Formula autocomplete suggestions dropdown
 *  - Formula cell-pointing: click or drag cells to insert references while typing
 *  - Column text filters
 *  - Drag-to-reorder rows and columns
 *  - Auto-save (debounced)
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Bold, Italic, Plus, Filter, ChevronUp, ChevronDown } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const LETTERS       = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const FORMULA_NAMES = ['SUM', 'AVERAGE', 'AVG', 'COUNT', 'COUNTA', 'MIN', 'MAX'];

// ─── Formula engine ───────────────────────────────────────────────────────────
export function ck(c, r) { return `${LETTERS[c] ?? '?'}${r + 1}`; }

function parseRef(ref) {
  const m = String(ref).trim().match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = m[1].toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: parseInt(m[2]) - 1 };
}

function expandRange(str) {
  const [s, e] = str.split(':');
  const a = parseRef(s), b = e ? parseRef(e) : a;
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
  const fnM  = expr.match(/^(SUM|AVERAGE|AVG|COUNT|COUNTA|MIN|MAX)\((.+)\)$/);
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

  // ── Core state ─────────────────────────────────────────────────────────────
  const [title,      setTitle]      = useState(initialTitle || 'Untitled Sheet');
  const [data,       setData]       = useState(() => sheet.data || {});
  const [cols,       setCols]       = useState(() => Math.max(sheet.cols || 10, 1));
  const [rows,       setRows]       = useState(() => Math.max(sheet.rows || 50, 1));
  const [sel,        setSel]        = useState({ c: 0, r: 0 });
  const [selEnd,     setSelEnd]     = useState(null);
  const [editCell,   setEditCell]   = useState(null);
  const [editVal,    setEditVal]    = useState('');
  const [filters,    setFilters]    = useState({});
  const [showFilter, setShowFilter] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [sortConfig, setSortConfig] = useState(null); // { col, dir:'asc'|'desc' }
  // Formula autocomplete
  const [suggIdx,    setSuggIdx]    = useState(0);
  // Drag-to-reorder
  const [dragRow,    setDragRow]    = useState(null);
  const [dragOverRow,setDragOverRow]= useState(null);
  const [dragCol,    setDragCol]    = useState(null);
  const [dragOverCol,setDragOverCol]= useState(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const gridRef         = useRef(null);  // focusable outer div
  const inputRef        = useRef(null);  // in-cell input
  const fbarRef         = useRef(null);  // formula bar input
  const saveTimer       = useRef(null);
  // Drag-select refs (no re-render needed)
  const isDraggingRef   = useRef(false); // regular drag select in progress
  // Formula pointing refs
  const formulaDragRef  = useRef(false); // formula-mode drag in progress
  const formulaAnchor   = useRef(null);  // anchor cell { c, r } during formula drag
  const formulaInsertPos= useRef(null);  // { start, end } in editVal of last inserted ref

  // Focus cell input when entering edit mode
  useEffect(() => {
    if (editCell) setTimeout(() => inputRef.current?.focus(), 0);
  }, [editCell]);

  // Global mouseup to end drags
  useEffect(() => {
    const up = () => { isDraggingRef.current = false; formulaDragRef.current = false; };
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedKey  = ck(sel.c, sel.r);
  const selectedRaw  = data[selectedKey]?.v ?? '';
  const inFormulaMode= editCell !== null && editVal.startsWith('=');

  const selRange = useMemo(() => ({
    c1: selEnd ? Math.min(sel.c, selEnd.c) : sel.c,
    r1: selEnd ? Math.min(sel.r, selEnd.r) : sel.r,
    c2: selEnd ? Math.max(sel.c, selEnd.c) : sel.c,
    r2: selEnd ? Math.max(sel.r, selEnd.r) : sel.r,
  }), [sel, selEnd]);

  const isInRange = useCallback((c, r) =>
    c >= selRange.c1 && c <= selRange.c2 && r >= selRange.r1 && r <= selRange.r2,
  [selRange]);

  // Formula autocomplete suggestions derived from current editVal
  const formulaSuggestions = useMemo(() => {
    if (!editCell || !editVal.startsWith('=')) return [];
    // Match a partial word after = or operator/paren/comma
    const m = editVal.match(/(?:^=|[+\-*/,(])([A-Za-z]{2,})$/);
    if (!m) return [];
    const partial = m[1].toUpperCase();
    return FORMULA_NAMES.filter(f => f.startsWith(partial) && f.length > partial.length);
  }, [editCell, editVal]);

  // Reset suggestion index when suggestions change
  useEffect(() => { setSuggIdx(0); }, [formulaSuggestions]);

  // Visible rows: filtered, not sorted (sort is physical)
  const visibleRows = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (!active.length) return Array.from({ length: rows }, (_, i) => i);
    return Array.from({ length: rows }, (_, r) => r).filter(r =>
      active.every(([c, f]) => displayVal(+c, r, data).toLowerCase().includes(f.toLowerCase()))
    );
  }, [rows, filters, data]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((nd, nc, nr, nt) => {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus('saving');
      onSave(sheetId, { title: nt, data: nd, cols: nc, rows: nr })
        .then(() => setSaveStatus('saved')).catch(() => setSaveStatus('unsaved'));
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
    setEditCell(null); setEditVal('');
    formulaInsertPos.current = null;
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [updateCell]);

  const clearRange = useCallback(() => {
    setData(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++)
        for (let r = selRange.r1; r <= selRange.r2; r++) delete next[ck(c, r)];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [selRange, cols, rows, title, scheduleSave]);

  // ── Sort ───────────────────────────────────────────────────────────────────
  const sortByColumn = useCallback((colIdx, dir) => {
    const allRows = Array.from({ length: rows }, (_, i) => i);
    // Snapshot display values before sorting
    const vals = allRows.map(r => displayVal(colIdx, r, data));
    allRows.sort((a, b) => {
      const va = vals[a], vb = vals[b];
      const na = parseFloat(va), nb = parseFloat(vb);
      let cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
      return dir === 'asc' ? cmp : -cmp;
    });
    setData(prev => {
      const next = {};
      // Copy cells outside row range first
      Object.entries(prev).forEach(([k, v]) => {
        const ref = parseRef(k);
        if (!ref || ref.row >= rows) next[k] = v;
      });
      // Remap sorted rows
      allRows.forEach((srcRow, destRow) => {
        for (let c = 0; c < cols; c++) {
          const k = ck(c, srcRow);
          if (prev[k]) next[ck(c, destRow)] = { ...prev[k] };
        }
      });
      scheduleSave(next, cols, rows, title);
      return next;
    });
    setSortConfig({ col: colIdx, dir });
  }, [cols, rows, data, title, scheduleSave]);

  // ── Formula pointing helpers ───────────────────────────────────────────────
  // Get the active formula input element
  const getFormulaInput = () =>
    [fbarRef.current, inputRef.current].find(el => el === document.activeElement)
    ?? inputRef.current ?? fbarRef.current;

  // Insert or replace a cell/range reference at the tracked position in the formula
  const upsertFormulaRef = useCallback((anchorCell, endCell) => {
    const ref = (endCell && !(anchorCell.c === endCell.c && anchorCell.r === endCell.r))
      ? `${ck(Math.min(anchorCell.c, endCell.c), Math.min(anchorCell.r, endCell.r))}:${ck(Math.max(anchorCell.c, endCell.c), Math.max(anchorCell.r, endCell.r))}`
      : ck(anchorCell.c, anchorCell.r);

    setEditVal(prev => {
      let start, end;
      if (formulaInsertPos.current) {
        ({ start, end } = formulaInsertPos.current);
      } else {
        const inp = getFormulaInput();
        start = inp?.selectionStart ?? prev.length;
        end   = inp?.selectionEnd   ?? prev.length;
      }
      const newVal = prev.slice(0, start) + ref + prev.slice(end);
      formulaInsertPos.current = { start, end: start + ref.length };
      return newVal;
    });

    setTimeout(() => {
      const inp = getFormulaInput();
      if (inp && formulaInsertPos.current) {
        inp.setSelectionRange(formulaInsertPos.current.end, formulaInsertPos.current.end);
        inp.focus();
      }
    }, 0);
  }, []);

  // Apply autocomplete suggestion
  const applySuggestion = useCallback((name) => {
    setEditVal(prev => {
      const m = prev.match(/^(.*?)([A-Za-z]*)$/);
      return m ? m[1] + name + '(' : prev + name + '(';
    });
    setSuggIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const clampC = (c) => Math.max(0, Math.min(cols - 1, c));
  const clampR = (r) => Math.max(0, Math.min(rows - 1, r));

  const moveSel = useCallback((dc, dr, extend = false) => {
    if (extend) {
      const base = selEnd ?? sel;
      setSelEnd({ c: clampC(base.c + dc), r: clampR(base.r + dr) });
    } else {
      setSel(prev => ({ c: clampC(prev.c + dc), r: clampR(prev.r + dr) }));
      setSelEnd(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows, sel, selEnd]);

  // ── Grid keydown (navigation mode) ────────────────────────────────────────
  const onGridKeyDown = useCallback((e) => {
    // Formula suggestions navigation
    if (formulaSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
    }

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
      setEditCell(sel); setEditVal(key === '=' ? '=' : key);
    }
  }, [editCell, moveSel, sel, selectedRaw, clearRange, formulaSuggestions, suggIdx, applySuggestion]);

  // ── Cell input keydown (edit mode) ────────────────────────────────────────
  const onCellKeyDown = useCallback((e) => {
    // Suggestions navigation in cell input
    if (formulaSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
    }
    const { key, shiftKey } = e;
    if (key === 'Escape') {
      setEditCell(null); setEditVal(''); formulaInsertPos.current = null;
      requestAnimationFrame(() => gridRef.current?.focus());
    } else if (key === 'Enter') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: editCell.c, r: clampR(editCell.r + 1) });
    } else if (key === 'Tab') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: clampC(editCell.c + (shiftKey ? -1 : 1)), r: editCell.r });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCell, editVal, commitEdit, cols, rows, formulaSuggestions, suggIdx, applySuggestion]);

  // ── Format toggle ──────────────────────────────────────────────────────────
  const toggleFmt = useCallback((fmt) => {
    const newVal = !(data[selectedKey] || {})[fmt];
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
  const addCol = () => { if (cols >= 26) return; const c = cols + 1; setCols(c); scheduleSave(data, c, rows, title); };
  const handleTitleChange = (v) => { setTitle(v); scheduleSave(data, cols, rows, v); };

  // ── Drag-to-reorder rows/cols ──────────────────────────────────────────────
  const moveRowInsert = useCallback((fromRow, toRow) => {
    if (fromRow === toRow || fromRow == null || toRow == null) return;
    setData(prev => {
      const minR = Math.min(fromRow, toRow), maxR = Math.max(fromRow, toRow);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => { const ref = parseRef(k); if (!ref || ref.row < minR || ref.row > maxR) next[k] = v; });
      for (let c = 0; c < cols; c++) for (let r = minR; r <= maxR; r++) {
        const sv = prev[ck(c, r)]; if (!sv) continue;
        let dr = r === fromRow ? toRow : (fromRow < toRow ? r - 1 : r + 1);
        next[ck(c, dr)] = sv;
      }
      scheduleSave(next, cols, rows, title); return next;
    });
  }, [cols, rows, title, scheduleSave]);

  const moveColInsert = useCallback((fromCol, toCol) => {
    if (fromCol === toCol || fromCol == null || toCol == null) return;
    setData(prev => {
      const minC = Math.min(fromCol, toCol), maxC = Math.max(fromCol, toCol);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => { const ref = parseRef(k); if (!ref || ref.col < minC || ref.col > maxC) next[k] = v; });
      for (let r = 0; r < rows; r++) for (let c = minC; c <= maxC; c++) {
        const sv = prev[ck(c, r)]; if (!sv) continue;
        let dc = c === fromCol ? toCol : (fromCol < toCol ? c - 1 : c + 1);
        next[ck(dc, r)] = sv;
      }
      scheduleSave(next, cols, rows, title); return next;
    });
  }, [cols, rows, title, scheduleSave]);

  // ── Cell mouse handlers ────────────────────────────────────────────────────
  const handleCellMouseDown = useCallback((e, c, r) => {
    if (e.button !== 0) return;

    // ── Formula pointing mode ──────────────────────────────────────────────
    if (inFormulaMode && !(editCell.c === c && editCell.r === r)) {
      e.preventDefault(); // keep formula input focused
      formulaDragRef.current = true;
      formulaAnchor.current  = { c, r };
      formulaInsertPos.current = null; // will be set by upsertFormulaRef
      upsertFormulaRef({ c, r }, null);
      return;
    }

    // ── Normal drag-select ─────────────────────────────────────────────────
    if (editCell) commitEdit(editCell.c, editCell.r, editVal);
    isDraggingRef.current = true;
    setSel({ c, r }); setSelEnd(null); setEditCell(null); setEditVal('');
    gridRef.current?.focus();
  }, [inFormulaMode, editCell, editVal, commitEdit, upsertFormulaRef]);

  const handleCellMouseEnter = useCallback((e, c, r) => {
    if (formulaDragRef.current && formulaAnchor.current) {
      // Extend formula range reference
      upsertFormulaRef(formulaAnchor.current, { c, r });
      return;
    }
    if (isDraggingRef.current && e.buttons === 1) {
      setSelEnd({ c, r });
    }
  }, [upsertFormulaRef]);

  const handleCellClick = useCallback((e, c, r) => {
    if (inFormulaMode && !(editCell.c === c && editCell.r === r)) return; // handled by mousedown
    if (e.shiftKey && !inFormulaMode) { setSelEnd({ c, r }); return; }
    if (!isDraggingRef.current) {
      setSel({ c, r }); setSelEnd(null);
    }
  }, [inFormulaMode, editCell]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const isEditing = (c, r) => editCell?.c === c && editCell?.r === r;
  const selCell   = data[selectedKey] || {};

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* ── Title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
        <input
          className="input input-title"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          style={{ flex: 1, marginBottom: 0, fontSize: 18 }}
        />
        <span style={{ fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
          color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'saving' ? 'var(--ink-lighter)' : '#d97706' }}>
          {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}
        </span>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8,
        padding: '4px 8px', background: 'var(--paper-dark)',
        border: '1px solid var(--paper-line)', borderRadius: 8, flexWrap: 'wrap' }}>

        {/* Bold / Italic */}
        {[{ icon: <Bold size={14} />, fmt: 'b', label: 'Bold' }, { icon: <Italic size={14} />, fmt: 'i', label: 'Italic' }]
          .map(({ icon, fmt, label }) => (
            <button key={fmt} onMouseDown={e => { e.preventDefault(); toggleFmt(fmt); }} title={label}
              style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center',
                border: '1px solid transparent', background: selCell[fmt] ? 'var(--paper-line)' : 'none',
                color: 'var(--ink)', fontWeight: fmt === 'b' ? 700 : 400 }}>{icon}</button>
          ))}

        <div style={divider} />

        <button onMouseDown={e => { e.preventDefault(); setShowFilter(f => !f); setFilters({}); }}
          title="Toggle column filters" style={tbtnStyle(showFilter)}>
          <Filter size={13} /> Filter
        </button>

        <div style={divider} />

        <button onMouseDown={e => { e.preventDefault(); addRow(); }} title="Add 10 rows" style={tbtnStyle(false)}>
          <Plus size={13} /> Row
        </button>
        {cols < 26 && (
          <button onMouseDown={e => { e.preventDefault(); addCol(); }} title="Add column" style={tbtnStyle(false)}>
            <Plus size={13} /> Col
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Formula bar with suggestions */}
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--ink-light)', minWidth: 36, textAlign: 'center', fontWeight: 700 }}>
          {selEnd ? `${ck(selRange.c1, selRange.r1)}:${ck(selRange.c2, selRange.r2)}` : selectedKey}
        </span>
        <div style={{ position: 'relative' }}>
          <input
            ref={fbarRef}
            value={editCell && isEditing(sel.c, sel.r) ? editVal : String(selectedRaw)}
            onChange={e => {
              if (!editCell || !isEditing(sel.c, sel.r)) { setEditCell(sel); setEditVal(e.target.value); }
              else { setEditVal(e.target.value); formulaInsertPos.current = null; }
            }}
            onKeyDown={e => {
              if (formulaSuggestions.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
                if (e.key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
              }
              if (e.key === 'Enter') { commitEdit(sel.c, sel.r, editVal || String(selectedRaw)); e.preventDefault(); }
              else if (e.key === 'Escape') { setEditCell(null); setEditVal(''); formulaInsertPos.current = null; requestAnimationFrame(() => gridRef.current?.focus()); }
            }}
            onFocus={() => {
              // Only reset editVal if not already editing this cell (preserves cursor pos on re-focus)
              if (!editCell || editCell.c !== sel.c || editCell.r !== sel.r) {
                setEditCell(sel); setEditVal(String(selectedRaw));
              }
            }}
            placeholder="Enter value or =formula"
            style={{ width: 240, height: 28, padding: '0 8px', fontSize: 13, fontFamily: 'monospace',
              border: '1px solid var(--paper-line)', borderRadius: 6, outline: 'none', background: '#fff',
              boxShadow: inFormulaMode ? '0 0 0 2px #7c3aed44' : 'none' }}
          />
          {/* Autocomplete dropdown */}
          {formulaSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff',
              border: '1px solid var(--paper-line)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              zIndex: 100, marginTop: 2, overflow: 'hidden' }}>
              {formulaSuggestions.map((name, i) => (
                <div key={name}
                  onMouseDown={e => { e.preventDefault(); applySuggestion(name); }}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
                    background: i === suggIdx ? '#ede9fe' : 'transparent',
                    color: i === suggIdx ? '#7c3aed' : 'var(--ink)', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#7c3aed' }}>ƒ</span>
                  {name}
                  <span style={{ fontSize: 10, color: 'var(--ink-lighter)', fontWeight: 400, marginLeft: 'auto' }}>Tab to insert</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Formula pointing indicator */}
      {inFormulaMode && (
        <div style={{ fontSize: 11, color: '#7c3aed', fontFamily: 'var(--font-body)',
          marginBottom: 6, padding: '3px 8px', background: '#f5f3ff',
          borderRadius: 6, border: '1px solid #ddd6fe' }}>
          📌 Formula mode — click or drag cells to insert references into your formula
        </div>
      )}

      {/* ── Grid ── */}
      <div
        ref={gridRef}
        style={{ flex: 1, overflow: 'auto', border: '1px solid var(--paper-line)', borderRadius: 8, background: '#fff', outline: 'none' }}
        onKeyDown={onGridKeyDown}
        tabIndex={0}
        onMouseUp={() => { isDraggingRef.current = false; formulaDragRef.current = false; formulaAnchor.current = null; }}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: cols * 100 + 50 }}>
          <colgroup>
            <col style={{ width: 42 }} />
            {Array.from({ length: cols }, (_, c) => <col key={c} style={{ width: 110 }} />)}
          </colgroup>

          {/* ── Column headers ── */}
          <thead>
            <tr>
              <th style={thStyle(false)}>#</th>
              {Array.from({ length: cols }, (_, c) => {
                const sorted = sortConfig?.col === c;
                return (
                  <th key={c}
                    style={{ ...thStyle(selRange.c1 <= c && c <= selRange.c2),
                      cursor: 'grab', userSelect: 'none',
                      background: dragOverCol === c ? '#ddd6fe'
                        : (selRange.c1 <= c && c <= selRange.c2) ? '#ede9fe' : 'var(--paper-dark)' }}
                    draggable
                    onDragStart={() => setDragCol(c)}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={e => { e.preventDefault(); moveColInsert(dragCol, c); setDragCol(null); setDragOverCol(null); }}
                    onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                    onClick={() => { setSel({ c, r: 0 }); setSelEnd({ c, r: rows - 1 }); gridRef.current?.focus(); }}
                    title="Click to select · Drag to reorder"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <span>{LETTERS[c]}</span>
                      {/* Sort buttons */}
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 0, marginLeft: 2 }}>
                        <button
                          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); sortByColumn(c, 'asc'); }}
                          title={`Sort ${LETTERS[c]} ascending`}
                          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 1,
                            color: (sorted && sortConfig.dir === 'asc') ? '#7c3aed' : 'var(--ink-lighter)',
                            display: 'flex', alignItems: 'center' }}>
                          <ChevronUp size={10} strokeWidth={3} />
                        </button>
                        <button
                          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); sortByColumn(c, 'desc'); }}
                          title={`Sort ${LETTERS[c]} descending`}
                          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 1,
                            color: (sorted && sortConfig.dir === 'desc') ? '#7c3aed' : 'var(--ink-lighter)',
                            display: 'flex', alignItems: 'center' }}>
                          <ChevronDown size={10} strokeWidth={3} />
                        </button>
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>

            {/* ── Filter row ── */}
            {showFilter && (
              <tr>
                <td style={thStyle()} />
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} style={{ ...thStyle(), padding: '2px 4px' }}>
                    <input value={filters[c] || ''}
                      onChange={e => setFilters(prev => ({ ...prev, [c]: e.target.value }))}
                      placeholder="filter…"
                      style={{ width: '100%', fontSize: 11, padding: '2px 4px', fontFamily: 'var(--font-body)',
                        border: '1px solid var(--paper-line)', borderRadius: 4, outline: 'none', background: '#fffbe6' }} />
                  </td>
                ))}
              </tr>
            )}
          </thead>

          {/* ── Body ── */}
          <tbody>
            {visibleRows.map(r => (
              <tr key={r} style={{ background: dragOverRow === r ? '#ede9fe' : 'transparent' }}>
                {/* Row number — draggable */}
                <td
                  style={{ ...tdStyle(false, false), cursor: 'grab',
                    background: dragOverRow === r ? '#ddd6fe'
                      : (selRange.r1 <= r && r <= selRange.r2) ? '#ede9fe' : 'var(--paper-dark)',
                    color: 'var(--ink-lighter)', fontSize: 11, textAlign: 'center', userSelect: 'none', padding: '0 4px' }}
                  draggable
                  onDragStart={() => setDragRow(r)}
                  onDragOver={e => { e.preventDefault(); setDragOverRow(r); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => { e.preventDefault(); moveRowInsert(dragRow, r); setDragRow(null); setDragOverRow(null); }}
                  onDragEnd={() => { setDragRow(null); setDragOverRow(null); }}
                  onClick={() => { setSel({ c: 0, r }); setSelEnd({ c: cols - 1, r }); gridRef.current?.focus(); }}
                  title="Click to select row · Drag to reorder"
                >
                  {r + 1}
                </td>

                {Array.from({ length: cols }, (_, c) => {
                  const fmt      = data[ck(c, r)] || {};
                  const editing  = isEditing(c, r);
                  const inRange  = isInRange(c, r);
                  const isAnchor = sel.c === c && sel.r === r;
                  const dv       = displayVal(c, r, data);
                  const isNum    = !isNaN(+dv) && dv !== '';
                  const isErr    = String(dv).startsWith('#');
                  // Highlight cells in formula range while pointing
                  const inFormulaHighlight = inFormulaMode && formulaAnchor.current
                    ? (() => {
                        const a = formulaAnchor.current;
                        return c >= Math.min(a.c, c) && c <= Math.max(a.c, c)
                          && r >= Math.min(a.r, r) && r <= Math.max(a.r, r);
                      })()
                    : false;

                  return (
                    <td key={c}
                      style={{
                        border: '1px solid var(--paper-line)', height: 28, padding: 0,
                        cursor: inFormulaMode && !(editCell?.c === c && editCell?.r === r) ? 'crosshair' : 'default',
                        background: editing ? '#faf5ff' : inFormulaHighlight ? '#fef3c7' : inRange ? '#ede9fe' : 'transparent',
                        outline: isAnchor && !selEnd ? '2px solid #7c3aed' : inRange ? '1px solid #a78bfa' : 'none',
                        outlineOffset: isAnchor && !selEnd ? -1 : 0,
                        position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
                      }}
                      onMouseDown={e => handleCellMouseDown(e, c, r)}
                      onMouseEnter={e => handleCellMouseEnter(e, c, r)}
                      onClick={e => handleCellClick(e, c, r)}
                      onDoubleClick={() => {
                        if (inFormulaMode) return;
                        setSel({ c, r }); setSelEnd(null);
                        setEditCell({ c, r }); setEditVal(String(data[ck(c, r)]?.v ?? ''));
                      }}
                    >
                      {editing ? (
                        <input ref={inputRef} value={editVal}
                          onChange={e => { setEditVal(e.target.value); formulaInsertPos.current = null; }}
                          onKeyDown={onCellKeyDown}
                          onBlur={() => { if (!formulaDragRef.current) commitEdit(c, r, editVal); }}
                          style={{ width: '100%', height: '100%', border: 'none', outline: 'none',
                            padding: '0 4px', fontFamily: 'var(--font-body)', fontSize: 13, background: 'transparent',
                            fontWeight: fmt.b ? 700 : 400, fontStyle: fmt.i ? 'italic' : 'normal' }} />
                      ) : (
                        <span style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis', padding: '0 4px',
                          fontWeight: fmt.b ? 700 : 400, fontStyle: fmt.i ? 'italic' : 'normal',
                          textAlign: isErr ? 'center' : isNum ? 'right' : 'left',
                          color: isErr ? '#dc2626' : 'inherit', fontSize: 13 }}>
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
        Click+drag to select range · Shift+click to extend · ▲▼ on column headers to sort · Drag row/col headers to reorder · Type =formula for autocomplete · Start a formula then click cells to insert references
      </p>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const divider = { width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' };

function thStyle(highlight = false) {
  return {
    position: 'sticky', top: 0, zIndex: 2,
    background: highlight ? '#ede9fe' : 'var(--paper-dark)',
    borderBottom: '2px solid var(--paper-line)', borderRight: '1px solid var(--paper-line)',
    padding: '4px 4px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
    color: 'var(--ink-light)', textAlign: 'center', userSelect: 'none', whiteSpace: 'nowrap',
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
    padding: '4px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center',
    gap: 4, border: '1px solid transparent', background: active ? 'var(--paper-line)' : 'none',
    color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-body)',
  };
}
