/**
 * Unit + integration tests for tabCoordinator.js
 *
 * BroadcastChannel is not available in jsdom, so we mock it with a simple
 * in-memory bus that synchronously delivers messages to all subscribers.
 * This lets us test the full request/response handshake without real tabs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _reset as resetUnsaved, register, unregister } from '../unsavedState';

// ── BroadcastChannel mock ─────────────────────────────────────────────────────
// A shared message bus: all instances with the same channel name share it.
const _buses = {};

class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this._listeners = [];
    if (!_buses[name]) _buses[name] = new Set();
    _buses[name].add(this);
  }

  postMessage(data) {
    // Deliver to all OTHER instances on the same channel (mimics real BC)
    _buses[this.name].forEach(ch => {
      if (ch === this) return;
      const event = { data };
      if (ch.onmessage) ch.onmessage(event);
      ch._listeners.forEach(fn => fn(event));
    });
  }

  addEventListener(type, fn) {
    if (type === 'message') this._listeners.push(fn);
  }

  removeEventListener(type, fn) {
    this._listeners = this._listeners.filter(f => f !== fn);
  }

  close() {
    _buses[this.name]?.delete(this);
  }
}

// Install mock before importing the module under test
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
vi.stubGlobal('sessionStorage', {
  _store: {},
  getItem(k)    { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; },
  clear()       { this._store = {}; },
});

// Import AFTER mocks are installed
const { init, tryHandOff, destroy, _reset: resetCoordinator } = await import('../tabCoordinator');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Spin up a simulated "existing tab" that responds to CLAIM_REQUEST. */
function makeExistingTab({ canHandle = true } = {}) {
  const ch = new MockBroadcastChannel('ddiary_tab_coordinator');
  const tabId = 'existing-tab-' + Math.random().toString(36).slice(2, 6);
  const navigateCalls = [];

  ch.onmessage = (e) => {
    const { type } = e.data;
    if (type === 'CLAIM_REQUEST') {
      ch.postMessage({ type: 'CLAIM_RESPONSE', requestId: e.data.requestId, tabId, canHandle });
    }
    if (type === 'NAVIGATE' && e.data.targetTabId === tabId) {
      navigateCalls.push({ taskId: e.data.taskId, wsId: e.data.wsId });
      // Acknowledge navigation so the sending tab knows it's safe to close.
      if (e.data.navigateRequestId) {
        ch.postMessage({ type: 'NAVIGATE_ACK', navigateRequestId: e.data.navigateRequestId });
      }
    }
  };

  return { ch, tabId, navigateCalls, close: () => ch.close() };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetUnsaved();
  resetCoordinator();
  // Clear the bus between tests
  Object.keys(_buses).forEach(k => delete _buses[k]);
  sessionStorage.clear();

  // window.close and window.focus are not in jsdom; stub them
  vi.stubGlobal('window', {
    ...globalThis.window,
    close:  vi.fn(),
    focus:  vi.fn(),
  });
});

afterEach(() => {
  destroy();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tabCoordinator — no existing tabs', () => {
  it('resolves false when no other tabs respond', async () => {
    vi.useFakeTimers();
    const navigateFn = vi.fn();
    init(navigateFn);

    const promise = tryHandOff('task-abc', null);
    vi.advanceTimersByTime(400); // past 300 ms handshake timeout
    const result = await promise;

    expect(result).toBe(false);
    expect(window.close).not.toHaveBeenCalled();
  });
});

describe('tabCoordinator — one existing tab, no unsaved work', () => {
  it('resolves true and sends NAVIGATE to the existing tab', async () => {
    vi.useFakeTimers();
    const existing = makeExistingTab({ canHandle: true });
    const navigateFn = vi.fn();
    init(navigateFn);

    const promise = tryHandOff('task-xyz', 'ws-123');
    vi.advanceTimersByTime(400);
    const result = await promise;

    expect(result).toBe(true);
    expect(existing.navigateCalls).toHaveLength(1);
    expect(existing.navigateCalls[0]).toEqual({ taskId: 'task-xyz', wsId: 'ws-123' });

    // After a further 150 ms grace, this tab should try to close
    vi.advanceTimersByTime(200);
    expect(window.close).toHaveBeenCalled();

    existing.close();
  });
});

describe('tabCoordinator — one existing tab, has unsaved work', () => {
  it('resolves false and does NOT send NAVIGATE', async () => {
    vi.useFakeTimers();
    const existing = makeExistingTab({ canHandle: false });
    const navigateFn = vi.fn();
    init(navigateFn);

    const promise = tryHandOff('task-xyz', null);
    vi.advanceTimersByTime(400);
    const result = await promise;

    expect(result).toBe(false);
    expect(existing.navigateCalls).toHaveLength(0);
    expect(window.close).not.toHaveBeenCalled();

    existing.close();
  });
});

