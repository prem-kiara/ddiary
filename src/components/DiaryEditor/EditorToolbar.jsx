import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Table2, Undo2, Redo2, History, PenLine } from 'lucide-react';
import { HIGHLIGHT_COLORS, toolbarBtnStyle, applyHover } from './constants';

/**
 * EditorToolbar
 *
 * The formatting toolbar rendered above the contentEditable editor area.
 * All callbacks close over parent state/refs and are passed as props.
 *
 * Props:
 *   onUndo()                       - undo last action (also Ctrl+Z)
 *   onRedo()                       - redo last undone action (also Ctrl+Shift+Z)
 *   onShowHistory()                - open the version history modal
 *   onFormat(cmd)                  - execCommand wrapper (bold/italic/etc.)
 *   onHighlight(color)             - hiliteColor wrapper
 *   onToggleList(type)             - 'numbered' | 'bullet'
 *   onIndent(increase)             - true = indent, false = outdent
 *   onInsertTable()                - inserts a 3×2 table at cursor
 *   onInsertInk()                  - opens the handwriting pad and inserts a drawing
 *   onCellBgColor(scope, color)    - applies bg to row or col
 *   onInsertAtCursor(action)       - quick-key insertions (backspace/enter)
 *   cellBgPicker                   - null | 'row' | 'col'
 *   setCellBgPicker(value)         - open/close the colour picker dropdown
 */
