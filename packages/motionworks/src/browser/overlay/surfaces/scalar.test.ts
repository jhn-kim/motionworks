import { describe, expect, it } from "vitest";

import { scalarValueFromDrag } from "./scalar.js";

describe("scalarValueFromDrag", () => {
  it("maps a full-track upward drag to the maximum", () => {
    const v = scalarValueFromDrag(400, 0.5, 260, 0, 1, 140, false);
    // 140px up in a 140px track over range 1 = +1 → clamped to 1.
    expect(v).toBe(1);
  });

  it("maps a full-track downward drag to the minimum", () => {
    const v = scalarValueFromDrag(400, 0.5, 540, 0, 1, 140, false);
    expect(v).toBe(0);
  });

  it("holds still when the pointer does not move", () => {
    const v = scalarValueFromDrag(400, 0.5, 400, 0, 1, 140, false);
    expect(v).toBe(0.5);
  });

  it("applies shift-fine multiplier (10x slower)", () => {
    const coarse = scalarValueFromDrag(400, 0.5, 330, 0, 1, 140, false);
    const fine = scalarValueFromDrag(400, 0.5, 330, 0, 1, 140, true);
    // 70px up = 50% coarse; 5% fine.
    expect(coarse).toBeCloseTo(1);
    expect(fine).toBeCloseTo(0.55, 3);
  });

  it("clamps values that would overshoot the range", () => {
    const overshoot = scalarValueFromDrag(400, 0.9, 0, 0, 1, 140, false);
    expect(overshoot).toBe(1);
    const undershoot = scalarValueFromDrag(400, 0.1, 800, 0, 1, 140, false);
    expect(undershoot).toBe(0);
  });

  it("preserves proportion across arbitrary min/max ranges", () => {
    // Range 100 → 300 (span 200), 140px is one full track = +200.
    const v = scalarValueFromDrag(400, 200, 400 - 70, 100, 300, 140, false);
    expect(v).toBeCloseTo(300, 3);
  });
});
