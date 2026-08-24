// Detection of JavaScript-driven animation libraries. These run on their own
// main-thread engines and do NOT appear in document.getAnimations() (verified:
// even Motion's animate() / <motion.div> use a rAF engine, not WAAPI), so the
// CSS auto-detectors can't see them. GSAP is the exception: it exposes a global
// registry (gsap.globalTimeline) we can walk to recover targets and timing.
// Framer Motion and react-spring expose no such registry, so we can only report
// their presence (best-effort) and hand adoption to the coding agent.
//
// Nothing here edits or persists: JS values live in JS, so these effects are
// surfaced for ADOPTION (a one-time agent lift of the tunable value into a
// CSS custom property), after which the normal CSS path takes over.

import type { AdoptionRequest } from "../../shared/index.js";
import { describeNode } from "../dom-selector.js";

export interface JsAnimationCandidate {
  library: "gsap";
  node: HTMLElement;
  duration?: number; // ms
  delay?: number; // ms
  ease?: string;
}

export interface JsLibraryPresence {
  gsap: boolean;
  framerMotion: boolean;
  reactSpring: boolean;
}

interface GsapTween {
  targets?: () => unknown[];
  duration?: () => number;
  vars?: { ease?: unknown; delay?: unknown };
}
interface GsapGlobal {
  globalTimeline?: {
    getChildren?: (
      timelines?: boolean,
      tweens?: boolean,
      ignoreBeforeTime?: boolean,
    ) => GsapTween[];
  };
}

function gsapGlobal(): GsapGlobal | undefined {
  const candidate = (window as { gsap?: unknown }).gsap;
  return typeof candidate === "object" && candidate !== null
    ? (candidate as GsapGlobal)
    : undefined;
}

// GSAP durations/delays are seconds; MotionWorks works in ms.
function toMs(seconds: unknown): number | undefined {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.round(seconds * 1000)
    : undefined;
}

export function detectGsapCandidates(): JsAnimationCandidate[] {
  const timeline = gsapGlobal()?.globalTimeline;
  const getChildren = timeline?.getChildren;
  if (timeline === undefined || typeof getChildren !== "function") return [];
  let tweens: GsapTween[];
  try {
    // (timelines, tweens, ignoreBeforeTime) — include tweens, not nested
    // timelines, so each concrete tween is reported once.
    tweens = getChildren.call(timeline, false, true, true);
  } catch {
    return [];
  }
  const seen = new Set<HTMLElement>();
  const candidates: JsAnimationCandidate[] = [];
  for (const tween of tweens) {
    let targets: unknown[] = [];
    try {
      targets = typeof tween.targets === "function" ? tween.targets() : [];
    } catch {
      continue;
    }
    const duration = toMs(
      typeof tween.duration === "function" ? tween.duration() : undefined,
    );
    const delay = toMs(tween.vars?.delay);
    const ease = typeof tween.vars?.ease === "string" ? tween.vars.ease : undefined;
    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue;
      if (seen.has(target)) continue;
      if (target.closest("[data-motionworks-overlay]") !== null) continue;
      seen.add(target);
      candidates.push({
        library: "gsap",
        node: target,
        ...(duration !== undefined && { duration }),
        ...(delay !== undefined && { delay }),
        ...(ease !== undefined && { ease }),
      });
    }
  }
  return candidates;
}

// Map a GSAP candidate to an adoption request: the tunable timing values the
// agent should lift into CSS custom properties. GSAP eases are library-specific
// strings ("power1.inOut"), not cubic-beziers, so ease is left for the agent to
// translate rather than proposed as an editable easing-curve param.
export function buildGsapAdoptionRequest(
  candidate: JsAnimationCandidate,
  page: string,
): AdoptionRequest {
  const params: AdoptionRequest["params"] = [];
  if (candidate.duration !== undefined)
    params.push({
      key: "duration",
      type: "duration",
      value: candidate.duration,
      var: "--mw-duration",
      label: "Duration",
      unit: "ms",
    });
  if (candidate.delay !== undefined)
    params.push({
      key: "delay",
      type: "duration",
      value: candidate.delay,
      var: "--mw-delay",
      label: "Delay",
      unit: "ms",
    });
  return {
    library: "gsap",
    page,
    effectName: "GSAP animation",
    elementSelector: describeNode(candidate.node),
    params,
  };
}

// Best-effort library presence. GSAP is reliable (global registry). Framer
// Motion and react-spring expose no stable global, so presence can only be
// inferred weakly; absence here does NOT mean the library is unused.
export function detectLibraries(): JsLibraryPresence {
  const w = window as unknown as Record<string, unknown>;
  return {
    gsap: gsapGlobal()?.globalTimeline?.getChildren !== undefined,
    // Framer Motion / Motion attach no canonical global; these markers appear in
    // some builds/devtools integrations but are not guaranteed.
    framerMotion:
      "__FRAMER_MOTION_DEV_TOOLS__" in w || "MotionGlobalConfig" in w,
    reactSpring: "__REACT_SPRING_GLOBALS__" in w,
  };
}
