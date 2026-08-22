import { describe, expect, it } from "vitest";

import {
  bezierPoint,
  closestOnPath,
  fromScreen,
  insertAnchorAt,
  materializeHandles,
  pathCoordinateNode,
  pathContrastColor,
  removeAnchorAt,
  segmentControls,
  toScreen,
  translateAnchor,
} from "./path.js";

describe("pathContrastColor", () => {
  it("uses white linework on a black background", () => {
    const node = document.createElement("div");
    node.style.backgroundColor = "rgb(0, 0, 0)";
    document.body.appendChild(node);
    expect(pathContrastColor(node)).toBe("#ffffff");
    node.remove();
  });

  it("uses black linework on a white background", () => {
    const node = document.createElement("div");
    node.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.appendChild(node);
    expect(pathContrastColor(node)).toBe("#000000");
    node.remove();
  });

  it("composites translucent backgrounds through their ancestors", () => {
    const parent = document.createElement("div");
    parent.style.backgroundColor = "rgb(0, 0, 0)";
    const node = document.createElement("div");
    node.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    parent.appendChild(node);
    document.body.appendChild(parent);
    expect(pathContrastColor(node)).toBe("#ffffff");
    parent.remove();
  });
});

const RECT: DOMRect = {
  x: 100,
  y: 200,
  width: 300,
  height: 200,
  top: 200,
  right: 400,
  bottom: 400,
  left: 100,
  toJSON: () => ({}),
} as DOMRect;

describe("toScreen / fromScreen", () => {
  it("adds the rect origin for element-relative → screen", () => {
    expect(toScreen({ x: 20, y: 30 }, RECT)).toEqual({ x: 120, y: 230 });
  });

  it("subtracts the rect origin for screen → element-relative", () => {
    expect(fromScreen({ x: 120, y: 230 }, RECT)).toEqual({ x: 20, y: 30 });
  });

  it("round-trips a point", () => {
    const p = { x: 55, y: 77 };
    expect(fromScreen(toScreen(p, RECT), RECT)).toEqual(p);
  });
});

describe("pathCoordinateNode", () => {
  it("uses the CSS offset-path consumer's containing block", () => {
    const registered = document.createElement("div");
    const host = document.createElement("div");
    const runner = document.createElement("div");
    registered.appendChild(host);
    host.appendChild(runner);
    document.body.appendChild(registered);
    const path = [
      { x: 0, y: 10 },
      { x: 100, y: 20 },
    ];
    runner.style.setProperty("offset-path", 'path("M 0 10 L 100 20")');
    Object.defineProperty(runner, "offsetParent", {
      configurable: true,
      value: host,
    });

    expect(pathCoordinateNode(registered, path)).toBe(host);
    registered.remove();
  });

  it("falls back to the registered element for a non-CSS path", () => {
    const registered = document.createElement("div");
    expect(
      pathCoordinateNode(registered, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(registered);
  });
});

describe("insertAnchorAt", () => {
  it("inserts between the two closest anchors", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    // Screen point near the mid-point of the first segment.
    const next = insertAnchorAt(path, { x: 150, y: 200 }, RECT);
    expect(next).toHaveLength(4);
    expect(next[1]).toEqual({ x: 50, y: 0 });
  });

  it("inserts before the last anchor when the click is near the last segment", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const next = insertAnchorAt(path, { x: 250, y: 200 }, RECT);
    expect(next).toHaveLength(4);
    // Position is between anchors 2 and 3 in the original list, so should
    // land at index 2.
    expect(next[2]).toEqual({ x: 150, y: 0 });
  });

  it("appends when the input path is length 1", () => {
    const next = insertAnchorAt([{ x: 0, y: 0 }], { x: 300, y: 250 }, RECT);
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 50 },
    ]);
  });

  it("splits a curved segment with de Casteljau, preserving shape", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 25, y: -50 }, cp2: { x: 75, y: -50 } },
    ];
    // The curve's midpoint is (50, -37.5); click exactly there (screen coords).
    const next = insertAnchorAt(path, { x: 150, y: 162.5 }, RECT);
    expect(next).toHaveLength(3);
    const inserted = next[1]!;
    expect(inserted.x).toBeCloseTo(50);
    expect(inserted.y).toBeCloseTo(-37.5);
    // First-half subdivision controls.
    expect(inserted.cp1).toEqual({ x: 12.5, y: -25 });
    expect(inserted.cp2).toEqual({ x: 31.25, y: -37.5 });
    // Follower keeps its position but gets the second-half controls.
    const follower = next[2]!;
    expect(follower.x).toBe(100);
    expect(follower.cp1).toEqual({ x: 68.75, y: -37.5 });
    expect(follower.cp2).toEqual({ x: 87.5, y: -25 });
    // The split halves still evaluate onto the original curve: check the
    // first half's midpoint lies on the original cubic (at t = 0.25).
    const onOriginal = bezierPoint(
      { x: 0, y: 0 },
      { x: 25, y: -50 },
      { x: 75, y: -50 },
      { x: 100, y: 0 },
      0.25,
    );
    const onHalf = bezierPoint(
      { x: 0, y: 0 },
      inserted.cp1!,
      inserted.cp2!,
      inserted,
      0.5,
    );
    expect(onHalf.x).toBeCloseTo(onOriginal.x);
    expect(onHalf.y).toBeCloseTo(onOriginal.y);
  });

  it("projects onto the nearest point of a straight segment (not the raw click)", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    // Click 30px below the segment: the inserted anchor lands ON the line.
    const next = insertAnchorAt(path, { x: 150, y: 230 }, RECT);
    expect(next[1]).toEqual({ x: 50, y: 0 });
  });
});

