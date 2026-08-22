import { describe, expect, it, vi } from 'vitest';

import type { MotionWorksEffect } from '../../shared/index.js';

import { TypeOverrideStore } from './type-overrides.js';

function makeEffect(overrides: Partial<MotionWorksEffect> = {}): MotionWorksEffect {
  return {
    id: 'e1',
    name: 'E',
    params: {
      trail: { type: 'scalar', value: 0.5, var: '--mw-trail', cssUnit: '', bound: true },
    },
    ...overrides,
  };
}

describe('TypeOverrideStore', () => {
  it('stores and retrieves overrides', () => {
    const store = new TypeOverrideStore();
    store.set('e1', 'trail', 'temporal-decay');
    expect(store.get('e1', 'trail')).toBe('temporal-decay');
  });

  it('returns null when no override exists', () => {
    const store = new TypeOverrideStore();
    expect(store.get('e1', 'trail')).toBeNull();
  });

  it('notifies subscribers on set', () => {
    const store = new TypeOverrideStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('e1', 'trail', 'temporal-decay');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not notify when setting the same value twice', () => {
    const store = new TypeOverrideStore();
    store.set('e1', 'trail', 'temporal-decay');
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('e1', 'trail', 'temporal-decay');
    expect(listener).not.toHaveBeenCalled();
  });

  it('reconcile clears overrides that match the newly-registered type', () => {
    const store = new TypeOverrideStore();
    store.set('e1', 'trail', 'temporal-decay');
    const effect = makeEffect({
      params: { trail: { type: 'temporal-decay', value: 0.5, var: '--mw-trail', cssUnit: '', bound: true } },
    });
    store.reconcile(effect);
    expect(store.get('e1', 'trail')).toBeNull();
  });

  it('reconcile keeps overrides whose type does not match yet', () => {
    const store = new TypeOverrideStore();
    store.set('e1', 'trail', 'temporal-decay');
    const effect = makeEffect(); // Still declares scalar.
    store.reconcile(effect);
    expect(store.get('e1', 'trail')).toBe('temporal-decay');
  });

  it('clearParam removes only the named param', () => {
    const store = new TypeOverrideStore();
    store.set('e1', 'a', 'temporal-decay');
    store.set('e1', 'b', 'spring-response');
    store.clearParam('e1', 'a');
    expect(store.get('e1', 'a')).toBeNull();
    expect(store.get('e1', 'b')).toBe('spring-response');
  });

  it('version increments on every notify', () => {
    const store = new TypeOverrideStore();
    const before = store.getVersion();
    store.set('e1', 'a', 'temporal-decay');
    expect(store.getVersion()).toBe(before + 1);
  });
});
