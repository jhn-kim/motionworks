import { decodeCssValue } from "../shared/css-values.js";
import type { MotionWorksParam } from "../shared/types.js";

export const DEFAULT_VAR_PREFIX = "--mw-";
export const EVENTS = {
  change: "motionworks:change",
  replay: "motionworks:replay",
  scrub: "motionworks:scrub",
} as const;

export function varNameFor(key: string, spec: MotionWorksParam): string {
  return (
    spec.var ??
    `${DEFAULT_VAR_PREFIX}${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
  );
}

export function readParam(
  el: Element,
  key: string,
  spec: MotionWorksParam,
): unknown | null {
  const decoded = decodeCssValue(
    spec.type,
    getComputedStyle(el).getPropertyValue(varNameFor(key, spec)),
  );
  return decoded?.value ?? null;
}

export function readParams(
  el: Element,
  params: Record<string, MotionWorksParam>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, spec]) => {
      const value = readParam(el, key, spec);
      return value === null ? [] : [[key, value]];
    }),
  );
}

/**
 * SSR- and mount-safe reader for a single MotionWorks CSS variable, for wiring
 * JS-driven motion (Framer Motion, react-spring, custom) to a MotionWorks-owned
 * value. Returns `fallback` when there is no element yet (null ref, first
 * render) or no browser (server) — so the animation keeps its original value and
 * hydration never mismatches — and only returns the variable's value once it is
 * both present and decodable.
 *
 * Unit is explicit: MotionWorks stores durations in milliseconds. Pass
 * `{ seconds: true }` for consumers that want seconds (Framer's `duration`),
 * which prevents a silent 1000x error. Non-time variables are returned as a
 * plain number.
 */
export function readMotionVar(
  el: Element | null,
  name: string,
  fallback: number,
  opts?: { seconds?: boolean },
): number {
  if (el === null || typeof window === "undefined") return fallback;
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (raw === "") return fallback;
  const decoded = decodeCssValue("duration", raw);
  if (decoded !== null && typeof decoded.value === "number")
    return opts?.seconds === true ? decoded.value / 1000 : decoded.value;
  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function onParamsChange(
  el: Element,
  cb: (params: Record<string, unknown>, event: CustomEvent) => void,
): () => void {
  const listener = (event: Event): void => {
    const custom = event as CustomEvent<{ param?: string; value?: unknown }>;
    if (custom.detail?.param !== undefined)
      cb({ [custom.detail.param]: custom.detail.value }, custom);
  };
  el.addEventListener(EVENTS.change, listener);
  return () => el.removeEventListener(EVENTS.change, listener);
}
