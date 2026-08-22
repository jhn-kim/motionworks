import { describe, expect, it, vi } from "vitest";
import { onParamsChange, readParams, varNameFor } from "./css-bindings.js";
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
});
