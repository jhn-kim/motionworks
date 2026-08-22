import { describe, expect, it, vi } from "vitest";
import { MotionWorksStateManager } from "./state.js";

const baseline = {
  radius: {
    type: "spatial-radius" as const,
    value: 100,
    var: "--mw-radius",
    cssUnit: "px",
    bound: true,
  },
};
describe("MotionWorksStateManager", () => {
  it("registers schema with a runtime baseline", () => {
    const state = new MotionWorksStateManager();
    const effect = state.registerEffect(
      "card#1",
      { name: "Card", params: { radius: { type: "spatial-radius" } } },
      baseline,
    );
    expect(effect.params.radius).toEqual(baseline.radius);
  });
  it("tracks selection, unregistration, and subscriptions", () => {
    const state = new MotionWorksStateManager();
    const listener = vi.fn();
    state.subscribe(listener);
    state.registerEffect(
      "card#1",
      { name: "Card", params: { radius: { type: "spatial-radius" } } },
      baseline,
    );
    state.selectEffect("card#1");
    state.applyParamChange("card#1", "radius", 120);
    state.unregisterEffect("card#1");
    expect(listener).toHaveBeenCalledTimes(4);
    expect(state.getSelectedEffect()).toBeNull();
  });
});
