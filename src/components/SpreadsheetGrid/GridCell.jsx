import { DEFAULT_ROW_H } from './constants';
import { ck, displayVal } from './formulaEngine';

/**
 * GridCell — renders a single data cell <td>.
 * All event handlers are passed in from the parent to avoid stale closures.
 */
export default function GridCell({
  c,
  r,
  data,
  rowHeights,
  sel,
  selEnd,
  selRange,
  isInRange,
  editCell,
  editVal,
  setEditVal,
  inFormulaMode,
  formulaInsertPos,
  formulaDragRef,
  inputRef,
  commitEdit,
  onCellKeyDown,
  handleCellMouseDown,
  handleCellMouseEnter,
  handleCellClick,
  setContextMenu,
  setSel,
  setSelEnd,
  setEditCell,
}) {
  const fmt      = data[ck(c, r)] || {};
  const editing  = editCell?.c === c && editCell?.r === r;
  const inRange  = isInRange(c, r);
  const isAnchor = sel.c === c && sel.r === r;
  const dv       = displayVal(c, r, data);
  const isNum    = !isNaN(+dv) && dv !== '';
  const isErr    = String(dv).startsWith('#');

  return (
    <td
      data-c={c}
      data-r={r}
      style={{
        border: '1px solid var(--paper-line)',
        height: rowHeights[r] ?? DEFAULT_ROW_H,
        padding: 0,
        cursor: inFormulaMode && !(editCell?.c === c && editCell?.r === r) ? 'crosshair' : 'default',
        background: editing ? '#faf5ff' : inRange ? '#ede9fe' : (fmt.bg || 'transparent'),
        outline: isAnchor && !selEnd ? '2px solid #7c3aed' : inRange && !isAnchor ? '1px solid #a78bfa' : 'none',
        outlineOffset: -1,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      onMouseDown={e => handleCellMouseDown(e, c, r)}
      onMouseEnter={e => handleCellMouseEnter(e, c, r)}
      onClick={e => handleCellClick(e, c, r)}
      onContextMenu={e => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, row: r, col: c });
      }}
      onDoubleClick={() => {
        if (inFormulaMode) return;
        setSel({ c, r });
        setSelEnd(null);
        setEditCell({ c, r });
        setEditVal(String(data[ck(c, r)]?.v ?? ''));
      }}
    >
      {editing ? (
        <textarea
          ref={inputRef}
          value={editVal}
          onChange={e => {
            setEditVal(e.target.value);
            formulaInsertPos.current = null;
          }}
          onKeyDown={onCellKeyDown}
          onBlur={() => {
            if (!formulaDragRef.current) commitEdit(c, r, editVal);
          }}
          style={{
            width: '100%', height: '100%', border: 'none', outline: 'none',
            padding: '2px 4px', fontFamily: 'var(--font-body)', fontSize: 13,
            background: 'transparent',
            fontWeight: fmt.b ? 700 : 400,
            fontStyle: fmt.i ? 'italic' : 'normal',
            resize: 'none', overflow: 'hidden', boxSizing: 'border-box', lineHeight: '1.4',
          }}
        />
      ) : (
        <span
          style={{
            display: 'block',
            overflow: 'hidden',
            whiteSpace: dv.includes?.('\n') ? 'pre-wrap' : 'nowrap',
            textOverflow: dv.includes?.('\n') ? 'clip' : 'ellipsis',
            padding: '0 4px',
            fontWeight: fmt.b ? 700 : 400,
            fontStyle: fmt.i ? 'italic' : 'normal',
            textAlign: isErr ? 'center' : isNum ? 'right' : 'left',
            color: isErr ? '#dc2626' : 'inherit',
            fontSize: 13,
            lineHeight: '1.4',
          }}
        >
          {dv}
        </span>
      )}
    </td>
  );
}
