/**
 * Error monitoring utility.
 *
 * Writes errors to Firestore so they are visible in production without
 * needing a third-party service. Each user's errors go to:
 *   users/{uid}/errorLogs/{auto-id}
 *
 * Falls back silently — logging must never crash the app.
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Log an error to the console AND to Firestore.
 *
 * @param {Error|string} error   The error object or message.
 * @param {object}       context Extra context (component name, action, etc.).
 * @param {string|null}  uid     Authenticated user's UID, if available.
 */
export async function logError(error, context = {}, uid = null) {
  // Always surface in dev console
  console.error(`[ddiary/${context.location ?? 'app'}]`, error, context);

  try {
    const col = uid
      ? collection(db, 'users', uid, 'errorLogs')
      : collection(db, 'errorLogs');

    await addDoc(col, {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      context,
      uid,
      timestamp: serverTimestamp(),
      userAgent: navigator?.userAgent ?? null,
      url: window?.location?.href ?? null,
    });
  } catch {
    // Never let error logging itself crash the app
  }
}

/**
 * Returns a convenience logger bound to a component name and UID.
 *
 * Usage:
 *   const log = createLogger('useEntries', user.uid);
 *   log(err, { action: 'addEntry' });
 */
export function createLogger(location, uid = null) {
  return (error, extra = {}) => logError(error, { location, ...extra }, uid);
}
