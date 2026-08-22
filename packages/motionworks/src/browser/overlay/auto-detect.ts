import { parseEasing, type MotionWorksRegistration } from '../../shared/index.js';

import { getBridge } from '../bridge.js';
import { bindKeyframeEffect } from './css-apply.js';

// Auto-registration of CSS keyframe animations. Anything running via
// @keyframes is discovered through document.getAnimations() and registered
// as a first-class effect — named after its animationName, selectable like
// any registered element, with duration / delay / easing editable live
// through KeyframeEffect.updateTiming(). No sourceHints are available (the
// values live in CSS, not named constants), so commits carry only the
// animation name — the agent locates the @keyframes / animation declaration
// by name during writeback.
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
  let transforms = '';
  for (const frame of frames) {
    for (const [key, value] of Object.entries(frame)) {
      if (key === 'offset' || key === 'easing' || key === 'composite' || key === 'computedOffset') continue;
      props.add(key);
      if (key === 'transform') transforms += ` ${String(value)}`;
    }
  }
  if (/rotate/i.test(transforms)) return 'Spin';
  if (/scale/i.test(transforms)) return props.has('opacity') ? 'Pulse' : 'Scale';
  if (/translate/i.test(transforms)) return props.has('opacity') ? 'Fade drift' : 'Drift';
  if (props.has('opacity')) return 'Fade';
  if (props.has('backgroundColor') || props.has('color') || props.has('filter')) return 'Color shift';
  if (props.has('width') || props.has('height')) return 'Resize';
  return 'Animation';
}

// Display name for an auto-detected animation. The original @keyframes name
// is preserved in the effect id (css::<name>#<n>) for writeback — this only
// decides what the designer reads.
function displayNameFor(animationName: string, effect: KeyframeEffect): string {
  if (isReadableName(animationName)) {
    const spaced = animationName.replace(/-+/g, ' ').toLowerCase();
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
  node: HTMLElement;
}

export function startAutoDetect(intervalMs = 1500): () => void {
  const bridge = getBridge();
  const registered = new Map<string, AutoEffect>();

  const scan = (): void => {
    if (typeof document.getAnimations !== 'function') return;
    if (typeof CSSAnimation === 'undefined') return;
    const seen = new Set<string>();
    // Index per animationName so several elements running the same
    // @keyframes each get a stable, distinct id.
    const counters = new Map<string, number>();

    for (const animation of document.getAnimations()) {
      if (!(animation instanceof CSSAnimation)) continue;
      const keyframeEffect = animation.effect;
      if (!(keyframeEffect instanceof KeyframeEffect)) continue;
      const target = keyframeEffect.target;
      if (!(target instanceof HTMLElement)) continue;
      if (target.closest('[data-motionworks-overlay]') !== null) continue;

      const name = animation.animationName;
      const index = counters.get(name) ?? 0;
      counters.set(name, index + 1);
      const id = `css::${name}#${String(index)}`;
      seen.add(id);
      if (registered.has(id)) continue;

      const timing = keyframeEffect.getTiming();
      bindKeyframeEffect(target, keyframeEffect, name);
      const params: MotionWorksRegistration['params'] = {};
      if (typeof timing.duration === 'number') {
        params['duration'] = {
          type: 'duration',
          var: 'animation-duration',
          min: 0,
          max: Math.max(3000, timing.duration * 2),
          label: 'Duration',
          unit: 'ms',
        };
      }
      if (typeof timing.delay === 'number' && timing.delay > 0) {
        params['delay'] = {
          type: 'duration',
          var: 'animation-delay',
          min: 0,
          max: Math.max(2000, timing.delay * 2),
          label: 'Delay',
          unit: 'ms',
        };
      }
      const curve = parseEasing(String(timing.easing ?? ''));
      if (curve !== null) {
        params['easing'] = { type: 'easing-curve', var: 'animation-timing-function', label: 'Easing' };
      }
      if (Object.keys(params).length === 0) continue;

      const registration: MotionWorksRegistration = {
        name: displayNameFor(name, keyframeEffect),
        params,
      };
      bridge.register(id, target, registration);
      registered.set(id, { node: target });
    }

    // Unregister effects whose animation stopped or whose element left.
    for (const [id, entry] of Array.from(registered.entries())) {
      if (!seen.has(id)) {
        bridge.unregister(id, entry.node);
        registered.delete(id);
      }
    }
  };

  scan();
  const interval = window.setInterval(scan, intervalMs);
  return () => {
    window.clearInterval(interval);
    for (const [id, entry] of registered.entries()) {
      bridge.unregister(id, entry.node);
    }
    registered.clear();
  };
}
