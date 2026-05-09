import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X, Bold, Italic, Underline, Strikethrough } from 'lucide-react';

// Re-numbers consecutive numbered list items starting after `afterCursor`.
// Called after a new numbered item is inserted so the items that follow
// don't end up with duplicate numbers.
function renumberSubsequentItems(text, afterCursor, insertedNum, sep) {
  const lineEnd = text.indexOf('\n', afterCursor);
  if (lineEnd === -1) return text; // nothing after the inserted line
  const before = text.substring(0, lineEnd + 1);
  const rest   = text.substring(lineEnd + 1);
  const lines  = rest.split('\n');
  let expected = insertedNum + 1;
  const renumbered = lines.map(line => {
    const m = line.match(/^(\d+)([.)]\s+)(.*)/);
    if (m) {
      const out = `${expected}${m[2]}${m[3]}`;
      expected++;
      return out;
    }
    return line; // non-numbered line → stop incrementing
  });
  return before + renumbered.join('\n');
}

// Shared style for quick-key buttons
const quickKeyStyle = {
  background: 'var(--paper-dark)',
  border: '1px solid var(--paper-line)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 20,
  width: 46,
  height: 46,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  color: 'var(--ink)',
  transition: 'background 0.15s ease',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

export default function DiaryEditor({ editingEntry, onSave, onCancel, showToast }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showQuickKeys, setShowQuickKeys] = useState(true);
  // 'idle' | 'saving' | 'saved' | 'restored'
  const [draftStatus, setDraftStatus] = useState('idle');
  const textareaRef = useRef(null);
  // Tracks the previous textarea value so onChange can detect newly inserted newlines
  // from handwriting/IME input that never fires a keydown event.
  const prevTextRef = useRef('');
  // Tracks the entry ID being edited so the autosave effect can build the draft key
  // without adding editingEntry to its dependency array (which would reset the timer).
  const entryIdRef = useRef(editingEntry?.id || 'new');
  // When true, the next [title, content] effect run is from an internal load/restore
  // and should NOT trigger a draft write.
  const skipDraftOnceRef = useRef(true);

  useEffect(() => {
    entryIdRef.current = editingEntry?.id || 'new';
    skipDraftOnceRef.current = true; // don't autosave the initial state load

    const text = editingEntry ? (editingEntry.content || '') : '';
    const ttl  = editingEntry ? (editingEntry.title   || '') : '';

    // ── Draft restore ────────────────────────────────────────────────────────
    // If there is a locally-saved draft that is newer than the last server save,
    // restore it silently so nothing is lost on accidental back-navigation.
    try {
      const draftKey = `ddiary_draft_${entryIdRef.current}`;
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        const ut = editingEntry?.updatedAt;
        const entrySavedAt = ut
          ? (ut.seconds ? ut.seconds * 1000 : new Date(ut).getTime())
          : 0;
        if (draft.savedAt > entrySavedAt && (draft.title !== ttl || draft.content !== text)) {
          setTitle(draft.title ?? ttl);
          setContent(draft.content ?? text);
          prevTextRef.current = draft.content ?? text;
          setDraftStatus('restored');
          return; // skip the normal load below
        }
      }
    } catch { /* localStorage unavailable */ }

    setTitle(ttl);
    setContent(text);
    prevTextRef.current = text;
    setDraftStatus('idle');
  }, [editingEntry]);

  // ── Autosave to localStorage ──────────────────────────────────────────────
  // Fires 1.5 s after the last change to title or content.
  // The skipDraftOnceRef guard prevents a write on the initial load/restore.
  useEffect(() => {
    if (skipDraftOnceRef.current) {
      skipDraftOnceRef.current = false;
      return;
    }
    setDraftStatus('saving');
    const draftKey = `ddiary_draft_${entryIdRef.current}`;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ title, content, savedAt: Date.now() }));
        setDraftStatus('saved');
      } catch { /* storage full or unavailable */ }
    }, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [content]);

  const handleSave = async () => {
    if (!title.trim() && !content.trim()) {
      showToast('Please add a title or some content.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), content: content.trim() });
      // Clear draft — content is now safely persisted on the server
      try { localStorage.removeItem(`ddiary_draft_${entryIdRef.current}`); } catch {}
      setDraftStatus('idle');
      showToast('Entry saved!', 'success');
    } catch (err) {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

  // Returns list continuation info if current line is a list item, else null
  const detectListPrefix = (line) => {
    const numbered = line.match(/^(\d+)([.)]\s+)(.*)/);
    if (numbered) {
      return { type: 'numbered', num: parseInt(numbered[1]), sep: numbered[2], body: numbered[3] };
    }
    const bullet = line.match(/^([-*•]\s+)(.*)/);
    if (bullet) {
      return { type: 'bullet', prefix: bullet[1], body: bullet[2] };
    }
    return null;
  };

  // Core logic for continuing (or exiting) a list when Enter is pressed.
  // Always pass the live DOM value (ta.value) so handwriting / IME input
  // that hasn't yet synced to React state is handled correctly.
  const handleEnterForList = useCallback((currentContent, cursorPos) => {
    const textBefore = currentContent.substring(0, cursorPos);
    const textAfter = currentContent.substring(cursorPos);
    const lineStart = textBefore.lastIndexOf('\n') + 1;
    const currentLine = textBefore.substring(lineStart);
    const list = detectListPrefix(currentLine);
    if (!list) return null;

    if (!list.body.trim()) {
      // Empty list item → exit list
      const newText = textBefore.substring(0, lineStart) + '\n' + textAfter;
      return { newText, newCursor: lineStart + 1 };
    }

    const nextPrefix = list.type === 'numbered'
      ? `${list.num + 1}${list.sep}`
      : list.prefix;
    let newText = textBefore + '\n' + nextPrefix + textAfter;
    const newCursor = cursorPos + 1 + nextPrefix.length;
    // Renumber any items that follow so there are no duplicates
    if (list.type === 'numbered') {
      newText = renumberSubsequentItems(newText, newCursor, list.num + 1, list.sep);
    }
    return { newText, newCursor };
  }, []);

  // Helper: apply new text to both DOM + React state, and keep prevTextRef current.
  const applyText = useCallback((ta, newText, newCursor) => {
    ta.value = newText;
    setContent(newText);
    prevTextRef.current = newText;
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = newCursor; }, 0);
  }, []);

  // ── Keyboard Enter (physical keyboard) ────────────────────────────────────
  // Read ta.value directly so any un-synced IME text is included.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const ta = textareaRef.current;
    const result = handleEnterForList(ta.value, ta.selectionStart);
    if (!result) return;

    e.preventDefault();
    applyText(ta, result.newText, result.newCursor);
  };

  // ── onChange: detects newlines inserted by handwriting / IME ─────────────
  // Handwriting recognition commits text (possibly containing \n) via the
  // input event — it never fires keydown with key==='Enter'.
  // We compare newline counts to catch this and apply list continuation.
  const handleChange = useCallback((e) => {
    const newText = e.target.value;
    const ta      = textareaRef.current;
    const prev    = prevTextRef.current;

    const prevNl = (prev.match(/\n/g) || []).length;
    const newNl  = (newText.match(/\n/g) || []).length;

    if (newNl > prevNl) {
      // One or more newlines were inserted by IME/handwriting.
      // Find where the new text first diverges from the old to locate the newline.
      let divergeAt = 0;
      const minLen = Math.min(prev.length, newText.length);
      while (divergeAt < minLen && prev[divergeAt] === newText[divergeAt]) divergeAt++;

      // Walk forward from divergeAt to find the inserted \n
      const nlPos = newText.indexOf('\n', divergeAt);
      if (nlPos !== -1) {
        const afterNl = nlPos + 1;
        // Inspect the line that just ended (before the \n)
        const textBeforeNl  = newText.substring(0, nlPos);
        const prevLineStart = textBeforeNl.lastIndexOf('\n') + 1;
        const currentLine   = textBeforeNl.substring(prevLineStart);
        const list          = detectListPrefix(currentLine);

        if (list && list.body.trim()) {
          // Continue the list: insert the next prefix right after the \n
          const nextPrefix = list.type === 'numbered'
            ? `${list.num + 1}${list.sep}`
            : list.prefix;
          let patched = newText.substring(0, afterNl) + nextPrefix + newText.substring(afterNl);
          const patchCursor = afterNl + nextPrefix.length;
          if (list.type === 'numbered') {
            patched = renumberSubsequentItems(patched, patchCursor, list.num + 1, list.sep);
          }
          applyText(ta, patched, patchCursor);
          return;
        } else if (list && !list.body.trim()) {
          // Empty list item → exit list: remove the prefix from this line
          const stripped = newText.substring(0, prevLineStart) + '\n' + newText.substring(afterNl);
          applyText(ta, stripped, prevLineStart + 1);
          return;
        }
      }
    }

    // Normal change (no new newline, or no list match) — just update state
    prevTextRef.current = newText;
    setContent(newText);
  }, [applyText]);

  // Apply an action at the current cursor position.
  // Reads ta.value directly so handwriting / IME content is always current.
  // Uses applyText so prevTextRef stays in sync (prevents double-fire in onChange).
  const insertAtCursor = useCallback((action) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();

    const liveText = ta.value;
    const pos      = ta.selectionStart;
    const selEnd   = ta.selectionEnd;

    if (action === 'backspace') {
      if (pos === 0 && selEnd === 0) return;
      const start = pos !== selEnd ? pos : pos - 1;
      applyText(ta, liveText.substring(0, start) + liveText.substring(selEnd), start);
      return;
    }

    if (action === 'enter') {
      const result = handleEnterForList(liveText, pos);
      if (result) {
        applyText(ta, result.newText, result.newCursor);
      } else {
        const newText = liveText.substring(0, pos) + '\n' + liveText.substring(selEnd);
        applyText(ta, newText, pos + 1);
      }
      return;
    }

    if (action === 'list-numbered' || action === 'list-bullet') {
      const prefix     = action === 'list-numbered' ? '1. ' : '- ';
      const lineStart  = liveText.lastIndexOf('\n', pos - 1) + 1;
      const linePrefix = liveText.substring(lineStart, pos);
      // If the current line is empty, insert prefix here; otherwise start a new line
      const insert     = linePrefix.trim() === '' ? prefix : '\n' + prefix;
      const newText    = liveText.substring(0, pos) + insert + liveText.substring(selEnd);
      applyText(ta, newText, pos + insert.length);
      return;
    }

    // Regular character (space, etc.)
    applyText(ta, liveText.substring(0, pos) + action + liveText.substring(selEnd), pos + action.length);
  }, [applyText, handleEnterForList]);

  // Wraps selected text with a formatting marker (e.g. **bold**).
  // If nothing is selected, inserts the markers and places cursor between them.
  const wrapSelection = useCallback((marker) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const liveText = ta.value;
    const start    = ta.selectionStart;
    const end      = ta.selectionEnd;
    const selected = liveText.substring(start, end);
    const newText  = liveText.substring(0, start) + marker + selected + marker + liveText.substring(end);
    const newCursor = selected.length > 0
      ? start + marker.length + selected.length + marker.length
      : start + marker.length;
    applyText(ta, newText, newCursor);
  }, [applyText]);

  return (
    <div className="fade-in">
      <h2 className="section-title">
        {editingEntry ? 'Edit Entry' : 'New Entry'}
      </h2>

      <div className="card">
        {/* Title + autosave status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <input
            className="input input-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
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

        {/* Formatting toolbar */}
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
            { icon: <Bold size={15} />,        marker: '**',  title: 'Bold (Ctrl+B)'        },
            { icon: <Italic size={15} />,      marker: '*',   title: 'Italic (Ctrl+I)'      },
            { icon: <Underline size={15} />,   marker: '__',  title: 'Underline'             },
            { icon: <Strikethrough size={15}/>, marker: '~~', title: 'Strikethrough'         },
          ].map(({ icon, marker, title }) => (
            <button
              key={marker}
              onMouseDown={e => { e.preventDefault(); wrapSelection(marker); }}
              title={title}
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
                e.currentTarget.style.background = 'var(--paper)';
                e.currentTarget.style.borderColor = 'var(--paper-line)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.borderColor = 'transparent';
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

        {/* Textarea + Quick-Keys side by side (stacks on phones) */}
        <div className="editor-layout" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {/* Content — takes all remaining width */}
          <textarea
            ref={textareaRef}
            className="textarea"
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Write your thoughts here..."
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 330,
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              resize: 'none',
              overflow: 'hidden',
              paddingBottom: 180, // ≈ 6 empty lines
            }}
          />

          {/* Quick-Keys panel — sits right beside the textarea on desktop,
              floats above the bottom-tab bar on phones. */}
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
              top: 120,          // stays visible while scrolling
            }}>
              {/* Collapse */}
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

              <button
                onMouseDown={e => { e.preventDefault(); insertAtCursor('backspace'); }}
                title="Backspace"
                style={quickKeyStyle}
              >⌫</button>

              <button
                onMouseDown={e => { e.preventDefault(); insertAtCursor(' '); }}
                title="Space"
                style={{ ...quickKeyStyle, fontSize: 13, fontFamily: 'var(--font-body)', letterSpacing: 0.5 }}
              >spc</button>

              <button
                onMouseDown={e => { e.preventDefault(); insertAtCursor('enter'); }}
                title="Enter / new line"
                style={quickKeyStyle}
              >↵</button>

              {/* Divider */}
              <div style={{ width: '70%', height: 1, background: 'var(--paper-line)', margin: '2px 0' }} />

              <button
                onMouseDown={e => { e.preventDefault(); insertAtCursor('list-numbered'); }}
                title="Start numbered list (auto-continues on Enter)"
                style={{ ...quickKeyStyle, fontSize: 13, fontFamily: 'var(--font-body)', fontWeight: 700 }}
              >1.</button>

              <button
                onMouseDown={e => { e.preventDefault(); insertAtCursor('list-bullet'); }}
                title="Start bullet list (auto-continues on Enter)"
                style={{ ...quickKeyStyle, fontSize: 18 }}
              >•</button>
            </div>
          ) : (
            /* Re-open — tiny button aligned to top of textarea */
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

        {/* Action Buttons */}
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
