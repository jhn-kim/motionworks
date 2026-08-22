import {
  decodeCssValue,
  defaultUnitFor,
  encodeCssValue,
} from "../../shared/css-values.js";
import type { MotionWorksParam } from "../../shared/types.js";
import { EVENTS, varNameFor } from "../css-bindings.js";

export interface KeyframeBinding {
  effect: KeyframeEffect;
  animation?: Animation;
  animationName: string;
  occurrence: number;
}

export interface CssBinding {
  key: string;
  var: string;
  unit: string;
  inlineBefore: string;
  bound: boolean;
  originalValue?: unknown;
  keyframeEffect?: KeyframeEffect;
  keyframeAnimation?: Animation;
}

export function bindKeyframeEffect(
  effect: KeyframeEffect,
  animationName: string,
  occurrence = 0,
  animation?: Animation,
): KeyframeBinding {
  return { effect, animationName, occurrence, ...(animation && { animation }) };
}

export function readBaseline(
  node: HTMLElement,
  key: string,
  spec: MotionWorksParam,
  keyframe?: KeyframeBinding,
): { value: unknown; binding: CssBinding } {
  const variable = varNameFor(key, spec);
  const inlineBefore = node.style.getPropertyValue(variable);
  const computed = getComputedStyle(node);
  let css = computed.getPropertyValue(variable);
  if (keyframe !== undefined && !variable.startsWith("--")) {
    const names = computed
      .getPropertyValue("animation-name")
      .split(",")
      .map((item) => item.trim());
    const matching = names.flatMap((name, index) =>
      name === keyframe.animationName ? [index] : [],
    );
    const index = matching[keyframe.occurrence] ?? matching[0] ?? 0;
    css = computed.getPropertyValue(variable).split(",")[index]?.trim() ?? css;
  }
  const decoded = decodeCssValue(spec.type, css);
  if (decoded === null) {
    console.warn(
      `[MotionWorks] Param "${key}" is unbound: could not decode ${variable}: ${css.trim() || "(empty)"}.`,
    );
    return {
      value: 0,
      binding: {
        key,
        var: variable,
        unit: defaultUnitFor(spec.type, spec.unit),
        inlineBefore,
        bound: false,
        ...(keyframe !== undefined && { keyframeEffect: keyframe.effect }),
        ...(keyframe?.animation !== undefined && {
          keyframeAnimation: keyframe.animation,
        }),
      },
    };
  }
  return {
    value: decoded.value,
    binding: {
      key,
      var: variable,
      unit: decoded.unit,
      inlineBefore,
      bound: true,
      originalValue: decoded.value,
      ...(keyframe !== undefined && { keyframeEffect: keyframe.effect }),
      ...(keyframe?.animation !== undefined && {
        keyframeAnimation: keyframe.animation,
      }),
    },
  };
}

interface AnimationPhase {
  animation: Animation;
  effect: KeyframeEffect;
  currentTime: number;
  delay: number;
  duration: number;
}

export function retimeCurrentTime(
  currentTime: number,
  before: { delay: number; duration: number },
  after: { delay: number; duration: number },
): number {
  if (before.duration <= 0 || after.duration <= 0) return currentTime;
  if (currentTime <= before.delay) return currentTime;
  return (
    after.delay +
    (currentTime - before.delay) * (after.duration / before.duration)
  );
}

function numericTiming(effect: KeyframeEffect): {
  delay: number;
  duration: number;
} | null {
  const timing = effect.getTiming();
  if (typeof timing.duration !== "number") return null;
  return {
    delay: typeof timing.delay === "number" ? timing.delay : 0,
    duration: timing.duration,
  };
}

function captureAnimationPhases(
  node: HTMLElement,
  binding: CssBinding,
): AnimationPhase[] {
  if (typeof KeyframeEffect === "undefined") return [];
  let animations: Animation[] = [];
  if (binding.keyframeAnimation !== undefined) {
    animations = [binding.keyframeAnimation];
  } else if (typeof node.getAnimations === "function") {
    animations = node.getAnimations({ subtree: true });
  }
  return animations.flatMap((animation) => {
    if (!(animation.effect instanceof KeyframeEffect)) return [];
    if (typeof animation.currentTime !== "number") return [];
    const timing = numericTiming(animation.effect);
    if (timing === null || timing.duration <= 0) return [];
    return [
      {
        animation,
        effect: animation.effect,
        currentTime: animation.currentTime,
        ...timing,
      },
    ];
  });
}

function restoreAnimationPhases(phases: AnimationPhase[]): void {
  for (const phase of phases) {
    // Reading computed timing forces any CSS-variable timing update to land
    // before the current time is remapped.
    phase.effect.getComputedTiming();
    const next = numericTiming(phase.effect);
    if (next === null) continue;
    try {
      phase.animation.currentTime = retimeCurrentTime(
        phase.currentTime,
        phase,
        next,
      );
    } catch {
      // A replaced/cancelled CSSAnimation is no longer adjustable.
    }
  }
}

export function applyLive(
  node: HTMLElement,
  spec: MotionWorksParam,
  binding: CssBinding,
  value: unknown,
): void {
  if (!binding.bound) return;
  const css = encodeCssValue(spec.type, value, binding.unit);
  const phases =
    spec.type === "duration" ? captureAnimationPhases(node, binding) : [];
  if (binding.var.startsWith("--")) node.style.setProperty(binding.var, css);
  else {
    const effect = binding.keyframeEffect;
    if (effect !== undefined) {
      const patch: OptionalEffectTiming = {};
      if (binding.var === "animation-duration")
        patch.duration = value as number;
      else if (binding.var === "animation-delay") patch.delay = value as number;
      else if (binding.var === "animation-timing-function") patch.easing = css;
      effect.updateTiming(patch);
    } else node.style.setProperty(binding.var, css);
  }
  if (phases.length > 0) restoreAnimationPhases(phases);
  node.dispatchEvent(
    new CustomEvent(EVENTS.change, {
      bubbles: true,
      detail: { param: binding.key, value, css },
    }),
  );
}

