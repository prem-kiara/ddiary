/**
 * Unit tests for unsavedState.js
 *
 * Tests the register/unregister/hasUnsaved API in isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { register, unregister, hasUnsaved, _reset } from '../unsavedState';

beforeEach(() => {
  _reset(); // start each test with a clean slate
});

describe('unsavedState', () => {
  it('starts with no unsaved work', () => {
    expect(hasUnsaved()).toBe(false);
  });

  it('reports unsaved after register()', () => {
    register('diary-editor');
    expect(hasUnsaved()).toBe(true);
  });

  it('clears after unregister()', () => {
    register('diary-editor');
    unregister('diary-editor');
    expect(hasUnsaved()).toBe(false);
  });

  it('stays true while at least one key is still registered', () => {
    register('diary-editor');
    register('task-add-form');
    unregister('diary-editor');
    expect(hasUnsaved()).toBe(true); // task-add-form still registered
  });

  it('clears only when all keys are unregistered', () => {
    register('diary-editor');
    register('task-add-form');
    unregister('diary-editor');
    unregister('task-add-form');
    expect(hasUnsaved()).toBe(false);
  });

  it('unregistering an unknown key is a no-op', () => {
    expect(() => unregister('nonexistent')).not.toThrow();
    expect(hasUnsaved()).toBe(false);
  });

  it('registering the same key twice is idempotent', () => {
    register('diary-editor');
    register('diary-editor');
    unregister('diary-editor'); // one unregister should clear it
    expect(hasUnsaved()).toBe(false);
  });

  it('_reset() clears all locks', () => {
    register('diary-editor');
    register('task-add-form');
    _reset();
    expect(hasUnsaved()).toBe(false);
  });
});
