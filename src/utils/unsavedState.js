/**
 * unsavedState.js — module-level unsaved-work registry.
 *
 * Components call register(key) when they have unsaved work and
 * unregister(key) when the work is saved or discarded.  Any component
 * can call hasUnsaved() to check whether ANY component currently holds
 * unsaved work.
 *
 * Kept deliberately framework-free (no React) so it can be read from
 * tabCoordinator.js without pulling in React context machinery.
 *
 * Keys used by the app:
 *   'diary-editor'     — DiaryEditor has a pending autosave (draftStatus==='saving')
 *   'task-add-form'    — TaskManager quick-add input has typed text
 */

const _locks = new Set();

/**
 * Mark a piece of work as unsaved.
 * @param {string} key  Stable identifier for the unsaved source.
 */
export function register(key) {
  _locks.add(key);
}

/**
 * Mark a piece of work as saved / discarded.
 * @param {string} key
 */
export function unregister(key) {
  _locks.delete(key);
}

/**
 * Returns true if any component currently has unsaved work.
 */
export function hasUnsaved() {
  return _locks.size > 0;
}

/**
 * For testing only — reset all locks.
 */
export function _reset() {
  _locks.clear();
}