export function restoreLive(node: HTMLElement, binding: CssBinding): void {
  if (
    binding.keyframeEffect !== undefined &&
    binding.originalValue !== undefined
  ) {
    const patch: OptionalEffectTiming = {};
    if (binding.var === "animation-duration")
      patch.duration = binding.originalValue as number;
    else if (binding.var === "animation-delay")
      patch.delay = binding.originalValue as number;
    else if (binding.var === "animation-timing-function") {
      const value = binding.originalValue as {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      };
      patch.easing = `cubic-bezier(${String(value.x1)}, ${String(value.y1)}, ${String(value.x2)}, ${String(value.y2)})`;
    }
    binding.keyframeEffect.updateTiming(patch);
    return;
  }
  if (binding.inlineBefore === "") node.style.removeProperty(binding.var);
  else node.style.setProperty(binding.var, binding.inlineBefore);
}

export interface DeclaringRule {
  selectorText: string;
  sheetHref: string;
  sourceFile?: string;
}
export function findDeclaringRule(
  node: HTMLElement,
  varName: string,
): DeclaringRule | undefined {
  let found: DeclaringRule | undefined;
  const visit = (rules: CSSRuleList, sheet: CSSStyleSheet): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        try {
          const owner =
            (sheet.ownerNode as HTMLElement | null) ??
            Array.from(
              document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
                'style,link[rel="stylesheet"]',
              ),
            ).find((candidate) => candidate.sheet === sheet) ??
            null;
          if (
            rule.style.getPropertyValue(varName) !== "" &&
            (rule.selectorText === ":root" ||
              node.closest(rule.selectorText) !== null)
          )
            found = {
              selectorText: rule.selectorText,
              sheetHref: sheet.href ?? "",
              ...(owner?.dataset.viteDevId !== undefined && {
                sourceFile: owner.dataset.viteDevId,
              }),
            };
        } catch {
          /* Invalid selectors are not candidates. */
        }
      } else if ("cssRules" in rule) {
        try {
          visit((rule as CSSGroupingRule).cssRules, sheet);
        } catch {
          /* Inaccessible nested rules are skipped. */
        }
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules, sheet);
    } catch {
      /* Cross-origin sheet. */
    }
  }
  return found;
}

export function watchStylesheets(cb: () => void): () => void {
  const links = new Set<HTMLLinkElement>();
  const onLoad = (): void => cb();
  const isOverlayNode = (node: Node): boolean => {
    const element =
      "closest" in node && typeof node.closest === "function"
        ? (node as Element)
        : node.parentElement;
    return (
      element !== null && element.closest("[data-motionworks-overlay]") !== null
    );
  };
  const asElement = (node: Node): Element | null =>
    node.nodeType === 1 ? (node as Element) : null;
  const isStyleElement = (node: Node): boolean =>
    asElement(node)?.tagName === "STYLE";
  const isOverlayStyle = (node: Node): boolean =>
    isStyleElement(node) &&
    asElement(node)?.hasAttribute("data-motionworks-overlay-style") === true;
  const isStylesheetLink = (node: Node): boolean => {
    const element = asElement(node);
    return (
      element?.tagName === "LINK" &&
      (element.getAttribute("rel") ?? "").toLowerCase() === "stylesheet"
    );
  };
  const attach = (): void => {
    for (const link of Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ))
      if (!links.has(link)) {
        links.add(link);
        link.addEventListener("load", onLoad);
      }
  };
  const isStylesheetNode = (node: Node): boolean => {
    // Family drawers and editors inject their own scoped <style> blocks.
    // They are toolbar implementation details, never a new source baseline.
    if (isOverlayNode(node) || isOverlayStyle(node)) return false;
    if (isStyleElement(node) || isStylesheetLink(node)) return true;
    const element = asElement(node);
    if (element !== null)
      return Array.from(
        element.querySelectorAll('style,link[rel="stylesheet"]'),
      ).some(
        (candidate) => !isOverlayNode(candidate) && !isOverlayStyle(candidate),
      );
    return (
      node.parentElement !== null &&
      isStyleElement(node.parentElement) &&
      !isOverlayStyle(node.parentElement)
    );
  };
  const affectsStylesheets = (record: MutationRecord): boolean => {
    // Checking the mutation target is essential for removals: a detached
    // <style> no longer has a parent, but the record target still identifies
    // the overlay subtree it came from.
    if (isOverlayNode(record.target)) return false;
    if (record.type === "attributes") return isStylesheetNode(record.target);
    if (record.type === "characterData") return isStylesheetNode(record.target);
    if (isStyleElement(record.target)) return true;
    return [...record.addedNodes, ...record.removedNodes].some(
      isStylesheetNode,
    );
  };
  attach();
  const observer = new MutationObserver((records) => {
    if (records.some(affectsStylesheets)) {
      attach();
      cb();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "rel", "media", "disabled"],
    characterData: true,
  });
  return () => {
    observer.disconnect();
    for (const link of links) link.removeEventListener("load", onLoad);
  };
}
