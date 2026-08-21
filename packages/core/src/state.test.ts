import { describe, expect, it, vi } from 'vitest';
import { MotionWorksStateManager } from './state.js';
import type { MotionWorksEffect, MotionWorksRegistration, ParamDiff } from './types.js';

function makeRegistration(overrides: Partial<MotionWorksRegistration> = {}): MotionWorksRegistration {
  return {
    name: 'TestEffect',
    params: {
      radius: { type: 'spatial-radius', value: 100, min: 10, max: 400 },
      strength: { type: 'spatial-strength', value: 0.5 },
    },
    update: vi.fn(),
    ...overrides,
  };
}

function makeWireEffect(overrides: Partial<MotionWorksEffect> = {}): MotionWorksEffect {
  return {
    id: 'effect-wire',
    name: 'WireEffect',
    params: {
      radius: { type: 'spatial-radius', value: 80 },
    },
    readOnly: false,
    ...overrides,
  };
}

describe('MotionWorksStateManager', () => {
  describe('registerEffect', () => {
    it('stores the effect and returns an MotionWorksEffect', () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect('id-1', makeRegistration());
      expect(effect.id).toBe('id-1');
      expect(effect.name).toBe('TestEffect');
      expect(state.getEffect('id-1')).toBe(effect);
    });

    it('applies validation: bad params are excluded from the stored effect', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect(
        'id-2',
        makeRegistration({
          params: {
            good: { type: 'scalar', value: 1 },
            bad: { type: 'spatial-radius', value: 'not-a-number' },
          },
        }),
      );
      expect(effect.params['good']).toBeDefined();
      expect(effect.params['bad']).toBeUndefined();
      vi.restoreAllMocks();
    });

    it('sets readOnly false when update is a function', () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect('id-3', makeRegistration({ update: () => {} }));
      expect(effect.readOnly).toBe(false);
    });

    it('sets readOnly true when update is absent', () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect('id-4', makeRegistration({ update: undefined }));
      expect(effect.readOnly).toBe(true);
    });

    it('notifies subscribers on registration', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffect('id-5', makeRegistration());
      expect(listener).toHaveBeenCalledOnce();
    });

    it('re-registration replaces the previous stored effect', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-6', makeRegistration({ name: 'First' }));
      const effect = state.registerEffect('id-6', makeRegistration({ name: 'Second' }));
      expect(effect.name).toBe('Second');
      expect(state.getAllEffects()).toHaveLength(1);
    });
  });

  describe('registerEffectFromWire', () => {
    it('stores the wire effect without update fn', () => {
      const state = new MotionWorksStateManager();
      const wire = makeWireEffect();
      state.registerEffectFromWire(wire);
      expect(state.getEffect(wire.id)).toMatchObject({ id: wire.id, name: wire.name });
    });

    it('notifies subscribers', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffectFromWire(makeWireEffect());
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('unregisterEffect', () => {
    it('removes the effect', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-a', makeRegistration());
      state.unregisterEffect('id-a');
      expect(state.getEffect('id-a')).toBeUndefined();
    });

    it('clears selection if the selected effect is unregistered', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-b', makeRegistration());
      state.selectEffect('id-b');
      state.unregisterEffect('id-b');
      expect(state.getSelectedEffect()).toBeNull();
    });

    it('does not notify if the effect was not registered', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.unregisterEffect('nonexistent');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('selectEffect', () => {
    it('sets the selected effect id', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-c', makeRegistration());
      state.selectEffect('id-c');
      expect(state.getSelectedEffect()?.id).toBe('id-c');
    });

    it('ignores selection of an unknown effect', () => {
      const state = new MotionWorksStateManager();
      state.selectEffect('nonexistent');
      expect(state.getSelectedEffect()).toBeNull();
    });

    it('clears selection when passed null', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-d', makeRegistration());
      state.selectEffect('id-d');
      state.selectEffect(null);
      expect(state.getSelectedEffect()).toBeNull();
    });
  });

  describe('applyParamChange', () => {
    it('updates liveValues for the param', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-e', makeRegistration());
      state.applyParamChange('id-e', 'radius', 200);

      const diff = state.computeUncommittedDiff('id-e');
      expect(diff?.['radius']?.to).toBe(200);
    });

    it('calls the update fn with only the changed param (partial delta)', () => {
      const updateFn = vi.fn();
      const state = new MotionWorksStateManager();
      state.registerEffect('id-f', makeRegistration({ update: updateFn }));
      state.applyParamChange('id-f', 'radius', 150);

      expect(updateFn).toHaveBeenCalledOnce();
      const arg = updateFn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(arg)).toEqual(['radius']);
      expect(arg['radius']).toBe(150);
    });

    it('does not call update fn when effect is readOnly', () => {
      const updateFn = vi.fn();
      const state = new MotionWorksStateManager();
      state.registerEffect('id-g', makeRegistration({ update: undefined }));
      state.applyParamChange('id-g', 'radius', 150);
      expect(updateFn).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown effect ids', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.applyParamChange('nonexistent', 'x', 1);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('computeUncommittedDiff', () => {
    it('returns null for an unknown effect', () => {
      const state = new MotionWorksStateManager();
      expect(state.computeUncommittedDiff('nonexistent')).toBeNull();
    });

    it('returns an empty object when no params have changed', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-h', makeRegistration());
      expect(state.computeUncommittedDiff('id-h')).toEqual({});
    });

    it('includes only changed params in the diff', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-i', makeRegistration());
      state.applyParamChange('id-i', 'radius', 200);

      const diff = state.computeUncommittedDiff('id-i');
      expect(diff).toEqual({
        radius: { from: 100, to: 200 },
      });
      expect(diff?.['strength']).toBeUndefined();
    });

    it('tracks multiple changed params', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-j', makeRegistration());
      state.applyParamChange('id-j', 'radius', 300);
      state.applyParamChange('id-j', 'strength', 0.9);

      const diff = state.computeUncommittedDiff('id-j');
      expect(diff?.['radius']).toEqual({ from: 100, to: 300 });
      expect(diff?.['strength']).toEqual({ from: 0.5, to: 0.9 });
    });
  });

  describe('commitEffect', () => {
    it('returns null for an unknown effect', () => {
      const state = new MotionWorksStateManager();
      const diffs: ParamDiff[] = [{ param: 'x', from: 0, to: 1 }];
      expect(state.commitEffect('nonexistent', '#sel', diffs)).toBeNull();
    });

    it('returns null for an empty diffs array', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-k', makeRegistration());
      expect(state.commitEffect('id-k', '#sel', [])).toBeNull();
    });

    it('creates a changeset from the provided diffs', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-l', makeRegistration());
      const diffs: ParamDiff[] = [{ param: 'radius', from: 100, to: 200 }];

      const changeset = state.commitEffect('id-l', '#hero > div', diffs);
      expect(changeset?.effectName).toBe('TestEffect');
      expect(changeset?.elementSelector).toBe('#hero > div');
      expect(changeset?.changes['radius']).toEqual({ from: 100, to: 200 });
    });

    it('assigns a unique id and timestamp to each changeset', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-idts', makeRegistration());
      const before = Date.now();
      const a = state.commitEffect('id-idts', '#s', [
        { param: 'radius', from: 100, to: 200 },
      ]);
      const b = state.commitEffect('id-idts', '#s', [
        { param: 'strength', from: 0.5, to: 0.9 },
      ]);
      const after = Date.now();
      expect(a?.id).toBeDefined();
      expect(b?.id).toBeDefined();
      expect(a?.id).not.toBe(b?.id);
      expect(a?.timestamp).toBeGreaterThanOrEqual(before);
      expect(b?.timestamp).toBeLessThanOrEqual(after);
    });

    it('preserves insertion order oldest-first in the queue', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-ord', makeRegistration());
      const a = state.commitEffect('id-ord', '#s', [
        { param: 'radius', from: 100, to: 200 },
      ]);
      const b = state.commitEffect('id-ord', '#s', [
        { param: 'strength', from: 0.5, to: 0.9 },
      ]);
      const c = state.commitEffect('id-ord', '#s', [
        { param: 'radius', from: 200, to: 250 },
      ]);
      const queue = state.getSnapshot().changesets;
      expect(queue.map((cs) => cs.id)).toEqual([a?.id, b?.id, c?.id]);
    });

    it('includes source hints only for changed params', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect(
        'id-m',
        makeRegistration({
          sourceHints: {
            radius: { file: 'src/fx.ts', variable: 'RADIUS' },
            strength: { file: 'src/fx.ts', variable: 'STRENGTH' },
          },
        }),
      );
      const diffs: ParamDiff[] = [{ param: 'radius', from: 100, to: 200 }];
      const changeset = state.commitEffect('id-m', '#sel', diffs);

      expect(changeset?.sourceHints?.['radius']).toBeDefined();
      expect(changeset?.sourceHints?.['strength']).toBeUndefined();
    });

    it('adds the changeset to the queue', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-n', makeRegistration());
      state.commitEffect('id-n', '#sel', [{ param: 'radius', from: 100, to: 200 }]);
      expect(state.getSnapshot().changesets).toHaveLength(1);
    });
  });

  describe('clearChangeset', () => {
    it('removes only the matching changeset and returns true', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-o', makeRegistration());
      const a = state.commitEffect('id-o', '#s', [
        { param: 'radius', from: 100, to: 200 },
      ]);
      const b = state.commitEffect('id-o', '#s', [
        { param: 'strength', from: 0.5, to: 0.9 },
      ]);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();

      const removed = state.clearChangeset(a!.id);
      expect(removed).toBe(true);

      const queue = state.getSnapshot().changesets;
      expect(queue).toHaveLength(1);
      expect(queue[0]?.id).toBe(b!.id);
    });

    it('returns false and does not notify when the id is unknown', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-o2', makeRegistration());
      state.commitEffect('id-o2', '#s', [{ param: 'radius', from: 100, to: 200 }]);
      const listener = vi.fn();
      state.subscribe(listener);
      const removed = state.clearChangeset('does-not-exist');
      expect(removed).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      expect(state.getSnapshot().changesets).toHaveLength(1);
    });

    it('preserves order after popping the head', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-o3', makeRegistration());
      const a = state.commitEffect('id-o3', '#s', [
        { param: 'radius', from: 100, to: 200 },
      ]);
      const b = state.commitEffect('id-o3', '#s', [
        { param: 'strength', from: 0.5, to: 0.9 },
      ]);
      const c = state.commitEffect('id-o3', '#s', [
        { param: 'radius', from: 200, to: 250 },
      ]);
      state.clearChangeset(a!.id);
      const queue = state.getSnapshot().changesets;
      expect(queue.map((cs) => cs.id)).toEqual([b!.id, c!.id]);
    });
  });

  describe('typeCorrections', () => {
    it('adds and clears type corrections', () => {
      const state = new MotionWorksStateManager();
      state.addTypeCorrection({
        effectName: 'TestEffect',
        paramKey: 'trail',
        previousType: 'scalar',
        correctedType: 'temporal-decay',
        correctedAt: Date.now(),
      });
      expect(state.getSnapshot().typeCorrections).toHaveLength(1);
      state.clearTypeCorrections();
      expect(state.getSnapshot().typeCorrections).toHaveLength(0);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('calls the listener on state changes', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffect('id-p', makeRegistration());
      expect(listener).toHaveBeenCalledOnce();
    });

    it('stops calling the listener after unsubscribe', () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      const unsubscribe = state.subscribe(listener);
      unsubscribe();
      state.registerEffect('id-q', makeRegistration());
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getSnapshot', () => {
    it('returns all effects, selection, changesets, and corrections', () => {
      const state = new MotionWorksStateManager();
      state.registerEffect('id-r', makeRegistration());
      state.selectEffect('id-r');
      state.commitEffect('id-r', '#sel', [{ param: 'radius', from: 100, to: 200 }]);
      state.addTypeCorrection({
        effectName: 'TestEffect',
        paramKey: 'strength',
        previousType: 'scalar',
        correctedType: 'spatial-strength',
        correctedAt: Date.now(),
      });

      const snap = state.getSnapshot();
      expect(snap.effects).toHaveLength(1);
      expect(snap.selectedEffectId).toBe('id-r');
      expect(snap.changesets).toHaveLength(1);
      expect(snap.typeCorrections).toHaveLength(1);
    });
  });
});
