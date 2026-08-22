import { describe, expect, it } from "vitest";

import { isReadableName, nameFromKeyframes } from "./auto-detect.js";
import { friendlyNodeLabel, humanizeEffectName } from "./display-name.js";

describe("humanizeEffectName", () => {
  it("splits camelCase registered names into words", () => {
    expect(humanizeEffectName("ProductCardHover")).toBe("Product card hover");
    expect(humanizeEffectName("HeroTextEntrance")).toBe("Hero text entrance");
  });

  it("splits kebab and snake case", () => {
    expect(humanizeEffectName("live-pulse")).toBe("Live pulse");
    expect(humanizeEffectName("fade_in_up")).toBe("Fade in up");
  });

  it("turns an instance suffix into an ordinal label", () => {
    expect(humanizeEffectName("card-entrance#2")).toBe("Card entrance 2");
  });
});

describe("isReadableName", () => {
  it("accepts human-authored keyframes names", () => {
    expect(isReadableName("live-pulse")).toBe(true);
    expect(isReadableName("fadeIn")).toBe(true);
  });

  it("rejects hashed and framework-mangled names", () => {
    expect(isReadableName("pulse__1x9ab")).toBe(false);
    expect(isReadableName("jsx-3982-spin")).toBe(false);
    expect(isReadableName("a")).toBe(false);
  });
});

describe("nameFromKeyframes", () => {
  it("describes the dominant visual change in plain words", () => {
    expect(nameFromKeyframes([{ opacity: 0 }, { opacity: 1 }])).toBe("Fade");
    expect(
      nameFromKeyframes([
        { transform: "scale(1)", opacity: 0.7 },
        { transform: "scale(1.7)" },
      ]),
    ).toBe("Pulse");
    expect(
      nameFromKeyframes([
        { transform: "rotate(0deg)" },
        { transform: "rotate(360deg)" },
      ]),
    ).toBe("Spin");
    expect(
      nameFromKeyframes([
        { transform: "translateY(0)" },
        { transform: "translateY(-8px)" },
      ]),
    ).toBe("Drift");
    expect(nameFromKeyframes([])).toBe("Animation");
  });
});

describe("friendlyNodeLabel", () => {
  it("prefers the element’s own text", () => {
    const el = document.createElement("button");
    el.textContent = "Add to cart";
    expect(friendlyNodeLabel(el)).toBe('"Add to cart"');
  });

  it("anchors text-less elements to nearby text", () => {
    const parent = document.createElement("span");
    const dot = document.createElement("span");
    parent.appendChild(dot);
    parent.appendChild(document.createTextNode("Collection · 6"));
    expect(friendlyNodeLabel(dot)).toBe('<span> in "Collection · 6"');
  });

  it("truncates long text", () => {
    const el = document.createElement("p");
    el.textContent = "A small studio of tabletop, lighting, and seating pieces";
    expect(friendlyNodeLabel(el)).toBe('"A small studio of tabletop…"');
  });
});
