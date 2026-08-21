import { describe, expect, it } from 'vitest';

import { makeEffectId } from './ids.js';

describe('makeEffectId', () => {
  it('composes component name and schema name into a stable id', () => {
    expect(makeEffectId('AnimatedCard', 'CardEntrance')).toBe('AnimatedCard::CardEntrance');
  });

  it('is deterministic — same inputs always produce the same id', () => {
    const a = makeEffectId('HeroImage', 'LiquidCursor');
    const b = makeEffectId('HeroImage', 'LiquidCursor');
    expect(a).toBe(b);
  });

  it('distinguishes different schema names on the same component', () => {
    const entrance = makeEffectId('Card', 'Entrance');
    const hover = makeEffectId('Card', 'Hover');
    expect(entrance).not.toBe(hover);
  });

  it('distinguishes the same schema name across different components', () => {
    const one = makeEffectId('CardA', 'Common');
    const two = makeEffectId('CardB', 'Common');
    expect(one).not.toBe(two);
  });
});
