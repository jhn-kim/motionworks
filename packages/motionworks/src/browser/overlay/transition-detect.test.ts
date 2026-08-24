import { afterEach, describe, expect, it, vi } from "vitest";

import { MotionWorksStateManager } from "../../shared/index.js";
import { getBridge } from "../bridge.js";
import {
  startTransitionDetect,
  transitionDisplayName,
} from "./transition-detect.js";

class FakeKeyframeEffect {
  constructor(readonly target: Element) {}
}
class FakeCssTransition {
  constructor(
    readonly transitionProperty: string,
    readonly effect: FakeKeyframeEffect,
  ) {}
}

// getComputedStyle for the element under test; swapped per test.
let computed: Record<string, string> = {};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "getAnimations");
  document.body.innerHTML = "";
  getBridge().detach();
  computed = {};
});

function mount(target: Element, transitions: FakeCssTransition[]): void {
  vi.stubGlobal("CSSTransition", FakeCssTransition);
  vi.stubGlobal("KeyframeEffect", FakeKeyframeEffect);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (prop: string) => computed[prop] ?? "",
  } as CSSStyleDeclaration);
  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: () => transitions as unknown as Animation[],
  });
  void target;
}

describe("transitionDisplayName", () => {
  it("humanizes the property; 'all' and empty become 'Transition'", () => {
    expect(transitionDisplayName("background-color")).toBe("Background color");
    expect(transitionDisplayName("opacity")).toBe("Opacity");
    expect(transitionDisplayName("all")).toBe("Transition");
    expect(transitionDisplayName("")).toBe("Transition");
  });
});

describe("CSS transition auto-detection", () => {
  it("registers a single-value transition as manualTrigger with editable timing", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("button");
    document.body.appendChild(node);
    computed = {
      "transition-property": "opacity",
      "transition-duration": "0.3s",
      "transition-delay": "0s",
      "transition-timing-function": "ease",
    };
    mount(node, [new FakeCssTransition("opacity", new FakeKeyframeEffect(node))]);

    const stop = startTransitionDetect(10);
    const effect = state.getEffect("opacity#1");
    expect(effect?.name).toBe("Opacity");
    expect(effect?.capabilities?.manualTrigger).toBe(true);
    expect(effect?.params.duration?.var).toBe("transition-duration");
    expect(effect?.params.duration?.value).toBe(300);
    expect(effect?.params.easing?.var).toBe("transition-timing-function");
    // delay is 0 → not exposed
    expect(effect?.params.delay).toBeUndefined();
    stop();
  });

  it("skips multi-property transitions (comma lists) to avoid clobbering", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("div");
    document.body.appendChild(node);
    computed = {
      "transition-property": "opacity, transform",
      "transition-duration": "0.3s, 0.5s",
      "transition-delay": "0s, 0s",
      "transition-timing-function": "ease, ease",
    };
    mount(node, [
      new FakeCssTransition("opacity", new FakeKeyframeEffect(node)),
    ]);

    const stop = startTransitionDetect(10);
    expect(state.getAllEffects()).toHaveLength(0);
    stop();
  });

  it("unregisters a transition effect when its element leaves the DOM", async () => {
    vi.useFakeTimers();
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const node = document.createElement("button");
    document.body.appendChild(node);
    computed = {
      "transition-property": "opacity",
      "transition-duration": "0.3s",
      "transition-delay": "0s",
      "transition-timing-function": "ease",
    };
    mount(node, [new FakeCssTransition("opacity", new FakeKeyframeEffect(node))]);

    const stop = startTransitionDetect(10);
    expect(state.getAllEffects()).toHaveLength(1);
    node.remove();
    await vi.advanceTimersByTimeAsync(10);
    expect(state.getAllEffects()).toHaveLength(0);
    stop();
  });
});
