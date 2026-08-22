import { decodeCssValue, defaultUnitFor, encodeCssValue } from '../../shared/css-values.js';
import type { MotionWorksParam } from '../../shared/types.js';
import { EVENTS, varNameFor } from '../css-bindings.js';

export interface CssBinding { var: string; unit: string; inlineBefore: string; bound: boolean; originalValue?: unknown; keyframeEffect?: KeyframeEffect }
const pendingKeyframeEffects = new WeakMap<HTMLElement, { effect: KeyframeEffect; animationName: string }>();
export function bindKeyframeEffect(node: HTMLElement, effect: KeyframeEffect, animationName: string): void { pendingKeyframeEffects.set(node, { effect, animationName }); }

export function readBaseline(node: HTMLElement, key: string, spec: MotionWorksParam): { value: unknown; binding: CssBinding } {
  const variable = varNameFor(key, spec);
  const inlineBefore = node.style.getPropertyValue(variable);
  const computed = getComputedStyle(node);
  const keyframe = pendingKeyframeEffects.get(node);
  let css = computed.getPropertyValue(variable);
  if (keyframe !== undefined && !variable.startsWith('--')) {
    const names = computed.getPropertyValue('animation-name').split(',').map((item) => item.trim());
    const index = Math.max(0, names.indexOf(keyframe.animationName));
    css = computed.getPropertyValue(variable).split(',')[index]?.trim() ?? css;
  }
  const decoded = decodeCssValue(spec.type, css);
  if (decoded === null) {
    console.warn(`[MotionWorks] Param "${key}" is unbound: could not decode ${variable}: ${css.trim() || '(empty)'}.`);
    return { value: 0, binding: { var: variable, unit: defaultUnitFor(spec.type, spec.unit), inlineBefore, bound: false, ...(keyframe !== undefined && { keyframeEffect: keyframe.effect }) } };
  }
  return { value: decoded.value, binding: { var: variable, unit: decoded.unit, inlineBefore, bound: true, originalValue: decoded.value, ...(keyframe !== undefined && { keyframeEffect: keyframe.effect }) } };
}

export function applyLive(node: HTMLElement, spec: MotionWorksParam, binding: CssBinding, value: unknown): void {
  if (!binding.bound) return;
  const css = encodeCssValue(spec.type, value, binding.unit);
  if (binding.var.startsWith('--')) node.style.setProperty(binding.var, css);
  else {
    const effect = binding.keyframeEffect;
    if (effect !== undefined) {
      const patch: OptionalEffectTiming = {};
      if (binding.var === 'animation-duration') patch.duration = value as number;
      else if (binding.var === 'animation-delay') patch.delay = value as number;
      else if (binding.var === 'animation-timing-function') patch.easing = css;
      effect.updateTiming(patch);
    } else node.style.setProperty(binding.var, css);
  }
  node.dispatchEvent(new CustomEvent(EVENTS.change, { bubbles: true, detail: { param: binding.var, value, css } }));
}

export function restoreLive(node: HTMLElement, binding: CssBinding): void {
  if (binding.keyframeEffect !== undefined && binding.originalValue !== undefined) {
    const patch: OptionalEffectTiming = {};
    if (binding.var === 'animation-duration') patch.duration = binding.originalValue as number;
    else if (binding.var === 'animation-delay') patch.delay = binding.originalValue as number;
    else if (binding.var === 'animation-timing-function') {
      const value = binding.originalValue as { x1: number; y1: number; x2: number; y2: number };
      patch.easing = `cubic-bezier(${String(value.x1)}, ${String(value.y1)}, ${String(value.x2)}, ${String(value.y2)})`;
    }
    binding.keyframeEffect.updateTiming(patch);
    return;
  }
  if (binding.inlineBefore === '') node.style.removeProperty(binding.var);
  else node.style.setProperty(binding.var, binding.inlineBefore);
}

export interface DeclaringRule { selectorText: string; sheetHref: string; sourceFile?: string }
export function findDeclaringRule(node: HTMLElement, varName: string): DeclaringRule | undefined {
  let found: DeclaringRule | undefined;
  const visit = (rules: CSSRuleList, sheet: CSSStyleSheet): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        try { const owner = (sheet.ownerNode as HTMLElement | null) ?? Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style,link[rel="stylesheet"]')).find((candidate) => candidate.sheet === sheet) ?? null; if (rule.style.getPropertyValue(varName) !== '' && (rule.selectorText === ':root' || node.closest(rule.selectorText) !== null)) found = { selectorText: rule.selectorText, sheetHref: sheet.href ?? '', ...(owner?.dataset.viteDevId !== undefined && { sourceFile: owner.dataset.viteDevId }) }; } catch { /* Invalid selectors are not candidates. */ }
      } else if ('cssRules' in rule) {
        try { visit((rule as CSSGroupingRule).cssRules, sheet); } catch { /* Inaccessible nested rules are skipped. */ }
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) { try { visit(sheet.cssRules, sheet); } catch { /* Cross-origin sheet. */ } }
  return found;
}

export function watchStylesheets(cb: () => void): () => void {
  const links = new Set<HTMLLinkElement>();
  const onLoad = (): void => cb();
  const attach = (): void => { for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) if (!links.has(link)) { links.add(link); link.addEventListener('load', onLoad); } };
  attach();
  const observer = new MutationObserver((records) => { if (records.some((record) => record.target === document.head || record.target === document.body || (record.target as Element).closest?.('head,body') !== null)) { attach(); cb(); } });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => { observer.disconnect(); for (const link of links) link.removeEventListener('load', onLoad); };
}