describe("closestOnPath", () => {
  it("picks the curved segment point over a farther straight one", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 25, y: -50 }, cp2: { x: 75, y: -50 } },
      { x: 200, y: 0 },
    ];
    // Near the hump of the curve.
    const hit = closestOnPath(path, { x: 50, y: -30 });
    expect(hit.segEnd).toBe(1);
    expect(hit.point.y).toBeLessThan(-20);
  });

  it("projects exactly on straight segments", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const hit = closestOnPath(path, { x: 40, y: 25 });
    expect(hit.point).toEqual({ x: 40, y: 0 });
    expect(hit.t).toBeCloseTo(0.4);
    expect(hit.dist).toBeCloseTo(25);
  });
});

describe("segmentControls", () => {
  it("returns null for a straight segment", () => {
    expect(segmentControls({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });

  it("degenerates a missing control onto the segment endpoint", () => {
    const controls = segmentControls(
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 30, y: -40 } },
    );
    expect(controls).toEqual({ c1: { x: 30, y: -40 }, c2: { x: 100, y: 0 } });
  });
});

describe("translateAnchor", () => {
  it("carries the anchor approach control and the next departure control", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 25, y: -50 }, cp2: { x: 75, y: -50 } },
      { x: 200, y: 0, cp1: { x: 125, y: 50 }, cp2: { x: 175, y: 50 } },
    ];
    const next = translateAnchor(path, 1, 10, 20);
    expect(next[1]).toEqual({
      x: 110,
      y: 20,
      cp1: { x: 25, y: -50 },
      cp2: { x: 85, y: -30 },
    });
    // Next point's cp1 (the departure handle from the moved anchor) follows.
    expect(next[2]!.cp1).toEqual({ x: 135, y: 70 });
    // Its own approach handle stays put.
    expect(next[2]!.cp2).toEqual({ x: 175, y: 50 });
    expect(next[0]).toEqual({ x: 0, y: 0 });
  });

  it("is a no-op translation for plain points beyond the pair", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const next = translateAnchor(path, 0, 5, 5);
    expect(next[0]).toEqual({ x: 5, y: 5 });
    expect(next[1]).toEqual({ x: 100, y: 0 });
    expect(next[2]).toEqual({ x: 200, y: 0 });
  });
});

describe("removeAnchorAt", () => {
  it("refuses to shrink below the minimum", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(removeAnchorAt(path, 0)).toBe(path);
  });

  it("merges segments, keeping arrival from the removed and approach from the follower", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 25, y: -50 }, cp2: { x: 75, y: -50 } },
      { x: 200, y: 0, cp1: { x: 125, y: 50 }, cp2: { x: 175, y: 50 } },
    ];
    const next = removeAnchorAt(path, 1);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      x: 200,
      y: 0,
      cp1: { x: 25, y: -50 },
      cp2: { x: 175, y: 50 },
    });
  });

  it("strips orphaned controls when the first anchor is removed", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0, cp1: { x: 25, y: -50 }, cp2: { x: 75, y: -50 } },
      { x: 200, y: 0 },
    ];
    const next = removeAnchorAt(path, 0);
    expect(next[0]).toEqual({ x: 100, y: 0 });
    expect(next[1]).toEqual({ x: 200, y: 0 });
  });

  it("drops a plain trailing anchor cleanly", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(removeAnchorAt(path, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

describe("materializeHandles", () => {
  it("seeds controls at thirds so the curve starts as the line", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 90, y: 30 },
    ];
    const next = materializeHandles(path, 1);
    expect(next[1]).toEqual({
      x: 90,
      y: 30,
      cp1: { x: 30, y: 10 },
      cp2: { x: 60, y: 20 },
    });
    // Seeded controls are colinear: the cubic still evaluates on the line.
    const mid = bezierPoint(
      { x: 0, y: 0 },
      { x: 30, y: 10 },
      { x: 60, y: 20 },
      { x: 90, y: 30 },
      0.5,
    );
    expect(mid.x).toBeCloseTo(45);
    expect(mid.y).toBeCloseTo(15);
  });

  it("ignores an out-of-range segment index", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(materializeHandles(path, 5)).toEqual(path);
  });
});
