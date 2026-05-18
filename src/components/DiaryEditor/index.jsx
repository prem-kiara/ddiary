import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import EditorToolbar from './EditorToolbar';
import { useAutosave } from './hooks/useAutosave';
import { useEditorSync } from './hooks/useEditorSync';
import { HIGHLIGHT_COLORS, TD_STYLE } from './constants';

// ── Pure helpers (no React deps) ──────────────────────────────────────────────

function getIndentLevel(block) {
  return parseInt(block?.dataset?.indent || '0');
}

function setIndentLevel(block, level) {
  if (!block) return;
  level = Math.max(0, Math.min(3, level));
  if (level === 0) {
    delete block.dataset.indent;
  } else {
    block.dataset.indent = String(level);
  }
}

// Get the <td> or <th> ancestor of a node within the editor, if any.
function getCurrentCell(node, editorEl) {
  let n = node;
  while (n && n !== editorEl) {
    if (n.nodeName === 'TD' || n.nodeName === 'TH') return n;
    n = n.parentNode;
  }
  return null;
}

// Select all content in a cell and move cursor to end.
function selectCell(cell) {
  if (!cell) return;
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Detect list prefix on a block.
 * Supports:
 *   - Nested numbered:  1.   /  1.1.  /  1.1.1.  etc.
 *   - Bullets:          - text  /  * text  /  • text
 *
 * The trailing space after the last digit+dot is optional so that blocks
 * where the cursor landed mid-prefix (and the space is missing) are still
 * detected and can be renumbered / continued correctly.
 */
function detectListPrefix(text) {
  // Allow zero or one space after the final period so mis-formatted prefixes
  // (e.g. "3.1.Test Entry" missing the trailing space) are still recognised.
  const numbered = text.match(/^([\d]+(?:\.[\d]+)*\. ?)(.*)/s);
  if (numbered) {
    const rawPrefix = numbered[1];
    // Normalise: ensure exactly one trailing space
    const prefix = rawPrefix.trimEnd() + '. ';
    const nums = (prefix.match(/\d+/g) || []).map(Number);
    const num  = nums[nums.length - 1] || 1;
    return { type: 'numbered', prefix, nums, num, sep: '. ', body: numbered[2] };
  }
  const bullet = text.match(/^([-*•]\s+)(.*)/s);
  if (bullet) {
    return { type: 'bullet', prefix: bullet[1], body: bullet[2] };
  }
  return null;
}

/**
 * Walk every direct-child block in the contentEditable and fix sequential
 * numbering across all indent levels.
 * Counters are maintained per-level: [level0, level1, level2, level3]
 * Prefix format: 1. / 2.1. / 2.1.3. etc.
 */
function fixNumberedListsInDOM(editorEl) {
  if (!editorEl) return;

  // ── Snapshot cursor before any DOM mutations ──────────────────────────────
  // Mutating ANY text node's nodeValue (even in a block the cursor is NOT in)
  // can invalidate the browser's Selection and silently move the cursor to
  // offset 0, especially in Firefox.  We save the range endpoints by their
  // (node, offset) references and restore them after all rewrites are done.
  const sel = window.getSelection();
  let savedStart = null, savedStartOff = 0;
  let savedEnd   = null, savedEndOff   = 0;
  let hadSelection = false;
  if (sel?.rangeCount) {
    const r = sel.getRangeAt(0);
    savedStart    = r.startContainer;
    savedStartOff = r.startOffset;
    savedEnd      = r.endContainer;
    savedEndOff   = r.endOffset;
    hadSelection  = true;
  }

  const blocks  = Array.from(editorEl.children);
  const counters = [0, 0, 0, 0];

  blocks.forEach(block => {
    // ── Skip tables entirely — a table in the middle of a numbered list
    // should not break the sequence; counters carry through unmodified.
    if (block.nodeName === 'TABLE') return;

    const level = getIndentLevel(block);
    const text  = block.textContent;

    // ── Skip empty blocks (<p><br></p>, whitespace-only paragraphs) ──────
    // An empty line between list items should not reset the counter; only
    // a block that actually contains non-list non-empty text resets it.
    if (!text.trim()) return;

    // Allow missing trailing space so stale/mis-formatted blocks are
    // still detected and healed (e.g. "3.1.Text" → "3.1. Text").
    const isNumbered = /^[\d]+(?:\.[\d]+)*\. ?/.test(text);

    if (isNumbered) {
      const body = text.replace(/^[\d]+(?:\.[\d]+)*\. ?/, '').trim();

      // Prefix-only block (no body content) — only count it if it was freshly
      // created by Enter (data-empty-new="true").  Blocks that became
      // prefix-only because the user deleted their body content should be
      // skipped so subsequent numbered blocks renumber correctly.
      if (!body && !block.dataset.emptyNew) return;

      // If the block carries a restart marker, reset this level and all
      // deeper levels so numbering begins at 1 again from this point.
      if (block.dataset.restart === 'true') {
        counters[level] = 0;
        for (let i = level + 1; i < counters.length; i++) counters[i] = 0;
      }
      counters[level]++;
      // Reset all deeper levels
      for (let i = level + 1; i < counters.length; i++) counters[i] = 0;

      // Always emit a prefix with exactly one trailing space for consistency.
      const expectedPrefix = counters.slice(0, level + 1).join('.') + '. ';

      const walker   = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      const firstTxt = walker.nextNode();
      if (firstTxt) {
        const updated = firstTxt.nodeValue.replace(/^[\d]+(?:\.[\d]+)*\. ?/, expectedPrefix);
        if (updated !== firstTxt.nodeValue) {
          // When the prefix length changes, adjust saved cursor offsets if the
          // cursor lives inside this text node so the restore lands correctly.
          const oldPrefixLen = (firstTxt.nodeValue.match(/^[\d]+(?:\.[\d]+)*\. ?/) || [''])[0].length;
          const newPrefixLen = expectedPrefix.length;
          const delta        = newPrefixLen - oldPrefixLen;
          if (delta !== 0) {
            if (savedStart === firstTxt)
              savedStartOff = Math.max(newPrefixLen, savedStartOff + delta);
            if (savedEnd === firstTxt)
              savedEndOff   = Math.max(newPrefixLen, savedEndOff + delta);
          }
          firstTxt.nodeValue = updated;
        }
      }

      // Once the block has real body content, the "new empty" marker is no
      // longer needed — clear it so future empty-block logic works correctly.
      if (body && block.dataset.emptyNew) delete block.dataset.emptyNew;
    } else {
      // Non-empty, non-numbered block: reset this level and deeper counters
      counters[level] = 0;
      for (let i = level + 1; i < counters.length; i++) counters[i] = 0;
    }
  });

  // ── Restore cursor after all mutations ───────────────────────────────────
  if (hadSelection && savedStart?.isConnected) {
    try {
      const clamp = (node, off) =>
        node.nodeType === Node.TEXT_NODE
          ? Math.min(off, node.length)
          : Math.min(off, node.childNodes.length);
      const newRange = document.createRange();
      newRange.setStart(savedStart, clamp(savedStart, savedStartOff));
      newRange.setEnd(
        savedEnd?.isConnected ? savedEnd : savedStart,
        clamp(savedEnd?.isConnected ? savedEnd : savedStart, savedEndOff)
      );
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch { /* node detached or invalid — leave cursor where browser put it */ }
  }
}

/**
 * Convert a legacy plain-text (or markdown-marker) entry to HTML so it can
 * be loaded into the contentEditable editor.  Already-HTML content is passed
 * through unchanged.
 */
function legacyTextToHtml(text) {
  if (!text) return '';
  if (/<[a-zA-Z]/.test(text)) return text; // already HTML

  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<u>$1</u>')
    .replace(/~~(.+?)~~/g,     '<s>$1</s>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>');

  return s
    .split('\n')
    .map(line => (line ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}

/**
 * Returns true when `range` is collapsed at the very beginning of `block`
 * (before any text or child elements).
 */
function isAtBlockStart(range, block) {
  if (!range || !range.collapsed || !block) return false;
  if (range.startContainer === block && range.startOffset === 0) return true;
  if (range.startOffset !== 0) return false;
  // Walk up from the start container: every ancestor up to the block must
  // have no previous sibling (i.e., we are on the leftmost path).
  let node = range.startContainer;
  while (node && node !== block) {
    if (node.previousSibling) return false;
    node = node.parentNode;
  }
  return node === block;
}

/**
 * Place the cursor at the very end of a block.
 * We walk into the deepest last child so the cursor is inside the final
 * text node (not at element-level offset N), which makes the next Backspace
 * delete a character rather than an element node.
 */
function placeCursorAtEnd(block, sel) {
  if (!block || !sel) return;
  function deepLast(node) {
    return node.lastChild ? deepLast(node.lastChild) : node;
  }
  const target = deepLast(block);
  const r = document.createRange();
  if (target.nodeType === Node.TEXT_NODE) {
    r.setStart(target, target.length);
    r.setEnd(target, target.length);
  } else if (target.nodeName === 'BR') {
    // Place cursor right before the <br> (= end of visible content)
    r.setStartBefore(target);
    r.collapse(true);
  } else {
    r.selectNodeContents(block);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Set all cells in the table to the same fractional width so columns are
 * uniform after adding or removing a column.
 */
function equalizeColumns(table) {
  const firstRow = table.querySelector('tr');
  if (!firstRow) return;
  const colCount = firstRow.children.length;
  if (colCount === 0) return;
  const pct = `${(100 / colCount).toFixed(2)}%`;
  Array.from(table.querySelectorAll('td, th')).forEach(cell => {
    cell.style.width = pct;
  });
}

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
  const isSharedEntryRef   = useRef(false); // true when editing a shared diary
  const lastLocalEditRef   = useRef(0);     // timestamp of last local keystroke
  const pendingFirstSnapRef = useRef(true); // skip the initial onSnapshot fire

  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => { titleRef.current = title; }, [title]);

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

  // ── Real-time shared-diary sync (receive changes from collaborators) ──────
  const { remoteUpdateInfo } = useEditorSync({
    entryId: editingEntry?.id,
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
    entryIdRef.current        = editingEntry?.id || 'new';
    skipFirstSaveRef.current  = true;
    isSharedEntryRef.current  = !!(editingEntry?.isShared || editingEntry?.isSharedWithMe);
    pendingFirstSnapRef.current = true;   // reset so we skip the first snapshot on re-mount
    lastLocalEditRef.current  = Date.now(); // treat load as a local edit to block early overwrites

    const rawContent = editingEntry?.content || '';
    const ttl        = editingEntry?.title   || '';
    const html       = legacyTextToHtml(rawContent) || '<p><br></p>';

    try {
      const key = `ddiary_draft_${entryIdRef.current}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft  = JSON.parse(raw);
        const ut     = editingEntry?.updatedAt;
        const savedAt = ut
          ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime())
          : 0;
        if (draft.savedAt > savedAt) {
          setTitle(draft.title ?? ttl);
          titleRef.current = draft.title ?? ttl;
          if (editorRef.current) {
            editorRef.current.innerHTML = draft.content || html;
            prevBlockCountRef.current = editorRef.current.childElementCount;
          }
          setIsEmpty(!(draft.content || '').replace(/<[^>]+>/g, '').trim());
          setDraftStatus('restored');
          return;
        }
      }
    } catch { /* localStorage unavailable */ }

    setTitle(ttl);
    titleRef.current = ttl;
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      prevBlockCountRef.current = editorRef.current.childElementCount;
    }
    setIsEmpty(!rawContent.trim());
    setDraftStatus('idle');
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
    } catch {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

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
  }, [scheduleAutosave]);

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

    // ── Inside a numbered list block → show list menu ──────────────────
    let node = e.target;
    let block = null;
    while (node && node !== editorRef.current) {
      if (node.parentNode === editorRef.current) { block = node; break; }
      node = node.parentNode;
    }
    if (block) {
      const list = detectListPrefix(block.textContent);
      if (list && list.type === 'numbered') {
        e.preventDefault();
        setListMenu({
          x: e.clientX,
          y: e.clientY,
          block,
          hasRestart: block.dataset.restart === 'true',
        });
      }
    }
  }, []);

  // ── Table context menu actions ────────────────────────────────────────────
  const handleTableMenuAction = useCallback((action) => {
    if (!tableMenu) return;
    const { cell, table } = tableMenu;
    setTableMenu(null);

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
  }, [tableMenu, scheduleAutosave]);

  // ── List right-click actions (restart / continue numbering) ──────────────
  const handleListMenuAction = useCallback((action) => {
    if (!listMenu) return;
    const { block } = listMenu;
    setListMenu(null);
    if (action === 'restart') {
      block.dataset.restart = 'true';
    } else if (action === 'continue') {
      delete block.dataset.restart;
    }
    fixNumberedListsInDOM(editorRef.current);
    scheduleAutosave();
  }, [listMenu, scheduleAutosave]);

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const handleEditorKeyDown = useCallback((e) => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

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
    if ((e.key === 'Backspace' || e.key === 'Delete') && range.collapsed) {
      const block = getBlock(range.startContainer);
      if (block) {
        const listCheck = detectListPrefix(block.textContent);
        if (listCheck && !listCheck.body.trim()) {
          e.preventDefault();
          block.innerHTML = '<br>';
          // Place cursor at start of the now-empty block
          const r2 = document.createRange();
          r2.setStart(block, 0);
          r2.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r2);
          requestAnimationFrame(() => fixNumberedListsInDOM(editorRef.current));
          scheduleAutosave();
          return;
        }
      }
    }

    if (e.key === 'Backspace' && range.collapsed) {
      const block = getBlock(range.startContainer);
      if (block && isAtBlockStart(range, block)) {
        const prevBlock = block.previousElementSibling;
        if (prevBlock) {
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

    // Enter inside a list item → continue the list
    const block = getBlock(range.startContainer);
    if (!block) return;

    const list = detectListPrefix(block.textContent);
    if (!list) return;

    e.preventDefault();
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
        block.innerHTML = '<br>';
        const r = document.createRange();
        r.setStart(block, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
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
        // Set a placeholder prefix directly (any valid numbered prefix works —
        // fixNumberedListsInDOM will renumber everything correctly in one pass).
        newBlock.textContent = list.type === 'numbered' ? '1. ' : list.prefix;
        // Mark as freshly-created empty block so fixNumberedListsInDOM counts
        // it (prefix-only) but skips body-deleted prefix-only blocks.
        if (list.type === 'numbered') newBlock.dataset.emptyNew = 'true';
        // Renumber synchronously so numbering is correct before the next render
        fixNumberedListsInDOM(editorRef.current);
        // Place cursor deep inside the last text node for reliable Backspace
        placeCursorAtEnd(newBlock, newSel);
      }
    }

    scheduleAutosave();
  }, [getBlock, scheduleAutosave]);

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
        .diary-html-content [data-indent="1"] { padding-left: 24px; }
        .diary-html-content [data-indent="2"] { padding-left: 48px; }
        .diary-html-content [data-indent="3"] { padding-left: 72px; }
        .diary-html-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .diary-html-content td, .diary-html-content th {
          border: 1px solid #e2e8f0;
          padding: 4px 6px;
          min-width: 0;
          vertical-align: top;
          overflow: hidden;
        }
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

        {/* ── Formatting toolbar ── */}
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
        />

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
          {listMenu.hasRestart ? (
            <button
              onMouseDown={e => { e.preventDefault(); handleListMenuAction('continue'); }}
              style={{ display:'block', width:'100%', padding:'8px 16px', background:'none',
                border:'none', cursor:'pointer', textAlign:'left', fontSize:13, color:'var(--ink)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-dark)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              ↩ Continue from previous sequence
            </button>
          ) : (
            <button
              onMouseDown={e => { e.preventDefault(); handleListMenuAction('restart'); }}
              style={{ display:'block', width:'100%', padding:'8px 16px', background:'none',
                border:'none', cursor:'pointer', textAlign:'left', fontSize:13, color:'#7c3aed' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              ↺ Restart numbering from here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
