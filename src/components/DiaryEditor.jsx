import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X, Bold, Italic, Underline, Strikethrough } from 'lucide-react';

// ── Pure helpers (no React deps) ──────────────────────────────────────────────

function detectListPrefix(text) {
  const numbered = text.match(/^(\d+)([.)]\s+)(.*)/);
  if (numbered) {
    return { type: 'numbered', num: parseInt(numbered[1]), sep: numbered[2], body: numbered[3] };
  }
  const bullet = text.match(/^([-*•]\s+)(.*)/);
  if (bullet) {
    return { type: 'bullet', prefix: bullet[1], body: bullet[2] };
  }
  return null;
}

/**
 * Walk every direct-child block in the contentEditable and fix the sequential
 * numbering of any numbered-list run.  Preserves the starting number of each
 * run so intentional offsets are kept.
 */
function fixNumberedListsInDOM(editorEl) {
  if (!editorEl) return;
  const blocks = Array.from(editorEl.children);
  let expectedNum = null;
  let blockSep    = null;

  blocks.forEach(block => {
    const text = block.textContent;
    const m    = text.match(/^(\d+)([.)]\s)/);
    if (m) {
      const num = parseInt(m[1]);
      if (expectedNum === null) {
        // First item in this run — anchor the expected sequence here
        expectedNum = num + 1;
        blockSep    = m[2];
      } else if (num !== expectedNum) {
        // Out-of-sequence — patch the leading text node
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
        const firstTxt = walker.nextNode();
        if (firstTxt) {
          firstTxt.nodeValue = firstTxt.nodeValue.replace(
            /^\d+([.)]\s)/,
            `${expectedNum}$1`,
          );
        }
        expectedNum++;
      } else {
        expectedNum++;
      }
    } else {
      // Non-list line — reset the run
      expectedNum = null;
      blockSep    = null;
    }
  });
}

/**
 * Convert a legacy plain-text (or markdown-marker) entry to HTML so it can
 * be loaded into the contentEditable editor.  Already-HTML content is passed
 * through unchanged.
 */
