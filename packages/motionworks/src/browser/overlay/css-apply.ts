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
  // "::after"/"::before" when the animation targets a pseudo-element; the
  // baseline must then be read from the pseudo-element's computed style, not the
  // host's (the host has no animation of its own).
  pseudoElement?: string;
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
  const pseudoElement = effect.pseudoElement ?? undefined;
  return {
    effect,
    animationName,
    occurrence,
    ...(animation && { animation }),
    ...(pseudoElement !== undefined &&
      pseudoElement !== "" && { pseudoElement }),
  };
}

// Scroll- and view-driven animations carry a timeline other than the document
// timeline; their progress follows scroll position, not wall-clock time. They
// can't be played from script (calling play() cannot advance a scroll-bound
// timeline) and their `animation-duration` doesn't drive playback the way it
// does for a time-based animation. Detection marks them manualTrigger and skips
// the duration control. The check needs no ScrollTimeline/ViewTimeline globals:
// a plain CSSAnimation's timeline is exactly `document.timeline`.
export function isScrollDriven(animation: Animation): boolean {
  const timeline = animation.timeline;
  return timeline !== null && timeline !== document.timeline;
}

export function readBaseline(
  node: HTMLElement,
  key: string,
  spec: MotionWorksParam,
  keyframe?: KeyframeBinding,
): { value: unknown; binding: CssBinding } {
  const variable = varNameFor(key, spec);
  const inlineBefore = node.style.getPropertyValue(variable);
  const computed = getComputedStyle(node, keyframe?.pseudoElement ?? null);
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
  // How many elements in the document the winning selector governs. Greater
  // than 1 means one declaration is shared across instances, so a writeback
  // fans out to all of them — the repeated-child / staggered-loader case where
  // editing "one dot" silently rewrites every dot. `scope` is the same fact in
  // human-facing form and rides along to the journal so the daemon and the
  // agent can flag a global edit instead of treating it as local.
  matchedCount: number;
  scope: "single" | "shared";
  // The winning rule's declared value for the looked-up property (var() intact,
  // as authored). Lets callers inspect e.g. an `animation` shorthand for a
  // var() timing token without re-resolving the cascade.
  value: string;
}

// Pseudo-ELEMENTS a rule can target. `closest()`/`matches()` reject a selector
// ending in one, which made pseudo-element animations (`.x::after { animation }`,
// discovered against their host element) impossible to locate for writeback. We
// strip the trailing pseudo-element to match the originating element, then keep
// the full selector — pseudo included — for the writer.
const PSEUDO_ELEMENT_SUFFIX =
  /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\s*$/i;

