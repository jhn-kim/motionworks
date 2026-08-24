import { afterEach, describe, expect, it, vi } from "vitest";

import { MotionWorksStateManager } from "../../shared/index.js";
import { getBridge } from "../bridge.js";
import { startAutoDetect } from "./auto-detect.js";

class FakeKeyframeEffect {
  readonly updateTiming = vi.fn();

  constructor(
    readonly target: Element,
    private readonly timing: EffectTiming,
  ) {}

  getTiming(): EffectTiming {
    return this.timing;
  }

  getKeyframes(): Keyframe[] {
    return [];
  }
}

class FakeCssAnimation {
  constructor(
    readonly animationName: string,
    readonly effect: FakeKeyframeEffect,
    // Omitted → undefined, treated as the document timeline (not scroll-driven).
    // A distinct object stands in for a ScrollTimeline/ViewTimeline.
    readonly timeline: unknown = undefined,
  ) {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "getAnimations");
  document.body.innerHTML = "";
  getBridge().detach();
});

describe("CSS animation auto-detection", () => {
  it("allocates distinct stable ids for same-name animations on one node", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSSAnimation", FakeCssAnimation);
    vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("div");
    node.style.animationName = "spin, spin";
    node.style.animationDuration = "100ms, 200ms";
    document.body.appendChild(node);
    const first = new FakeCssAnimation(
      "spin",
      new FakeKeyframeEffect(node, { duration: 100, easing: "linear" }),
    );
    const second = new FakeCssAnimation(
      "spin",
      new FakeKeyframeEffect(node, { duration: 200, easing: "linear" }),
    );
    let animations = [first, second] as unknown as Animation[];
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => animations,
    });

    const stop = startAutoDetect(10);
    expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
      "spin#1",
      "spin#2",
    ]);
    expect(state.getEffect("spin#1")?.params.duration?.value).toBe(100);
    expect(state.getEffect("spin#2")?.params.duration?.value).toBe(200);

    const registrationChanged = vi.fn();
    const unsubscribe = state.subscribe(registrationChanged);
    (first.effect.getTiming() as { duration: number }).duration = 1800;
    await vi.advanceTimersByTimeAsync(10);
    expect(registrationChanged).not.toHaveBeenCalled();
    unsubscribe();

    animations = [second] as unknown as Animation[];
    await vi.advanceTimersByTimeAsync(10);
    expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
      "spin#2",
    ]);
    stop();
  });

  it("marks a scroll-driven animation manualTrigger and suppresses its duration (F2/F3)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSSAnimation", FakeCssAnimation);
    vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("div");
    document.body.appendChild(node);
    const animation = new FakeCssAnimation(
      "reveal",
      new FakeKeyframeEffect(node, { duration: 300, easing: "linear" }),
      {}, // a non-document timeline → scroll/view-driven
    );
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation] as unknown as Animation[],
    });

    const stop = startAutoDetect(10);
    const effect = state.getEffect("reveal#1");
    expect(effect?.capabilities?.manualTrigger).toBe(true);
    // Duration is meaningless for scroll-driven playback; easing stays editable.
    expect(effect?.params.duration).toBeUndefined();
    expect(effect?.params.easing).toBeDefined();
    stop();
  });

  it("keeps a finished one-shot registered while its element stays in the DOM (P2-9)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSSAnimation", FakeCssAnimation);
    vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("div");
    node.style.animationName = "enter";
    node.style.animationDuration = "300ms";
    document.body.appendChild(node);
    const animation = Object.assign(
      new FakeCssAnimation(
        "enter",
        new FakeKeyframeEffect(node, { duration: 300, easing: "linear" }),
      ),
      { playState: "running" as AnimationPlayState },
    );
    let animations = [animation] as unknown as Animation[];
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => animations,
    });

    const stop = startAutoDetect(10);
    expect(state.getAllEffects().map((e) => e.id)).toEqual(["enter#1"]);

    // The one-shot finishes: it drops out of getAnimations() but the element
    // is still on the page. It must stay selectable, not flicker away.
    animation.playState = "finished";
    animations = [] as unknown as Animation[];
    await vi.advanceTimersByTimeAsync(10);
    expect(state.getAllEffects().map((e) => e.id)).toEqual(["enter#1"]);

    // Once the element leaves the DOM, it is finally unregistered.
    node.remove();
    await vi.advanceTimersByTimeAsync(10);
    expect(state.getAllEffects()).toEqual([]);
    stop();
  });

  it("does not duplicate an animation inside an explicitly registered effect", () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSSAnimation", FakeCssAnimation);
    vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("div");
    node.setAttribute(
      "data-motionworks",
      '{"name":"Pulse","params":{"strength":{"type":"spatial-strength"}}}',
    );
    node.style.animationName = "pulse";
    node.style.animationDuration = "1000ms";
    document.body.appendChild(node);
    const animation = new FakeCssAnimation(
      "pulse",
      new FakeKeyframeEffect(node, { duration: 1000, easing: "linear" }),
    );
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation] as unknown as Animation[],
    });

    const stop = startAutoDetect(10);
    expect(state.getAllEffects()).toEqual([]);
    stop();
  });

  it("treats hook-registered containers as owners of descendant animations", () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSSAnimation", FakeCssAnimation);
    vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
    const state = new MotionWorksStateManager();
    const bridge = getBridge();
    bridge.attach(state);
    const group = document.createElement("div");
    const bar = document.createElement("i");
    group.style.setProperty("--mw-stagger-gap", "100ms");
    group.appendChild(bar);
    document.body.appendChild(group);
    bridge.register("stagger-wave#1", group, {
      name: "Stagger wave",
      params: {
        gap: {
          type: "stagger",
          var: "--mw-stagger-gap",
          unit: "ms",
        },
      },
    });
    const animation = new FakeCssAnimation(
      "stagger-wave",
      new FakeKeyframeEffect(bar, { duration: 900, easing: "linear" }),
    );
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation] as unknown as Animation[],
    });

    const stop = startAutoDetect(10);
    expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
      "stagger-wave#1",
    ]);
    stop();
  });
});
