/**
 * pointerCapture — normalised pen / touch / mouse input for the ink engine.
 *
 * Why this exists (vs. the old DrawingCanvas mouse+touch handlers):
 *
 *  1. **Full sample rate.** Browsers deliver pointermove at most once per
 *     animation frame, but a stylus reports at 120–240 Hz. `getCoalescedEvents()`
 *     hands back every sample the OS buffered since the last frame, so curves
 *     stay smooth instead of polygonal.
 *  2. **Palm rejection.** Once a pen has been seen, touch input is ignored for
 *     PEN_LOCKOUT_MS. This is the same latch Xournal++ uses (1 s default), but
 *     on the web it costs us nothing — `pointerType` tells us directly, so no
 *     device-disabling subsystem is needed.
 *  3. **Multi-touch veto.** A second finger means "pan/zoom", not "draw", so an
 *     in-progress finger stroke is cancelled rather than committed.
 *  4. **Pointer lock per stroke.** Events from any pointerId other than the one
 *     that started the stroke are dropped, so a stray palm mid-stroke can't
 *     inject points.
 *
 * Emits samples in CSS pixels relative to the canvas, with raw platform
 * pressure passed through untouched — normalisation is pressure.js's job.
 */

// After any pen event, ignore touch for this long. Xournal++ defaults to 1000 ms
// with a 500 ms floor; the same values feel right here.
const PEN_LOCKOUT_MS = 1000;

/** Input policies — which pointer types are allowed to draw. */
export const DEVICE_POLICY = {
  AUTO:     'auto',      // pen always draws; touch draws only when no pen is around
  PEN_ONLY: 'pen-only',  // stylus only — finger always pans
  ANY:      'any',       // pen, touch and mouse all draw (desktop/testing)
};

/**
 * @param {HTMLCanvasElement} el          element to listen on
 * @param {object}   handlers
 * @param {Function} handlers.onStart     (sample) => void
 * @param {Function} handlers.onMove      (samples[]) => void  — batched per frame
 * @param {Function} handlers.onEnd       (sample|null) => void
 * @param {Function} handlers.onCancel    () => void
 * @param {Function} [handlers.getPolicy] () => DEVICE_POLICY  — read at event time
 * @returns {{ detach: Function, isDrawing: Function }}
 */
export function attachPointerCapture(el, handlers) {
  const { onStart, onMove, onEnd, onCancel, getPolicy } = handlers;

  let activeId   = null;   // pointerId currently drawing
  let activeType = null;   // its pointerType
  let lastPenAt  = 0;      // timestamp of the most recent pen event
  let touchCount = 0;      // live touch points, for the multi-touch veto

  const policy = () => (getPolicy ? getPolicy() : DEVICE_POLICY.AUTO);

  /** Should this pointer type be allowed to draw right now? */
  function canDraw(type) {
    const p = policy();
    if (p === DEVICE_POLICY.ANY) return true;
    if (type === 'pen') return true;
    if (p === DEVICE_POLICY.PEN_ONLY) return false;
    // AUTO: finger draws only if no pen has touched down recently (palm rejection)
    if (type === 'touch') return performance.now() - lastPenAt > PEN_LOCKOUT_MS;
    return type === 'mouse';
  }

  /** Convert a PointerEvent into an engine sample in canvas-local CSS pixels. */
  function toSample(e) {
    const r = el.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      // Chrome reports 0.5 for devices with no pressure axis, and 0 on some
      // digitizers at lift-off; pressure.js decides what to do with these.
      pressure: e.pressure,
      type:     e.pointerType,
      tiltX:    e.tiltX || 0,
      tiltY:    e.tiltY || 0,
      // Sub-millisecond and monotonic — strictly better than the integer-ms
      // timestamps Xournal++ is stuck with, which matters for velocity.
      t: e.timeStamp,
    };
  }

  function handleDown(e) {
    if (e.pointerType === 'pen') lastPenAt = performance.now();
    if (e.pointerType === 'touch') touchCount++;

    if (activeId !== null) {
      // **A pen always takes over.** Two situations need this:
      //
      //  1. The palm landed first — the normal writing posture. Without the
      //     handover the palm keeps ownership and the pen is ignored for as
      //     long as the hand rests on the glass.
      //  2. The previous stroke never ended. iOS drops a pointerup whenever the
      //     system interrupts a gesture, and `activeId` then stays set forever,
      //     so every later stroke is silently discarded — the reported
      //     "had to write the word several times to complete it". Refusing a
      //     fresh pen-down because a stale one is recorded is never right.
      if (e.pointerType === 'pen') {
        try { el.releasePointerCapture(activeId); } catch { /* not fatal */ }
        activeId = activeType = null;
        onCancel?.();
        // fall through and let the pen claim the stroke below
      } else {
        // Second finger while a finger-stroke is running → that's a pan gesture.
        if (activeType === 'touch' && e.pointerType === 'touch') {
          activeId = activeType = null;
          onCancel?.();
        }
        return;
      }
    }
    if (!canDraw(e.pointerType)) return;

    activeId   = e.pointerId;
    activeType = e.pointerType;
    // Keep receiving moves even if the pointer leaves the element.
    try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    e.preventDefault();
    onStart(toSample(e));
  }

  function handleMove(e) {
    if (e.pointerType === 'pen') lastPenAt = performance.now();
    if (e.pointerId !== activeId) return;
    e.preventDefault();

    // Every buffered sample since the last frame, not just the latest one.
    const raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const batch = raw && raw.length ? raw.map(toSample) : [toSample(e)];
    onMove(batch);
  }

  function handleUp(e) {
    if (e.pointerType === 'touch') touchCount = Math.max(0, touchCount - 1);
    if (e.pointerId !== activeId) return;
    try { el.releasePointerCapture(e.pointerId); } catch { /* not fatal */ }
    activeId = activeType = null;
    onEnd(toSample(e));
  }

  function handleCancel(e) {
    if (e.pointerType === 'touch') touchCount = Math.max(0, touchCount - 1);
    if (e.pointerId !== activeId) return;
    activeId = activeType = null;
    onCancel?.();
  }

  // A pointer the engine declines (a resting palm during the pen lockout, or
  // any finger in stylus-only mode) is handed back to the browser, whose
  // default for a drag is to select text — on iOS that selects across the page
  // and pops the Copy / Look Up callout over the toolbar. CSS user-select
  // covers most of it, but Safari has historically still begun a selection
  // mid-drag, so refuse it at the source too.
  const blockSelection = (e) => e.preventDefault();
  el.addEventListener('selectstart', blockSelection);

  el.addEventListener('pointerdown',   handleDown,   { passive: false });
  el.addEventListener('pointermove',   handleMove,   { passive: false });
  el.addEventListener('pointerup',     handleUp);
  el.addEventListener('pointerleave',  handleUp);
  el.addEventListener('pointercancel', handleCancel);
  // Safety net for the same stuck-stroke problem: if the browser takes capture
  // away (system gesture, app switch) no pointerup may ever arrive, so release
  // ownership here rather than blocking every subsequent stroke.
  el.addEventListener('lostpointercapture', handleCancel);

  return {
    detach() {
      el.removeEventListener('selectstart',   blockSelection);
      el.removeEventListener('pointerdown',   handleDown);
      el.removeEventListener('pointermove',   handleMove);
      el.removeEventListener('pointerup',     handleUp);
      el.removeEventListener('pointerleave',  handleUp);
      el.removeEventListener('pointercancel', handleCancel);
      el.removeEventListener('lostpointercapture', handleCancel);
    },
    isDrawing: () => activeId !== null,
  };
}