// Approximate CSS specificity (a,b,c) folded into one comparable number. Used
// only to pick the cascade winner among rules that declare the same variable
// and match the node; exact per-spec accounting is unnecessary because document
// order breaks ties, exactly as the cascade does. Replaces the old
// last-rule-wins scan, which could target a less specific later rule.
function selectorSpecificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classesAttrsPseudoClasses =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]*\]/g) ?? []).length +
    (selector.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const typesAndPseudoElements =
    (selector.match(/::[\w-]+/g) ?? []).length +
    (selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classesAttrsPseudoClasses * 100 + typesAndPseudoElements;
}

interface Candidate {
  // Base selector (pseudo-element stripped) used for matching and for counting
  // how many elements the rule governs.
  baseSelector: string;
  specificity: number;
  order: number;
}

// The part of a rule's selector list that actually matches this node, with its
// specificity. Custom properties (`--*`) inherit, so an ancestor rule can
// legitimately supply the value and an ancestor match counts. Regular
// properties (`animation-duration`, …) do not inherit, so a rule that only
// matches an ancestor is NOT this node's declaring rule — matching there via
// `closest` was the old misattribution bug that pinned a container's rule onto
// a descendant.
function matchingCandidate(
  node: HTMLElement,
  selectorText: string,
  inherits: boolean,
  order: number,
): Candidate | undefined {
  let best: Candidate | undefined;
  for (const part of selectorText.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const base =
      trimmed === ":root"
        ? ":root"
        : trimmed.replace(PSEUDO_ELEMENT_SUFFIX, "").trim();
    if (base === "") continue;
    let matched = false;
    try {
      if (base === ":root") matched = inherits;
      else if (inherits) matched = node.closest(base) !== null;
      else matched = node.matches(base);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    const specificity = selectorSpecificity(trimmed);
    if (best === undefined || specificity >= best.specificity)
      best = { baseSelector: base, specificity, order };
  }
  return best;
}

export function findDeclaringRule(
  node: HTMLElement,
  varName: string,
): DeclaringRule | undefined {
  const inherits = varName.startsWith("--");
  let order = 0;
  let winner:
    | {
        selectorText: string;
        sheetHref: string;
        sourceFile?: string;
        value: string;
        candidate: Candidate;
      }
    | undefined;
  const visit = (rules: CSSRuleList, sheet: CSSStyleSheet): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        try {
          if (rule.style.getPropertyValue(varName) === "") continue;
          const candidate = matchingCandidate(
            node,
            rule.selectorText,
            inherits,
            order++,
          );
          if (candidate === undefined) continue;
          const better =
            winner === undefined ||
            candidate.specificity > winner.candidate.specificity ||
            (candidate.specificity === winner.candidate.specificity &&
              candidate.order > winner.candidate.order);
          if (!better) continue;
          const owner =
            (sheet.ownerNode as HTMLElement | null) ??
            Array.from(
              document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
                'style,link[rel="stylesheet"]',
              ),
            ).find((element) => element.sheet === sheet) ??
            null;
          winner = {
            selectorText: rule.selectorText,
            sheetHref: sheet.href ?? "",
            ...(owner?.dataset.viteDevId !== undefined && {
              sourceFile: owner.dataset.viteDevId,
            }),
            value: rule.style.getPropertyValue(varName),
            candidate,
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
  if (winner === undefined) return undefined;
  let matchedCount = 1;
  try {
    matchedCount = Math.max(
      1,
      document.querySelectorAll(winner.candidate.baseSelector).length,
    );
  } catch {
    matchedCount = 1;
  }
  return {
    selectorText: winner.selectorText,
    sheetHref: winner.sheetHref,
    ...(winner.sourceFile !== undefined && { sourceFile: winner.sourceFile }),
    matchedCount,
    scope: matchedCount > 1 ? "shared" : "single",
    value: winner.value,
  };
}

// If an auto-detected animation's timing value is supplied by a custom property
// — either as an `animation-<role>` longhand (`animation-delay: var(--d)`) or a
// token inside the `animation` shorthand (`animation: spin 2s var(--d)`) — this
// returns that custom property (and the unit it's authored in). The caller can
// bind directly when the property is in the daemon's writable namespace, or
// retain the unit while falling back to an allowed timing longhand for agent
// hand-off. When the value is a literal, a keyword, or otherwise not a single
// var(), returns undefined and the caller keeps the longhand binding.
export function resolveAnimationTimingVar(
  node: HTMLElement,
  role: "duration" | "delay" | "easing",
): { var: string; unit: string } | undefined {
  const varOf = (raw: string): string | undefined => {
    const match = /^var\(\s*(--[A-Za-z0-9_-]+)/.exec(raw.trim());
    return match?.[1];
  };
  const unitOf = (name: string): string => {
    const resolved = getComputedStyle(node).getPropertyValue(name).trim();
    return resolved.endsWith("ms") ? "ms" : resolved.endsWith("s") ? "s" : "ms";
  };
  // 1) Authored as the longhand directly.
  const longhand = `animation-${role === "easing" ? "timing-function" : role}`;
  const lh = findDeclaringRule(node, longhand);
  if (lh !== undefined) {
    const name = varOf(lh.value);
    if (name !== undefined) return { var: name, unit: unitOf(name) };
  }
  // 2) A var() token inside the `animation` shorthand.
  const shorthand = findDeclaringRule(node, "animation");
  if (shorthand === undefined) return undefined;
  const tokens = topLevelAnimationTokens(shorthand.value);
  if (tokens === null) return undefined; // multi-animation list — leave it
  const TIME = /^-?(?:\d+\.?\d*|\.\d+)m?s$/i;
  const isVar = (t: string): boolean => t.startsWith("var(");
  const timeLike = tokens.filter((t) => TIME.test(t) || isVar(t));
  let token: string | undefined;
  if (role === "duration") token = timeLike[0];
  else if (role === "delay") token = timeLike[1];
  else
    token = tokens.find(
      (t) =>
        t.startsWith("cubic-bezier(") || t.startsWith("steps(") || isVar(t),
    );
  if (token === undefined) return undefined;
  const name = varOf(token);
  return name === undefined ? undefined : { var: name, unit: unitOf(name) };
}

// Split an `animation` shorthand into top-level, whitespace-separated tokens,
// keeping parenthesised groups (cubic-bezier(), steps(), var()) whole. Returns
// null for a comma-separated multi-animation list, whose sub-values can't be
// mapped to one element unambiguously.
function topLevelAnimationTokens(value: string): string[] | null {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return null;
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else current += ch;
  }
  if (current !== "") tokens.push(current);
  return tokens;
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
  // Coalesce bursts of stylesheet mutations into one refresh per frame.
  // `refreshBaselines` runs a synchronous getComputedStyle for every param of
  // every effect, and CSS-in-JS/Tailwind-JIT dev servers rewrite <style>
  // textContent rapidly — firing it per characterData mutation was a storm
  // (P2-2).
  let frame: number | null = null;
  const scheduleRefresh = (): void => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      cb();
    });
  };
  const observer = new MutationObserver((records) => {
    if (records.some(affectsStylesheets)) {
      attach();
      scheduleRefresh();
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
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    for (const link of links) link.removeEventListener("load", onLoad);
  };
}
