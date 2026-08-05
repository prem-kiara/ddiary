/**
 * InkCanvasPage — full-page handwritten note.
 *
 * A canvas note is stored as an ordinary diary entry whose `content` is a
 * sequence of ink blocks, one per page. That choice is the whole design:
 * listing, search, archive, trash, sharing, version history, email and PDF
 * export all keep working untouched, because to the rest of the app this is
 * just an entry. No new Firestore collection, no new security rules, no
 * migration — and DiaryView already renders ink blocks, so a canvas note is
 * readable without a single change to the viewer.
 *
 * Memory: **one engine is alive at a time**, not one per page. An A4 page at
 * 3× DPR is roughly 14 MB of backing store per canvas and the engine keeps two
 * offscreen layers, so a page-per-engine design would exhaust an iPad within a
 * few pages. Switching page serialises the current one and reloads the next.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Save, X, Pen, Highlighter, Eraser, Undo2, Redo2, Trash2,
  Shapes, ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import { createInkEngine } from '../ink/inkEngine';
import { inkBlockHtml, decodeInk, contentInkBytes, INK_CLASS, INK_ATTR } from '../ink/inkHtml';
import {
  useInkTools, SHAPES_ENABLED, INK_COLORS, INK_SIZES, INK_BACKGROUNDS, INK_SMOOTHING,
} from './ink/useInkTools';
import { register as registerUnsaved, unregister as unregisterUnsaved } from '../utils/unsavedState';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { saveSnapshot } from '../utils/diaryHistory';

// A4 portrait aspect. Width adapts to the viewport; height follows.
const PAGE_RATIO = 1123 / 794;
const MAX_PAGE_WIDTH = 900;

// Warn well before Firestore's 1 MiB per-document ceiling, which `content`
// shares with everything else on the entry.
const SIZE_WARN_BYTES = 700 * 1024;

/** Pull the per-page ink documents out of an existing entry's content. */
function pagesFromContent(html) {
  if (!html) return [null];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const blocks = [...doc.querySelectorAll(`.${INK_CLASS}[${INK_ATTR}]`)];
  if (!blocks.length) return [null];
  return blocks.map(el => decodeInk(el.getAttribute(INK_ATTR)));
}

