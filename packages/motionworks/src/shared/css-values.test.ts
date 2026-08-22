import { describe, expect, it } from 'vitest';
import { cssValuesEqual, decodeCssValue, encodeCssValue, formatNumber } from './css-values.js';

describe('CSS values', () => {
  it.each([
    ['spatial-radius', '12px', 12, 'px'], ['scalar', '.25', 0.25, ''], ['duration', '0.3s', 300, 's'],
  ] as const)('decodes %s', (type, css, value, unit) => expect(decodeCssValue(type, css)).toEqual({ value, unit }));
  it('preserves units and normalizes seconds for equality', () => { expect(encodeCssValue('duration', 300, 's')).toBe('0.3s'); expect(cssValuesEqual('duration', '0.3s', '300ms')).toBe(true); });
  it('rejects relative units', () => expect(decodeCssValue('spatial-radius', '2rem')).toBeNull());
  it('handles complex values', () => {
    expect(decodeCssValue('easing-curve', 'ease')?.value).toMatchObject({ x1: 0.25, y1: 0.1 });
    expect(decodeCssValue('spring-response', '200 20 1')?.value).toEqual({ stiffness: 200, damping: 20, mass: 1 });
    expect(decodeCssValue('gradient', 'rgb(1, 2, 3) 0%, #fff 100%')?.value).toHaveLength(2);
    expect(decodeCssValue('path', 'path("M 0 0 C 1 2 3 4 5 6")')?.value).toHaveLength(2);
  });
  it('formats at most four decimals', () => expect(formatNumber(1.234567)).toBe('1.2346'));
});
