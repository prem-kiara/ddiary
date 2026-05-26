import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import EditorToolbar from './EditorToolbar';
import DiaryHistoryModal from '../DiaryHistoryModal';
import { useAutosave } from './hooks/useAutosave';
import { useEditorSync } from './hooks/useEditorSync';
import { useUndoStack } from './hooks/useUndoStack';
import { saveSnapshot } from '../../utils/diaryHistory';
import { HIGHLIGHT_COLORS, TD_STYLE } from './constants';
import { getIndentLevel, setIndentLevel, isAtBlockStart, placeCursorAtEnd } from './utils/cursorUtils';
import { getCurrentCell, selectCell, equalizeColumns } from './utils/tableUtils';
import { detectListPrefix, fixNumberedListsInDOM, normalizeBareTextNodes, legacyTextToHtml } from './utils/listUtils';
import { register as registerUnsaved, unregister as unregisterUnsaved } from '../../utils/unsavedState';

// ── Component ─────────────────────────────────────────────────────────────────
export default function DiaryEditor({ editingEntry, onSave, onCancel, showToast }) {
  const [title,         setTitle]         = useState('');
  const [saving,        setSaving]        = useState(false);
  const [draftStatus,   setDraftStatus]   = useState('idle'); // 'idle'|'saving'|'saved'|'restored'
  const [isEmpty,       setIsEmpty]       = useState(true);
  // Table right-click context menu: { x, y, cell, table } | null
  const [tableMenu,     setTableMenu]     = useState(null);
  // List right-click context menu: { x, y, block, hasRestart } | null
  const [listMenu,      setListMenu]      = useState(null);
  // Row / Col background-color picker open in toolbar: null | 'row' | 'col'
  const [cellBgPicker,  setCellBgPicker]  = useState(null);
  // Version history modal
  const [showHistory,   setShowHistory]   = useState(false);

  const editorRef         = useRef(null);
  const titleRef          = useRef('');
  const entryIdRef        = useRef(editingEntry?.id || 'new');
  const editorWrapRef     = useRef(null);   // wrapper for cursor-style changes
  const resizeDragRef     = useRef(null);   // active resize drag state
  const hoverResizeRef    = useRef(null);   // current hover: {type:'col'|'row', cell}
  // Table drag-move — fully imperative (no React state) to prevent flicker
  const tableDragRef      = useRef(null);   // {table, insertBefore: Element|null}
  const hoveredTableRef   = useRef(null);   // which table the handle is shown for
  const dragHandleElRef   = useRef(null);   // the handle DOM node (created imperatively)
  const dropLineElRef     = useRef(null);   // the drop-line DOM node (created imperatively)
  const prevBlockCountRef  = useRef(0);     // tracks child count to detect structural changes
  const isSharedEntryRef   = useRef(!!(editingEntry?.isShared || editingEntry?.isSharedWithMe)); // true when editing a shared diary
  const lastLocalEditRef   = useRef(0);     // timestamp of last local keystroke
  const pendingFirstSnapRef = useRef(true); // skip the initial onSnapshot fire

  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => { titleRef.current = title; }, [title]);

  // ── Unsaved-work registration ─────────────────────────────────────────────
  // While a pending autosave is in flight (draftStatus==='saving'), tell the
  // tab coordinator this tab has unsaved work so it won't hand off a deep link
  // to us in that window.  The effect cleanup (which runs whenever draftStatus
  // changes AND on unmount) handles unregistration — no need to call
  // unregisterUnsaved in the effect body as well.
  useEffect(() => {
    if (draftStatus === 'saving') {
      registerUnsaved('diary-editor');
    }
    return () => unregisterUnsaved('diary-editor');
  }, [draftStatus]);

  // ── Autosave hook ────────────────────────────────────────────────────────
  const { scheduleAutosave, autoSaveTimerRef, liveShareTimerRef, skipFirstSaveRef } = useAutosave({
    editorRef,
    titleRef,
    entryIdRef,
    isSharedEntryRef,
    userRef,
    lastLocalEditRef,
    setDraftStatus,
  });

  // ── Custom undo/redo stack (owns Ctrl+Z / Ctrl+Y — replaces browser undo) ──
  // The editor mixes execCommand with direct DOM mutations, so browser undo
  // partially reverts changes and leaves corrupted state.  We own the full stack.
  const { pushUndo, undo, redo, handleUndoKey, onBeforeInput } = useUndoStack({ editorRef, scheduleAutosave });

  // ── Real-time shared-diary sync (receive changes from collaborators) ──────
  const { remoteUpdateInfo } = useEditorSync({
    entryId: editingEntry?.id,
    // Pass isShared as a boolean derived from props so the effect re-runs
    // if the entry is converted from personal to shared mid-session.
    isShared: !!(editingEntry?.isShared || editingEntry?.isSharedWithMe),
    isSharedEntryRef,
    pendingFirstSnapRef,
    lastLocalEditRef,
    titleRef,
    editorRef,
    prevBlockCountRef,
    setTitle,
    setIsEmpty,
  });

  // ── Create drag handle + drop-line DOM nodes imperatively ─────────────────
  // Using React state for these causes flicker: there is always a gap between
  // setState() and React actually committing the new DOM, during which the ref
  // is null and the guard check fails.  Imperative nodes have zero re-render lag.
  useEffect(() => {
    const wrap = editorWrapRef.current;
    if (!wrap) return;

    // Drag handle — positioned inside the table's top-left corner (no gap = no flicker)
    const handle = document.createElement('div');
    handle.title = 'Drag to move table';
    handle.textContent = '⠿';
    Object.assign(handle.style, {
      position: 'absolute', display: 'none', zIndex: '100',
      cursor: 'grab', background: '#7c3aed', color: '#fff',
      borderRadius: '3px', width: '20px', height: '18px',
      alignItems: 'center', justifyContent: 'center',
      fontSize: '12px', userSelect: 'none', lineHeight: '1',
      pointerEvents: 'all', opacity: '0.85',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    });
    wrap.appendChild(handle);
    dragHandleElRef.current = handle;

    // Drop indicator (horizontal purple line)
    const dropLine = document.createElement('div');
    Object.assign(dropLine.style, {
      position: 'absolute', display: 'none', left: '0', right: '0',
      height: '3px', background: '#7c3aed', borderRadius: '2px',
      pointerEvents: 'none', zIndex: '20',
    });
    wrap.appendChild(dropLine);
    dropLineElRef.current = dropLine;

    const onHandleMouseDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const table = hoveredTableRef.current;
      if (!table) return;
      tableDragRef.current    = { table, insertBefore: null };
      handle.style.display    = 'none';
      document.body.style.cursor = 'grabbing';
    };
    handle.addEventListener('mousedown', onHandleMouseDown);

    return () => {
      handle.removeEventListener('mousedown', onHandleMouseDown);
      handle.remove();
      dropLine.remove();
      dragHandleElRef.current = null;
      dropLineElRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load entry + restore draft ──────────────────────────────────────────────
  useEffect(() => {
    const entryId = editingEntry?.id || 'new';
    entryIdRef.current          = entryId;
    skipFirstSaveRef.current    = true;
    isSharedEntryRef.current    = !!(editingEntry?.isShared || editingEntry?.isSharedWithMe);
    pendingFirstSnapRef.current = true;
    lastLocalEditRef.current    = Date.now();

    const rawContent = editingEntry?.content || '';
    const ttl        = editingEntry?.title   || '';
    const html       = legacyTextToHtml(rawContent) || '<p><br></p>';

    // Helper: apply content + title to the editor
    const applyToEditor = (content, titleStr, status) => {
      setTitle(titleStr);
      titleRef.current = titleStr;
      if (editorRef.current) {
        editorRef.current.innerHTML = content;
        prevBlockCountRef.current = editorRef.current.childElementCount;
      }
      setIsEmpty(!content.replace(/<[^>]+>/g, '').trim());
      setDraftStatus(status);
    };

    // Helper: check localStorage draft and apply if newer than the given timestamp
    const tryLocalDraft = (fallbackContent, fallbackTitle, fallbackTs) => {
      try {
        const key  = `ddiary_draft_${entryId}`;
        const raw  = localStorage.getItem(key);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.savedAt > fallbackTs) {
            applyToEditor(draft.content || fallbackContent, draft.title ?? fallbackTitle, 'restored');
            return true;
          }
        }
      } catch { /* localStorage unavailable */ }
      return false;
    };

    // For shared entries: sharedDiaries is the canonical source — collaborators write
    // there directly and the personal entry may lag behind. Fetch it now so the editor
    // always opens with the latest version regardless of personal-entry sync state.
    if (isSharedEntryRef.current && entryId && entryId !== 'new') {
      getDoc(doc(db, 'sharedDiaries', entryId))
        .then(snap => {
          if (snap.exists()) {
            const d            = snap.data();
            const sharedContent = d.content || html;
            const sharedTitle   = d.title   || ttl;
            const sharedTs      = d.updatedAt?.seconds
              ? d.updatedAt.seconds * 1000
              : (d.updatedAt?.toMillis?.() ?? 0);

            // localStorage draft wins only if it is newer than sharedDiaries
            if (!tryLocalDraft(sharedContent, sharedTitle, sharedTs)) {
              applyToEditor(sharedContent, sharedTitle, 'idle');
            }
          } else {
            // sharedDiaries doc missing — fall back to personal entry
            const ut = editingEntry?.updatedAt;
            const personalTs = ut ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime()) : 0;
            if (!tryLocalDraft(html, ttl, personalTs)) {
              applyToEditor(html, ttl, 'idle');
            }
          }
        })
        .catch(() => {
          // Network/permission error — fall back to personal entry content
          const ut = editingEntry?.updatedAt;
          const personalTs = ut ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime()) : 0;
          if (!tryLocalDraft(html, ttl, personalTs)) {
            applyToEditor(html, ttl, 'idle');
          }
        });
      return; // async path handles the rest
    }

    // Non-shared entry: check localStorage draft then fall back to personal entry
    const ut       = editingEntry?.updatedAt;
    const personalTs = ut ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime()) : 0;
    if (!tryLocalDraft(html, ttl, personalTs)) {
      applyToEditor(html, ttl, 'idle');
    }
  }, [editingEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearTimeout(autoSaveTimerRef.current);
    clearTimeout(liveShareTimerRef.current);
  }, [autoSaveTimerRef, liveShareTimerRef]);

  // ── Save to server ────────────────────────────────────────────────────────
  const handleSave = async () => {
    const html     = editorRef.current?.innerHTML || '';
    const emptyHtml = !html || !html.replace(/<[^>]+>/g, '').trim();
    if (!title.trim() && emptyHtml) {
      showToast('Please add a title or some content.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), content: html });
      try { localStorage.removeItem(`ddiary_draft_${entryIdRef.current}`); } catch {}
      setDraftStatus('idle');
      showToast('Entry saved!', 'success');

      // Take a version snapshot on every manual save (personal + shared)
      if (entryIdRef.current && entryIdRef.current !== 'new') {
        saveSnapshot({
          uid:      user?.uid,
          entryId:  entryIdRef.current,
          isShared: isSharedEntryRef.current,
          title:    title.trim(),
          content:  html,
          savedBy:  user?.displayName || user?.email || '',
          type:     'manual',
        }).catch(() => {}); // best-effort — never block the save flow
      }
    } catch {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

  // ── Version history restore ───────────────────────────────────────────────
  const handleHistoryRestore = useCallback((content, restoredTitle) => {
    pushUndo(); // snapshot current state first so Ctrl+Z can undo the restore
    if (editorRef.current) {
      editorRef.current.innerHTML = content;
      fixNumberedListsInDOM(editorRef.current);
      setIsEmpty(!content.replace(/<[^>]+>/g, '').trim());
    }
    if (restoredTitle) {
      setTitle(restoredTitle);
      titleRef.current = restoredTitle;
    }
    scheduleAutosave();
    showToast('Version restored — click Save Entry to confirm.', 'success');
  }, [pushUndo, scheduleAutosave, showToast]);

  // ── Editor input ──────────────────────────────────────────────────────────
  // fixNumberedListsInDOM is NOT called on every keystroke because rewriting
  // text nodes mid-keystroke races with the browser's selection state and
  // causes the cursor to jump to position 0 on numbered lines.
  // HOWEVER: when the block count changes (a whole block was added/removed via
  // native browser delete, select+Backspace, etc.) we renumber via rAF — the
  // cursor is already placed by that point so the race doesn't apply.
  const handleEditorInput = useCallback((e) => {
    const text = editorRef.current?.textContent?.trim() || '';
    setIsEmpty(!text);
    scheduleAutosave();
    prevBlockCountRef.current = editorRef.current?.childElementCount ?? 0;
    // Always renumber — fixNumberedListsInDOM saves/restores the cursor
    // internally so running on every keystroke is safe and ensures the list
    // stays consistent no matter how content was changed (typing, paste,
    // select+delete, drag-drop, etc.).
    requestAnimationFrame(() => fixNumberedListsInDOM(editorRef.current));
  }, [scheduleAutosave]);

  // ── Set defaultParagraphSeparator once on mount ───────────────────────────
  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, []);

  // Helper: walk up to the direct child of editorRef
  const getBlock = useCallback((node) => {
    let n = node;
    while (n && n.parentNode !== editorRef.current) {
      n = n.parentNode;
    }
    return (n && n !== editorRef.current) ? n : null;
  }, []);

  // ── Formatting (Bold / Italic / Underline / Strikethrough) ───────────────
  const handleFormat = useCallback((cmd) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, null);
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── Highlight with one of 5 colours (or clear) ───────────────────────────
  const handleHighlight = useCallback((color) => {
    editorRef.current?.focus();
    // hiliteColor is the standard; backColor is IE-compat fallback
    const ok = document.execCommand('hiliteColor', false, color);
    if (!ok) document.execCommand('backColor', false, color);
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── Apply background colour to every cell in the current row or column ─────
  const handleCellBgColor = useCallback((scope, color, cell) => {
    // `cell` may be passed directly (from context menu) or resolved from selection
    const target = cell || (() => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return null;
      return getCurrentCell(sel.getRangeAt(0).startContainer, editorRef.current);
    })();
    if (!target) return;
    const bg = color === 'transparent' ? '' : color;
    if (scope === 'row') {
      const row = target.closest('tr');
      if (row) Array.from(row.children).forEach(td => { td.style.backgroundColor = bg; });
    } else {
      const table = target.closest('table');
      const colIdx = Array.from(target.parentElement.children).indexOf(target);
      if (table) Array.from(table.querySelectorAll('tr')).forEach(row => {
        if (row.children[colIdx]) row.children[colIdx].style.backgroundColor = bg;
      });
    }
    setCellBgPicker(null);
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── Toggle numbered / bullet list on the current paragraph ───────────────
  const toggleList = useCallback((type) => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const block = getBlock(sel.getRangeAt(0).startContainer);
    if (!block) return;

    const existing = detectListPrefix(block.textContent);

    if (existing && existing.type === type) {
      // Remove prefix
      const walker   = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      const firstTxt = walker.nextNode();
      if (firstTxt) {
        firstTxt.nodeValue = firstTxt.nodeValue.replace(existing.prefix, '');
      }
    } else {
      // Strip any existing prefix
      if (existing) {
        const walker   = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
        const firstTxt = walker.nextNode();
        if (firstTxt) {
          firstTxt.nodeValue = firstTxt.nodeValue.replace(existing.prefix, '');
        }
      }

      let newPrefix = '- ';
      if (type === 'numbered') {
        const prev     = block.previousElementSibling;
        const prevList = prev ? detectListPrefix(prev.textContent) : null;
        const startNum = (prevList?.type === 'numbered') ? prevList.num + 1 : 1;
        newPrefix = `${startNum}. `;
      }

      const walker   = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      const firstTxt = walker.nextNode();
      if (firstTxt) {
        firstTxt.nodeValue = newPrefix + firstTxt.nodeValue;
      } else {
        block.textContent = newPrefix;
        placeCursorAtEnd(block, sel);
      }
    }

    requestAnimationFrame(() => fixNumberedListsInDOM(editorRef.current));
    scheduleAutosave();
  }, [getBlock, scheduleAutosave]);

  // ── Indent / outdent a block ──────────────────────────────────────────────
  const handleIndent = useCallback((increase) => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const block = getBlock(sel.getRangeAt(0).startContainer);
    if (!block) return;
    const level = getIndentLevel(block);
    setIndentLevel(block, increase ? level + 1 : level - 1);
    fixNumberedListsInDOM(editorRef.current);
    // Reposition cursor at end of block so typing always follows the prefix
    placeCursorAtEnd(block, window.getSelection());
    scheduleAutosave();
  }, [getBlock, scheduleAutosave]);

  // ── Insert a 3×2 table at the cursor position ────────────────────────────
  const handleInsertTable = useCallback(() => {
    pushUndo();
    editorRef.current?.focus();
    const tr = (cols) =>
      `<tr>${Array.from({ length: cols }, () =>
        `<td style="${TD_STYLE}"><br></td>`
      ).join('')}</tr>`;
    const tableHtml =
      `<table style="border-collapse:collapse;width:100%;margin:8px 0">` +
        `<tbody>${tr(3)}${tr(3)}</tbody>` +
      `</table><p><br></p>`;
    document.execCommand('insertHTML', false, tableHtml);
    scheduleAutosave();
  }, [pushUndo, scheduleAutosave]);

  // ── Table column / row resize ────────────────────────────────────────────
  // Detects hover within 6px of a cell's right edge (col resize) or bottom
  // edge (row resize) and changes the wrapper cursor accordingly.
  const handleEditorWrapMouseMove = useCallback((e) => {
    if (resizeDragRef.current) return; // resize drag handled by document listener
    if (tableDragRef.current) return;  // table drag handled by document listener

    // If the event originates from the drag handle itself, leave it alone
    if (dragHandleElRef.current && dragHandleElRef.current.contains(e.target)) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);

    // ── Resize border detection ──────────────────────────────────────────────
    const cell = el?.closest?.('td, th');
    if (cell && editorRef.current?.contains(cell)) {
      const rect = cell.getBoundingClientRect();
      const T = 6;
      if (e.clientX >= rect.right - T) {
        hoverResizeRef.current = { type: 'col', cell };
        editorWrapRef.current.style.cursor = 'col-resize';
        // Hide drag handle while near resize border
        if (dragHandleElRef.current) dragHandleElRef.current.style.display = 'none';
        return;
      } else if (e.clientY >= rect.bottom - T) {
        hoverResizeRef.current = { type: 'row', cell };
        editorWrapRef.current.style.cursor = 'row-resize';
        if (dragHandleElRef.current) dragHandleElRef.current.style.display = 'none';
        return;
      }
    }
    if (hoverResizeRef.current) {
      hoverResizeRef.current = null;
      editorWrapRef.current.style.cursor = '';
    }

    // ── Table drag handle ────────────────────────────────────────────────────
    const table = el?.closest?.('table');
    const handle = dragHandleElRef.current;
    if (table && editorRef.current?.contains(table) && handle) {
      const tRect = table.getBoundingClientRect();
      const wRect = editorWrapRef.current.getBoundingClientRect();
      hoveredTableRef.current      = table;
      // Position the handle INSIDE the table at the top-left corner (no gap
      // between handle and table, so the mouse never crosses empty space when
      // moving from table to handle — that gap was the cause of the flicker).
      handle.style.top             = `${tRect.top  - wRect.top  + 2}px`;
      handle.style.left            = `${tRect.left - wRect.left + 2}px`;
      handle.style.display         = 'flex';
    } else if (handle) {
      handle.style.display         = 'none';
      hoveredTableRef.current      = null;
    }
  }, []);

  // Starts a drag when the mouse is pressed on a resize border.
  const handleEditorWrapMouseDown = useCallback((e) => {
    if (!hoverResizeRef.current || e.button !== 0) return;
    const { type, cell } = hoverResizeRef.current;
    const table = cell.closest('table');
    if (!table) return;
    e.preventDefault(); // prevent focus/selection disruption in contentEditable
    // Lock the table so resizing one column doesn't affect others:
    //  1. Read ALL pixel widths before touching the layout
    //  2. Switch to table-layout:fixed + width:auto
    //  3. Apply the frozen widths back so nothing visually shifts
    const allRows = Array.from(table.querySelectorAll('tr'));
    const frozenWidths = allRows.map(row =>
      Array.from(row.children).map(c => c.getBoundingClientRect().width)
    );
    table.style.tableLayout = 'fixed';
    table.style.width       = 'auto';
    allRows.forEach((row, ri) =>
      Array.from(row.children).forEach((c, ci) => {
        c.style.minWidth  = '';
        c.style.maxWidth  = '';
        c.style.minHeight = '';
        c.style.width     = `${frozenWidths[ri][ci]}px`;
      })
    );

    if (type === 'col') {
      const colIdx  = Array.from(cell.parentElement.children).indexOf(cell);
      const rows    = allRows;
      const initWidths = rows.map((row, ri) => frozenWidths[ri][colIdx] || 0);
      resizeDragRef.current = { type: 'col', startX: e.clientX, table, colIdx, rows, initWidths };
    } else {
      const rowEl     = cell.closest('tr');
      const initHeight = rowEl.getBoundingClientRect().height;
      resizeDragRef.current = { type: 'row', startY: e.clientY, rowEl, initHeight };
    }
  }, []);

  // Document-level drag handlers: update sizes on mousemove, finish on mouseup.
  useEffect(() => {
    const onDocMove = (e) => {
      // ── Cell / row resize drag ──────────────────────────────────────────
      if (resizeDragRef.current) {
        const cur = resizeDragRef.current.type === 'col' ? 'col-resize' : 'row-resize';
        document.body.style.cursor = cur;
        if (editorWrapRef.current) editorWrapRef.current.style.cursor = cur;

        if (resizeDragRef.current.type === 'col') {
          const { startX, colIdx, rows, initWidths } = resizeDragRef.current;
          const dx = e.clientX - startX;
          rows.forEach((row, i) => {
            const c = row.children[colIdx];
            if (c) c.style.width = `${Math.max(8, (initWidths[i] || 80) + dx)}px`;
          });
        } else {
          const { startY, rowEl, initHeight } = resizeDragRef.current;
          const dy = e.clientY - startY;
          const newH = Math.max(6, initHeight + dy);
          rowEl.style.height = `${newH}px`;
          Array.from(rowEl.children).forEach(c => { c.style.height = `${newH}px`; c.style.minHeight = ''; });
        }
        return;
      }

      // ── Table drag-move ─────────────────────────────────────────────────
      if (tableDragRef.current) {
        document.body.style.cursor = 'grabbing';
        if (editorWrapRef.current) editorWrapRef.current.style.cursor = 'grabbing';

        const editor = editorRef.current;
        if (!editor) return;
        const blocks = Array.from(editor.children);
        const wRect  = editorWrapRef.current?.getBoundingClientRect();
        if (!wRect) return;

        let insertBefore = null;
        let lineTop = null;

        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b === tableDragRef.current.table) continue;
          const bRect = b.getBoundingClientRect();
          if (e.clientY < bRect.top + bRect.height / 2) {
            insertBefore = b;
            lineTop = bRect.top - wRect.top;
            break;
          }
          if (i === blocks.length - 1) lineTop = bRect.bottom - wRect.top;
        }

        tableDragRef.current.insertBefore = insertBefore;

        // Update drop line imperatively — no React state, no re-render
        const dl = dropLineElRef.current;
        if (dl && lineTop !== null) {
          dl.style.top     = `${lineTop - 1}px`;
          dl.style.display = 'block';
        } else if (dl) {
          dl.style.display = 'none';
        }
        return;
      }
    };

    const onDocUp = () => {
      // ── Finish resize ───────────────────────────────────────────────────
      if (resizeDragRef.current) {
        resizeDragRef.current = null;
        hoverResizeRef.current = null;
        document.body.style.cursor = '';
        if (editorWrapRef.current) editorWrapRef.current.style.cursor = '';
        scheduleAutosave();
        return;
      }

      // ── Finish table drag-move ──────────────────────────────────────────
      if (tableDragRef.current) {
        const { table, insertBefore } = tableDragRef.current;
        tableDragRef.current = null;
        hoveredTableRef.current = null;
        document.body.style.cursor = '';
        if (editorWrapRef.current) editorWrapRef.current.style.cursor = '';
        if (dropLineElRef.current)  dropLineElRef.current.style.display  = 'none';
        if (dragHandleElRef.current) dragHandleElRef.current.style.display = 'none';

        const editor = editorRef.current;
        if (editor && table.parentElement === editor) {
          if (insertBefore && insertBefore !== table) {
            editor.insertBefore(table, insertBefore);
          } else if (!insertBefore) {
            editor.appendChild(table);
          }
          fixNumberedListsInDOM(editor);
          scheduleAutosave();
        }
      }
    };

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup',   onDocUp);
    return () => {
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup',   onDocUp);
    };
  }, [scheduleAutosave]);

  // ── Close context menus / pickers on outside click ───────────────────────
  useEffect(() => {
    if (!tableMenu && !listMenu && !cellBgPicker) return;
    const close = () => { setTableMenu(null); setListMenu(null); setCellBgPicker(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tableMenu, listMenu, cellBgPicker]);

  // ── Context menu dispatcher ───────────────────────────────────────────────
  const handleContextMenu = useCallback((e) => {
    // ── Inside a table cell → show table menu ──────────────────────────
    const cell = getCurrentCell(e.target, editorRef.current);
    if (cell) {
      e.preventDefault();
      const table = cell.closest('table');
      setTableMenu({ x: e.clientX, y: e.clientY, cell, table });
      return;
    }

    // ── Any non-table block → show numbering menu ─────────────────────
    let node = e.target;
    let block = null;
    while (node && node !== editorRef.current) {
      if (node.parentNode === editorRef.current) { block = node; break; }
      node = node.parentNode;
    }
    if (block && block.nodeName !== 'TABLE') {
      e.preventDefault();
      const list      = detectListPrefix(block.textContent);
      const isNumbered = !!(list && list.type === 'numbered');
      // For non-numbered blocks (headings, plain text), check the next
      // numbered sibling so the checkmarks reflect the current state.
      let flagBlock = block;
      if (!isNumbered) {
        let sib = block.nextElementSibling;
        while (sib) {
          if (detectListPrefix(sib.textContent)?.type === 'numbered') { flagBlock = sib; break; }
          sib = sib.nextElementSibling;
        }
      }
      setListMenu({
        x:          e.clientX,
        y:          e.clientY,
        block,
        isNumbered,
        hasRestart:  flagBlock.dataset.restart  === 'true',
        hasContinue: flagBlock.dataset.continue === 'true',
      });
    }
  }, []);

  // ── Table context menu actions ────────────────────────────────────────────
  const handleTableMenuAction = useCallback((action) => {
    if (!tableMenu) return;
    const { cell, table } = tableMenu;
    setTableMenu(null);

    // Snapshot current state BEFORE any change so Ctrl+Z can restore it.
    // This is critical for table operations because they are direct DOM mutations
    // invisible to the browser's own undo stack.
    pushUndo();

    const colIdx = Array.from(cell.parentElement.children).indexOf(cell);
    const rows   = Array.from(table.querySelectorAll('tr'));

    if (action === 'col-left' || action === 'col-right') {
      const insertIdx = action === 'col-left' ? colIdx : colIdx + 1;
      rows.forEach(row => {
        const td = document.createElement('td');
        td.setAttribute('style', TD_STYLE);
        td.innerHTML = '<br>';
        const ref = row.children[insertIdx];
        if (ref) row.insertBefore(td, ref);
        else     row.appendChild(td);
      });
      equalizeColumns(table);
      selectCell(table.querySelector('tr').children[insertIdx] || cell);

    } else if (action === 'col-delete') {
      if (rows[0].children.length <= 1) return; // keep at least one column
      rows.forEach(row => { if (row.children[colIdx]) row.children[colIdx].remove(); });
      equalizeColumns(table);
      const newIdx = Math.min(colIdx, rows[0].children.length - 1);
      selectCell(rows[0].children[newIdx]);

    } else if (action === 'row-above' || action === 'row-below') {
      const currentRow = cell.closest('tr');
      const colCount   = currentRow.children.length;
      const newRow     = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const td = document.createElement('td');
        td.setAttribute('style', TD_STYLE);
        td.innerHTML = '<br>';
        newRow.appendChild(td);
      }
      currentRow.insertAdjacentElement(
        action === 'row-above' ? 'beforebegin' : 'afterend',
        newRow,
      );
      selectCell(newRow.children[0]);

    } else if (action === 'row-delete') {
      const currentRow = cell.closest('tr');
      const tbody = currentRow.parentElement;
      if (tbody.children.length <= 1) return; // keep at least one row
      const nextRow = currentRow.nextElementSibling || currentRow.previousElementSibling;
      currentRow.remove();
      if (nextRow) selectCell(nextRow.children[0]);

    } else if (action === 'table-delete') {
      // Move cursor to the block after the table (or before it) then remove
      const after  = table.nextElementSibling;
      const before = table.previousElementSibling;
      table.remove();
      const target = after || before;
      if (target) placeCursorAtEnd(target, window.getSelection());
    }

    scheduleAutosave();
    // Re-focus the editor so Ctrl+Z works immediately after a menu action
    // (right-clicking opens the context menu and causes the editor to lose focus)
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [tableMenu, scheduleAutosave, pushUndo]);

  // ── List right-click actions (restart / continue numbering) ──────────────
  const handleListMenuAction = useCallback((action) => {
    if (!listMenu) return;
    const { block, isNumbered } = listMenu;
    setListMenu(null);

    // If the right-clicked block is not already a numbered item (e.g. a section
    // heading like "Equity"), CONVERT it into a numbered item by prepending
    // "1. " then letting fixNumberedListsInDOM assign the correct number.
    // data-continue → sequence continues from the previous list above
    // data-restart  → sequence restarts at 1
    if (!isNumbered) {
      pushUndo();
      // Strip any leading <br> nodes — they're empty-line placeholders and
      // would push "1. " onto its own line separate from the heading text.
      let insertRef = block.firstChild;
      while (insertRef && insertRef.nodeName === 'BR') {
        const next = insertRef.nextSibling;
        insertRef.remove();
        insertRef = next;
      }
      // Prepend "1. " as a plain text node before existing content so any
      // inline formatting (bold, colour) on the heading is preserved.
      const prefixNode = document.createTextNode('1. ');
      if (insertRef) block.insertBefore(prefixNode, insertRef);
      else           block.appendChild(prefixNode);
      if (action === 'restart') {
        block.dataset.restart = 'true';
        delete block.dataset.continue;
      } else {
        block.dataset.continue = 'true';
        delete block.dataset.restart;
      }
      fixNumberedListsInDOM(editorRef.current);
      scheduleAutosave();
      return;
    }

    if (action === 'restart') {
      block.dataset.restart = 'true';
      delete block.dataset.continue;
    } else if (action === 'continue') {
      block.dataset.continue = 'true';
      delete block.dataset.restart;
    }
    fixNumberedListsInDOM(editorRef.current);
    scheduleAutosave();
  }, [listMenu, scheduleAutosave, pushUndo]);

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const handleEditorKeyDown = useCallback((e) => {
    // ── Undo / Redo — our custom stack owns Ctrl+Z / Ctrl+Y ──────────────
    // We intercept BEFORE any other handler so browser undo never fires.
    // (Browser undo only knows about execCommand; our direct DOM mutations
    //  are invisible to it and would leave the editor in a corrupted state.)
    if (handleUndoKey(e)) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

    // ── Formatting shortcuts (Word-style) ─────────────────────────────────
    // Ctrl/Cmd+B → Bold   Ctrl/Cmd+I → Italic   Ctrl/Cmd+U → Underline
    // Ctrl/Cmd+Shift+S → Strikethrough
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' && !e.shiftKey) { e.preventDefault(); document.execCommand('bold');          scheduleAutosave(); return; }
      if (k === 'i' && !e.shiftKey) { e.preventDefault(); document.execCommand('italic');        scheduleAutosave(); return; }
      if (k === 'u' && !e.shiftKey) { e.preventDefault(); document.execCommand('underline');     scheduleAutosave(); return; }
      if (k === 's' &&  e.shiftKey) { e.preventDefault(); document.execCommand('strikeThrough'); scheduleAutosave(); return; }
    }

    // ── Home / End constrained to the current block ───────────────────────
    // In a contenteditable the browser treats the entire div as one long line,
    // so shift+End can select all the way to the end of the LAST block and
    // cause accidental multi-line deletions.  We intercept Home/End (with or
    // without Shift) and keep the movement/selection inside the current block.
    if ((e.key === 'Home' || e.key === 'End') && !e.ctrlKey && !e.metaKey) {
      const block = getBlock(range.startContainer);
      if (block && block.nodeName !== 'TABLE') {
        e.preventDefault();

        // Find first and last text nodes within the block
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
        let firstTn = null, lastTn = null, tn;
        while ((tn = walker.nextNode())) {
          if (!firstTn) firstTn = tn;
          lastTn = tn;
        }

        // Target node + offset for the movement destination
        let destNode, destOff;
        if (e.key === 'Home') {
          destNode = firstTn || block;
          destOff  = 0;
        } else {
          // End — jump to last text node's end (or block end if no text)
          destNode = lastTn || block;
          destOff  = lastTn ? lastTn.length : block.childNodes.length;
        }

        const r = document.createRange();
        if (e.shiftKey) {
          // Extend: keep anchor where it is, move focus to dest
          // The current range's collapse-end is the focus; the anchor is
          // the side that does NOT move.  When shift is held the anchor is
          // range.startContainer/startOffset for a forward selection.
          r.setStart(range.startContainer, range.startOffset);
          r.setEnd(destNode, destOff);
          // If dest is before the anchor (e.g. shift+Home and cursor is past
          // end), swap so Range is always start ≤ end.
          if (r.collapsed && e.key === 'Home') {
            r.setStart(destNode, destOff);
            r.setEnd(range.startContainer, range.startOffset);
          }
        } else {
          r.setStart(destNode, destOff);
          r.collapse(true);
        }
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    }

    // ── Backspace at the very start of a block (MS Word–style merge) ────
    //
    // When the cursor is at position 0 of a block we merge the current line
    // into the previous one — exactly like MS Word — rather than letting the
    // browser do an element-level merge (which can leave the cursor at an
    // element-offset position and cause the next Backspace to delete a whole
    // child node instead of a character).
    //
    // Rules:
    //  • If current block is empty: delete it, cursor → end of prev block.
    //  • If current block has a numbered prefix: strip the prefix, append the
    //    remaining body text/nodes to the end of the previous block, cursor
    //    lands at the join point.  Renumber afterwards.
    //  • Non-numbered block with content: same merge without stripping.
    //  • If prev block is a <table>: skip (don't merge into a table).
    // ── Prefix-only block: any Backspace/Delete wipes the whole prefix ────────
    // When a numbered block has no body content (e.g. "1.1." or "2. ") the
    // user's intent on pressing Backspace or Delete is always "get rid of this
    // prefix".  Character-by-character deletion races with fixNumberedListsInDOM
    // and the cursor-restore.  We short-circuit: one keypress → empty block.
    // ── Prefix-only block: Backspace / Delete removes the entire block ──────
    // When a numbered/bullet block has no body text (e.g. "2.3. " with nothing
    // after the prefix) any Backspace or Delete removes the whole block and
    // places the cursor at the end of the previous block (or start of the next
    // if there is no previous).
    //
    // WHY remove instead of clearing to <br>:
    //   Clearing to <br> leaves an orphaned empty block.  The user then needs a
    //   SECOND Backspace to actually get rid of it, and the intermediate state
    //   confuses the numbering.  Removing in one step is simpler and matches
    //   the behaviour users expect (same as pressing Backspace on an empty
    //   paragraph in Word / Google Docs).
    if ((e.key === 'Backspace' || e.key === 'Delete') && range.collapsed) {
      const block = getBlock(range.startContainer);
      if (block) {
        const listCheck = detectListPrefix(block.textContent);
        if (listCheck && !listCheck.body.trim()) {
          e.preventDefault();
          pushUndo(); // snapshot before the removal so Ctrl+Z brings it back
          const prevBlock = block.previousElementSibling;
          const nextBlock = block.nextElementSibling;
          block.remove();
          if (prevBlock && prevBlock.nodeName !== 'TABLE') {
            placeCursorAtEnd(prevBlock, sel);
          } else if (nextBlock) {
            const r2 = document.createRange();
            r2.setStart(nextBlock, 0);
            r2.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r2);
          } else {
            // Editor is now empty — insert a placeholder so it stays editable
            const placeholder = document.createElement('p');
            placeholder.innerHTML = '<br>';
            editorRef.current.appendChild(placeholder);
            const r2 = document.createRange();
            r2.setStart(placeholder, 0);
            r2.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r2);
          }
          fixNumberedListsInDOM(editorRef.current);
          scheduleAutosave();
          return;
        }
      }
    }

    if (e.key === 'Backspace' && range.collapsed) {
      normalizeBareTextNodes(editorRef.current);
      const block = getBlock(range.startContainer);
      if (block && isAtBlockStart(range, block)) {
        const prevBlock = block.previousElementSibling;
        if (prevBlock) {
          // Snapshot before a block-start merge so Ctrl+Z restores cleanly
          pushUndo();
          // Don't merge into a table — just delete empty blocks above tables
          if (prevBlock.nodeName === 'TABLE') {
            const isEmpty2 =
              block.innerHTML === '<br>' || block.innerHTML === '' || !block.textContent.trim();
            if (isEmpty2) {
              e.preventDefault();
              block.remove();
              fixNumberedListsInDOM(editorRef.current);
              scheduleAutosave();
            }
            return;
          }

          e.preventDefault();

          const list     = detectListPrefix(block.textContent);
          const isEmpty  =
            block.innerHTML === '<br>' ||
            block.innerHTML === '' ||
            (!block.textContent.trim()) ||
            (list && !list.body.trim());

          if (isEmpty) {
            // Empty block: just remove it, cursor to end of prev
            block.remove();
            placeCursorAtEnd(prevBlock, sel);
          } else {
            // ── Strip list prefix from the first text node if present ───
            if (list) {
              const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
              const ft = tw.nextNode();
              if (ft) {
                const stripped = ft.nodeValue.replace(/^[\d]+(?:\.[\d]+)*\. ?/, '');
                if (stripped) ft.nodeValue = stripped;
                else ft.remove();
              }
            }

            // ── Record junction point (end of prevBlock's last text) ───
            function deepLastNode(n) { return n.lastChild ? deepLastNode(n.lastChild) : n; }
            const junctionNode   = deepLastNode(prevBlock);
            const junctionOffset = junctionNode.nodeType === Node.TEXT_NODE
              ? junctionNode.length : 0;
            const junctionIsText = junctionNode.nodeType === Node.TEXT_NODE;

            // ── Move all child nodes (preserves inline formatting) ──────
            const kids = Array.from(block.childNodes);
            kids.forEach(child => {
              if (child.nodeName !== 'BR') prevBlock.appendChild(child);
            });

            // ── Remove the now-empty source block ───────────────────────
            block.remove();

            // ── Place cursor at junction ────────────────────────────────
            if (junctionIsText) {
              const r = document.createRange();
              r.setStart(junctionNode, junctionOffset);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
            } else {
              placeCursorAtEnd(prevBlock, sel);
            }

            fixNumberedListsInDOM(editorRef.current);
          }

          scheduleAutosave();
          return;
        }
      }
    }

    // ── Tab key: table navigation OR block indent/outdent ────────────────
    if (e.key === 'Tab') {
      const cell = getCurrentCell(range.startContainer, editorRef.current);

      if (cell) {
        // ── Inside a table cell ──────────────────────────────────────────
        e.preventDefault();
        const table = cell.closest('table');
        const cells = Array.from(table.querySelectorAll('td, th'));
        const idx   = cells.indexOf(cell);

        if (!e.shiftKey) {
          if (idx < cells.length - 1) {
            selectCell(cells[idx + 1]);
          } else {
            // Add a new row after the last row
            const lastRow = table.querySelector('tr:last-child');
            const colCount = lastRow.children.length;
            const newRow  = document.createElement('tr');
            for (let i = 0; i < colCount; i++) {
              const td = document.createElement('td');
              td.setAttribute('style', TD_STYLE);
              td.innerHTML = '<br>';
              newRow.appendChild(td);
            }
            lastRow.insertAdjacentElement('afterend', newRow);
            selectCell(newRow.children[0]);
            scheduleAutosave();
          }
        } else {
          if (idx > 0) selectCell(cells[idx - 1]);
        }
        return;
      }

      // ── Outside a table: indent/outdent the current block ────────────
      const block = getBlock(range.startContainer);
      if (block) {
        e.preventDefault();
        const level = getIndentLevel(block);
        setIndentLevel(block, e.shiftKey ? level - 1 : level + 1);
        fixNumberedListsInDOM(editorRef.current);
        // After fixNumberedListsInDOM rewrites the first text node the cursor
        // offset no longer lines up correctly (e.g. "4. " → "3.1. " changes
        // the text length).  Explicitly place cursor deep inside last text node.
        placeCursorAtEnd(block, window.getSelection());
        scheduleAutosave();
      }
      return;
    }

    // ── Enter key ────────────────────────────────────────────────────────
    if (e.key !== 'Enter' || e.shiftKey) return;

    // Enter inside a table cell → insert a new row below
    const cell = getCurrentCell(range.startContainer, editorRef.current);
    if (cell) {
      e.preventDefault();
      const currentRow = cell.closest('tr');
      const table      = currentRow.closest('table');
      const colCount   = currentRow.children.length;
      const newRow     = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const td = document.createElement('td');
        td.setAttribute('style', TD_STYLE);
        td.innerHTML = '<br>';
        newRow.appendChild(td);
      }
      currentRow.insertAdjacentElement('afterend', newRow);
      selectCell(newRow.children[0]);
      scheduleAutosave();
      return;
    }

    // Normalise any bare text nodes synchronously before querying blocks —
    // the rAF from handleEditorInput may not have fired yet if the user is
    // typing quickly, so we ensure the first line is always a <p> here too.
    normalizeBareTextNodes(editorRef.current);

    // Enter inside a list item → continue the list
    const block = getBlock(range.startContainer);
    if (!block) return;

    const list = detectListPrefix(block.textContent);
    if (!list) return;

    e.preventDefault();
    // Snapshot BEFORE we touch the DOM so Ctrl+Z perfectly restores this state
    pushUndo();
    const level = getIndentLevel(block);

    if (!list.body.trim()) {
      // Empty list item:
      // - If nested (level > 0): dedent back one level, add placeholder prefix
      // - If at level 0: strip prefix, leave a blank paragraph
      if (level > 0) {
        setIndentLevel(block, level - 1);
        block.textContent = list.type === 'numbered' ? '1. ' : list.prefix;
        fixNumberedListsInDOM(editorRef.current);
        placeCursorAtEnd(block, sel);
      } else {
        // Level-0 empty numbered/bullet item: remove the block entirely so the
        // items below renumber correctly (e.g. "5. Escrow" becomes "4.").
        const nextBlock = block.nextElementSibling;
        const prevBlock = block.previousElementSibling;
        block.remove();
        fixNumberedListsInDOM(editorRef.current);
        // Place cursor at start of next block, or end of previous block.
        if (nextBlock?.isConnected) {
          const r = document.createRange();
          r.setStart(nextBlock, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } else if (prevBlock?.isConnected) {
          placeCursorAtEnd(prevBlock, sel);
        }
      }
      scheduleAutosave();
      return;
    }

    // Insert a new paragraph inheriting this block's list type & indent.
    // We use direct DOM manipulation instead of execCommand('insertText') to
    // avoid the async race between execCommand and the rAF-scheduled
    // fixNumberedListsInDOM call, which caused the prefix to repeat (e.g.
    // pressing Enter after "3." produced another "3." instead of "4.").
    document.execCommand('insertParagraph');

    // The cursor is now in the freshly-created block
    const newSel = window.getSelection();
    if (newSel?.rangeCount) {
      const newBlock = getBlock(newSel.getRangeAt(0).startContainer);
      if (newBlock && newBlock !== block) {
        if (level > 0) newBlock.dataset.indent = String(level);
        const existingText = newBlock.textContent;
        if (detectListPrefix(existingText)) {
          // Cursor was at position 0: Chrome moved ALL content (prefix + body)
          // to newBlock.  The user's intent here is to insert a blank line ABOVE
          // the numbered item (e.g. add breathing room between a table and the
          // first numbered heading).  Convert the orphaned empty `block` into a
          // plain blank paragraph and leave `newBlock` with the full original
          // content so numbering is undisturbed.
          block.innerHTML = '<br>';
          delete block.dataset.indent;
          delete block.dataset.emptyNew;
          fixNumberedListsInDOM(editorRef.current);
          placeCursorAtEnd(block, window.getSelection());
        } else if (existingText.trim()) {
          // Cursor was mid-body: Chrome split the text, leaving body tail in newBlock.
          // Prepend the correct prefix so it becomes a valid list item.
          newBlock.textContent = (list.type === 'numbered' ? '1. ' : list.prefix) + existingText;
          if (list.type === 'numbered') newBlock.dataset.emptyNew = 'true';
          fixNumberedListsInDOM(editorRef.current);
          placeCursorAtEnd(newBlock, newSel);
        } else {
          // Normal case: cursor was at end, newBlock is empty — just set prefix.
          newBlock.textContent = list.type === 'numbered' ? '1. ' : list.prefix;
          if (list.type === 'numbered') newBlock.dataset.emptyNew = 'true';
          fixNumberedListsInDOM(editorRef.current);
          placeCursorAtEnd(newBlock, newSel);
        }
      }
    }

    scheduleAutosave();
  }, [getBlock, scheduleAutosave, handleUndoKey, pushUndo]);

  // ── Quick-keys (adapted for contentEditable) ──────────────────────────────
  const insertAtCursor = useCallback((action) => {
    editorRef.current?.focus();

    if (action === 'backspace') {
      document.execCommand('delete');
    } else if (action === 'enter') {
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const block = getBlock(sel.getRangeAt(0).startContainer);
        if (block && detectListPrefix(block.textContent)) {
          handleEditorKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
          return;
        }
      }
      document.execCommand('insertParagraph');
    } else if (action === 'list-numbered') {
      document.execCommand('insertText', false, '1. ');
    } else if (action === 'list-bullet') {
      document.execCommand('insertText', false, '- ');
    } else {
      document.execCommand('insertText', false, action);
    }
    scheduleAutosave();
  }, [handleEditorKeyDown, scheduleAutosave, getBlock]);

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in">
      {/* Indent-level + table CSS for the editor */}
      <style>{`
        .diary-editor [data-indent="1"] { padding-left: 24px; }
        .diary-editor [data-indent="2"] { padding-left: 48px; }
        .diary-editor [data-indent="3"] { padding-left: 72px; }
        .diary-editor table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .diary-editor td, .diary-editor th {
          border: 1px solid #e2e8f0;
          padding: 4px 6px;
          min-width: 0;
          vertical-align: top;
          overflow: hidden;
        }
        .diary-editor [data-restart="true"] {
          border-left: 3px solid #7c3aed;
          padding-left: 6px;
          margin-left: -9px;
        }
        .diary-editor td:focus, .diary-editor td:focus-within {
          outline: 2px solid var(--gold-light);
          outline-offset: -1px;
        }
        /* diary-html-content table/indent rules live in diary.css — always loaded */
      `}</style>

      <h2 className="section-title">
        {editingEntry ? 'Edit Entry' : 'New Entry'}
      </h2>

      <div className="card">

        {/* ── Title + draft status ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <input
            className="input input-title"
            value={title}
            onChange={e => { setTitle(e.target.value); scheduleAutosave(); }}
            placeholder="Give your entry a title..."
            style={{ flex: 1, marginBottom: 0 }}
          />
          {draftStatus === 'saving' && (
            <span style={{ fontSize: 12, color: 'var(--ink-lighter)', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
              Saving draft…
            </span>
          )}
          {draftStatus === 'saved' && (
            <span style={{ fontSize: 12, color: '#16a34a', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
              ✓ Draft saved
            </span>
          )}
          {draftStatus === 'restored' && (
            <span style={{ fontSize: 12, color: '#d97706', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
              ↩ Draft restored
            </span>
          )}
          {isSharedEntryRef.current && (
            <span style={{ fontSize: 11, color: '#7c3aed', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px',
              background: '#f5f3ff', borderRadius: 8, border: '1px solid #ddd6fe' }}>
              🔴 Live
            </span>
          )}
        </div>

        {/* ── Remote update banner ── */}
        {remoteUpdateInfo && (
          <div style={{ marginBottom: 10, padding: '6px 12px', borderRadius: 8,
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            fontSize: 13, color: '#15803d', fontFamily: 'var(--font-body)',
            display: 'flex', alignItems: 'center', gap: 6 }}>
            ✏️ <strong>{remoteUpdateInfo.name}</strong> just made changes — content updated.
          </div>
        )}

        {/* ── Formatting toolbar (sticky — stays visible when scrolling long entries) ── */}
        <div style={{
          position:     'sticky',
          top:          'var(--header-h)',
          zIndex:       40,
          background:   '#ffffff',
          marginLeft:   -20,
          marginRight:  -20,
          paddingLeft:  20,
          paddingRight: 20,
          paddingTop:   6,
          paddingBottom: 6,
          borderBottom: '1px solid var(--paper-line)',
          boxShadow:    '0 2px 6px rgba(0,0,0,0.05)',
          marginBottom: 12,
        }}>
          <EditorToolbar
            onFormat={handleFormat}
            onHighlight={handleHighlight}
            onToggleList={toggleList}
            onIndent={handleIndent}
            onInsertTable={handleInsertTable}
            onCellBgColor={(scope, color) => handleCellBgColor(scope, color, null)}
            onInsertAtCursor={insertAtCursor}
            cellBgPicker={cellBgPicker}
            setCellBgPicker={setCellBgPicker}
            onUndo={undo}
            onRedo={redo}
            onShowHistory={() => setShowHistory(true)}
          />
        </div>

        {/* ── Editor area + Quick-Keys ── */}
        <div className="editor-layout" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>

          {/* contentEditable editor */}
          <div
            ref={editorWrapRef}
            style={{ flex: 1, minWidth: 0, position: 'relative' }}
            onMouseMove={handleEditorWrapMouseMove}
            onMouseDown={handleEditorWrapMouseDown}
          >
            {/* Drag handle + drop line are created imperatively in useEffect — no JSX needed */}
            {isEmpty && (
              <span style={{
                position:      'absolute',
                top:           12,
                left:          14,
                color:         'var(--ink-lighter)',
                fontFamily:    'var(--font-body)',
                fontSize:      16,
                pointerEvents: 'none',
                userSelect:    'none',
              }}>
                Write your thoughts here…
              </span>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onBeforeInput={onBeforeInput}
              onInput={handleEditorInput}
              onKeyDown={handleEditorKeyDown}
              onContextMenu={handleContextMenu}
              className="diary-editor"
            />
          </div>

        </div>

        {/* ── Action buttons ── */}
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-outline" onClick={onCancel}>
            <X size={16} /> Cancel
          </button>
          <button className="btn btn-teal" onClick={handleSave} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>

      </div>

      {/* ── Table right-click context menu ── */}
      {tableMenu && (
        <div
          onMouseDown={e => e.stopPropagation()} // prevent outside-click close when interacting
          style={{
            position:     'fixed',
            top:          tableMenu.y,
            left:         tableMenu.x,
            background:   'var(--paper)',
            border:       '1px solid var(--paper-line)',
            borderRadius: 8,
            boxShadow:    '0 6px 24px rgba(0,0,0,0.13)',
            zIndex:       9999,
            minWidth:     180,
            padding:      '4px 0',
            fontFamily:   'var(--font-body)',
          }}
        >
          {[
            { label: '← Add Column Left',  action: 'col-left'    },
            { label: 'Add Column Right →',  action: 'col-right'   },
            { label: 'Delete Column',        action: 'col-delete',  danger: true },
            null,
            { label: '↑ Add Row Above',     action: 'row-above'   },
            { label: '↓ Add Row Below',     action: 'row-below'   },
            { label: 'Delete Row',           action: 'row-delete',  danger: true },
            null,
            { label: 'Delete Entire Table', action: 'table-delete', danger: true },
          ].map((item, idx) =>
            item === null ? (
              <div key={idx} style={{ height: 1, background: 'var(--paper-line)', margin: '4px 0' }} />
            ) : (
              <button
                key={idx}
                onMouseDown={(e) => { e.preventDefault(); handleTableMenuAction(item.action); }}
                style={{
                  display:    'block',
                  width:      '100%',
                  padding:    '8px 16px',
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  textAlign:  'left',
                  fontSize:   13,
                  color:      item.danger ? '#dc2626' : 'var(--ink)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = item.danger ? '#fff1f2' : 'var(--paper-dark)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                {item.label}
              </button>
            )
          )}

          {/* ── Row / Column background colour ── */}
          <div style={{ height: 1, background: 'var(--paper-line)', margin: '4px 0' }} />
          {[{ scope: 'row', label: '🎨 Row colour' }, { scope: 'col', label: '🎨 Column colour' }].map(({ scope, label }) => (
            <div key={scope} style={{ padding: '5px 16px' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-lighter)', marginBottom: 5, fontWeight: 600 }}>
                {label}
              </div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                {HIGHLIGHT_COLORS.map(({ color, title }) => (
                  <button
                    key={color}
                    onMouseDown={e => { e.preventDefault(); handleCellBgColor(scope, color, tableMenu?.cell); }}
                    title={title}
                    style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: color, border: '1px solid rgba(0,0,0,0.15)',
                      cursor: 'pointer', padding: 0, flexShrink: 0,
                    }}
                  />
                ))}
                <button
                  onMouseDown={e => { e.preventDefault(); handleCellBgColor(scope, 'transparent', tableMenu?.cell); }}
                  title="Clear background"
                  style={{
                    background: 'none', border: '1px solid var(--paper-line)',
                    borderRadius: 4, fontSize: 10, cursor: 'pointer',
                    padding: '1px 5px', color: 'var(--ink-lighter)',
                  }}
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Version history modal ── */}
      {showHistory && (
        <DiaryHistoryModal
          entryId={entryIdRef.current}
          isShared={isSharedEntryRef.current}
          onRestore={handleHistoryRestore}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* ── List right-click context menu (restart / continue numbering) ── */}
      {listMenu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position:     'fixed',
            top:          listMenu.y,
            left:         listMenu.x,
            background:   'var(--paper)',
            border:       '1px solid var(--paper-line)',
            borderRadius: 8,
            boxShadow:    '0 6px 24px rgba(0,0,0,0.13)',
            zIndex:       9999,
            minWidth:     210,
            padding:      '4px 0',
            fontFamily:   'var(--font-body)',
          }}
        >
          {/* Header label */}
          <div style={{ padding: '6px 16px 4px', fontSize: 11, color: 'var(--ink-lighter)',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Numbering
          </div>
          <div style={{ height: 1, background: 'var(--paper-line)', margin: '2px 0 4px' }} />
          <button
            onMouseDown={e => { e.preventDefault(); handleListMenuAction('continue'); }}
            style={{ display:'block', width:'100%', padding:'8px 16px', background:'none',
              border:'none', cursor:'pointer', textAlign:'left', fontSize:13,
              color: listMenu.hasContinue ? '#7c3aed' : 'var(--ink)',
              fontWeight: listMenu.hasContinue ? 600 : 400 }}
            onMouseEnter={e => e.currentTarget.style.background = listMenu.hasContinue ? '#f5f3ff' : 'var(--paper-dark)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            {listMenu.hasContinue ? '✓ ' : ''}↩ Continue from previous sequence
          </button>
          <button
            onMouseDown={e => { e.preventDefault(); handleListMenuAction('restart'); }}
            style={{ display:'block', width:'100%', padding:'8px 16px', background:'none',
              border:'none', cursor:'pointer', textAlign:'left', fontSize:13,
              color: listMenu.hasRestart ? '#7c3aed' : 'var(--ink)',
              fontWeight: listMenu.hasRestart ? 600 : 400 }}
            onMouseEnter={e => e.currentTarget.style.background = listMenu.hasRestart ? '#f5f3ff' : 'var(--paper-dark)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            {listMenu.hasRestart ? '✓ ' : ''}↺ Restart numbering from here
          </button>
        </div>
      )}
    </div>
  );
}
