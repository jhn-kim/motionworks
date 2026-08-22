import { describe, expect, it, vi } from 'vitest';
import { validateRegistration } from './validate.js';
import type { MotionWorksRegistration, ParameterType } from './types.js';

function makeReg(overrides: Partial<MotionWorksRegistration> = {}): MotionWorksRegistration {
  return {
    name: 'TestEffect',
    params: {},
    update: () => {},
    ...overrides,
  };
}

describe('validateRegistration — duration and easing-curve types', () => {
  it('accepts a numeric duration', () => {
    const result = validateRegistration(
      makeReg({ params: { d: { type: 'duration', value: 240, min: 0, max: 1200 } } }),
    );
    expect(result.params['d']?.type).toBe('duration');
    expect(result.skippedParams).toEqual([]);
  });

  it('rejects a non-numeric duration (rule 3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateRegistration(
      makeReg({ params: { d: { type: 'duration', value: '240ms' } } }),
    );
    expect(result.skippedParams).toEqual(['d']);
    warn.mockRestore();
  });

  it('accepts a full cubic-bezier easing-curve value', () => {
    const result = validateRegistration(
      makeReg({
        params: { e: { type: 'easing-curve', value: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 } } },
      }),
    );
    expect(result.params['e']?.type).toBe('easing-curve');
  });

  it('rejects an easing-curve missing control points (rule 3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateRegistration(
      makeReg({ params: { e: { type: 'easing-curve', value: { x1: 0.2, y1: 1 } } } }),
    );
    expect(result.skippedParams).toEqual(['e']);
    warn.mockRestore();
  });
});