function legacyTextToHtml(text) {
  if (!text) return '';
  if (/<[a-zA-Z]/.test(text)) return text; // already HTML

  // Escape entities first
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert markdown inline markers → HTML
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<u>$1</u>')
    .replace(/~~(.+?)~~/g,     '<s>$1</s>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>');

  // Wrap each line in <p>; empty lines become <p><br></p>
  return s
    .split('\n')
    .map(line => (line ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}

// ── Shared quick-key button style ─────────────────────────────────────────────
const quickKeyStyle = {
  background:    'var(--paper-dark)',
  border:        '1px solid var(--paper-line)',
  borderRadius:  8,
  cursor:        'pointer',
  fontSize:      20,
  width:         46,
  height:        46,
  display:       'flex',
  alignItems:    'center',
  justifyContent:'center',
  fontFamily:    'system-ui, sans-serif',
  color:         'var(--ink)',
  transition:    'background 0.15s ease',
  userSelect:    'none',
  WebkitUserSelect: 'none',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function DiaryEditor({ editingEntry, onSave, onCancel, showToast }) {
  const [title,        setTitle]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [showQuickKeys,setShowQuickKeys]= useState(true);
  const [draftStatus,  setDraftStatus]  = useState('idle'); // 'idle'|'saving'|'saved'|'restored'
  const [isEmpty,      setIsEmpty]      = useState(true);

  const editorRef         = useRef(null);
  const titleRef          = useRef('');           // always mirrors `title` state
  const entryIdRef        = useRef(editingEntry?.id || 'new');
  const autoSaveTimerRef  = useRef(null);
  const skipFirstSaveRef  = useRef(true);         // skip autosave on initial load

  // Keep titleRef in sync with state so the autosave closure always reads fresh value
  useEffect(() => { titleRef.current = title; }, [title]);

  // ── Load entry + restore draft ──────────────────────────────────────────────
  useEffect(() => {
    entryIdRef.current   = editingEntry?.id || 'new';
    skipFirstSaveRef.current = true;

    const rawContent = editingEntry?.content || '';
    const ttl        = editingEntry?.title   || '';
    const html       = legacyTextToHtml(rawContent) || '<p><br></p>';

    // Check for a newer local draft
    try {
      const key = `ddiary_draft_${entryIdRef.current}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft     = JSON.parse(raw);
        const ut        = editingEntry?.updatedAt;
        const savedAt   = ut
          ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime())
          : 0;
        if (draft.savedAt > savedAt) {
          setTitle(draft.title ?? ttl);
          titleRef.current = draft.title ?? ttl;
          if (editorRef.current) editorRef.current.innerHTML = draft.content || html;
          setIsEmpty(!(draft.content || '').replace(/<[^>]+>/g,'').trim());
          setDraftStatus('restored');
          return;
        }
      }
    } catch { /* localStorage unavailable */ }

    setTitle(ttl);
    titleRef.current = ttl;
    if (editorRef.current) editorRef.current.innerHTML = html;
    setIsEmpty(!rawContent.trim());
    setDraftStatus('idle');
  }, [editingEntry]);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(autoSaveTimerRef.current), []);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    setDraftStatus('saving');
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      try {
        const key  = `ddiary_draft_${entryIdRef.current}`;
        const html = editorRef.current?.innerHTML || '';
        localStorage.setItem(key, JSON.stringify({
          title:   titleRef.current,
          content: html,
          savedAt: Date.now(),
        }));
        setDraftStatus('saved');
      } catch { /* storage full */ }
    }, 1500);
  }, []);

  // ── Save to server ────────────────────────────────────────────────────────
  const handleSave = async () => {
    const html = editorRef.current?.innerHTML || '';
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
  const handleEditorInput = useCallback(() => {
    const text = editorRef.current?.textContent?.trim() || '';
    setIsEmpty(!text);
    // Renumber any out-of-sequence numbered list items
    requestAnimationFrame(() => fixNumberedListsInDOM(editorRef.current));
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── List continuation on Enter ────────────────────────────────────────────
  const handleEditorKeyDown = useCallback((e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    // Walk up to find the direct child of editorRef
    let block = sel.getRangeAt(0).startContainer;
    while (block && block.parentElement !== editorRef.current) {
      block = block.parentElement;
    }
    if (!block || block === editorRef.current) return;

    const list = detectListPrefix(block.textContent);
    if (!list) return; // let browser handle normally

    e.preventDefault();

    if (!list.body.trim()) {
      // Empty item → clear prefix, leave cursor in blank paragraph
      block.innerHTML = '<br>';
      const r = document.createRange();
      r.setStart(block, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      scheduleAutosave();
      return;
    }

    const nextPrefix = list.type === 'numbered'
      ? `${list.num + 1}${list.sep}`
      : list.prefix;

    // Insert new paragraph after current block
    const newP = document.createElement('p');
    newP.textContent = nextPrefix;
    block.parentNode.insertBefore(newP, block.nextSibling);

    // Move cursor to end of new paragraph
    const r    = document.createRange();
    const node = newP.firstChild;
    r.setStart(node || newP, node ? node.length : 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);

    // Renumber items that follow the newly inserted one
    requestAnimationFrame(() => fixNumberedListsInDOM(editorRef.current));
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── Formatting (Bold / Italic / Underline / Strikethrough) ───────────────
  const handleFormat = useCallback((cmd) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, null);
    scheduleAutosave();
  }, [scheduleAutosave]);

  // ── Quick-keys (adapted for contentEditable) ──────────────────────────────
  const insertAtCursor = useCallback((action) => {
    editorRef.current?.focus();

    if (action === 'backspace') {
      document.execCommand('delete');

    } else if (action === 'enter') {
      // Try list continuation first, then fall back to insertParagraph
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        let block = sel.getRangeAt(0).startContainer;
        while (block && block.parentElement !== editorRef.current) block = block.parentElement;
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
      // space or any character
      document.execCommand('insertText', false, action);
    }
    scheduleAutosave();
  }, [handleEditorKeyDown, scheduleAutosave]);

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in">
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
        </div>

        {/* ── Formatting toolbar ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 8,
          padding: '4px 6px',
          background: 'var(--paper-dark)',
          border: '1px solid var(--paper-line)',
          borderRadius: 8,
        }}>
          {[
            { icon: <Bold size={15} />,          cmd: 'bold',          label: 'Bold'          },
            { icon: <Italic size={15} />,        cmd: 'italic',        label: 'Italic'        },
            { icon: <Underline size={15} />,     cmd: 'underline',     label: 'Underline'     },
            { icon: <Strikethrough size={15} />, cmd: 'strikeThrough', label: 'Strikethrough' },
          ].map(({ icon, cmd, label }) => (
            <button
              key={cmd}
              onMouseDown={e => { e.preventDefault(); handleFormat(cmd); }}
              title={label}
              style={{
                background: 'none',
                border: '1px solid transparent',
                borderRadius: 6,
                cursor: 'pointer',
                padding: '4px 7px',
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = 'var(--paper)';
                e.currentTarget.style.borderColor   = 'var(--paper-line)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = 'none';
                e.currentTarget.style.borderColor   = 'transparent';
              }}
            >
              {icon}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, color: 'var(--ink-lighter)', fontFamily: 'var(--font-body)', userSelect: 'none' }}>
            Select text then click to format
          </span>
        </div>

        {/* ── Editor area + Quick-Keys ── */}
        <div className="editor-layout" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>

          {/* contentEditable editor */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {/* Placeholder (shown when editor is empty) */}
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
              className="diary-editor"
            />
          </div>

          {/* Quick-Keys panel */}
          {showQuickKeys ? (
            <div className="editor-quick-keys" style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              background: 'var(--paper)',
              border: '1px solid var(--paper-line)',
              borderRadius: 12,
              padding: '6px 6px 8px',
              boxShadow: '0 3px 14px rgba(124, 58, 237, 0.15)',
              position: 'sticky',
              top: 120,
            }}>
              <button
                onClick={() => setShowQuickKeys(false)}
                title="Hide quick keys"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--ink-lighter)', fontSize: 11,
                  padding: '0 2px 2px', fontFamily: 'var(--font-body)',
                  alignSelf: 'flex-end', lineHeight: 1,
                }}
              >✕</button>

              <button onMouseDown={e => { e.preventDefault(); insertAtCursor('backspace'); }}   title="Backspace"       style={quickKeyStyle}>⌫</button>
              <button onMouseDown={e => { e.preventDefault(); insertAtCursor(' '); }}           title="Space"           style={{ ...quickKeyStyle, fontSize: 13, fontFamily: 'var(--font-body)', letterSpacing: 0.5 }}>spc</button>
              <button onMouseDown={e => { e.preventDefault(); insertAtCursor('enter'); }}       title="Enter / new line" style={quickKeyStyle}>↵</button>

              <div style={{ width: '70%', height: 1, background: 'var(--paper-line)', margin: '2px 0' }} />

              <button onMouseDown={e => { e.preventDefault(); insertAtCursor('list-numbered'); }} title="Start numbered list" style={{ ...quickKeyStyle, fontSize: 13, fontFamily: 'var(--font-body)', fontWeight: 700 }}>1.</button>
              <button onMouseDown={e => { e.preventDefault(); insertAtCursor('list-bullet'); }}   title="Start bullet list"   style={{ ...quickKeyStyle, fontSize: 18 }}>•</button>
            </div>
          ) : (
            <button
              className="editor-quick-keys-reopen"
              onClick={() => setShowQuickKeys(true)}
              title="Show quick keys"
              style={{
                flexShrink: 0,
                background: 'var(--gold)',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: 40,
                height: 40,
                cursor: 'pointer',
                fontSize: 17,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                position: 'sticky',
                top: 120,
              }}
            >⌨</button>
          )}
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
    </div>
  );
}
