import {
  parseEasing,
  type MotionWorksRegistration,
} from "../../shared/index.js";

import { getBridge } from "../bridge.js";
import { slugify } from "../ids.js";

// Auto-registration of CSS transitions. A running transition surfaces in
// document.getAnimations() as a CSSTransition, and `transitionrun` fires the
// instant one starts — we use the event for prompt capture and getAnimations()
// as the validated source of truth, so capture still works if the event path is
// unavailable. Effects are keyed by their element (not the ephemeral
// CSSTransition object, which is replaced on every hover), so re-hovering an
// element reuses its registration instead of spawning duplicates. A registered
// element is retained until it leaves the DOM, so a finished hover transition
// stays selectable instead of flickering out.
//
// Transitions can't be replayed from script (:hover can't be forced, class
// toggles are app-owned), so they are marked manualTrigger: the toolkit renders
// Play inert with a "trigger it manually" chip.
//
// Scope: single-value transitions (transition-property "all" or one property,
// with single-valued duration/delay/timing). Multi-property comma lists would
// need index-matched reads and full-list reconstruction on write to avoid
// clobbering sibling properties; those elements are deliberately skipped.

function isMultiValue(value: string): boolean {
  return value.includes(",");
}

// "background-color" → "Background color"; "all"/"" → "Transition".
export function transitionDisplayName(property: string): string {
  const trimmed = property.trim();
  if (trimmed === "" || trimmed === "all") return "Transition";
  const spaced = trimmed.replace(/-+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function durationMs(value: string): number {
  const numeric = parseFloat(value);
  if (Number.isNaN(numeric)) return 0;
  return value.trim().endsWith("ms") ? numeric : numeric * 1000;
}

function allocateId(
  slug: string,
  existing: ReadonlyMap<string, readonly HTMLElement[]>,
): string {
  const pattern = new RegExp(
    `^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#(\\d+)$`,
  );
  const used = new Set(
    [...existing.keys()].flatMap((id) => {
      const match = pattern.exec(id);
      return match === null ? [] : [Number(match[1])];
    }),
  );
  let index = 1;
  while (used.has(index)) index++;
  return `${slug}#${String(index)}`;
}

export function startTransitionDetect(intervalMs = 1500): () => void {
  const bridge = getBridge();
  const registered = new Map<HTMLElement, string>();

  const handleElement = (target: HTMLElement): void => {
    if (registered.has(target)) return;
    if (target.closest("[data-motionworks-overlay]") !== null) return;
    // An explicit schema owns the animation semantics of its subtree.
    if (
      target.closest("[data-motionworks]") !== null ||
      bridge.hasExplicitOwner(target)
    )
      return;

    const computed = getComputedStyle(target);
    const property = computed.getPropertyValue("transition-property").trim();
    const duration = computed.getPropertyValue("transition-duration").trim();
    if (property === "" || property === "none" || duration === "") return;
    // Single-value only (see file header).
    if (isMultiValue(property) || isMultiValue(duration)) return;
    if (durationMs(duration) <= 0) return;

    const params: MotionWorksRegistration["params"] = {
      duration: {
        type: "duration",
        var: "transition-duration",
        min: 0,
        max: Math.max(3000, durationMs(duration) * 2),
        label: "Duration",
        unit: "ms",
      },
    };
    const delay = computed.getPropertyValue("transition-delay").trim();
    if (!isMultiValue(delay) && durationMs(delay) > 0) {
      params["delay"] = {
        type: "duration",
        var: "transition-delay",
        min: 0,
        max: Math.max(2000, durationMs(delay) * 2),
        label: "Delay",
        unit: "ms",
      };
    }
    const easing = computed
      .getPropertyValue("transition-timing-function")
      .trim();
    if (!isMultiValue(easing) && parseEasing(easing) !== null) {
      params["easing"] = {
        type: "easing-curve",
        var: "transition-timing-function",
        label: "Easing",
      };
    }

    const registration: MotionWorksRegistration = {
      name: transitionDisplayName(property),
      params,
      capabilities: { manualTrigger: true },
    };
    const id = allocateId(slugify(registration.name), bridge.getAllNodes());
    // No keyframe binding: transitions read timing from CSS, so applyLive writes
    // the transition-* longhand via setProperty (its non-keyframe path) and the
    // change lands the next time the transition runs.
    bridge.register(id, target, registration);
    registered.set(target, id);
  };

  const scan = (): void => {
    if (
      typeof document.getAnimations === "function" &&
      typeof CSSTransition !== "undefined"
    ) {
      for (const animation of document.getAnimations()) {
        if (!(animation instanceof CSSTransition)) continue;
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) continue;
        if (effect.target instanceof HTMLElement) handleElement(effect.target);
      }
    }
    for (const [node, id] of Array.from(registered.entries())) {
      if (node.isConnected) continue;
      bridge.unregister(id, node);
      registered.delete(node);
    }
  };

  const onRun = (event: Event): void => {
    if (event.target instanceof HTMLElement) handleElement(event.target);
  };

  document.addEventListener("transitionrun", onRun, true);
  scan();
  const interval = window.setInterval(scan, intervalMs);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("transitionrun", onRun, true);
    for (const [node, id] of registered) bridge.unregister(id, node);
    registered.clear();
  };
}
