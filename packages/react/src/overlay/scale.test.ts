import { describe, expect, it } from 'vitest';

import {
  clampScale,
  curveForType,
  formatReal,
  formatScale,
  scaleToValue,
  valueToScale,
  type ScaleSpec,
} from './scale.js';

const linear: ScaleSpec = { min: 0, max: 400, curve: 'linear' };
const quad: ScaleSpec = { min: 0, max: 2000, curve: 'quad' };
const log: ScaleSpec = { min: 40, max: 800, curve: 'log' };

describe('scaleToValue', () => {
  it('linear maps 0/5/10 to min/mid/max', () => {
    expect(scaleToValue(0, linear)).toBe(0);
    expect(scaleToValue(5, linear)).toBe(200);
    expect(scaleToValue(10, linear)).toBe(400);
  });

  it('quad front-loads resolution at the low end', () => {
    expect(scaleToValue(5, quad)).toBe(500); // t² → 0.25 of range
    expect(scaleToValue(10, quad)).toBe(2000);
    expect(scaleToValue(3, quad)).toBeCloseTo(180, 0);
  });

  it('log maps 0/10 to min/max with a geometric midpoint', () => {
    expect(scaleToValue(0, log)).toBeCloseTo(40);
    expect(scaleToValue(10, log)).toBeCloseTo(800);
    expect(scaleToValue(5, log)).toBeCloseTo(Math.sqrt(40 * 800), 3);
  });

  it('log with min 0 uses a floor instead of exploding', () => {
    const v = scaleToValue(0, { min: 0, max: 100, curve: 'log' });
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('clamps scale outside 0–10', () => {
    expect(scaleToValue(-3, linear)).toBe(0);
    expect(scaleToValue(14, linear)).toBe(400);
  });
});

describe('valueToScale', () => {
  it('round-trips within a tenth on every curve', () => {
    for (const spec of [linear, quad, log]) {
      for (const s of [0, 1.3, 5, 7.7, 10]) {
        expect(valueToScale(scaleToValue(s, spec), spec)).toBeCloseTo(s, 1);
      }
    }
  });

  it('returns 0 for degenerate bounds', () => {
    expect(valueToScale(5, { min: 1, max: 1, curve: 'linear' })).toBe(0);
  });
});

describe('curveForType', () => {
  it('assigns quad to timing, log to springs, linear otherwise', () => {
    expect(curveForType('duration')).toBe('quad');
    expect(curveForType('stagger')).toBe('quad');
    expect(curveForType('spring-response')).toBe('log');
    expect(curveForType('spatial-radius')).toBe('linear');
    expect(curveForType('scalar')).toBe('linear');
  });
});

describe('formatting', () => {
  it('formatScale shows integers clean and tenths with one decimal', () => {
    expect(formatScale(7)).toBe('7');
    expect(formatScale(6.4)).toBe('6.4');
    expect(formatScale(6.4000001)).toBe('6.4');
  });

  it('formatReal scales digits to magnitude', () => {
    expect(formatReal(320, 'ms')).toBe('320ms');
    expect(formatReal(12.34)).toBe('12.3');
    expect(formatReal(0.456)).toBe('0.46');
  });

  it('clampScale bounds the dial', () => {
    expect(clampScale(-1)).toBe(0);
    expect(clampScale(11)).toBe(10);
  });
});
