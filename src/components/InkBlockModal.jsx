/**
 * InkBlockModal — the handwriting surface used to create or edit an ink block
 * inside a diary entry.
 *
 * Thin shell around the shared engine in src/ink/: this component owns only
 * the toolbar state and the modal chrome. All capture, stabilisation, pressure
 * and rendering live in the engine so the full-page and PDF-markup surfaces can
 * reuse them unchanged.
 *
 * Returns a serialised vector document via onSave(doc); the caller decides how
 * to embed it (see ink/inkHtml.js).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Check, Shapes } from 'lucide-react';
import { createInkEngine } from '../ink/inkEngine';
import {
  useInkTools,
  INK_COLORS as COLORS,
  INK_SIZES as SIZES,
  INK_BACKGROUNDS as BACKGROUNDS,
  INK_SMOOTHING as STABILIZERS,
} from './ink/useInkTools';

// Authoring height. Width is measured from the modal so the block fits the
// device; strokes store authoring coordinates and rescale on render.
const INK_HEIGHT = 300;

export default function InkBlockModal({ initialDoc, onSave, onClose }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Tool state and its engine wiring are shared with the full-page canvas so
  // the two surfaces cannot drift apart as options are added.
  const {
    color, setColor, size, setSize, mode, setMode,
    bg, setBg, smooth, setSmooth, penOnly, setPenOnly, shapes, setShapes,
  } = useInkTools(engineRef, ready, { bg: 'ruled' });

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;

    // clientWidth includes the holder's padding; without stripping it the
    // canvas is wider than its container and forces a horizontal scrollbar.
    const cs = getComputedStyle(holder);
    const inner = holder.clientWidth
      - (parseFloat(cs.paddingLeft) || 0)
      - (parseFloat(cs.paddingRight) || 0);
    const width = Math.max(280, Math.min(inner, 900));
    const engine = createInkEngine({
      canvas,
      width,
      height: INK_HEIGHT,
      background: 'ruled',
      onChange: () => setDirty(true),
    });
    engineRef.current = engine;
    if (initialDoc) {
      engine.loadJSON(initialDoc);
      setDirty(false);
    }
    setReady(true);
    return () => { engine.destroy(); engineRef.current = null; };
    // Mount-only: the engine sizes itself once, like the rest of the app's canvases.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    // When editing an existing block, an empty canvas is a deliberate delete and
    // must be saved through — bailing to onClose() silently reverted it and left
    // the old drawing in the document.
    if (e.isEmpty() && !initialDoc) { onClose(); return; }
    onSave(e.toJSON());
  }, [onSave, onClose, initialDoc]);

  // Esc closes; Ctrl+Z / Ctrl+Shift+Z drive the engine's own undo stack.
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); onClose(); return; }
      const meta = ev.ctrlKey || ev.metaKey;
      if (meta && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        ev.shiftKey ? engineRef.current?.redo() : engineRef.current?.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toolBtn = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 11px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: '1px solid ' + (active ? '#7c3aed' : '#cbd5e1'),
    background: active ? '#7c3aed' : '#fff',
    color: active ? '#fff' : '#334155',
  });

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: 940 }}>
        {/* Toolbar */}
        <div className="canvas-toolbar">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {COLORS.map(c => (
              <button
                key={c}
                aria-label={`Colour ${c}`}
                onClick={() => { setColor(c); setMode('pen'); }}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: c,
                  border: '2px solid #fff', cursor: 'pointer', padding: 0,
                  boxShadow: color === c && mode === 'pen'
                    ? '0 0 0 2px #7c3aed' : '0 0 0 1px #cbd5e1',
                }}
              />
            ))}
            <select
              value={size}
              onChange={e => setSize(Number(e.target.value))}
              className="select"
              style={{ width: 'auto', padding: '6px 10px', marginLeft: 4 }}
            >
              {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>

            <button style={toolBtn(mode === 'pen')}         onClick={() => setMode('pen')}><Pen size={14} /> Pen</button>
            <button style={toolBtn(mode === 'highlighter')} onClick={() => setMode('highlighter')}><Highlighter size={14} /> Marker</button>
            <button style={toolBtn(mode === 'eraser')}      onClick={() => setMode('eraser')}><Eraser size={14} /> Eraser</button>
            <button
              style={toolBtn(shapes)}
              onClick={() => setShapes(v => !v)}
              title="Shapes: straighten lines and snap rough boxes, circles and triangles when you lift the pen. Anything unrecognised stays freehand."
            >
              <Shapes size={14} /> Shapes
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-outline" onClick={() => engineRef.current?.undo()} title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
            <button className="btn btn-sm btn-outline" onClick={() => engineRef.current?.redo()} title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
            <button className="btn btn-sm btn-outline" onClick={() => engineRef.current?.clear()} title="Clear all"><Trash2 size={14} /></button>
            <button className="btn-icon" onClick={onClose} title="Close"><X size={20} /></button>
          </div>
        </div>

        {/* Secondary options */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc',
        }}>
          <select value={bg} onChange={e => setBg(e.target.value)} className="select" style={{ width: 'auto', padding: '5px 9px', fontSize: 12 }}>
            {BACKGROUNDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select value={smooth} onChange={e => setSmooth(e.target.value)} className="select" style={{ width: 'auto', padding: '5px 9px', fontSize: 12 }}>
            {STABILIZERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={penOnly} onChange={e => setPenOnly(e.target.checked)} />
            Stylus only (ignore finger)
          </label>
        </div>

        {/* Canvas */}
        <div ref={holderRef} style={{ padding: 12, background: '#f1f5f9', overflow: 'auto' }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block', touchAction: 'none', background: '#fff',
              border: '1px solid #e2e8f0', borderRadius: 8,
              cursor: mode === 'eraser' ? 'cell' : 'crosshair',
              margin: '0 auto',
            }}
          />
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 8, padding: '10px 16px', borderTop: '1px solid #e2e8f0',
        }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            {dirty ? 'Unsaved drawing' : 'Draw with a stylus or finger'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-gold" onClick={handleSave}>
              <Check size={14} /> {initialDoc ? 'Update drawing' : 'Insert drawing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