describe('validateRegistration', () => {
  describe('Rule 1 — name must be a non-empty string', () => {
    it('marks nameValid true for a non-empty string', () => {
      const result = validateRegistration(makeReg({ name: 'MyEffect' }));
      expect(result.nameValid).toBe(true);
    });

    it('marks nameValid false for an empty string', () => {
      const result = validateRegistration(makeReg({ name: '' }));
      expect(result.nameValid).toBe(false);
    });

    it('marks nameValid false when name is not a string', () => {
      // @ts-expect-error intentional bad input
      const result = validateRegistration(makeReg({ name: 42 }));
      expect(result.nameValid).toBe(false);
    });
  });

  describe('Rule 2 — unknown type falls back to scalar', () => {
    it('corrects an unknown type to scalar and records the key', () => {
      const result = validateRegistration(
        makeReg({
          params: { foo: { type: 'unknown-type' as never, value: 1 } },
        }),
      );
      expect(result.params['foo']?.type).toBe('scalar');
      expect(result.correctedTypes).toContain('foo');
    });

    it('does not correct a valid type', () => {
      const result = validateRegistration(
        makeReg({ params: { r: { type: 'spatial-radius', value: 100 } } }),
      );
      expect(result.params['r']?.type).toBe('spatial-radius');
      expect(result.correctedTypes).toHaveLength(0);
    });
  });

  describe('Rule 3 — value / type mismatch skips the param', () => {
    it('skips a spatial-radius param with a non-number value', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateRegistration(
        makeReg({
          params: { r: { type: 'spatial-radius', value: 'not-a-number' } },
        }),
      );
      expect(result.params['r']).toBeUndefined();
      expect(result.skippedParams).toContain('r');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"r"'));
      warnSpy.mockRestore();
    });

    it('treats the retired boolean type as unknown: scalar fallback, then skipped for its non-numeric value', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateRegistration(
        makeReg({ params: { flag: { type: 'boolean' as ParameterType, value: true } } }),
      );
      expect(result.skippedParams).toContain('flag');
      vi.restoreAllMocks();
    });

    it('accepts a valid spring-response object value', () => {
      const result = validateRegistration(
        makeReg({
          params: {
            spring: { type: 'spring-response', value: { stiffness: 200, damping: 20 } },
          },
        }),
      );
      expect(result.params['spring']).toBeDefined();
      expect(result.skippedParams).toHaveLength(0);
    });

    it('accepts a spring-response with a scalar number value', () => {
      const result = validateRegistration(
        makeReg({ params: { spring: { type: 'spring-response', value: 0.5 } } }),
      );
      expect(result.params['spring']).toBeDefined();
    });

    it('accepts a valid gradient array', () => {
      const result = validateRegistration(
        makeReg({
          params: {
            colors: {
              type: 'gradient',
              value: [
                { stop: 0, color: '#ff0000' },
                { stop: 1, color: '#0000ff' },
              ],
            },
          },
        }),
      );
      expect(result.params['colors']).toBeDefined();
    });

    it('skips a gradient with a non-array value', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateRegistration(
        makeReg({ params: { colors: { type: 'gradient', value: 'red' } } }),
      );
      expect(result.skippedParams).toContain('colors');
      vi.restoreAllMocks();
    });

    it('accepts a valid path array', () => {
      const result = validateRegistration(
        makeReg({
          params: {
            route: {
              type: 'path',
              value: [
                { x: 0, y: 0 },
                { x: 100, y: 50 },
              ],
            },
          },
        }),
      );
      expect(result.params['route']).toBeDefined();
    });
  });

  describe('Rule 4 — missing or non-function update → readOnly', () => {
    it('sets readOnly true when update is absent', () => {
      const result = validateRegistration(makeReg({ update: undefined }));
      expect(result.readOnly).toBe(true);
    });

    it('sets readOnly true when update is not a function', () => {
      // @ts-expect-error intentional bad input
      const result = validateRegistration(makeReg({ update: 'not-a-function' }));
      expect(result.readOnly).toBe(true);
    });

    it('sets readOnly false when update is a function', () => {
      const result = validateRegistration(makeReg({ update: () => {} }));
      expect(result.readOnly).toBe(false);
    });
  });

  describe('Rule 5 — bad min/max are ignored', () => {
    it('strips both min and max when min === max', () => {
      const result = validateRegistration(
        makeReg({ params: { x: { type: 'scalar', value: 1, min: 5, max: 5 } } }),
      );
      const p = result.params['x'];
      expect(p?.min).toBeUndefined();
      expect(p?.max).toBeUndefined();
    });

    it('strips both min and max when min > max', () => {
      const result = validateRegistration(
        makeReg({ params: { x: { type: 'scalar', value: 1, min: 10, max: 5 } } }),
      );
      const p = result.params['x'];
      expect(p?.min).toBeUndefined();
      expect(p?.max).toBeUndefined();
    });

    it('keeps both min and max when min < max', () => {
      const result = validateRegistration(
        makeReg({ params: { x: { type: 'scalar', value: 1, min: 0, max: 10 } } }),
      );
      const p = result.params['x'];
      expect(p?.min).toBe(0);
      expect(p?.max).toBe(10);
    });

    it('keeps min when max is absent', () => {
      const result = validateRegistration(
        makeReg({ params: { x: { type: 'scalar', value: 1, min: 0 } } }),
      );
      expect(result.params['x']?.min).toBe(0);
    });

    it('keeps max when min is absent', () => {
      const result = validateRegistration(
        makeReg({ params: { x: { type: 'scalar', value: 1, max: 10 } } }),
      );
      expect(result.params['x']?.max).toBe(10);
    });
  });

  describe('mixed params', () => {
    it('processes valid and invalid params independently', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateRegistration(
        makeReg({
          params: {
            good: { type: 'scalar', value: 1 },
            bad: { type: 'spatial-radius', value: 'wrong' },
            unknown: { type: 'made-up' as never, value: 5 },
          },
        }),
      );
      expect(result.params['good']).toBeDefined();
      expect(result.params['bad']).toBeUndefined();
      expect(result.params['unknown']?.type).toBe('scalar');
      expect(result.skippedParams).toEqual(['bad']);
      expect(result.correctedTypes).toEqual(['unknown']);
      vi.restoreAllMocks();
    });
  });
});
