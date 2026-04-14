/**
 * emailPrefs.js
 * Module-level singleton that caches the current user's email notification preferences.
 * Updated by AuthContext whenever the user object changes.
 * Consumed by emailNotifications.js to gate each email send.
 */

let _prefs = null;

/**
 * Called from AuthContext when user settings load/change.
 * @param {Object|null} settings — user.settings from Firestore
 */
export function updateEmailPrefs(settings) {
  _prefs = settings || null;
}

/**
 * Check whether a specific notification type should trigger an email.
 * Falls back to the global `emailRemindersEnabled` flag for legacy accounts.
 *
 * @param {'taskAssigned'|'statusChanged'|'taskCompleted'|'comment'|'workspaceCreated'} type
 * @returns {boolean}
 */
export function isEmailEnabled(type) {
  if (!_prefs) return true; // prefs not loaded yet — default to enabled

  const perType = _prefs.emailNotifications;

  // If per-type prefs exist, use them
  if (perType && typeof perType === 'object') {
    // A missing key defaults to true (opt-out model)
    return perType[type] !== false;
  }

  // Legacy: honour the global toggle
  return _prefs.emailRemindersEnabled !== false;
}
