/**
 * tabCoordinator.js — Single-tab reuse for email deep links.
 *
 * Flow when a new tab opens with ?task=<id>[&wsId=<id>]:
 *
 *   1. New tab calls tryHandOff(taskId, wsId, navigateFn).
 *   2. It broadcasts CLAIM_REQUEST to all open app tabs.
 *   3. Each existing tab replies with CLAIM_RESPONSE { canHandle }.
 *      canHandle = true  ↔  the tab has no unsaved work.
 *   4. After HANDSHAKE_TIMEOUT_MS the new tab picks the best candidate:
 *        • First tab that replied canHandle=true wins.
 *        • If every reply is canHandle=false (all tabs busy) OR there are
 *          no replies at all → resolve(false) and let the new tab handle
 *          the deep link itself (safe fallback).
 *   5. Winning tab receives NAVIGATE { taskId, wsId } → calls its own
 *      navigate() and brings itself to the foreground.
 *   6. New tab closes itself after a 150 ms grace period.
 *
 * Each browser tab gets a unique ID stored in sessionStorage so messages
 * can be targeted (BroadcastChannel is broadcast-only; we filter by tabId).
 */

import { hasUnsaved } from './unsavedState';

const CHANNEL_NAME      = 'ddiary_tab_coordinator';
const HANDSHAKE_TIMEOUT = 300; // ms — time to collect responses before deciding

let _channel    = null;   // BroadcastChannel instance
let _tabId      = null;   // this tab's unique ID
let _navigateFn = null;   // React Router navigate(), injected by App.jsx

// ── Internal helpers ──────────────────────────────────────────────────────────

function _uid() {
  return Math.random().toString(36).slice(2, 10);
}

function _getTabId() {
  let id = sessionStorage.getItem('ddiary_tab_id');
  if (!id) {
    id = _uid();
    sessionStorage.setItem('ddiary_tab_id', id);
  }
  return id;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the coordinator for this tab.  Call once, early in App mount.
 *
 * @param {function} navigateFn  React Router navigate() from useNavigate().
 */
export function init(navigateFn) {
  if (_channel) return; // already initialised
  if (typeof BroadcastChannel === 'undefined') return; // SSR / old browser guard

  _tabId      = _getTabId();
  _navigateFn = navigateFn;
  _channel    = new BroadcastChannel(CHANNEL_NAME);

  _channel.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'CLAIM_REQUEST') {
      // Another tab is asking: "can you handle this deep link?"
      _channel.postMessage({
        type:      'CLAIM_RESPONSE',
        requestId: e.data.requestId,
        tabId:     _tabId,
        canHandle: !hasUnsaved(),
      });
      return;
    }

    if (type === 'NAVIGATE' && e.data.targetTabId === _tabId) {
      // We were chosen — navigate and bring ourselves forward.
      const { taskId, wsId, navigateRequestId } = e.data;
      if (_navigateFn) {
        const q = wsId
          ? `/tasks?task=${encodeURIComponent(taskId)}&wsId=${encodeURIComponent(wsId)}`
          : `/tasks?task=${encodeURIComponent(taskId)}`;
        _navigateFn(q);
        // Acknowledge the navigation so the sending tab knows it's safe to close.
        if (navigateRequestId) {
          _channel.postMessage({ type: 'NAVIGATE_ACK', navigateRequestId });
        }
      }
      try { window.focus(); } catch { /* cross-origin policy may block */ }
    }
  };
}

/**
 * Try to hand a deep-link off to an already-open tab.
 *
 * Call this on the NEW tab (the one that opened from the email link) when
 * it detects ?task= in the URL.  Returns a Promise that resolves to:
 *   true  — hand-off succeeded; caller should window.close() / do nothing.
 *   false — no suitable existing tab; caller should handle the deep link
 *           locally (existing behaviour).
 *
 * @param {string}   taskId
 * @param {string|null} wsId
 * @returns {Promise<boolean>}
 */
export function tryHandOff(taskId, wsId) {
  return new Promise((resolve) => {
    if (!_channel) {
      resolve(false);
      return;
    }

    const requestId = _uid();
    const responses = [];

    // Temporary extra listener to collect replies for THIS request only.
    const listener = (e) => {
      if (e.data.type === 'CLAIM_RESPONSE' && e.data.requestId === requestId) {
        responses.push(e.data);
      }
    };
    _channel.addEventListener('message', listener);
    _channel.postMessage({ type: 'CLAIM_REQUEST', requestId });

    setTimeout(() => {
      _channel.removeEventListener('message', listener);

      // Pick the best candidate: first tab that said canHandle=true.
      const winner = responses.find(r => r.canHandle);

      if (!winner) {
        // No existing tab can handle it (all busy or none open).
        resolve(false);
        return;
      }

      // Tell the winning tab to navigate, including a request ID so its ACK
      // can be matched back to this specific hand-off.
      // IMPORTANT: register ackListener BEFORE calling postMessage so we don't
      // miss an ACK that arrives synchronously (e.g. in test environments where
      // BroadcastChannel delivers messages synchronously).
      const navigateRequestId = _uid();

      // Wait for the winning tab to acknowledge navigation before closing.
      // If no ACK arrives within the grace period the new tab stays open —
      // better to have a duplicate tab than a lost navigation.
      const ackListener = (e) => {
        if (e.data.type === 'NAVIGATE_ACK' && e.data.navigateRequestId === navigateRequestId) {
          _channel.removeEventListener('message', ackListener);
          clearTimeout(ackTimeout);
          try { window.close(); } catch { /* blocked in some contexts */ }
        }
      };
      _channel.addEventListener('message', ackListener);
      const ackTimeout = setTimeout(() => {
        _channel.removeEventListener('message', ackListener);
        // No ACK — winning tab may have failed; leave this tab open as fallback.
        console.warn('[tabCoordinator] No NAVIGATE_ACK received; keeping this tab open as fallback.');
      }, 150);

      _channel.postMessage({
        type:              'NAVIGATE',
        targetTabId:       winner.tabId,
        taskId,
        wsId:              wsId || null,
        navigateRequestId,
      });

      resolve(true);
    }, HANDSHAKE_TIMEOUT);
  });
}

/**
 * Tear down — call on App unmount (rarely needed in practice but good hygiene).
 */
export function destroy() {
  if (_channel) {
    _channel.close();
    _channel = null;
  }
  _navigateFn = null;
}

/**
 * For testing — reset module state between test cases.
 */
export function _reset() {
  if (_channel) { try { _channel.close(); } catch {} }
  _channel    = null;
  _tabId      = null;
  _navigateFn = null;
}
