/**
 * Module-level holder for the AuthContext refreshMsToken function.
 *
 * Why this exists:
 *   Util files (graphPeopleSearch, emailNotifications) need to recover from a
 *   401 Unauthorized by refreshing the Microsoft access token, but they can't
 *   import from React context. Threading refreshMsToken through every call
 *   site clutters every caller with the same boilerplate.
 *
 *   Instead, AuthProvider registers its refreshMsToken on mount via
 *   setMsTokenRefresher(), and any util can call tryRefreshMsToken() without
 *   knowing where it came from. Same idea as a service locator, scoped to one
 *   tiny concern.
 *
 *   Returns the new token string on success, or null if there's no refresher
 *   registered or the refresh failed (so callers can decide whether to throw
 *   or fall back to an empty result).
 */

let refreshFn = null;

export function setMsTokenRefresher(fn) {
  refreshFn = fn;
}

export async function tryRefreshMsToken() {
  if (typeof refreshFn !== 'function') return null;
  try {
    return await refreshFn();
  } catch {
    return null;
  }
}
