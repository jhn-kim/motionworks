import { describe, expect, it, vi } from "vitest";
import { MotionWorksStateManager } from "./state.js";
import type { MotionWorksEffect, MotionWorksRegistration } from "./types.js";

function makeRegistration(
  overrides: Partial<MotionWorksRegistration> = {},
): MotionWorksRegistration {
  return {
    name: "TestEffect",
    params: {
      radius: { type: "spatial-radius", value: 100, min: 10, max: 400 },
      strength: { type: "spatial-strength", value: 0.5 },
    },
    update: vi.fn(),
    ...overrides,
  };
}

function makeWireEffect(
  overrides: Partial<MotionWorksEffect> = {},
): MotionWorksEffect {
  return {
    id: "effect-wire",
    name: "WireEffect",
    params: {
      radius: { type: "spatial-radius", value: 80 },
    },
    readOnly: false,
    ...overrides,
  };
}

describe("MotionWorksStateManager", () => {
  describe("registerEffect", () => {
    it("stores the effect and returns an MotionWorksEffect", () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect("id-1", makeRegistration());
      expect(effect.id).toBe("id-1");
      expect(effect.name).toBe("TestEffect");
      expect(state.getEffect("id-1")).toBe(effect);
    });

    it("applies validation: bad params are excluded from the stored effect", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect(
        "id-2",
        makeRegistration({
          params: {
            good: { type: "scalar", value: 1 },
            bad: { type: "spatial-radius", value: "not-a-number" },
          },
        }),
      );
      expect(effect.params["good"]).toBeDefined();
      expect(effect.params["bad"]).toBeUndefined();
      vi.restoreAllMocks();
    });

    it("sets readOnly false when update is a function", () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect(
        "id-3",
        makeRegistration({ update: () => {} }),
      );
      expect(effect.readOnly).toBe(false);
    });

    it("sets readOnly true when update is absent", () => {
      const state = new MotionWorksStateManager();
      const effect = state.registerEffect(
        "id-4",
        makeRegistration({ update: undefined }),
      );
      expect(effect.readOnly).toBe(true);
    });

    it("notifies subscribers on registration", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffect("id-5", makeRegistration());
      expect(listener).toHaveBeenCalledOnce();
    });

    it("re-registration replaces the previous stored effect", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-6", makeRegistration({ name: "First" }));
      const effect = state.registerEffect(
        "id-6",
        makeRegistration({ name: "Second" }),
      );
      expect(effect.name).toBe("Second");
      expect(state.getAllEffects()).toHaveLength(1);
    });
  });

  describe("registerEffectFromWire", () => {
    it("stores the wire effect without update fn", () => {
      const state = new MotionWorksStateManager();
      const wire = makeWireEffect();
      state.registerEffectFromWire(wire);
      expect(state.getEffect(wire.id)).toMatchObject({
        id: wire.id,
        name: wire.name,
      });
    });

    it("notifies subscribers", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffectFromWire(makeWireEffect());
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe("unregisterEffect", () => {
    it("removes the effect", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-a", makeRegistration());
      state.unregisterEffect("id-a");
      expect(state.getEffect("id-a")).toBeUndefined();
    });

    it("clears selection if the selected effect is unregistered", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-b", makeRegistration());
      state.selectEffect("id-b");
      state.unregisterEffect("id-b");
      expect(state.getSelectedEffect()).toBeNull();
    });

    it("does not notify if the effect was not registered", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.unregisterEffect("nonexistent");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("selectEffect", () => {
    it("sets the selected effect id", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-c", makeRegistration());
      state.selectEffect("id-c");
      expect(state.getSelectedEffect()?.id).toBe("id-c");
    });

    it("ignores selection of an unknown effect", () => {
      const state = new MotionWorksStateManager();
      state.selectEffect("nonexistent");
      expect(state.getSelectedEffect()).toBeNull();
    });

    it("clears selection when passed null", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-d", makeRegistration());
      state.selectEffect("id-d");
      state.selectEffect(null);
      expect(state.getSelectedEffect()).toBeNull();
    });
  });

  describe("applyParamChange", () => {
    it("calls the update fn with only the changed param (partial delta)", () => {
      const updateFn = vi.fn();
      const state = new MotionWorksStateManager();
      state.registerEffect("id-f", makeRegistration({ update: updateFn }));
      state.applyParamChange("id-f", "radius", 150);

      expect(updateFn).toHaveBeenCalledOnce();
      const arg = updateFn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(arg)).toEqual(["radius"]);
      expect(arg["radius"]).toBe(150);
    });

    it("does not call update fn when effect is readOnly", () => {
      const updateFn = vi.fn();
      const state = new MotionWorksStateManager();
      state.registerEffect("id-g", makeRegistration({ update: undefined }));
      state.applyParamChange("id-g", "radius", 150);
      expect(updateFn).not.toHaveBeenCalled();
    });

    it("is a no-op for unknown effect ids", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.applyParamChange("nonexistent", "x", 1);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("calls the listener on state changes", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      state.subscribe(listener);
      state.registerEffect("id-p", makeRegistration());
      expect(listener).toHaveBeenCalledOnce();
    });

    it("stops calling the listener after unsubscribe", () => {
      const state = new MotionWorksStateManager();
      const listener = vi.fn();
      const unsubscribe = state.subscribe(listener);
      unsubscribe();
      state.registerEffect("id-q", makeRegistration());
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("getSnapshot", () => {
    it("returns all effects and the selection", () => {
      const state = new MotionWorksStateManager();
      state.registerEffect("id-r", makeRegistration());
      state.selectEffect("id-r");

      const snap = state.getSnapshot();
      expect(snap.effects).toHaveLength(1);
      expect(snap.selectedEffectId).toBe("id-r");
    });
  });
});