export default function EditorToolbar({
  onUndo,
  onRedo,
  onShowHistory,
  onFormat,
  onHighlight,
  onToggleList,
  onIndent,
  onInsertTable,
  onInsertInk,
  onCellBgColor,
  onInsertAtCursor,
  cellBgPicker,
  setCellBgPicker,
}) {
  return (
    <div style={{
      display:       'flex',
      alignItems:    'center',
      flexWrap:      'wrap',
      gap:           4,
      marginBottom:  0,
      padding:       '4px 6px',
      background:    'var(--paper-dark)',
      border:        '1px solid var(--paper-line)',
      borderRadius:  8,
    }}>

      {/* ── Undo / Redo ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onUndo(); }}
        title="Undo (Ctrl+Z)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <Undo2 size={15} />
      </button>
      <button
        onMouseDown={e => { e.preventDefault(); onRedo(); }}
        title="Redo (Ctrl+Shift+Z)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <Redo2 size={15} />
      </button>

      {/* ── Version history ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onShowHistory(); }}
        title="Version history — restore a previous version"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <History size={15} />
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── Inline formatting ── */}
      {[
        { icon: <Bold size={15} />,          cmd: 'bold',          label: 'Bold'          },
        { icon: <Italic size={15} />,        cmd: 'italic',        label: 'Italic'        },
        { icon: <Underline size={15} />,     cmd: 'underline',     label: 'Underline'     },
        { icon: <Strikethrough size={15} />, cmd: 'strikeThrough', label: 'Strikethrough' },
      ].map(({ icon, cmd, label }) => (
        <button
          key={cmd}
          onMouseDown={e => { e.preventDefault(); onFormat(cmd); }}
          title={label}
          style={toolbarBtnStyle}
          onMouseEnter={e => applyHover(e, true)}
          onMouseLeave={e => applyHover(e, false)}
        >
          {icon}
        </button>
      ))}

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── List toggles ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onToggleList('numbered'); }}
        title="Numbered list (toggle)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <ListOrdered size={15} />
      </button>
      <button
        onMouseDown={e => { e.preventDefault(); onToggleList('bullet'); }}
        title="Bullet list (toggle)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <List size={15} />
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── Indent / Outdent ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onIndent(true); }}
        title="Increase indent (Tab)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <span style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 1 }}>⇥</span>
      </button>
      <button
        onMouseDown={e => { e.preventDefault(); onIndent(false); }}
        title="Decrease indent (Shift+Tab)"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <span style={{ fontSize: 13, fontFamily: 'monospace', lineHeight: 1 }}>⇤</span>
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── Highlight colours ── */}
      {HIGHLIGHT_COLORS.map(({ color, title }) => (
        <button
          key={color}
          onMouseDown={e => { e.preventDefault(); onHighlight(color); }}
          title={title}
          style={{
            width:        18,
            height:       18,
            borderRadius: '50%',
            background:   color,
            border:       '1px solid rgba(0,0,0,0.15)',
            cursor:       'pointer',
            padding:      0,
            flexShrink:   0,
          }}
        />
      ))}
      {/* Clear highlight */}
      <button
        onMouseDown={e => { e.preventDefault(); onHighlight('transparent'); }}
        title="Clear highlight"
        style={{ ...toolbarBtnStyle, fontSize: 11, padding: '2px 5px', color: 'var(--ink-lighter)' }}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        ✕hl
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── Insert table ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onInsertTable(); }}
        title="Insert table (3 × 2) — Tab moves between cells, Enter adds a row"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <Table2 size={15} />
      </button>

      {/* ── Insert handwriting ── */}
      {onInsertInk && (
        <button
          onMouseDown={e => { e.preventDefault(); onInsertInk(); }}
          title="Insert handwriting / drawing — write with a stylus or finger"
          style={toolbarBtnStyle}
          onMouseEnter={e => applyHover(e, true)}
          onMouseLeave={e => applyHover(e, false)}
        >
          <PenLine size={15} />
        </button>
      )}

      {/* ── Row / Column background colour ── */}
      {['row', 'col'].map(scope => (
        <div key={scope} style={{ position: 'relative' }}
          onMouseDown={e => e.stopPropagation()} // prevent outside-click closing picker immediately
        >
          <button
            onMouseDown={e => {
              e.preventDefault();
              setCellBgPicker(p => (p === scope ? null : scope));
            }}
            title={scope === 'row' ? 'Highlight row background' : 'Highlight column background'}
            style={toolbarBtnStyle}
            onMouseEnter={e => applyHover(e, true)}
            onMouseLeave={e => applyHover(e, false)}
          >
            <span style={{
              fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-body)',
              lineHeight: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              {scope === 'row' ? '▬' : '▐'}
              <span style={{ fontSize: 9, opacity: 0.7 }}>{scope}</span>
            </span>
          </button>
          {cellBgPicker === scope && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300,
              background: 'var(--paper)', border: '1px solid var(--paper-line)',
              borderRadius: 8, padding: '6px 8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
              display: 'flex', gap: 5, alignItems: 'center',
              whiteSpace: 'nowrap',
            }}>
              {HIGHLIGHT_COLORS.map(({ color, title }) => (
                <button
                  key={color}
                  onMouseDown={e => { e.preventDefault(); onCellBgColor(scope, color); }}
                  title={title}
                  style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: color, border: '1px solid rgba(0,0,0,0.15)',
                    cursor: 'pointer', padding: 0, flexShrink: 0,
                  }}
                />
              ))}
              <button
                onMouseDown={e => { e.preventDefault(); onCellBgColor(scope, 'transparent'); }}
                title="Clear background"
                style={{ ...toolbarBtnStyle, fontSize: 10, padding: '1px 5px', color: 'var(--ink-lighter)' }}
              >✕</button>
            </div>
          )}
        </div>
      ))}

      <div style={{ width: 1, height: 18, background: 'var(--paper-line)', margin: '0 2px' }} />

      {/* ── Backspace / Enter quick keys ── */}
      <button
        onMouseDown={e => { e.preventDefault(); onInsertAtCursor('backspace'); }}
        title="Backspace"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <span style={{ fontSize: 15 }}>⌫</span>
      </button>
      <button
        onMouseDown={e => { e.preventDefault(); onInsertAtCursor('enter'); }}
        title="Enter / new line"
        style={toolbarBtnStyle}
        onMouseEnter={e => applyHover(e, true)}
        onMouseLeave={e => applyHover(e, false)}
      >
        <span style={{ fontSize: 15 }}>↵</span>
      </button>

    </div>
  );
}
