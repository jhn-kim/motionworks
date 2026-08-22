import { describe, expect, it } from "vitest";

import {
  decayValueFromTrailLength,
  trailLengthFromValue,
} from "./temporal-decay.js";

describe("decayValueFromTrailLength ↔ trailLengthFromValue", () => {
  it("at minimum trail length the decay is min", () => {
    expect(decayValueFromTrailLength(0, 0, 1)).toBeCloseTo(0, 5);
  });

  it("at maximum trail length the decay is max", () => {
    // Max trail length in theme is 220.
    expect(decayValueFromTrailLength(220, 0, 1)).toBeCloseTo(1, 5);
  });

  it("clamps trails longer than the max", () => {
    expect(decayValueFromTrailLength(1000, 0, 1)).toBeCloseTo(1, 5);
  });

  it("is linear between min and max trail lengths", () => {
    const half = decayValueFromTrailLength((4 + 220) / 2, 0, 1);
    expect(half).toBeCloseTo(0.5, 3);
  });

  it("trailLengthFromValue is the inverse for values in range", () => {
    for (const v of [0.1, 0.4, 0.6, 0.9]) {
      const px = trailLengthFromValue(v, 0, 1);
      const back = decayValueFromTrailLength(px, 0, 1);
      expect(back).toBeCloseTo(v, 4);
    }
  });

  it("handles degenerate zero-range without crashing", () => {
    // min == max: trailLength collapses to the min trail px.
    const len = trailLengthFromValue(0.5, 5, 5);
    expect(len).toBe(4); // DECAY_SURFACE.minTrailPx
  });
});
