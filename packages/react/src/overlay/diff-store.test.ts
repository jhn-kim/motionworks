import { describe, expect, it, vi } from "vitest";

import { DiffStore } from "./diff-store.js";

describe("DiffStore", () => {
  describe("recordChange", () => {
    it("captures the baseline as `from` on first record", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 145);
      expect(store.getDiff("effect-a")).toEqual({
        radius: { from: 100, to: 145 },
      });
    });

    it("preserves the original `from` across subsequent records", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 145);
      store.recordChange("effect-a", "radius", 100, 165);
      store.recordChange("effect-a", "radius", 100, 200);
      expect(store.getDiff("effect-a")).toEqual({
        radius: { from: 100, to: 200 },
      });
    });

    it("does not record a change when the value equals the baseline", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 100);
      expect(store.getDiff("effect-a")).toEqual({});
      expect(store.hasDiff("effect-a")).toBe(false);
    });

    it("does not notify when the incoming value equals the stored `to`", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 145);
      const listener = vi.fn();
      store.subscribe(listener);
      store.recordChange("effect-a", "radius", 100, 145);
      expect(listener).not.toHaveBeenCalled();
    });

    it("uses deep equality for object-valued params (spring)", () => {
      const store = new DiffStore();
      const baseline = { stiffness: 280, damping: 20 };
      const identical = { stiffness: 280, damping: 20 };
      store.recordChange("effect-a", "spring", baseline, identical);
      // Structurally equal → no diff recorded.
      expect(store.getDiff("effect-a")).toEqual({});
    });

    it("records a diff for a shallow difference in a spring value", () => {
      const store = new DiffStore();
      const baseline = { stiffness: 280, damping: 20 };
      const changed = { stiffness: 320, damping: 20 };
      store.recordChange("effect-a", "spring", baseline, changed);
      expect(store.getDiff("effect-a")).toEqual({
        spring: { from: baseline, to: changed },
      });
    });
  });

  describe("reconcile — matrix branches", () => {
    it("clean: new baseline equals `to` → diff cleared", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);

      const result = store.reconcile("effect-a", { radius: 165 });

      expect(result.params["radius"]?.status).toBe("clean");
      expect(store.hasDiff("effect-a")).toBe(false);
    });

    it("preserved: new baseline equals `from` → diff kept, no unexpected flag", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);

      const result = store.reconcile("effect-a", { radius: 100 });

      expect(result.params["radius"]?.status).toBe("preserved");
      expect(store.getDiff("effect-a")).toEqual({
        radius: { from: 100, to: 165 },
      });
      expect(store.getFlags("effect-a").size).toBe(0);
    });

    it("unexpected: neither `from` nor `to` → diff kept and flag set", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);

      const result = store.reconcile("effect-a", { radius: 250 });

      expect(result.params["radius"]?.status).toBe("unexpected");
      expect(store.hasDiff("effect-a")).toBe(true);
      expect(store.getFlags("effect-a").has("radius")).toBe(true);
    });

    it("deep equality is used against object-valued params", () => {
      const store = new DiffStore();
      const from = { stiffness: 280, damping: 20 };
      const to = { stiffness: 320, damping: 25 };
      store.recordChange("effect-a", "spring", from, to);

      const clean = store.reconcile("effect-a", {
        spring: { stiffness: 320, damping: 25 },
      });
      expect(clean.params["spring"]?.status).toBe("clean");
    });

    it("unexpected flag clears when a later baseline matches `to`", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);
      store.reconcile("effect-a", { radius: 250 });
      expect(store.getFlags("effect-a").has("radius")).toBe(true);

      store.reconcile("effect-a", { radius: 165 });
      expect(store.getFlags("effect-a").has("radius")).toBe(false);
      expect(store.hasDiff("effect-a")).toBe(false);
    });

    it("leaves untouched params alone", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);
      store.recordChange("effect-a", "strength", 0.5, 0.9);

      store.reconcile("effect-a", { radius: 165 });

      expect(store.getDiff("effect-a")).toEqual({
        strength: { from: 0.5, to: 0.9 },
      });
    });
  });

  describe("clear operations", () => {
    it("clearEffect removes both diffs and flags", () => {
      const store = new DiffStore();
      store.recordChange("effect-a", "radius", 100, 165);
      store.reconcile("effect-a", { radius: 250 });
      store.clearEffect("effect-a");
      expect(store.hasDiff("effect-a")).toBe(false);
      expect(store.getFlags("effect-a").size).toBe(0);
    });
  });

  it("round-trips through the serialisable form", () => {
    const original = new DiffStore();
    original.recordChange("effect-a", "radius", 100, 165);
    original.recordChange("effect-b", "strength", 0.5, 0.8);

    const hydrated = new DiffStore();
    hydrated.hydrate(original.toJSON());

    expect(hydrated.toJSON()).toEqual(original.toJSON());
  });
});
