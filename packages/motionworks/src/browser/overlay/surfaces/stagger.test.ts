import { describe, expect, it } from "vitest";

import { scaleSubsequentDelays } from "./stagger.js";

describe("scaleSubsequentDelays", () => {
  it("doubles a gap → scales every subsequent element by 2", () => {
    const delays = [0, 100, 200, 300];
    // Current gap between 0 and 1 is 100; make it 200.
    const next = scaleSubsequentDelays(delays, 0, 200);
    expect(next).toEqual([0, 200, 400, 600]);
  });

  it("halves a gap → scales subsequent elements proportionally", () => {
    const delays = [0, 200, 400, 600];
    // Current gap 200 → halve to 100.
    const next = scaleSubsequentDelays(delays, 0, 100);
    expect(next).toEqual([0, 100, 200, 300]);
  });

  it("is a no-op when the gap index is out of range", () => {
    expect(scaleSubsequentDelays([0, 100], 5, 200)).toEqual([0, 100]);
    expect(scaleSubsequentDelays([0, 100], -1, 200)).toEqual([0, 100]);
  });

  it("does nothing when the current gap is zero", () => {
    expect(scaleSubsequentDelays([0, 0, 100], 0, 50)).toEqual([0, 0, 100]);
  });

  it("scales a middle gap without affecting earlier elements", () => {
    const delays = [0, 100, 200, 400];
    // Scale the gap between anchors 1 and 2 (currently 100) to 300.
    const next = scaleSubsequentDelays(delays, 1, 300);
    // Anchor 2 should now be 100 + 300 = 400. Anchor 3 originally sat
    // 200 above anchor 1 (its offset from anchor 1 was 300) → scaled by
    // the same 3× ratio to 900, plus anchor 1's 100 = 1000. But this uses
    // anchor[gapIndex] (anchor 1 = 100) as the base, so anchor 3's offset
    // from 100 was 300 → scaled to 900 → 100 + 900 = 1000.
    expect(next).toEqual([0, 100, 400, 1000]);
  });

  it("enforces monotonically increasing order", () => {
    // If a scale would push anchor N behind anchor N-1, it stays at N-1's
    // delay.
    const delays = [0, 100, 200];
    const next = scaleSubsequentDelays(delays, 0, 250); // scale big
    // 250 > 200, so anchor 2 should be 500 (not before anchor 1).
    expect(next[1]).toBe(250);
    expect(next[2]).toBe(500);
  });
});