export default function InkCanvasPage({ editingEntry, onSave, onCancel, showToast }) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [title, setTitle] = useState(editingEntry?.title || '');
  const [pages, setPages] = useState(() => pagesFromContent(editingEntry?.content));
  const [pageIdx, setPageIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const tools = useInkTools(engineRef, ready, { bg: 'ruled' });

  // Keep the latest pages/index available to callbacks without re-creating them.
  const pagesRef = useRef(pages);   pagesRef.current = pages;
  const idxRef   = useRef(pageIdx); idxRef.current = pageIdx;
  const dirtyRef = useRef(dirty);   dirtyRef.current = dirty;

  // Re-sync when the entry resolves after first render.
  //
  // Reaching /canvas/:id without router state — a bookmarked or pasted URL, a
  // session restore that dropped history.state — renders before `entries` has
  // loaded, so the lazy initialisers above captured an empty note. Without this
  // the user sees a blank page, draws one stroke, saves, and every page of the
  // real note is replaced. DiaryEditor has the equivalent re-load effect, which
  // is why the text editor never had this problem.
  const loadedIdRef = useRef(editingEntry?.id ?? null);
  useEffect(() => {
    const id = editingEntry?.id ?? null;
    if (id === loadedIdRef.current) return;
    loadedIdRef.current = id;
    if (dirtyRef.current) return;   // never clobber unsaved work
    const next = pagesFromContent(editingEntry?.content);
    pagesRef.current = next;
    setPages(next);
    setPageIdx(0);
    idxRef.current = 0;
    setTitle(editingEntry?.title || '');
    engineRef.current?.loadJSON(next[0] || { v: 1, w: dims.w, h: dims.h, s: [] });
  }, [editingEntry?.id, editingEntry?.content, editingEntry?.title, dims.w, dims.h]);

  // ── Measure the page before building the engine ───────────────────────────
  // A mount effect can run before the container has its final width, which
  // silently pinned the page to the 320px minimum inside a 1082px column. A
  // ResizeObserver gives us the settled width instead of a guess.
  const [pageW, setPageW] = useState(0);
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const measure = () => {
      const cs = getComputedStyle(holder);
      const inner = holder.clientWidth
        - (parseFloat(cs.paddingLeft) || 0)
        - (parseFloat(cs.paddingRight) || 0);
      if (inner > 0) setPageW(Math.max(320, Math.min(inner, MAX_PAGE_WIDTH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(holder);
    return () => ro.disconnect();
  }, []);

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  // Built once, as soon as a real width is known. Later container resizes are
  // deliberately ignored: this is a paged document, so a page keeps the size it
  // was authored at rather than reflowing ink when the window changes.
  //
  // Note this effect returns NO cleanup. It depends on `pageW`, and React runs
  // the previous cleanup whenever a dependency changes — so destroying here
  // tore the engine down on any resize (iPad rotation, a scrollbar appearing)
  // while the early-return guard stopped it ever being rebuilt. The canvas kept
  // showing its last painted frame, so it looked alive while drawing, undo and
  // page switching all silently no-opped, and saving then wrote an empty note.
  // Teardown belongs on unmount only, below.
  const builtRef = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageW || builtRef.current) return;
    builtRef.current = true;

    const w = pageW;
    const h = Math.round(w * PAGE_RATIO);
    setDims({ w, h });

    const engine = createInkEngine({
      canvas, width: w, height: h, background: 'ruled',
      onChange: () => setDirty(true),
    });
    engineRef.current = engine;
    if (pagesRef.current[0]) engine.loadJSON(pagesRef.current[0]);
    setReady(true);
  }, [pageW]);

  useEffect(() => () => {
    engineRef.current?.destroy();
    engineRef.current = null;
  }, []);

  /** Persist whatever is on screen into the pages array. */
  const capture = useCallback(() => {
    const e = engineRef.current;
    if (!e) return pagesRef.current;
    const next = [...pagesRef.current];
    next[idxRef.current] = e.isEmpty() ? null : e.toJSON();
    pagesRef.current = next;
    setPages(next);
    return next;
  }, []);

  const goToPage = useCallback((i) => {
    const e = engineRef.current;
    if (!e || i === idxRef.current) return;
    const next = capture();
    setPageIdx(i);
    idxRef.current = i;
    e.loadJSON(next[i] || { v: 1, w: dims.w, h: dims.h, s: [] });
  }, [capture, dims.w, dims.h]);

  const addPage = useCallback(() => {
    const next = [...capture(), null];
    pagesRef.current = next;
    setPages(next);
    goToPage(next.length - 1);
  }, [capture, goToPage]);

  const deletePage = useCallback(async () => {
    if (pagesRef.current.length <= 1) {
      engineRef.current?.clear();   // undoable via the engine's command stack
      return;
    }
    // Deleting a page is NOT undoable — loadJSON resets the engine's undo
    // stack — so it gets the same confirmation every other destructive action
    // in the app uses. One mis-tap on a tablet would otherwise destroy a full
    // page of handwriting with no way back.
    const ok = await confirm(
      `Delete page ${idxRef.current + 1} and everything written on it? This cannot be undone.`,
      { title: 'Delete page', danger: true, okText: 'Delete page' },
    );
    if (!ok) return;
    const i = idxRef.current;
    const next = pagesRef.current.filter((_, k) => k !== i);
    pagesRef.current = next;
    setPages(next);
    const target = Math.min(i, next.length - 1);
    setPageIdx(target);
    idxRef.current = target;
    engineRef.current?.loadJSON(next[target] || { v: 1, w: dims.w, h: dims.h, s: [] });
    setDirty(true);
  }, [dims.w, dims.h]);

  // ── Unsaved-work lock (shared with the deep-link tab coordinator) ─────────
  useEffect(() => {
    if (dirty) registerUnsaved('ink-canvas');
    else unregisterUnsaved('ink-canvas');
    return () => unregisterUnsaved('ink-canvas');
  }, [dirty]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const all = capture();
    const filled = all.filter(Boolean);
    if (!title.trim() && !filled.length) {
      showToast?.('Add a title or write something first.', 'warning');
      return;
    }
    const content = filled.map(inkBlockHtml).join('');
    // Firestore rejects documents over 1 MiB and the live-sync write path
    // swallows that error, so the user must be told before it silently fails.
    const bytes = contentInkBytes(content);
    setSaving(true);
    try {
      const finalTitle = title.trim() || 'Handwritten note';
      await onSave({ title: finalTitle, content, kind: 'canvas' });
      setDirty(false);
      // Warn *instead of* the success toast — the app renders one toast slot,
      // so a success message would immediately replace the warning whose whole
      // purpose is to stop the note walking into Firestore's 1 MiB limit.
      if (bytes > SIZE_WARN_BYTES) {
        showToast?.(
          `Saved — but this note is very large (${Math.round(bytes / 1024)} KB). Start a new note soon.`,
          'warning',
        );
      } else {
        showToast?.('Note saved!', 'success');
      }

      // Version snapshot, matching DiaryEditor. Without this a handwritten note
      // has no history at all, so any bad save is unrecoverable.
      if (editingEntry?.id) {
        saveSnapshot({
          uid:      user?.uid,
          entryId:  editingEntry.id,
          isShared: !!(editingEntry.isShared || editingEntry.isSharedWithMe),
          title:    finalTitle,
          content,
          savedBy:  user?.displayName || user?.email || '',
          type:     'manual',
        }).catch(() => {});   // best-effort — never block the save
      }
    } catch {
      showToast?.('Failed to save. Please try again.', 'warning');
    }
    setSaving(false);
  }, [capture, title, onSave, showToast, editingEntry, user]);

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (ev) => {
      const meta = ev.ctrlKey || ev.metaKey;
      if (meta && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        ev.shiftKey ? engineRef.current?.redo() : engineRef.current?.undo();
      } else if (meta && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  const btn = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '7px 11px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: '1px solid ' + (active ? '#7c3aed' : '#cbd5e1'),
    background: active ? '#7c3aed' : '#fff',
    color: active ? '#fff' : '#334155',
  });

  const { color, setColor, size, setSize, mode, setMode,
          bg, setBg, smooth, setSmooth, penOnly, setPenOnly, shapes, setShapes } = tools;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 8px 32px' }}>
      {/* Everything above the sheet is pinned — title, save/cancel, tools and
          page controls. An A4 sheet is far taller than the screen, so without
          this you have to scroll back to the top to rename, change colour or
          switch page, then scroll down again to carry on writing. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#f8fafc', paddingTop: 8,
        boxShadow: '0 4px 12px -6px rgba(15,23,42,0.25)',
      }}>
      {/* Title + actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); setDirty(true); }}
          placeholder="Untitled handwritten note"
          className="input"
          style={{ flex: 1, minWidth: 180, fontSize: 17, fontWeight: 600, padding: '10px 12px' }}
        />
        <button className="btn btn-outline" onClick={onCancel}><X size={16} /> Cancel</button>
        <button className="btn btn-teal" onClick={handleSave} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save Note'}
        </button>
      </div>

      {/* userSelect:none throughout the chrome — a pointer the engine declines
          (a resting palm, or any finger in stylus-only mode) falls through to
          the browser, which starts a text-selection drag and highlights
          whatever control it reaches. Nobody needs to select toolbar labels. */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 10px', background: '#fff', userSelect: 'none', WebkitUserSelect: 'none',
        border: '1px solid #e2e8f0', borderRadius: '10px 10px 0 0',
        boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
      }}>
        {INK_COLORS.map(c => (
          <button
            key={c}
            aria-label={`Colour ${c}`}
            onClick={() => { setColor(c); setMode('pen'); }}
            style={{
              width: 26, height: 26, borderRadius: '50%', background: c,
              border: '2px solid #fff', cursor: 'pointer', padding: 0,
              boxShadow: color === c && mode === 'pen' ? '0 0 0 2px #7c3aed' : '0 0 0 1px #cbd5e1',
            }}
          />
        ))}
        <select value={size} onChange={e => setSize(Number(e.target.value))}
                className="select" style={{ width: 'auto', padding: '6px 10px' }}>
          {INK_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button style={btn(mode === 'pen')}         onClick={() => setMode('pen')}><Pen size={14} /> Pen</button>
        <button style={btn(mode === 'highlighter')} onClick={() => setMode('highlighter')}><Highlighter size={14} /> Marker</button>
        <button style={btn(mode === 'eraser')}      onClick={() => setMode('eraser')}><Eraser size={14} /> Eraser</button>
        {SHAPES_ENABLED && (
          <button style={btn(shapes)} onClick={() => setShapes(v => !v)}
                  title="Straighten lines and snap rough boxes, circles and triangles on pen-up">
            <Shapes size={14} /> Shapes
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-outline" onClick={() => engineRef.current?.undo()} title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
        <button className="btn btn-sm btn-outline" onClick={() => engineRef.current?.redo()} title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
        <button className="btn btn-sm btn-outline" onClick={deletePage} title="Clear or delete this page"><Trash2 size={14} /></button>
      </div>

      {/* Options */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: '7px 10px', background: '#f8fafc', borderLeft: '1px solid #e2e8f0',
        borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0',
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}>
        <select value={bg} onChange={e => setBg(e.target.value)} className="select"
                style={{ width: 'auto', padding: '5px 9px', fontSize: 12 }}>
          {INK_BACKGROUNDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <select value={smooth} onChange={e => setSmooth(e.target.value)} className="select"
                style={{ width: 'auto', padding: '5px 9px', fontSize: 12 }}>
          {INK_SMOOTHING.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={penOnly} onChange={e => setPenOnly(e.target.checked)} />
          Stylus only (ignore finger)
        </label>

        <span style={{ flex: 1 }} />

        {/* Page navigation */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-sm btn-outline" disabled={pageIdx === 0}
                  onClick={() => goToPage(pageIdx - 1)} title="Previous page">
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: '#475569', minWidth: 78, textAlign: 'center', fontWeight: 600 }}>
            Page {pageIdx + 1} of {pages.length}
          </span>
          <button className="btn btn-sm btn-outline" disabled={pageIdx >= pages.length - 1}
                  onClick={() => goToPage(pageIdx + 1)} title="Next page">
            <ChevronRight size={14} />
          </button>
          <button className="btn btn-sm btn-outline" onClick={addPage} title="Add a page">
            <Plus size={14} /> Page
          </button>
        </div>
      </div>
      </div>{/* /sticky */}

      {/* The page */}
      <div ref={holderRef} style={{
        padding: 14, background: '#eef2f7',
        border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px',
        display: 'flex', justifyContent: 'center',
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block', background: '#fff',
            borderRadius: 6, boxShadow: '0 2px 10px rgba(15,23,42,0.12)',
            cursor: mode === 'eraser' ? 'cell' : 'crosshair',
            // No selection or iOS callout: a palm the engine declines otherwise
            // falls through to the browser, which begins a text-selection drag
            // across the page and pops the Copy/Look Up menu over the toolbar.
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
            // Always 'none'. touch-action applies to EVERY direct-manipulation
            // pointer, the Apple Pencil included — it cannot distinguish pen
            // from finger. Setting pan-y here to let a finger scroll also let
            // the browser claim the Pencil's vertical strokes for scrolling and
            // fire pointercancel, so stylus-only mode could not write at all.
            // Scroll the page using the margins beside the sheet instead.
            touchAction: 'none',
          }}
        />
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>
        {dirty ? 'Unsaved changes' : 'Write with a stylus or finger · Ctrl+Z to undo · Ctrl+S to save'}
      </div>
    </div>
  );
}
