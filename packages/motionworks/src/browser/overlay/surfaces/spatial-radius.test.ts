import { describe, expect, it } from 'vitest';

import type { MotionWorksParam } from '../../../shared/index.js';

import { clampRadius } from './spatial-radius.js';

function param(overrides: Partial<MotionWorksParam> = {}): MotionWorksParam {
  return { type: 'spatial-radius', ...overrides };
}

describe('clampRadius', () => {
  it('clamps below the greater of param.min and 8px', () => {
    expect(clampRadius(3, param({ min: 20 }), 800)).toBe(20);
    expect(clampRadius(3, param({ min: 4 }), 800)).toBe(8);
    expect(clampRadius(3, param(), 800)).toBe(8);
  });

  it('clamps above the lesser of param.max and viewport short side', () => {
    expect(clampRadius(9999, param({ max: 400 }), 800)).toBe(400);
    expect(clampRadius(9999, param({ max: 4000 }), 800)).toBe(800);
    expect(clampRadius(9999, param(), 500)).toBe(500);
  });

  it('returns the raw value when inside bounds', () => {
    expect(clampRadius(150, param({ min: 20, max: 400 }), 800)).toBe(150);
  });

  it('handles missing bounds gracefully', () => {
    expect(clampRadius(200, param(), 1000)).toBe(200);
  });

  it('clamps at 8px minimum even if raw is 0', () => {
    expect(clampRadius(0, param(), 800)).toBe(8);
  });

  it('never returns above the viewport short side even without param.max', () => {
    expect(clampRadius(2000, param(), 600)).toBe(600);
  });

  it('picks the tighter of the two upper bounds', () => {
    // viewport is smaller than param.max → viewport wins
    expect(clampRadius(500, param({ max: 800 }), 400)).toBe(400);
    // param.max is smaller than viewport → param.max wins
    expect(clampRadius(500, param({ max: 300 }), 800)).toBe(300);
  });

  it('if min ends up above the cap, the min-side wins (radius stays clamped up)', () => {
    // Contrived: viewport smaller than the effective floor.
    // The floor takes precedence so the handle stays >= 8px even on tiny
    // viewports.
    expect(clampRadius(5, param({ min: 50 }), 20)).toBe(50);
  });
});
