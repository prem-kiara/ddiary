/**
 * SpreadsheetGrid v5 — modular entry point
 *
 * Features:
 *  - Editable cells + formula bar with correct cursor positioning
 *  - Formulas: =SUM, =AVERAGE, =COUNT, =MIN, =MAX, arithmetic, cell refs
 *  - Per-cell Bold / Italic formatting
 *  - Click-and-drag multi-cell selection (mousedown → drag → mouseup)
 *  - Shift+click / Shift+Arrow range extension
 *  - Sort columns ascending / descending (▲ ▼) — empty rows always stay at bottom
 *  - Undo / Redo (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z) — up to 30 steps
 *  - Cut / Copy / Paste (Ctrl+X / Ctrl+C / Ctrl+V) — tab-separated, Excel-compatible
 *  - Formula autocomplete suggestions (Tab to insert)
 *  - Formula cell-pointing: click or drag cells while typing a formula to insert refs
 *  - Column text filters
 *  - Drag-to-reorder rows and columns
 *  - Resizable columns (drag right edge of header) and rows (drag bottom edge of row number)
 *  - Auto-save (debounced)
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Bold, Italic, Plus, Filter, ChevronUp, ChevronDown, Bell, MessageSquare, Send, X, Download, Trash2 } from 'lucide-react';
import { downloadSheetAsExcel } from '../../utils/exportUtils';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { saveSharedSheet } from '../../hooks/useSharedSheets';
import { useSheetRowReminders } from '../../utils/sheetReminders';
import RowReminderModal from '../RowReminderModal';

import { LETTERS, FORMULA_NAMES, DEFAULT_COL_W, DEFAULT_ROW_H, MIN_COL_W, MIN_ROW_H } from './constants';
import { ck, parseRef, displayVal, insertRowInData, deleteRowFromData, insertColInData, deleteColFromData, shiftRowComments } from './formulaEngine';
import { useSharedSheet } from './hooks/useSharedSheet';
import GridCell from './GridCell';
import GridToolbar from './GridToolbar';

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

// ─── Component ────────────────────────────────────────────────────────────────
export default function SpreadsheetGrid({ sheet, onSave, onBack, isShared = false, sharedSheetId = null }) {
  const { id: sheetId, title: initialTitle } = sheet;
  const { user } = useAuth();
  const initCols = Math.max(sheet.cols || 10, 1);
  const initRows = Math.max(sheet.rows || 50, 1);

  // ── Core state ─────────────────────────────────────────────────────────────
  const [title,      setTitle]      = useState(initialTitle || 'Untitled Sheet');
  // Track the last title that was actually persisted to Firestore so we can
  // show a "Save Name" button whenever there is an unsaved title change.
  const [savedTitle, setSavedTitle] = useState(initialTitle || 'Untitled Sheet');
  const [data,       setData]       = useState(() => sheet.data || {});
  const [cols,       setCols]       = useState(initCols);
  const [rows,       setRows]       = useState(initRows);
  const [sel,        setSel]        = useState({ c: 0, r: 0 });
  const [selEnd,     setSelEnd]     = useState(null);
  const [editCell,   setEditCell]   = useState(null);
  const [editVal,    setEditVal]    = useState('');
  const [filters,    setFilters]    = useState({});
  const [showFilter, setShowFilter] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [sortConfig, setSortConfig] = useState(null);
  const [suggIdx,    setSuggIdx]    = useState(0);
  const [dragRow,    setDragRow]    = useState(null);
  const [dragOverRow,setDragOverRow]= useState(null);
  const [dragCol,    setDragCol]    = useState(null);
  const [downloading,  setDownloading]  = useState(false);
  const [contextMenu,  setContextMenu]  = useState(null); // { x, y, row, col }
  const [dragOverCol,setDragOverCol]= useState(null);

  // ── Comments + Reminders state ─────────────────────────────────────────────
  const [rowComments,  setRowComments]  = useState(() => sheet.rowComments || {});
  const [commentRow,   setCommentRow]   = useState(null);   // null = panel closed
  const [newComment,   setNewComment]   = useState('');
  const [savingCmt,    setSavingCmt]    = useState(false);
  const [reminderRow,  setReminderRow]  = useState(null);   // null = modal closed
  const [hoveredRow,   setHoveredRow]   = useState(null);
  const [sheetMemberEmails, setSheetMemberEmails] = useState([]);

  // ── Column / row size state ─────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState(() =>
    Array.from({ length: initCols }, (_, i) => sheet.colWidths?.[i] ?? DEFAULT_COL_W)
  );
  const [rowHeights, setRowHeights] = useState(() =>
    Array.from({ length: initRows }, (_, i) => sheet.rowHeights?.[i] ?? DEFAULT_ROW_H)
  );

  const pendingAuditEventsRef = useRef([]);
  const [membersCount, setMembersCount] = useState(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const gridRef         = useRef(null);
  const inputRef        = useRef(null);
  const fbarRef         = useRef(null);
  const saveTimer       = useRef(null);
  const titleSaveTimer  = useRef(null);
  // Drag-select
  const isDraggingRef   = useRef(false);
  const didDragRef      = useRef(false);
  // Formula pointing
  const formulaDragRef  = useRef(false);
  const formulaAnchor   = useRef(null);
  const formulaInsertPos= useRef(null);
  // Undo / redo
  const undoStack       = useRef([]);
  const redoStack       = useRef([]);
  // Resize
  const resizingRef     = useRef(null); // { type:'col'|'row', idx, startPos, startSize }
  // Mirrors of state for use in closures that can't re-close over state
  const colWidthsRef    = useRef(colWidths);
  const rowHeightsRef   = useRef(rowHeights);
  const rowCommentsRef  = useRef(sheet.rowComments || {});
  // Latest save trigger (always up-to-date with current data/cols/rows/title)
  const triggerSaveRef  = useRef(null);

  // Always-fresh refs for the flush-on-back / flush-on-unmount path.
  const titleRef  = useRef(title);
  const dataRef   = useRef(data);
  const colsRef   = useRef(cols);
  const rowsRef   = useRef(rows);
  const userRef   = useRef(user);

  // Keep refs in sync
  useEffect(() => { colWidthsRef.current  = colWidths;  }, [colWidths]);
  useEffect(() => { rowHeightsRef.current = rowHeights; }, [rowHeights]);
  useEffect(() => { rowCommentsRef.current = rowComments; }, [rowComments]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { dataRef.current  = data;  }, [data]);
  useEffect(() => { colsRef.current  = cols;  }, [cols]);
  useEffect(() => { rowsRef.current  = rows;  }, [rows]);
  useEffect(() => { userRef.current  = user;  }, [user]);

  // Focus cell input when entering edit mode — place cursor at end, not position 0
  useEffect(() => {
    if (editCell) setTimeout(() => {
      const inp = inputRef.current;
      if (!inp) return;
      inp.focus();
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }, 0);
  }, [editCell]);

  // Global mouse event handlers (selection drag + resize)
  useEffect(() => {
    const onMove = (e) => {
      // ── Resize drag ──
      if (resizingRef.current) {
        const { type, idx, startPos, startSize } = resizingRef.current;
        if (type === 'col') {
          const newW = Math.max(MIN_COL_W, startSize + (e.clientX - startPos));
          setColWidths(prev => { const next = [...prev]; next[idx] = newW; return next; });
        } else {
          const newH = Math.max(MIN_ROW_H, startSize + (e.clientY - startPos));
          setRowHeights(prev => { const next = [...prev]; next[idx] = newH; return next; });
        }
        return;
      }
    };

    const onUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        triggerSaveRef.current?.();
      }
      isDraggingRef.current  = false;
      formulaDragRef.current = false;
      formulaAnchor.current  = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  // Real-time shared sheet sync
  const effectiveSharedId = isShared ? sharedSheetId : (sheet?.isShared ? sheet?.sharedSheetId : null);

  useSharedSheet({
    effectiveSharedId,
    isShared,
    sharedSheetId,
    user,
    editCell,
    commentRow,
    setData,
    setTitle,
    setCols,
    setRows,
    setColWidths,
    setRowHeights,
    setRowComments,
    setMembersCount,
    setSheetMemberEmails,
  });

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

  // Formula autocomplete
  const formulaSuggestions = useMemo(() => {
    if (!editCell || !editVal.startsWith('=')) return [];
    const m = editVal.match(/(?:^=|[+\-*/,(])([A-Za-z]{2,})$/);
    if (!m) return [];
    const partial = m[1].toUpperCase();
    return FORMULA_NAMES.filter(f => f.startsWith(partial) && f.length > partial.length);
  }, [editCell, editVal]);

  useEffect(() => { setSuggIdx(0); }, [formulaSuggestions]);

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
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      const updates = {
        title: nt, data: nd, cols: nc, rows: nr,
        colWidths:   colWidthsRef.current,
        rowHeights:  rowHeightsRef.current,
        rowComments: rowCommentsRef.current,
      };
      try {
        if (isShared && sharedSheetId && user) {
          const events = [...pendingAuditEventsRef.current];
          pendingAuditEventsRef.current = [];
          await saveSharedSheet(sharedSheetId, updates, user, events);
        } else {
          await onSave(sheetId, updates);
          if (sheet?.isShared && sheet?.sharedSheetId && user) {
            saveSharedSheet(sheet.sharedSheetId, updates, user, []).catch(() => {});
          }
        }
        setSaveStatus('saved');
        setSavedTitle(nt);
      } catch {
        setSaveStatus('unsaved');
      }
    }, 500);
  }, [sheetId, onSave, isShared, sharedSheetId, user]);

  // On unmount: flush any pending debounced save immediately
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const updates = {
        title:       titleRef.current,
        data:        dataRef.current,
        cols:        colsRef.current,
        rows:        rowsRef.current,
        colWidths:   colWidthsRef.current,
        rowHeights:  rowHeightsRef.current,
        rowComments: rowCommentsRef.current,
      };
      if (isShared && sharedSheetId) {
        saveSharedSheet(sharedSheetId, updates, userRef.current, []).catch(() => {});
      } else {
        onSave(sheetId, updates).catch(() => {});
        if (sheet?.isShared && sheet?.sharedSheetId && userRef.current) {
          saveSharedSheet(sheet.sharedSheetId, updates, userRef.current, []).catch(() => {});
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps intentional — reads latest values via refs

  // Keep triggerSaveRef always fresh
  triggerSaveRef.current = () => scheduleSave(data, cols, rows, title);

  // ── Row comments ──────────────────────────────────────────────────────────
  const saveRowComment = useCallback(() => {
    if (!newComment.trim() || !user) return;
    setSavingCmt(true);
    const comment = {
      text:        newComment.trim(),
      authorEmail: user.email,
      authorName:  user.displayName || user.email,
      ts:          new Date().toISOString(),
    };
    setRowComments(prev => {
      const next = { ...prev, [commentRow]: [...(prev[commentRow] || []), comment] };
      rowCommentsRef.current = next;
      scheduleSave(data, cols, rows, title);
      return next;
    });
    setNewComment('');
    setSavingCmt(false);
  }, [newComment, user, commentRow, data, cols, rows, title, scheduleSave]);

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const setDataWithHistory = useCallback((updaterOrValue) => {
    setData(prev => {
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue;
      if (next !== prev) {
        undoStack.current = [...undoStack.current.slice(-29), prev];
        redoStack.current = [];
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const previous = undoStack.current.pop();
    setData(cur => { redoStack.current = [...redoStack.current, cur]; return previous; });
    scheduleSave(previous, cols, rows, title);
  }, [cols, rows, title, scheduleSave]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    setData(cur => { undoStack.current = [...undoStack.current, cur]; return next; });
    scheduleSave(next, cols, rows, title);
  }, [cols, rows, title, scheduleSave]);

  // ── Row / column insert + delete ──────────────────────────────────────────
  const handleInsertRow = useCallback((at) => {
    setDataWithHistory(prev => insertRowInData(prev, at));
    setRowComments(prev => shiftRowComments(prev, at, 'insert'));
    setRowHeights(prev => { const next = [...prev]; next.splice(at, 0, DEFAULT_ROW_H); return next; });
    setRows(r => r + 1);
    setSel(s => ({ ...s, r: s.r >= at ? s.r + 1 : s.r }));
    setSelEnd(null);
    setTimeout(() => triggerSaveRef.current?.(), 0);
  }, [setDataWithHistory]);

  const handleDeleteRow = useCallback((at) => {
    setDataWithHistory(prev => deleteRowFromData(prev, at));
    setRowComments(prev => shiftRowComments(prev, at, 'delete'));
    setRowHeights(prev => { const next = [...prev]; next.splice(at, 1); return next; });
    setRows(r => Math.max(1, r - 1));
    setSel(s => ({ ...s, r: Math.max(0, s.r > at ? s.r - 1 : s.r) }));
    setSelEnd(null);
    setTimeout(() => triggerSaveRef.current?.(), 0);
  }, [setDataWithHistory]);

  const handleInsertCol = useCallback((at) => {
    setDataWithHistory(prev => insertColInData(prev, at));
    setColWidths(prev => { const next = [...prev]; next.splice(at, 0, DEFAULT_COL_W); return next; });
    setCols(c => c + 1);
    setSel(s => ({ ...s, c: s.c >= at ? s.c + 1 : s.c }));
    setSelEnd(null);
    setTimeout(() => triggerSaveRef.current?.(), 0);
  }, [setDataWithHistory]);

  const handleDeleteCol = useCallback((at) => {
    setDataWithHistory(prev => deleteColFromData(prev, at));
    setColWidths(prev => { const next = [...prev]; next.splice(at, 1); return next; });
    setCols(c => Math.max(1, c - 1));
    setSel(s => ({ ...s, c: Math.max(0, s.c > at ? s.c - 1 : s.c) }));
    setSelEnd(null);
    setTimeout(() => triggerSaveRef.current?.(), 0);
  }, [setDataWithHistory]);

  // Close context menu when clicking anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  // ── Cell helpers ───────────────────────────────────────────────────────────
  const updateCell = useCallback((c, r, patch) => {
    setDataWithHistory(prev => {
      const key  = ck(c, r);
      if (isShared && 'v' in patch) {
        const oldVal = prev[key]?.v ?? '';
        if (String(patch.v ?? '') !== String(oldVal)) {
          pendingAuditEventsRef.current.push({
            action: 'cell_edit',
            details: { cell: key, oldValue: String(oldVal), newValue: String(patch.v ?? '') },
          });
        }
      }
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      if (!next[key].v && !next[key].b && !next[key].i && !next[key].bg) delete next[key];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [cols, rows, title, scheduleSave, setDataWithHistory, isShared]);

  const commitEdit = useCallback((c, r, val) => {
    updateCell(c, r, { v: val });
    setEditCell(null); setEditVal('');
    formulaInsertPos.current = null;
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [updateCell]);

  const clearRange = useCallback(() => {
    setDataWithHistory(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++)
        for (let r = selRange.r1; r <= selRange.r2; r++) delete next[ck(c, r)];
      scheduleSave(next, cols, rows, title);
      return next;
    });
  }, [selRange, cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Sort ───────────────────────────────────────────────────────────────────
  const sortByColumn = useCallback((colIdx, dir) => {
    setDataWithHistory(prev => {
      const HEADER  = 1;
      const allRows = Array.from({ length: rows - HEADER }, (_, i) => i + HEADER);
      const vals    = allRows.map(r => displayVal(colIdx, r, prev));

      allRows.sort((a, b) => {
        const va = vals[a - HEADER], vb = vals[b - HEADER];
        if (va === '' && vb === '') return 0;
        if (va === '') return 1;
        if (vb === '') return -1;
        const na = parseFloat(va), nb = parseFloat(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
        return dir === 'asc' ? cmp : -cmp;
      });

      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ref = parseRef(k);
        if (!ref || ref.row < HEADER || ref.row >= rows) next[k] = v;
      });
      allRows.forEach((srcRow, destIdx) => {
        const destRow = destIdx + HEADER;
        for (let c = 0; c < cols; c++) {
          const k = ck(c, srcRow);
          if (prev[k]) next[ck(c, destRow)] = { ...prev[k] };
        }
      });
      scheduleSave(next, cols, rows, title);
      return next;
    });
    setSortConfig({ col: colIdx, dir });
  }, [cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Cut / Copy / Paste ─────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const lines = [];
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      const cells = [];
      for (let c = selRange.c1; c <= selRange.c2; c++) cells.push(displayVal(c, r, data));
      lines.push(cells.join('\t'));
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  }, [selRange, data]);

  const handleCut = useCallback(() => { handleCopy(); clearRange(); }, [handleCopy, clearRange]);

  const handlePaste = useCallback(async () => {
    try {
      const text  = await navigator.clipboard.readText();
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      if (!lines.length) return;
      setDataWithHistory(prev => {
        const next = { ...prev };
        lines.forEach((line, ri) => {
          line.split('\t').forEach((val, ci) => {
            const c = sel.c + ci, r = sel.r + ri;
            if (c < cols && r < rows) {
              const k = ck(c, r);
              next[k] = { ...(next[k] || {}), v: val };
              if (!next[k].v && !next[k].b && !next[k].i && !next[k].bg) delete next[k];
            }
          });
        });
        scheduleSave(next, cols, rows, title);
        return next;
      });
    } catch { /* clipboard permission denied */ }
  }, [sel, cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Format toggle ──────────────────────────────────────────────────────────
  const toggleFmt = useCallback((fmt) => {
    const newVal = !(data[selectedKey] || {})[fmt];
    setDataWithHistory(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        for (let r = selRange.r1; r <= selRange.r2; r++) {
          const k = ck(c, r);
          next[k] = { ...(next[k] || {}), [fmt]: newVal, v: (next[k]?.v ?? '') };
          if (!next[k].v && !next[k].b && !next[k].i && !next[k].bg) delete next[k];
        }
      }
      scheduleSave(next, cols, rows, title);
      return next;
    });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [selectedKey, data, selRange, cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Cell background colour ─────────────────────────────────────────────────
  const setCellBg = useCallback((color) => {
    setDataWithHistory(prev => {
      const next = { ...prev };
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        for (let r = selRange.r1; r <= selRange.r2; r++) {
          const k = ck(c, r);
          const cell = { ...(next[k] || {}), v: (next[k]?.v ?? '') };
          if (color) {
            cell.bg = color;
          } else {
            delete cell.bg;
          }
          if (!cell.v && !cell.b && !cell.i && !cell.bg) {
            delete next[k];
          } else {
            next[k] = cell;
          }
        }
      }
      scheduleSave(next, cols, rows, title);
      return next;
    });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [selRange, cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Add rows / columns ─────────────────────────────────────────────────────
  const addRow = () => {
    const r = rows + 10;
    setRows(r);
    setRowHeights(prev => [...prev, ...Array(10).fill(DEFAULT_ROW_H)]);
    if (isShared) pendingAuditEventsRef.current.push({ action: 'structure_changed', details: { rows: r } });
    scheduleSave(data, cols, r, title);
  };
  const addCol = () => {
    if (cols >= 26) return;
    const c = cols + 1;
    setCols(c);
    setColWidths(prev => [...prev, DEFAULT_COL_W]);
    if (isShared) pendingAuditEventsRef.current.push({ action: 'structure_changed', details: { cols: c } });
    scheduleSave(data, c, rows, title);
  };
  const handleTitleChange = (v) => { setTitle(v); scheduleSave(data, cols, rows, v); };

  // ── Drag-to-reorder rows / cols ────────────────────────────────────────────
  const moveRowInsert = useCallback((fromRow, toRow) => {
    if (fromRow === toRow || fromRow == null || toRow == null) return;
    setDataWithHistory(prev => {
      const minR = Math.min(fromRow, toRow), maxR = Math.max(fromRow, toRow);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => { const ref = parseRef(k); if (!ref || ref.row < minR || ref.row > maxR) next[k] = v; });
      for (let c = 0; c < cols; c++) for (let r = minR; r <= maxR; r++) {
        const sv = prev[ck(c, r)]; if (!sv) continue;
        const dr = r === fromRow ? toRow : fromRow < toRow ? r - 1 : r + 1;
        next[ck(c, dr)] = sv;
      }
      scheduleSave(next, cols, rows, title); return next;
    });
  }, [cols, rows, title, scheduleSave, setDataWithHistory]);

  const moveColInsert = useCallback((fromCol, toCol) => {
    if (fromCol === toCol || fromCol == null || toCol == null) return;
    setDataWithHistory(prev => {
      const minC = Math.min(fromCol, toCol), maxC = Math.max(fromCol, toCol);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => { const ref = parseRef(k); if (!ref || ref.col < minC || ref.col > maxC) next[k] = v; });
      for (let r = 0; r < rows; r++) for (let c = minC; c <= maxC; c++) {
        const sv = prev[ck(c, r)]; if (!sv) continue;
        const dc = c === fromCol ? toCol : fromCol < toCol ? c - 1 : c + 1;
        next[ck(dc, r)] = sv;
      }
      scheduleSave(next, cols, rows, title); return next;
    });
  }, [cols, rows, title, scheduleSave, setDataWithHistory]);

  // ── Formula pointing ───────────────────────────────────────────────────────
  const getFormulaInput = () =>
    [fbarRef.current, inputRef.current].find(el => el === document.activeElement)
    ?? inputRef.current ?? fbarRef.current;

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

  const applySuggestion = useCallback((name) => {
    setEditVal(prev => { const m = prev.match(/^(.*?)([A-Za-z]*)$/); return m ? m[1] + name + '(' : prev + name + '('; });
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

  // ── Grid keydown ───────────────────────────────────────────────────────────
  const onGridKeyDown = useCallback((e) => {
    const { key, shiftKey, ctrlKey, metaKey } = e;
    const mod = ctrlKey || metaKey;

    if (formulaSuggestions.length > 0) {
      if (key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
      if (key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
      if (key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
    }

    if (mod && key === 'z' && !shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (key === 'y' || (key === 'z' && shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && key === 'c') { e.preventDefault(); handleCopy(); return; }
    if (mod && key === 'x') { e.preventDefault(); handleCut(); return; }
    if (mod && key === 'v') { e.preventDefault(); handlePaste(); return; }

    if (editCell) return;

    if      (key === 'ArrowRight') { e.preventDefault(); moveSel(1,  0, shiftKey); }
    else if (key === 'ArrowLeft')  { e.preventDefault(); moveSel(-1, 0, shiftKey); }
    else if (key === 'ArrowDown')  { e.preventDefault(); moveSel(0,  1, shiftKey); }
    else if (key === 'ArrowUp')    { e.preventDefault(); moveSel(0, -1, shiftKey); }
    else if (key === 'Tab')        { e.preventDefault(); moveSel(shiftKey ? -1 : 1, 0); }
    else if (key === 'Enter')      { e.preventDefault(); moveSel(0, shiftKey ? -1 : 1); }
    else if (key === 'F2')         { setEditCell(sel); setEditVal(String(selectedRaw)); }
    else if (key === 'Escape')     { setSelEnd(null); }
    else if (key === 'Delete' || key === 'Backspace') { clearRange(); }
    else if (key.length === 1 && !mod) { setEditCell(sel); setEditVal(key === '=' ? '=' : key); }
  }, [editCell, moveSel, sel, selectedRaw, clearRange, formulaSuggestions, suggIdx,
      applySuggestion, undo, redo, handleCopy, handleCut, handlePaste]);

  // ── Cell input keydown ─────────────────────────────────────────────────────
  const onCellKeyDown = useCallback((e) => {
    e.stopPropagation();

    const { key, shiftKey, ctrlKey, metaKey } = e;
    const mod = ctrlKey || metaKey;

    if (formulaSuggestions.length > 0) {
      if (key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
      if (key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
      if (key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
    }
    if (mod && key === 'z') { e.preventDefault(); undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }

    if (key === 'Escape') {
      setEditCell(null); setEditVal(''); formulaInsertPos.current = null;
      requestAnimationFrame(() => gridRef.current?.focus());
    } else if (key === 'Enter' && e.altKey) {
      e.preventDefault();
      const inp = inputRef.current;
      const start = inp?.selectionStart ?? editVal.length;
      const end   = inp?.selectionEnd   ?? editVal.length;
      const next  = editVal.slice(0, start) + '\n' + editVal.slice(end);
      setEditVal(next);
      formulaInsertPos.current = null;
      setTimeout(() => { inp?.setSelectionRange(start + 1, start + 1); }, 0);
    } else if (key === 'Enter' && !e.altKey) {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: editCell.c, r: clampR(editCell.r + 1) });
    } else if (key === 'Tab') {
      e.preventDefault();
      commitEdit(editCell.c, editCell.r, editVal);
      setSel({ c: clampC(editCell.c + (shiftKey ? -1 : 1)), r: editCell.r });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCell, editVal, commitEdit, cols, rows, formulaSuggestions, suggIdx, applySuggestion, undo, redo]);

  // ── Cell mouse handlers ────────────────────────────────────────────────────
  const handleCellMouseDown = useCallback((e, c, r) => {
    if (e.button !== 0) return;
    if (inFormulaMode && !(editCell.c === c && editCell.r === r)) {
      e.preventDefault();
      formulaDragRef.current  = true;
      formulaAnchor.current   = { c, r };
      formulaInsertPos.current= null;
      upsertFormulaRef({ c, r }, null);
      return;
    }
    if (editCell && editCell.c === c && editCell.r === r) return;

    if (editCell) {
      commitEdit(editCell.c, editCell.r, editVal);
    }
    isDraggingRef.current = true;
    didDragRef.current    = false;
    setSel({ c, r }); setSelEnd(null); setEditCell(null); setEditVal('');
    gridRef.current?.focus();
  }, [inFormulaMode, editCell, editVal, commitEdit, upsertFormulaRef]);

  const handleCellMouseEnter = useCallback((e, c, r) => {
    if (formulaDragRef.current && formulaAnchor.current) {
      upsertFormulaRef(formulaAnchor.current, { c, r });
    }
  }, [upsertFormulaRef]);

  const handleGridMouseMove = useCallback((e) => {
    if (resizingRef.current) return;

    if (!isDraggingRef.current || e.buttons !== 1) {
      if (isDraggingRef.current) isDraggingRef.current = false;
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const td = el.closest ? el.closest('td[data-c]') : null;
    if (!td) return;
    const c = parseInt(td.dataset.c, 10);
    const r = parseInt(td.dataset.r, 10);
    if (isNaN(c) || isNaN(r)) return;
    setSelEnd(prev => {
      if (prev?.c === c && prev?.r === r) return prev;
      didDragRef.current = true;
      return { c, r };
    });
  }, []);

  const handleCellClick = useCallback((e, c, r) => {
    if (didDragRef.current) { didDragRef.current = false; return; }
    if (inFormulaMode && editCell && !(editCell.c === c && editCell.r === r)) return;
    if (editCell && editCell.c === c && editCell.r === r) return;
    if (e.shiftKey && !inFormulaMode) { setSelEnd({ c, r }); return; }
    setSel({ c, r }); setSelEnd(null);
  }, [inFormulaMode, editCell]);

  // ── Resize handle mouse down ───────────────────────────────────────────────
  const onColResizeMouseDown = useCallback((e, colIdx) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      type: 'col',
      idx: colIdx,
      startPos: e.clientX,
      startSize: colWidthsRef.current[colIdx] ?? DEFAULT_COL_W,
    };
  }, []);

  const onRowResizeMouseDown = useCallback((e, rowIdx) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      type: 'row',
      idx: rowIdx,
      startPos: e.clientY,
      startSize: rowHeightsRef.current[rowIdx] ?? DEFAULT_ROW_H,
    };
  }, []);

  // ── Row reminders (real-time active list) ─────────────────────────────────
  const { byRow: activeReminderByRow } = useSheetRowReminders(sharedSheetId || sheetId);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const selCell = data[selectedKey] || {};

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* ── Title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
        <input className="input input-title" value={title} onChange={e => handleTitleChange(e.target.value)}
          style={{ flex: 1, marginBottom: 0, fontSize: 18 }} />
        {title !== savedTitle && (
          <button
            className="btn btn-gold btn-sm"
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={async () => {
              clearTimeout(titleSaveTimer.current);
              try {
                if (isShared && sharedSheetId && user) {
                  await saveSharedSheet(sharedSheetId, { title }, user, []);
                } else {
                  await onSave(sheetId, { title });
                  if (sheet.isShared && sheet.sharedSheetId) {
                    await updateDoc(doc(db, 'sharedSheets', sheet.sharedSheetId), { title });
                  }
                }
                setSavedTitle(title);
              } catch { /* ignore */ }
            }}
          >
            Save Name
          </button>
        )}
        <span style={{ fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
          color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'saving' ? 'var(--ink-lighter)' : '#d97706' }}>
          {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}
        </span>
        {isShared && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', color: '#16a34a',
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
            padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
            ● Live · {membersCount} member{membersCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Toolbar ── */}
      <GridToolbar
        selCell={selCell}
        toggleFmt={toggleFmt}
        setCellBg={setCellBg}
        showFilter={showFilter}
        setShowFilter={setShowFilter}
        setFilters={setFilters}
        cols={cols}
        addRow={addRow}
        addCol={addCol}
        undo={undo}
        redo={redo}
        undoStack={undoStack}
        redoStack={redoStack}
        downloading={downloading}
        setDownloading={setDownloading}
        title={title}
        data={data}
        rows={rows}
        downloadSheetAsExcel={downloadSheetAsExcel}
        sel={sel}
        selEnd={selEnd}
        selRange={selRange}
        selectedRaw={selectedRaw}
        editCell={editCell}
        editVal={editVal}
        setEditVal={setEditVal}
        setEditCell={setEditCell}
        inFormulaMode={inFormulaMode}
        formulaInsertPos={formulaInsertPos}
        formulaSuggestions={formulaSuggestions}
        suggIdx={suggIdx}
        setSuggIdx={setSuggIdx}
        applySuggestion={applySuggestion}
        commitEdit={commitEdit}
        gridRef={gridRef}
        fbarRef={fbarRef}
      />

      {/* Formula pointing indicator */}
      {inFormulaMode && (
        <div style={{ fontSize: 11, color: '#7c3aed', fontFamily: 'var(--font-body)', marginBottom: 6,
          padding: '3px 8px', background: '#f5f3ff', borderRadius: 6, border: '1px solid #ddd6fe' }}>
          📌 Formula mode — click or drag cells to insert references into your formula
        </div>
      )}

      {/* ── Grid ── */}
      <div
        ref={gridRef}
        style={{ flex: 1, overflow: 'auto', border: '1px solid var(--paper-line)', borderRadius: 8, background: '#fff', outline: 'none' }}
        onKeyDown={onGridKeyDown}
        tabIndex={0}
        onMouseMove={handleGridMouseMove}
        onMouseUp={() => { isDraggingRef.current = false; formulaDragRef.current = false; formulaAnchor.current = null; }}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: colWidths.reduce((a, w) => a + w, 0) + 42 }}>
          <colgroup>
            <col style={{ width: 52 }} />
            {/* Comments column */}
            <col style={{ width: 40 }} />
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} style={{ width: colWidths[c] ?? DEFAULT_COL_W }} />
            ))}
          </colgroup>

          {/* ── Column headers ── */}
          <thead>
            <tr>
              <th style={{ ...thStyle(false), width: 52 }}>#</th>
              <th style={{ ...thStyle(false), width: 40, cursor: 'default' }}
                title="Row comments — click 💬 to view/add">
                <MessageSquare size={12} style={{ color: '#0891b2' }} />
              </th>
              {Array.from({ length: cols }, (_, c) => {
                const sorted  = sortConfig?.col === c;
                const hlCol   = selRange.c1 <= c && c <= selRange.c2;
                return (
                  <th key={c}
                    style={{ ...thStyle(hlCol), cursor: 'grab', userSelect: 'none', position: 'relative',
                      background: dragOverCol === c ? '#ddd6fe' : hlCol ? '#ede9fe' : 'var(--paper-dark)' }}
                    draggable
                    onDragStart={() => setDragCol(c)}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(c); }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={e => { e.preventDefault(); moveColInsert(dragCol, c); setDragCol(null); setDragOverCol(null); }}
                    onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                    onClick={() => { setSel({ c, r: 0 }); setSelEnd({ c, r: rows - 1 }); gridRef.current?.focus(); }}
                    onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, row: null, col: c }); }}
                    title="Click to select column · Right-click for column options · Drag to reorder"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <span>{LETTERS[c]}</span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 0, marginLeft: 2 }}>
                        <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); sortByColumn(c, 'asc'); }}
                          title={`Sort ${LETTERS[c]} ascending`}
                          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 1,
                            color: (sorted && sortConfig.dir === 'asc') ? '#7c3aed' : 'var(--ink-lighter)', display: 'flex', alignItems: 'center' }}>
                          <ChevronUp size={10} strokeWidth={3} />
                        </button>
                        <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); sortByColumn(c, 'desc'); }}
                          title={`Sort ${LETTERS[c]} descending`}
                          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 1,
                            color: (sorted && sortConfig.dir === 'desc') ? '#7c3aed' : 'var(--ink-lighter)', display: 'flex', alignItems: 'center' }}>
                          <ChevronDown size={10} strokeWidth={3} />
                        </button>
                      </span>
                    </div>
                    {/* Column resize handle */}
                    <div
                      style={{ position: 'absolute', top: 0, right: 0, width: 5, height: '100%',
                        cursor: 'col-resize', zIndex: 10, background: 'transparent' }}
                      onMouseDown={e => onColResizeMouseDown(e, c)}
                      title="Drag to resize column"
                    />
                  </th>
                );
              })}
            </tr>

            {showFilter && (
              <tr>
                <td style={thStyle()} />
                <td style={thStyle()} />
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} style={{ ...thStyle(), padding: '2px 4px' }}>
                    <input value={filters[c] || ''} onChange={e => setFilters(prev => ({ ...prev, [c]: e.target.value }))}
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
              <tr key={r}
                style={{ height: rowHeights[r] ?? DEFAULT_ROW_H }}
                onMouseEnter={() => setHoveredRow(r)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* Row number — draggable + resizable + bell icon */}
                <td
                  style={{ ...tdStyle(false, false), cursor: 'grab', position: 'relative',
                    background: dragOverRow === r ? '#ddd6fe' : (selRange.r1 <= r && r <= selRange.r2) ? '#ede9fe' : 'var(--paper-dark)',
                    color: 'var(--ink-lighter)', fontSize: 11, textAlign: 'center', userSelect: 'none',
                    padding: '0 2px', height: rowHeights[r] ?? DEFAULT_ROW_H, width: 52 }}
                  draggable
                  onDragStart={() => setDragRow(r)}
                  onDragOver={e => { e.preventDefault(); setDragOverRow(r); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => { e.preventDefault(); moveRowInsert(dragRow, r); setDragRow(null); setDragOverRow(null); }}
                  onDragEnd={() => { setDragRow(null); setDragOverRow(null); }}
                  onClick={() => { setSel({ c: 0, r }); setSelEnd({ c: cols - 1, r }); gridRef.current?.focus(); }}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, row: r, col: null }); }}
                  title="Click to select row · Right-click for row options · Drag to reorder"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' }}>
                    <span>{r + 1}</span>
                    {(hoveredRow === r || activeReminderByRow[r]) && (
                      <button
                        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                        onClick={e => { e.stopPropagation(); setReminderRow(r); }}
                        title={activeReminderByRow[r] ? 'Reminder active — click to stop' : 'Set daily reminder for this row'}
                        style={{ padding: 1, border: 'none', background: 'none', cursor: 'pointer',
                          color: activeReminderByRow[r] ? '#f59e0b' : 'var(--ink-lighter)',
                          display: 'flex', alignItems: 'center', lineHeight: 1 }}
                      >
                        {activeReminderByRow[r]
                          ? <Bell size={10} fill="#f59e0b" stroke="#f59e0b" />
                          : <Bell size={10} />}
                      </button>
                    )}
                  </div>
                  {/* Row resize handle */}
                  <div
                    style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 5,
                      cursor: 'row-resize', zIndex: 10, background: 'transparent' }}
                    onMouseDown={e => onRowResizeMouseDown(e, r)}
                    title="Drag to resize row"
                  />
                </td>

                {/* ── Comments cell ── */}
                {(() => {
                  const cmts = rowComments[r] || [];
                  const hasComments = cmts.length > 0;
                  const isOpen = commentRow === r;
                  return (
                    <td
                      style={{ border: '1px solid var(--paper-line)', width: 40, padding: 0,
                        background: isOpen ? '#e0f2fe' : hasComments ? '#f0f9ff' : 'transparent',
                        textAlign: 'center', verticalAlign: 'middle', cursor: 'pointer',
                        position: 'relative' }}
                      onClick={e => { e.stopPropagation(); setCommentRow(r === commentRow ? null : r); }}
                      title={hasComments ? `${cmts.length} comment${cmts.length > 1 ? 's' : ''} — click to view` : 'Add comment'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, padding: '0 2px' }}>
                        <MessageSquare size={12} style={{ color: hasComments ? '#0891b2' : '#cbd5e1', flexShrink: 0 }} />
                        {hasComments && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#0891b2' }}>{cmts.length}</span>
                        )}
                      </div>
                    </td>
                  );
                })()}

                {/* ── Data cells ── */}
                {Array.from({ length: cols }, (_, c) => (
                  <GridCell
                    key={c}
                    c={c}
                    r={r}
                    data={data}
                    rowHeights={rowHeights}
                    sel={sel}
                    selEnd={selEnd}
                    selRange={selRange}
                    isInRange={isInRange}
                    editCell={editCell}
                    editVal={editVal}
                    setEditVal={setEditVal}
                    inFormulaMode={inFormulaMode}
                    formulaInsertPos={formulaInsertPos}
                    formulaDragRef={formulaDragRef}
                    inputRef={inputRef}
                    commitEdit={commitEdit}
                    onCellKeyDown={onCellKeyDown}
                    handleCellMouseDown={handleCellMouseDown}
                    handleCellMouseEnter={handleCellMouseEnter}
                    handleCellClick={handleCellClick}
                    setContextMenu={setContextMenu}
                    setSel={setSel}
                    setSelEnd={setSelEnd}
                    setEditCell={setEditCell}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Right-click context menu ── */}
      {contextMenu && (() => {
        const { x, y, row, col } = contextMenu;
        const menuW = 220;
        const menuH = (row !== null ? 3 : 0) * 36 + (col !== null ? 3 : 0) * 36 + (row !== null && col !== null ? 9 : 0) + 16;
        const left = Math.min(x, window.innerWidth  - menuW - 8);
        const top  = Math.min(y, window.innerHeight - menuH - 8);
        const sep  = { height: 1, background: '#e2e8f0', margin: '4px 0' };
        const item = (label, icon, onClick, danger) => (
          <div
            key={label}
            onMouseDown={e => { e.stopPropagation(); onClick(); setContextMenu(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', cursor: 'pointer', fontSize: 13,
              color: danger ? '#dc2626' : '#0f172a', borderRadius: 6, margin: '0 4px',
              fontFamily: 'var(--font-body)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = danger ? '#fef2f2' : '#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {icon}
            <span>{label}</span>
          </div>
        );
        return (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', left, top, zIndex: 9999,
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
              minWidth: menuW, padding: '6px 0', userSelect: 'none',
            }}
          >
            {row !== null && <>
              {item('Insert Row Above', <Plus size={14} color="#7c3aed" />, () => handleInsertRow(row))}
              {item('Insert Row Below', <Plus size={14} color="#7c3aed" />, () => handleInsertRow(row + 1))}
              {item('Delete Row', <Trash2 size={14} />, () => handleDeleteRow(row), true)}
            </>}
            {row !== null && col !== null && <div style={sep} />}
            {col !== null && <>
              {item('Insert Column Left',  <Plus size={14} color="#0891b2" />, () => handleInsertCol(col))}
              {item('Insert Column Right', <Plus size={14} color="#0891b2" />, () => handleInsertCol(col + 1))}
              {item('Delete Column', <Trash2 size={14} />, () => handleDeleteCol(col), true)}
            </>}
          </div>
        );
      })()}

      {/* ── Comments side panel ── */}
      {commentRow !== null && (
        <div style={{
          position: 'fixed', right: 0, top: 0, bottom: 0, width: 320, zIndex: 400,
          background: '#fff', borderLeft: '1px solid var(--paper-line)',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
            borderBottom: '1px solid var(--paper-line)', flexShrink: 0 }}>
            <MessageSquare size={15} style={{ color: '#0891b2' }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', flex: 1 }}>
              Row {commentRow + 1} Comments
            </span>
            <button className="btn-icon" onClick={() => setCommentRow(null)}><X size={15} /></button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {(rowComments[commentRow] || []).length === 0 ? (
              <p style={{ color: 'var(--ink-lighter)', fontSize: 13, fontStyle: 'italic' }}>
                No comments yet. Add the first one below.
              </p>
            ) : (
              [...(rowComments[commentRow] || [])].reverse().map((cmt, i) => (
                <div key={i} style={{ marginBottom: 14, paddingBottom: 14,
                  borderBottom: '1px solid var(--paper-line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e0f2fe',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, color: '#0891b2', flexShrink: 0 }}>
                      {(cmt.authorName || cmt.authorEmail || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                        {cmt.authorName || cmt.authorEmail}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-lighter)' }}>
                        {cmt.ts ? new Date(cmt.ts).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: '0 0 0 36px', fontSize: 13, color: 'var(--ink)',
                    lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {cmt.text}
                  </p>
                </div>
              ))
            )}
          </div>

          <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--paper-line)' }}>
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveRowComment(); }
              }}
              placeholder="Add a comment… (Enter to send, Shift+Enter for new line)"
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none', padding: '8px 10px',
                fontSize: 13, fontFamily: 'var(--font-body)', border: '1px solid var(--paper-line)',
                borderRadius: 8, outline: 'none', marginBottom: 8 }}
            />
            <button
              className="btn btn-gold btn-sm"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={saveRowComment}
              disabled={savingCmt || !newComment.trim()}
            >
              <Send size={13} /> {savingCmt ? 'Saving…' : 'Add Comment'}
            </button>
          </div>
        </div>
      )}

      {/* ── Hint bar ── */}
      <p style={{ fontSize: 11, color: 'var(--ink-lighter)', marginTop: 6, fontFamily: 'var(--font-body)' }}>
        Click+drag to select · Opt+Enter for new line in cell · 💬 to comment on a row · 🔔 to set daily reminder · Ctrl+C/X/V · Ctrl+Z/Y
      </p>

      {/* ── Row Reminder Modal ── */}
      {reminderRow !== null && (() => {
        const rd = {};
        LETTERS.slice(0, cols).forEach(letter => {
          const colIdx = LETTERS.indexOf(letter);
          const dv = displayVal(colIdx, reminderRow, data);
          if (dv !== '') rd[letter] = dv;
        });
        const hd = {};
        LETTERS.slice(0, cols).forEach(letter => {
          const colIdx = LETTERS.indexOf(letter);
          const hv = displayVal(colIdx, 0, data);
          if (hv !== '') hd[letter] = hv;
        });
        return (
          <RowReminderModal
            rowIndex={reminderRow}
            rowData={rd}
            cols={cols}
            sheetId={sheetId}
            sharedSheetId={sharedSheetId}
            sheetTitle={title}
            memberEmails={sheetMemberEmails.length > 0 ? sheetMemberEmails : (user?.email ? [user.email] : [])}
            currentUser={user}
            existingReminder={activeReminderByRow[reminderRow] || null}
            onClose={() => setReminderRow(null)}
            showToast={null}
            rowCommentsData={rowComments[reminderRow] || []}
            headerData={hd}
          />
        );
      })()}
    </div>
  );
}
