import { describe, expect, it } from 'vitest';

import { allocateEffectId, slugify } from './ids.js';

describe('slugify', () => {
  it('turns effect names into readable slugs', () => {
    expect(slugify('Card Entrance')).toBe('card-entrance');
    expect(slugify('liquidCursor')).toBe('liquid-cursor');
    expect(slugify('  Glow___Pulse  ')).toBe('glow-pulse');
  });
});

describe('allocateEffectId', () => {
  it('allocates ids in DOM order', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    const existing = new Map<string, readonly Element[]>();
    const firstId = allocateEffectId('card', first, existing);
    existing.set(firstId, [first]);
    expect(firstId).toBe('card#1');
    expect(allocateEffectId('card', second, existing)).toBe('card#2');
  });

  it('returns an existing id and never renumbers it', () => {
    const node = document.createElement('div');
    const existing = new Map<string, readonly Element[]>([['card#3', [node]]]);
    expect(allocateEffectId('card', node, existing)).toBe('card#3');
  });
});
