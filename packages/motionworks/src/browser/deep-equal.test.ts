import { describe, expect, it } from "vitest";

import { deepEqual } from "./deep-equal.js";

describe("deepEqual", () => {
  it("returns true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it("returns true for NaN vs NaN", () => {
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("compares SpringValue-shaped objects deeply", () => {
    expect(
      deepEqual(
        { stiffness: 280, damping: 20 },
        { stiffness: 280, damping: 20 },
      ),
    ).toBe(true);
    expect(
      deepEqual(
        { stiffness: 280, damping: 20 },
        { stiffness: 281, damping: 20 },
      ),
    ).toBe(false);
  });

  it("compares gradient arrays deeply", () => {
    const a = [
      { stop: 0, color: "#ff0000" },
      { stop: 1, color: "#0000ff" },
    ];
    const b = [
      { stop: 0, color: "#ff0000" },
      { stop: 1, color: "#0000ff" },
    ];
    expect(deepEqual(a, b)).toBe(true);
  });

  it("differing array lengths are not equal", () => {
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
  });

  it("extra keys make objects unequal", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("nested path points with control handles", () => {
    const a = [
      { x: 0, y: 0, cp1: { x: 5, y: 5 } },
      { x: 100, y: 100 },
    ];
    const b = [
      { x: 0, y: 0, cp1: { x: 5, y: 5 } },
      { x: 100, y: 100 },
    ];
    expect(deepEqual(a, b)).toBe(true);
    const c = [
      { x: 0, y: 0, cp1: { x: 5, y: 6 } },
      { x: 100, y: 100 },
    ];
    expect(deepEqual(a, c)).toBe(false);
  });

  it("array vs object with same values is not equal", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });
});
