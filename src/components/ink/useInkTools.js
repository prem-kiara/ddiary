/**
 * useInkTools — shared tool state for every inking surface.
 *
 * Both the inline handwriting pad (InkBlockModal) and the full-page canvas
 * (InkCanvasPage) expose the same controls and must push them into the engine
 * identically. Keeping that wiring here means the two surfaces cannot drift
 * apart as options are added, and there is exactly one place that knows how a
 * toolbar choice maps onto an engine call.
 *
 * The component owns the chrome; this hook owns the state and the effects.
 */
import { useState, useEffect } from 'react';
import { TOOL, DEVICE_POLICY } from '../../ink/inkEngine';

/**
 * Shape recognition is implemented and tested (see ink/shapeRecognition.js and
 * its 26 tests) but its UI is deliberately withheld for now.
 *
 * Rationale: it is the only ink feature that *replaces* a stroke the user drew,
 * so a false positive destroys work rather than merely looking wrong. Review
 * found several everyday gestures — a square box, an arrow, a capital "U" —
 * being silently rewritten. Those are fixed, but the feature is being held back
 * to bake while the rest of the handwriting work lands.
 *
 * Flip this to true to expose the Shapes button in both inking surfaces; the
 * engine plumbing (setShapeMode) is already wired and stays exercised by tests.
 */
export const SHAPES_ENABLED = false;

export const INK_COLORS = ['#1a1a2e', '#dc2626', '#2563eb', '#15803d', '#d97706', '#7c3aed'];

export const INK_SIZES = [
  { label: 'Fine',   value: 1.2 },
  { label: 'Medium', value: 2.2 },
  { label: 'Thick',  value: 3.6 },
  { label: 'Bold',   value: 6 },
];

export const INK_BACKGROUNDS = [
  { value: 'blank',     label: 'Blank' },
  { value: 'ruled',     label: 'Ruled' },
  { value: 'rule_marg', label: 'Ruled + margin' },
  { value: 'grid',      label: 'Grid' },
  { value: 'dotted',    label: 'Dotted' },
];

export const INK_SMOOTHING = [
  { value: 'off',    label: 'Smoothing: off' },
  { value: 'light',  label: 'Smoothing: light' },
  { value: 'medium', label: 'Smoothing: medium' },
  { value: 'strong', label: 'Smoothing: strong' },
];

const HIGHLIGHTER_COLOR = '#fde047';

/**
 * @param {{current: object|null}} engineRef  ref holding the ink engine
 * @param {boolean} ready                     flips true once the engine exists
 * @param {object}  [initial]
 */
export function useInkTools(engineRef, ready, initial = {}) {
  const [color,   setColor]   = useState(initial.color   ?? INK_COLORS[0]);
  const [size,    setSize]    = useState(initial.size    ?? INK_SIZES[1].value);
  const [mode,    setMode]    = useState('pen');   // pen | highlighter | eraser
  const [bg,      setBg]      = useState(initial.bg      ?? 'ruled');
  const [smooth,  setSmooth]  = useState(initial.smooth  ?? 'medium');
  const [penOnly, setPenOnly] = useState(false);
  const [shapes,  setShapes]  = useState(false);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (mode === 'eraser') {
      e.setEraser({ active: true, mode: 'split', size: 22 });
    } else {
      e.setTool({
        type:  mode === 'highlighter' ? TOOL.HIGHLIGHTER : TOOL.PEN,
        color: mode === 'highlighter' ? HIGHLIGHTER_COLOR : color,
        size,
      });
    }
  }, [engineRef, mode, color, size, ready]);

  useEffect(() => { engineRef.current?.setBackground(bg); },      [engineRef, bg, ready]);
  useEffect(() => { engineRef.current?.setStabilizer(smooth); },  [engineRef, smooth, ready]);
  // Hard-off while the feature is withheld, regardless of any stale state.
  useEffect(() => {
    engineRef.current?.setShapeMode(SHAPES_ENABLED && shapes);
  }, [engineRef, shapes, ready]);
  useEffect(() => {
    engineRef.current?.setPolicy(penOnly ? DEVICE_POLICY.PEN_ONLY : DEVICE_POLICY.AUTO);
  }, [engineRef, penOnly, ready]);

  return {
    color, setColor, size, setSize, mode, setMode,
    bg, setBg, smooth, setSmooth,
    penOnly, setPenOnly, shapes, setShapes,
  };
}
