import { describe, expect, it, vi } from "vitest";
import {
  onParamsChange,
  readMotionVar,
  readParams,
  varNameFor,
} from "./css-bindings.js";
describe("css bindings", () => {
  it("derives names and reads params", () => {
    const el = document.createElement("div");
    el.style.setProperty("--mw-radius", "12px");
    expect(varNameFor("radius", { type: "spatial-radius" })).toBe(
      "--mw-radius",
    );
    expect(readParams(el, { radius: { type: "spatial-radius" } })).toEqual({
      radius: 12,
    });
  });
  it("subscribes to change events", () => {
    const el = document.createElement("div");
    const cb = vi.fn();
    const off = onParamsChange(el, cb);
    el.dispatchEvent(
      new CustomEvent("motionworks:change", {
        detail: { param: "radius", value: 4 },
      }),
    );
    expect(cb).toHaveBeenCalledWith({ radius: 4 }, expect.any(CustomEvent));
    off();
  });

  it("readMotionVar falls back safely and exposes units explicitly", () => {
    // No element (SSR / null ref) → fallback, never throws.
    expect(readMotionVar(null, "--mw-duration", 0.6, { seconds: true })).toBe(
      0.6,
    );

    const el = document.createElement("div");
    document.body.append(el);
    // Missing variable → fallback.
    expect(readMotionVar(el, "--mw-duration", 0.6, { seconds: true })).toBe(
      0.6,
    );

    el.style.setProperty("--mw-duration", "600ms");
    // Default unit is milliseconds (MotionWorks' internal unit)…
    expect(readMotionVar(el, "--mw-duration", 0)).toBe(600);
    // …seconds for Framer's duration, so no silent 1000x error.
    expect(readMotionVar(el, "--mw-duration", 0, { seconds: true })).toBe(0.6);

    // A seconds-declared value round-trips the same way.
    el.style.setProperty("--mw-duration", "0.3s");
    expect(readMotionVar(el, "--mw-duration", 0, { seconds: true })).toBe(0.3);
    el.remove();
  });
});
