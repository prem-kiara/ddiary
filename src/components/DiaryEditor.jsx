import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X } from 'lucide-react';

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
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editingEntry) {
      setTitle(editingEntry.title || '');
      setContent(editingEntry.content || '');
    } else {
      setTitle('');
      setContent('');
    }
  }, [editingEntry]);

  // Auto-resize textarea to fit content (+ bottom padding handled by CSS)
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
      showToast('Entry saved!', 'success');
    } catch (err) {
      showToast('Failed to save entry. Please try again.', 'warning');
    }
    setSaving(false);
  };

  // Returns { prefix, body } if current line is a list item, else null
  const detectListPrefix = (line) => {
    const numbered = line.match(/^(\d+)([.)]\s+)(.*)/);
    if (numbered) {
      return {
        type: 'numbered',
        num: parseInt(numbered[1]),
        sep: numbered[2],
        body: numbered[3],
      };
    }
    const bullet = line.match(/^([-*•]\s+)(.*)/);
    if (bullet) {
      return { type: 'bullet', prefix: bullet[1], body: bullet[2] };
    }
    return null;
  };

  // Core logic for continuing (or exiting) a list when Enter is pressed
  const handleEnterForList = useCallback((currentContent, cursorPos) => {
    const textBefore = currentContent.substring(0, cursorPos);
    const textAfter = currentContent.substring(cursorPos);
    const lineStart = textBefore.lastIndexOf('\n') + 1;
    const currentLine = textBefore.substring(lineStart);
    const list = detectListPrefix(currentLine);
    if (!list) return null;

    if (!list.body.trim()) {
      // Empty list item → exit the list (remove the prefix)
      const newText = textBefore.substring(0, lineStart) + '\n' + textAfter;
      return { newText, newCursor: lineStart + 1 };
    }

    let nextPrefix;
    if (list.type === 'numbered') {
      nextPrefix = `${list.num + 1}${list.sep}`;
    } else {
      nextPrefix = list.prefix;
    }
    const newText = textBefore + '\n' + nextPrefix + textAfter;
    return { newText, newCursor: cursorPos + 1 + nextPrefix.length };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const ta = textareaRef.current;
    const result = handleEnterForList(content, ta.selectionStart);
    if (!result) return;

    e.preventDefault();
    setContent(result.newText);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = result.newCursor;
    }, 0);
  };

  // Insert text (or perform Backspace / Enter) at the textarea cursor
  const insertAtCursor = (action) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();

    const pos = ta.selectionStart;
    const selEnd = ta.selectionEnd;

    if (action === 'backspace') {
      if (pos === 0 && selEnd === 0) return;
      const start = pos !== selEnd ? pos : pos - 1;
      const newText = content.substring(0, start) + content.substring(selEnd);
      setContent(newText);
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start; }, 0);
      return;
    }

    if (action === 'enter') {
      const result = handleEnterForList(content, pos);
      if (result) {
        setContent(result.newText);
        setTimeout(() => { ta.selectionStart = ta.selectionEnd = result.newCursor; }, 0);
      } else {
        const newText = content.substring(0, pos) + '\n' + content.substring(pos);
        setContent(newText);
        setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + 1; }, 0);
      }
      return;
    }

    // Regular character (e.g. space)
    const newText = content.substring(0, pos) + action + content.substring(selEnd);
    setContent(newText);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos + action.length; }, 0);
  };

  return (
    <div className="fade-in">
      <h2 className="section-title">
        {editingEntry ? 'Edit Entry' : 'New Entry'}
      </h2>

      <div className="card">
        {/* Title */}
        <input
          className="input input-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Give your entry a title..."
          style={{ marginBottom: 16 }}
        />

        {/* Content — auto-resizes; paddingBottom keeps ~6 empty lines visible */}
        <textarea
          ref={textareaRef}
          className="textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write your thoughts here..."
          style={{
            minHeight: 330,
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            resize: 'none',
            overflow: 'hidden',
            paddingBottom: 180, // ≈ 6 lines × 30px
          }}
        />

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onCancel}>
            <X size={16} /> Cancel
          </button>
          <button className="btn btn-teal" onClick={handleSave} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>

      {/* ── Floating Quick-Type Panel ─────────────────────────────────────── */}
      {showQuickKeys ? (
        <div style={{
          position: 'fixed',
          bottom: 90,
          right: 14,
          zIndex: 50,
          background: 'var(--paper)',
          border: '1px solid var(--paper-line)',
          borderRadius: 14,
          padding: '8px 8px 10px',
          boxShadow: '0 6px 24px rgba(139, 105, 20, 0.22)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}>
          {/* Collapse button */}
          <button
            onClick={() => setShowQuickKeys(false)}
            title="Hide quick keys"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-lighter)',
              fontSize: 11,
              padding: '0 4px 2px',
              fontFamily: 'var(--font-body)',
              alignSelf: 'flex-end',
              lineHeight: 1,
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
        </div>
      ) : (
        /* Re-open button */
        <button
          onClick={() => setShowQuickKeys(true)}
          title="Show quick keys"
          style={{
            position: 'fixed',
            bottom: 90,
            right: 14,
            zIndex: 50,
            background: 'var(--gold)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: 42,
            height: 42,
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          }}
        >⌨</button>
      )}
    </div>
  );
}
