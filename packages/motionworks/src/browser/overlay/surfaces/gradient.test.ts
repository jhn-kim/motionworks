import { describe, expect, it } from "vitest";

import { interpolateStopColor, normaliseStops } from "./gradient.js";

describe("normaliseStops", () => {
  it("sorts stops by position", () => {
    const stops = normaliseStops([
      { stop: 0.8, color: "#fff" },
      { stop: 0.2, color: "#000" },
      { stop: 0.5, color: "#555" },
    ]);
    expect(stops.map((s) => s.stop)).toEqual([0.2, 0.5, 0.8]);
  });

  it("clamps stops to [0, 1]", () => {
    const stops = normaliseStops([
      { stop: -0.5, color: "#000" },
      { stop: 1.5, color: "#fff" },
    ]);
    expect(stops.map((s) => s.stop)).toEqual([0, 1]);
  });
});

describe("interpolateStopColor", () => {
  it("returns the first color for t below the earliest stop", () => {
    const c = interpolateStopColor(
      [
        { stop: 0.2, color: "#ff0000" },
        { stop: 0.8, color: "#0000ff" },
      ],
      0,
    );
    expect(c).toBe("#ff0000");
  });

  it("returns the last color for t above the latest stop", () => {
    const c = interpolateStopColor(
      [
        { stop: 0.2, color: "#ff0000" },
        { stop: 0.8, color: "#0000ff" },
      ],
      1,
    );
    expect(c).toBe("#0000ff");
  });

  it("linearly mixes rgb between two stops", () => {
    const c = interpolateStopColor(
      [
        { stop: 0, color: "#000000" },
        { stop: 1, color: "#ffffff" },
      ],
      0.5,
    );
    // Expect ~mid-grey.
    expect(c).toBe("rgb(128, 128, 128)");
  });

  it("handles rgb() input", () => {
    const c = interpolateStopColor(
      [
        { stop: 0, color: "rgb(0, 0, 0)" },
        { stop: 1, color: "rgb(200, 100, 50)" },
      ],
      1,
    );
    expect(c).toBe("rgb(200, 100, 50)");
  });

  it("handles short hex input", () => {
    const c = interpolateStopColor(
      [
        { stop: 0, color: "#000" },
        { stop: 1, color: "#fff" },
      ],
      0.5,
    );
    expect(c).toBe("rgb(128, 128, 128)");
  });
});
