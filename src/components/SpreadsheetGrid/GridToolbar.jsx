import { Bold, Italic, Plus, Filter, Download } from 'lucide-react';
import { ck } from './formulaEngine';

// ── Style helpers ─────────────────────────────────────────────────────────────
const divider = { width: 1, height: 18, background: 'var(--paper-line)', margin: '0 4px' };

function tbtnStyle(active) {
  return {
    padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
    display: 'flex', alignItems: 'center',
    gap: 4, border: '1px solid transparent',
    background: active ? 'var(--paper-line)' : 'none',
    color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-body)',
  };
}

/**
 * GridToolbar — the strip above the grid containing:
 * Bold/Italic, colour swatches, Filter, Add Row/Col,
 * Undo/Redo, Download, cell-ref display, and the formula bar.
 */
export default function GridToolbar({
  // formatting
  selCell,
  toggleFmt,
  setCellBg,
  // filter
  showFilter,
  setShowFilter,
  setFilters,
  // structure
  cols,
  addRow,
  addCol,
  // undo/redo
  undo,
  redo,
  undoStack,
  redoStack,
  // download
  downloading,
  setDownloading,
  title,
  data,
  rows,
  downloadSheetAsExcel,
  // formula bar
  sel,
  selEnd,
  selRange,
  selectedRaw,
  editCell,
  editVal,
  setEditVal,
  setEditCell,
  inFormulaMode,
  formulaInsertPos,
  formulaSuggestions,
  suggIdx,
  setSuggIdx,
  applySuggestion,
  commitEdit,
  gridRef,
  fbarRef,
}) {
  const selectedKey = ck(sel.c, sel.r);

  const isEditingSelected = editCell && editCell.c === sel.c && editCell.r === sel.r;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8,
        padding: '4px 8px', background: 'var(--paper-dark)',
        border: '1px solid var(--paper-line)', borderRadius: 8, flexWrap: 'wrap',
      }}
    >
      {/* Bold / Italic */}
      {[
        { icon: <Bold size={14} />, fmt: 'b', label: 'Bold' },
        { icon: <Italic size={14} />, fmt: 'i', label: 'Italic' },
      ].map(({ icon, fmt, label }) => (
        <button
          key={fmt}
          onMouseDown={e => { e.preventDefault(); toggleFmt(fmt); }}
          title={label}
          style={{
            padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            border: '1px solid transparent',
            background: selCell[fmt] ? 'var(--paper-line)' : 'none',
            color: 'var(--ink)',
            fontWeight: fmt === 'b' ? 700 : 400,
          }}
        >
          {icon}
        </button>
      ))}

      <div style={divider} />

      {/* Cell background colour swatches */}
      {[
        { color: '#fef08a', title: 'Yellow fill'  },
        { color: '#bbf7d0', title: 'Green fill'   },
        { color: '#fce7f3', title: 'Pink fill'    },
        { color: '#bfdbfe', title: 'Blue fill'    },
        { color: '#fed7aa', title: 'Orange fill'  },
        { color: '#e0e7ff', title: 'Indigo fill'  },
      ].map(({ color, title: swatchTitle }) => (
        <button
          key={color}
          onMouseDown={e => { e.preventDefault(); setCellBg(selCell.bg === color ? null : color); }}
          title={swatchTitle}
          style={{
            width: 18, height: 18, borderRadius: 4,
            background: color,
            border: selCell.bg === color ? '2px solid #7c3aed' : '1px solid rgba(0,0,0,0.18)',
            cursor: 'pointer', padding: 0, flexShrink: 0,
          }}
        />
      ))}
      {/* Clear fill */}
      {selCell.bg && (
        <button
          onMouseDown={e => { e.preventDefault(); setCellBg(null); }}
          title="Clear cell fill"
          style={{
            padding: '2px 5px', borderRadius: 5, border: '1px solid var(--paper-line)',
            background: 'none', cursor: 'pointer', fontSize: 11,
            color: 'var(--ink-lighter)', display: 'flex', alignItems: 'center',
          }}
        >✕</button>
      )}

      <div style={divider} />

      <button
        onMouseDown={e => { e.preventDefault(); setShowFilter(f => !f); setFilters({}); }}
        title="Toggle column filters"
        style={tbtnStyle(showFilter)}
      >
        <Filter size={13} /> Filter
      </button>

      <div style={divider} />

      <button
        onMouseDown={e => { e.preventDefault(); addRow(); }}
        title="Add 10 rows"
        style={tbtnStyle(false)}
      >
        <Plus size={13} /> Row
      </button>

      {cols < 26 && (
        <button
          onMouseDown={e => { e.preventDefault(); addCol(); }}
          title="Add column"
          style={tbtnStyle(false)}
        >
          <Plus size={13} /> Col
        </button>
      )}

      <div style={divider} />

      <button
        onMouseDown={e => { e.preventDefault(); undo(); }}
        title="Undo (Ctrl+Z)"
        disabled={!undoStack.current.length}
        style={{ ...tbtnStyle(false), opacity: undoStack.current.length ? 1 : 0.35 }}
      >↩ Undo</button>

      <button
        onMouseDown={e => { e.preventDefault(); redo(); }}
        title="Redo (Ctrl+Y)"
        disabled={!redoStack.current.length}
        style={{ ...tbtnStyle(false), opacity: redoStack.current.length ? 1 : 0.35 }}
      >↪ Redo</button>

      <div style={divider} />

      <button
        onMouseDown={e => {
          e.preventDefault();
          if (downloading) return;
          setDownloading(true);
          downloadSheetAsExcel({ title, data, cols, rows })
            .catch(err => console.error('Download failed:', err))
            .finally(() => setDownloading(false));
        }}
        title="Download as Excel (.xlsx)"
        disabled={downloading}
        style={{ ...tbtnStyle(false), opacity: downloading ? 0.5 : 1 }}
      >
        <Download size={13} /> {downloading ? 'Saving…' : 'Excel'}
      </button>

      <div style={{ flex: 1 }} />

      {/* Cell ref display */}
      <span
        style={{
          fontSize: 12, fontFamily: 'monospace', color: 'var(--ink-light)',
          minWidth: 40, textAlign: 'center', fontWeight: 700,
        }}
      >
        {selEnd
          ? `${ck(selRange.c1, selRange.r1)}:${ck(selRange.c2, selRange.r2)}`
          : selectedKey}
      </span>

      {/* Formula bar */}
      <div style={{ position: 'relative' }}>
        <input
          ref={fbarRef}
          value={isEditingSelected ? editVal : String(selectedRaw)}
          onChange={e => {
            if (!editCell || !isEditingSelected) {
              setEditCell(sel);
              setEditVal(e.target.value);
            } else {
              setEditVal(e.target.value);
              formulaInsertPos.current = null;
            }
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (formulaSuggestions.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, formulaSuggestions.length - 1)); return; }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, 0)); return; }
              if (e.key === 'Tab')       { e.preventDefault(); applySuggestion(formulaSuggestions[suggIdx]); return; }
            }
            if (e.key === 'Enter') {
              commitEdit(sel.c, sel.r, editVal || String(selectedRaw));
              e.preventDefault();
            } else if (e.key === 'Escape') {
              setEditCell(null);
              setEditVal('');
              formulaInsertPos.current = null;
              requestAnimationFrame(() => gridRef.current?.focus());
            }
          }}
          onFocus={() => {
            if (!editCell || editCell.c !== sel.c || editCell.r !== sel.r) {
              setEditCell(sel);
              setEditVal(String(selectedRaw));
            }
          }}
          placeholder="Enter value or =formula"
          style={{
            width: 240, height: 28, padding: '0 8px', fontSize: 13, fontFamily: 'monospace',
            border: '1px solid var(--paper-line)', borderRadius: 6, outline: 'none',
            background: '#fff',
            boxShadow: inFormulaMode ? '0 0 0 2px #7c3aed44' : 'none',
          }}
        />
        {formulaSuggestions.length > 0 && (
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: '#fff', border: '1px solid var(--paper-line)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              zIndex: 100, marginTop: 2, overflow: 'hidden',
            }}
          >
            {formulaSuggestions.map((name, i) => (
              <div
                key={name}
                onMouseDown={e => { e.preventDefault(); applySuggestion(name); }}
                style={{
                  padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                  fontFamily: 'monospace',
                  background: i === suggIdx ? '#ede9fe' : 'transparent',
                  color: i === suggIdx ? '#7c3aed' : 'var(--ink)',
                  fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ color: '#7c3aed' }}>ƒ</span>{name}
                <span style={{ fontSize: 10, color: 'var(--ink-lighter)', fontWeight: 400, marginLeft: 'auto' }}>Tab</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
