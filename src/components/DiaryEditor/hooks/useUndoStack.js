/**
 * useUndoStack — custom undo/redo for the DiaryEditor.
 *
 * WHY this exists:
 *   The editor mixes `execCommand` (goes on the browser's undo stack) with
 *   direct DOM mutations like `textContent = …` (invisible to the browser).
 *   After a list-Enter, pressing Ctrl+Z only undoes the paragraph split but
 *   leaves our prefix mutations in place, corrupting content.
 *
 *   This hook owns the undo stack entirely:
 *   - `pushUndo(html)`     — call before any custom DOM operation
 *   - `handleUndoKey(e)`   — call from keydown handler; intercepts Ctrl/Cmd+Z
 *                             and Ctrl/Cmd+Shift+Z / Ctrl+Y for redo
 *   - `onBeforeInput`      — attach to the editor's onBeforeInput to capture
 *                             state before every browser-native change (typing,
 *                             paste, browser-format commands, etc.)
 *
 * State is kept in refs (no React re-renders on push/pop).
 */
import { useRef, useCallback } from 'react';
import { fixNumberedListsInDOM } from '../utils/listUtils';

const MAX_STACK = 80;
const THROTTLE_MS = 400; // group rapid keystrokes into one undo step

export function useUndoStack({ editorRef, scheduleAutosave }) {
  const undoStackRef      = useRef([]);  // array of innerHTML strings
  const redoStackRef      = useRef([]);
  const lastPushTimeRef   = useRef(0);
  const lastHtmlRef       = useRef('');  // avoid pushing identical snapshots

  // ── Push a snapshot ────────────────────────────────────────────────────────
  const pushUndo = useCallback((html) => {
    const snapshot = html ?? editorRef.current?.innerHTML ?? '';
    if (snapshot === lastHtmlRef.current) return; // no-op if nothing changed
    lastHtmlRef.current = snapshot;
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_STACK) undoStackRef.current.shift();
    redoStackRef.current = []; // new action clears redo branch
    lastPushTimeRef.current = Date.now();
  }, [editorRef]);

  // ── Throttled push for regular typing (called from onBeforeInput) ──────────
  const pushUndoThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastPushTimeRef.current < THROTTLE_MS) return;
    pushUndo();
  }, [pushUndo]);

  // ── Perform undo ───────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (!undoStackRef.current.length || !editorRef.current) return;
    // Save current state to redo stack before restoring
    redoStackRef.current.push(editorRef.current.innerHTML);
    const prev = undoStackRef.current.pop();
    lastHtmlRef.current = prev;
    editorRef.current.innerHTML = prev;
    fixNumberedListsInDOM(editorRef.current);
    scheduleAutosave();
  }, [editorRef, scheduleAutosave]);

  // ── Perform redo ───────────────────────────────────────────────────────────
  const redo = useCallback(() => {
    if (!redoStackRef.current.length || !editorRef.current) return;
    undoStackRef.current.push(editorRef.current.innerHTML);
    const next = redoStackRef.current.pop();
    lastHtmlRef.current = next;
    editorRef.current.innerHTML = next;
    fixNumberedListsInDOM(editorRef.current);
    scheduleAutosave();
  }, [editorRef, scheduleAutosave]);

  /**
   * Keyboard interceptor — call from the editor's onKeyDown BEFORE any other
   * key handling.  Returns true if the key was consumed (caller should return).
   */
  const handleUndoKey = useCallback((e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return true;
    }
    // Ctrl+Shift+Z or Ctrl+Y
    if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      e.preventDefault();
      redo();
      return true;
    }
    return false;
  }, [undo, redo]);

  /**
   * onBeforeInput handler — attach to <div onBeforeInput={onBeforeInput}>.
   * Captures editor state before every native browser edit so regular typing
   * participates in the undo history.
   */
  const onBeforeInput = useCallback(() => {
    pushUndoThrottled();
  }, [pushUndoThrottled]);

  return { pushUndo, undo, redo, handleUndoKey, onBeforeInput };
}