describe('tabCoordinator — two existing tabs, mixed unsaved state', () => {
  it('picks the first canHandle=true tab, ignores the busy one', async () => {
    vi.useFakeTimers();
    const busyTab  = makeExistingTab({ canHandle: false });
    const freeTab  = makeExistingTab({ canHandle: true });
    const navigateFn = vi.fn();
    init(navigateFn);

    const promise = tryHandOff('task-multi', 'ws-456');
    vi.advanceTimersByTime(400);
    const result = await promise;

    expect(result).toBe(true);
    // Only the free tab received NAVIGATE
    expect(freeTab.navigateCalls).toHaveLength(1);
    expect(busyTab.navigateCalls).toHaveLength(0);

    busyTab.close();
    freeTab.close();
  });
});

describe('tabCoordinator — two existing tabs, ALL busy', () => {
  it('resolves false so the new tab handles the deep link itself', async () => {
    vi.useFakeTimers();
    const busyTab1 = makeExistingTab({ canHandle: false });
    const busyTab2 = makeExistingTab({ canHandle: false });
    const navigateFn = vi.fn();
    init(navigateFn);

    const promise = tryHandOff('task-fallback', null);
    vi.advanceTimersByTime(400);
    const result = await promise;

    expect(result).toBe(false);
    expect(busyTab1.navigateCalls).toHaveLength(0);
    expect(busyTab2.navigateCalls).toHaveLength(0);
    expect(window.close).not.toHaveBeenCalled();

    busyTab1.close();
    busyTab2.close();
  });
});

describe('tabCoordinator — receiving tab navigates correctly', () => {
  it('calls navigateFn with /tasks?task= when it receives NAVIGATE', async () => {
    vi.useFakeTimers();
    const navigateFn = vi.fn();
    init(navigateFn);

    // Simulate another new tab sending NAVIGATE directly to us
    const bus = new MockBroadcastChannel('ddiary_tab_coordinator');
    // Find our tab's ID (written to sessionStorage on init)
    const ourTabId = sessionStorage.getItem('ddiary_tab_id');

    bus.postMessage({ type: 'NAVIGATE', targetTabId: ourTabId, taskId: 'task-999', wsId: 'ws-777' });

    expect(navigateFn).toHaveBeenCalledWith('/tasks?task=task-999&wsId=ws-777');
    bus.close();
  });

  it('navigates without wsId when wsId is null', async () => {
    vi.useFakeTimers();
    const navigateFn = vi.fn();
    init(navigateFn);

    const bus = new MockBroadcastChannel('ddiary_tab_coordinator');
    const ourTabId = sessionStorage.getItem('ddiary_tab_id');

    bus.postMessage({ type: 'NAVIGATE', targetTabId: ourTabId, taskId: 'task-888', wsId: null });

    expect(navigateFn).toHaveBeenCalledWith('/tasks?task=task-888');
    bus.close();
  });
});

describe('tabCoordinator — unsavedState integration', () => {
  it('canHandle=false when unsavedState has a lock', async () => {
    vi.useFakeTimers();

    // This tab has unsaved work
    register('diary-editor');

    // Another tab asks if we can handle a deep link
    const askingTab = new MockBroadcastChannel('ddiary_tab_coordinator');
    const responses = [];
    askingTab._listeners.push((e) => {
      if (e.data.type === 'CLAIM_RESPONSE') responses.push(e.data);
    });

    const navigateFn = vi.fn();
    init(navigateFn);

    askingTab.postMessage({ type: 'CLAIM_REQUEST', requestId: 'req-1' });

    expect(responses).toHaveLength(1);
    expect(responses[0].canHandle).toBe(false);

    askingTab.close();
    unregister('diary-editor');
  });

  it('canHandle=true when unsavedState has no locks', async () => {
    vi.useFakeTimers();

    const askingTab = new MockBroadcastChannel('ddiary_tab_coordinator');
    const responses = [];
    askingTab._listeners.push((e) => {
      if (e.data.type === 'CLAIM_RESPONSE') responses.push(e.data);
    });

    const navigateFn = vi.fn();
    init(navigateFn);

    askingTab.postMessage({ type: 'CLAIM_REQUEST', requestId: 'req-2' });

    expect(responses).toHaveLength(1);
    expect(responses[0].canHandle).toBe(true);

    askingTab.close();
  });
});
