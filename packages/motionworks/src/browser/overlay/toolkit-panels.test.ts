import { describe, expect, it } from 'vitest';

import { roundToStep, sliderBoundsFor, stepForRange } from './toolkit-panels.js';

describe('sliderBoundsFor', () => {
  it('uses the schema min/max when provided', () => {
    const bounds = sliderBoundsFor(
      { type: 'spatial-radius', min: 20, max: 400 },
      'spatial-radius',
    );
    expect(bounds.min).toBe(20);
    expect(bounds.max).toBe(400);
    expect(bounds.step).toBe(1);
  });

  it('falls back to per-type ranges when min/max are absent', () => {
    const decay = sliderBoundsFor({ type: 'temporal-decay' }, 'temporal-decay');
    expect(decay).toEqual({ min: 0, max: 1, step: 0.01 });

    const stagger = sliderBoundsFor({ type: 'stagger' }, 'stagger');
    expect(stagger).toEqual({ min: 0, max: 600, step: 1 });
  });

  it('rejects inverted schema bounds (validation rule 5) and uses the fallback', () => {
    const bounds = sliderBoundsFor(
      { type: 'scalar', min: 5, max: 1 },
      'scalar',
    );
    expect(bounds).toEqual({ min: 0, max: 1, step: 0.01 });
  });

  it('picks a finer step for small ranges', () => {
    expect(stepForRange(1)).toBe(0.01);
    expect(stepForRange(10)).toBe(0.1);
    expect(stepForRange(500)).toBe(1);
  });
});

describe('roundToStep', () => {
  it('rounds to the step resolution', () => {
    expect(roundToStep(0.123456, 0.01)).toBe(0.12);
    expect(roundToStep(3.14, 0.1)).toBe(3.1);
    expect(roundToStep(97.6, 1)).toBe(98);
  });
});
