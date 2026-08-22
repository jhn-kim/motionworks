import {
  parseEasing,
  type MotionWorksRegistration,
} from "../../shared/index.js";

import { getBridge } from "../bridge.js";
import { slugify } from "../ids.js";
import { bindKeyframeEffect } from "./css-apply.js";

// Auto-registration of CSS keyframe animations. Anything running via
// @keyframes is discovered through document.getAnimations() and registered
// as a first-class effect — named after its animationName, selectable like
// any registered element, with duration / delay / easing editable live
// through KeyframeEffect.updateTiming(). When CSSOM cannot identify a
// declaring longhand rule, the commit carries the animation name and the
// agent locates the @keyframes / animation declaration during writeback.
//
// Scope: CSSAnimation only. CSS transitions are transient (they exist only
// while running), so registering them would flicker in and out of the
// effect list; agents should register transition-based effects explicitly.

// A @keyframes name is only worth showing if a human wrote it to be read:
// short, letters and dashes, no hash suffixes or framework prefixes
// (CSS Modules "pulse__1x9ab", styled-jsx "jsx-3982-spin").
export function isReadableName(name: string): boolean {
  if (!/^[a-zA-Z][a-zA-Z-]{2,23}$/.test(name)) return false;
  if (/^(jsx|css|sc|emotion)-/.test(name)) return false;
  return true;
}

// Fallback naming from what the animation actually does — inspect the
// keyframes and describe the dominant visual change in plain words.
export function nameFromKeyframes(frames: Keyframe[]): string {
  const props = new Set<string>();
  let transforms = "";
  for (const frame of frames) {
    for (const [key, value] of Object.entries(frame)) {
      if (
        key === "offset" ||
        key === "easing" ||
        key === "composite" ||
        key === "computedOffset"
      )
        continue;
      props.add(key);
      if (key === "transform") transforms += ` ${String(value)}`;
    }
  }
  if (/rotate/i.test(transforms)) return "Spin";
  if (/scale/i.test(transforms))
    return props.has("opacity") ? "Pulse" : "Scale";
  if (/translate/i.test(transforms))
    return props.has("opacity") ? "Fade drift" : "Drift";
  if (props.has("opacity")) return "Fade";
  if (props.has("backgroundColor") || props.has("color") || props.has("filter"))
    return "Color shift";
  if (props.has("width") || props.has("height")) return "Resize";
  return "Animation";
}

// Display name for an auto-detected animation. The original @keyframes name
// is preserved in the effect id (css::<name>#<n>) for writeback — this only
// decides what the designer reads.
function displayNameFor(animationName: string, effect: KeyframeEffect): string {
  if (isReadableName(animationName)) {
    const spaced = animationName.replace(/-+/g, " ").toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  let frames: Keyframe[] = [];
  try {
    frames = effect.getKeyframes();
  } catch {
    // Cross-origin stylesheets can make keyframes unreadable.
  }
  return nameFromKeyframes(frames);
}

interface AutoEffect {
  id: string;
  node: HTMLElement;
  occurrence: number;
}

function allocateAutoEffectId(
  slug: string,
  existing: ReadonlyMap<string, readonly HTMLElement[]>,
): string {
  const used = new Set(
    [...existing.keys()].flatMap((id) => {
      const match = new RegExp(
        `^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#(\\d+)$`,
      ).exec(id);
      return match === null ? [] : [Number(match[1])];
    }),
  );
  let index = 1;
  while (used.has(index)) index++;
  return `${slug}#${String(index)}`;
}

export function startAutoDetect(intervalMs = 1500): () => void {
  const bridge = getBridge();
  const registered = new Map<Animation, AutoEffect>();

  const scan = (): void => {
    if (typeof document.getAnimations !== "function") return;
    if (typeof CSSAnimation === "undefined") return;
    const seen = new Set<Animation>();
    const occurrences = new WeakMap<HTMLElement, Map<string, number>>();

    for (const animation of document.getAnimations()) {
      if (!(animation instanceof CSSAnimation)) continue;
      const keyframeEffect = animation.effect;
      if (!(keyframeEffect instanceof KeyframeEffect)) continue;
      const target = keyframeEffect.target;
      if (!(target instanceof HTMLElement)) continue;
      if (target.closest("[data-motionworks-overlay]") !== null) continue;
      // An explicit schema owns the animation semantics for its subtree.
      // Registering the nested CSSAnimation as well duplicates controls and
      // makes a single card look like several unrelated effects.
      if (
        target.closest("[data-motionworks]") !== null ||
        bridge.hasExplicitOwner(target)
      )
        continue;

      const name = animation.animationName;
      const targetOccurrences =
        occurrences.get(target) ?? new Map<string, number>();
      const occurrence = targetOccurrences.get(name) ?? 0;
      targetOccurrences.set(name, occurrence + 1);
      occurrences.set(target, targetOccurrences);
      seen.add(animation);

      const existing = registered.get(animation);
      // MotionWorks updates KeyframeEffect timing live. Rebuilding the schema
      // from that edited timing would change slider bounds on the next scan
      // and make the thumb jump. An Animation object keeps its first schema
      // for its lifetime; HMR supplies a new object and therefore a new read.
      if (
        existing !== undefined &&
        existing.node === target &&
        existing.occurrence === occurrence
      )
        continue;

      const timing = keyframeEffect.getTiming();
      const params: MotionWorksRegistration["params"] = {};
      if (typeof timing.duration === "number") {
        params["duration"] = {
          type: "duration",
          var: "animation-duration",
          min: 0,
          max: Math.max(3000, timing.duration * 2),
          label: "Duration",
          unit: "ms",
        };
      }
      if (typeof timing.delay === "number" && timing.delay > 0) {
        params["delay"] = {
          type: "duration",
          var: "animation-delay",
          min: 0,
          max: Math.max(2000, timing.delay * 2),
          label: "Delay",
          unit: "ms",
        };
      }
      const curve = parseEasing(String(timing.easing ?? ""));
      if (curve !== null) {
        params["easing"] = {
          type: "easing-curve",
          var: "animation-timing-function",
          label: "Easing",
        };
      }
      if (Object.keys(params).length === 0) continue;

      const registration: MotionWorksRegistration = {
        name: displayNameFor(name, keyframeEffect),
        params,
      };
      const slug = slugify(registration.name);
      const id =
        existing?.node === target && existing.id.startsWith(`${slug}#`)
          ? existing.id
          : allocateAutoEffectId(slug, bridge.getAllNodes());
      if (existing !== undefined && existing.id !== id) {
        bridge.unregister(existing.id, existing.node);
      }
      bridge.register(
        id,
        target,
        registration,
        bindKeyframeEffect(keyframeEffect, name, occurrence, animation),
      );
      registered.set(animation, { id, node: target, occurrence });
    }

    // Unregister effects whose animation stopped or whose element left.
    for (const [animation, entry] of Array.from(registered.entries())) {
      if (!seen.has(animation)) {
        bridge.unregister(entry.id, entry.node);
        registered.delete(animation);
      }
    }
  };

  scan();
  const interval = window.setInterval(scan, intervalMs);
  return () => {
    window.clearInterval(interval);
    for (const entry of registered.values()) {
      bridge.unregister(entry.id, entry.node);
    }
    registered.clear();
  };
}
