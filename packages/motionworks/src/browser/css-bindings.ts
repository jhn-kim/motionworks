import { decodeCssValue } from '../shared/css-values.js';
import type { MotionWorksParam } from '../shared/types.js';

export const DEFAULT_VAR_PREFIX = '--mw-';
export const EVENTS = { change: 'motionworks:change', replay: 'motionworks:replay', scrub: 'motionworks:scrub' } as const;

export function varNameFor(key: string, spec: MotionWorksParam): string {
  return spec.var ?? `${DEFAULT_VAR_PREFIX}${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function readParam(el: Element, key: string, spec: MotionWorksParam): unknown | null {
  const decoded = decodeCssValue(spec.type, getComputedStyle(el).getPropertyValue(varNameFor(key, spec)));
  return decoded?.value ?? null;
}

export function readParams(el: Element, params: Record<string, MotionWorksParam>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, spec]) => { const value = readParam(el, key, spec); return value === null ? [] : [[key, value]]; }));
}

export function onParamsChange(el: Element, cb: (params: Record<string, unknown>, event: CustomEvent) => void): () => void {
  const listener = (event: Event): void => { const custom = event as CustomEvent<{ param?: string; value?: unknown }>; if (custom.detail?.param !== undefined) cb({ [custom.detail.param]: custom.detail.value }, custom); };
  el.addEventListener(EVENTS.change, listener);
  return () => el.removeEventListener(EVENTS.change, listener);
}
