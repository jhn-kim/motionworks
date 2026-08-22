import { describe, expect, it } from 'vitest';

import { springStep, toSpringValue } from './spring-response.js';

describe('toSpringValue', () => {
  it('normalises a number to {stiffness, damping, mass}', () => {
    const s = toSpringValue(0.5);
    expect(s.stiffness).toBeGreaterThan(0);
    expect(s.damping).toBeGreaterThan(0);
    expect(s.mass).toBeCloseTo(1, 3);
  });

  it('passes an object through preserving stiffness/damping', () => {
    const s = toSpringValue({ stiffness: 280, damping: 24, mass: 1.5 });
    expect(s).toEqual({ stiffness: 280, damping: 24, mass: 1.5 });
  });

  it('falls back to defaults when the object is partial', () => {
    const s = toSpringValue({ stiffness: 300 } as unknown);
    expect(s.stiffness).toBe(300);
    expect(s.damping).toBeGreaterThan(0);
  });

  it('handles null / undefined without crashing', () => {
    const s = toSpringValue(null);
    expect(s.stiffness).toBeGreaterThan(0);
  });
});

describe('springStep', () => {
  it('applies restoring force toward the target', () => {
    // Positive displacement should produce a negative velocity delta.
    const next = springStep(10, 0, 0, 100, 10, 1, 1 / 60);
    expect(next.vel).toBeLessThan(0);
  });

  it('opposes velocity with damping', () => {
    const undamped = springStep(0, 10, 0, 0, 0, 1, 1 / 60);
    const damped = springStep(0, 10, 0, 0, 5, 1, 1 / 60);
    expect(damped.vel).toBeLessThan(undamped.vel);
  });

  it('at rest with zero velocity stays put', () => {
    const next = springStep(0, 0, 0, 200, 20, 1, 1 / 60);
    expect(next.pos).toBe(0);
    expect(next.vel).toBe(0);
  });

  it('mass scales the effective acceleration inversely', () => {
    const light = springStep(10, 0, 0, 200, 20, 1, 1 / 60);
    const heavy = springStep(10, 0, 0, 200, 20, 5, 1 / 60);
    // Heavier mass = less velocity change per step (smaller absolute change).
    expect(Math.abs(heavy.vel)).toBeLessThan(Math.abs(light.vel));
  });

  it('given enough steps, oscillates around the target then settles', () => {
    let pos = 100;
    let vel = 0;
    for (let i = 0; i < 400; i++) {
      const n = springStep(pos, vel, 0, 240, 20, 1, 1 / 60);
      pos = n.pos;
      vel = n.vel;
    }
    expect(Math.abs(pos)).toBeLessThan(1);
    expect(Math.abs(vel)).toBeLessThan(1);
  });
});
