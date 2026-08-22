import { describe, expect, it } from "vitest";

import { gapFromResponse, responseFromGap } from "./temporal-response.js";

describe("responseFromGap ↔ gapFromResponse", () => {
  it("at gap 0 the response is at max", () => {
    expect(responseFromGap(0, 0, 1)).toBeCloseTo(1, 5);
  });

  it("at the max ghost lag the response is at min", () => {
    // The default maxGhostLagPx is 140.
    expect(responseFromGap(140, 0, 1)).toBeCloseTo(0, 5);
  });

  it("is non-linear — half the gap does not yield half the response", () => {
    const half = responseFromGap(70, 0, 1);
    // Because the exponent is > 1, half-way in gap → less than half-way in
    // response (i.e., closer to 1 than 0.5).
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
  });

  it("clamps negative gaps to the max response", () => {
    expect(responseFromGap(-50, 0.02, 1)).toBeCloseTo(1, 5);
  });

  it("clamps overshoot gaps to the min response", () => {
    expect(responseFromGap(500, 0.02, 1)).toBeCloseTo(0.02, 5);
  });

  it("round-trips through gapFromResponse for interior values", () => {
    for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const gap = gapFromResponse(v, 0, 1);
      const back = responseFromGap(gap, 0, 1);
      expect(back).toBeCloseTo(v, 4);
    }
  });

  it("respects arbitrary min/max ranges", () => {
    // Response range 0.02 → 0.8.
    const midValue = responseFromGap(70, 0.02, 0.8);
    expect(midValue).toBeGreaterThan(0.4);
    expect(midValue).toBeLessThan(0.8);
  });
});
