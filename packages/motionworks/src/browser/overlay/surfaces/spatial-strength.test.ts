import { describe, expect, it } from "vitest";

import {
  arrowLengthForValue,
  strengthValueFromDistance,
} from "./spatial-strength.js";

describe("strengthValueFromDistance", () => {
  it("at zero distance returns min", () => {
    expect(strengthValueFromDistance(0, 0, 1, 80)).toBe(0);
    expect(strengthValueFromDistance(0, 0.2, 0.8, 80)).toBe(0.2);
  });

  it("at maxDragDistance returns max", () => {
    expect(strengthValueFromDistance(80, 0, 1, 80)).toBe(1);
  });

  it("clamps distances beyond maxDragDistance", () => {
    expect(strengthValueFromDistance(999, 0, 1, 80)).toBe(1);
  });

  it("is linear between 0 and maxDragDistance", () => {
    expect(strengthValueFromDistance(40, 0, 1, 80)).toBe(0.5);
  });

  it("respects arbitrary min/max ranges", () => {
    expect(strengthValueFromDistance(40, 100, 300, 80)).toBe(200);
  });
});

describe("arrowLengthForValue", () => {
  it("is zero at min", () => {
    expect(arrowLengthForValue(0, 0, 1, 60)).toBe(0);
  });

  it("is maxLen at max", () => {
    expect(arrowLengthForValue(1, 0, 1, 60)).toBe(60);
  });

  it("is proportional between", () => {
    expect(arrowLengthForValue(0.5, 0, 1, 60)).toBe(30);
  });

  it("clamps values above max", () => {
    expect(arrowLengthForValue(2, 0, 1, 60)).toBe(60);
  });

  it("clamps values below min", () => {
    expect(arrowLengthForValue(-5, 0, 1, 60)).toBe(0);
  });

  it("handles a degenerate zero-range gracefully (returns 0)", () => {
    expect(arrowLengthForValue(5, 3, 3, 60)).toBe(0);
  });
});
