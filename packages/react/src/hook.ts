import { useEffect, useMemo, useRef, type RefObject } from 'react';

import type { MotionWorksRegistration } from '@motionworks/core';

import { getBridge } from './bridge.js';
import { getCallerComponentName, makeEffectId } from './ids.js';

const IS_DEV = process.env.NODE_ENV === 'development';

// Cheap identity fingerprint over the schema's baseline values so HMR that
// only changes a named constant (a common agent writeback) triggers
// re-registration. Nested values (spring/gradient/path) are covered too.
// Purely for dep-array equality; readers of the schema keep going through
// registrationRef.current, so precise JSON key ordering doesn't matter.
function fingerprintRegistration(reg: MotionWorksRegistration): string {
  const parts: string[] = [reg.name];
  const keys = Object.keys(reg.params).sort();
  for (const key of keys) {
    const p = reg.params[key];
    parts.push(key, p?.type ?? '', JSON.stringify(p?.value));
  }
  return parts.join('|');
}

// This hook is imported statically by application components, so its module
// stays small and does not pull in any overlay UI. In production the effect
// body returns immediately, giving a near-zero-cost no-op.
//
// The name must be discovered during render (React 19's owner is only set
// while a component is rendering), so we capture it into a ref for the
// mount effect to consume.
export function useMotionWorks<T extends Element>(
  ref: RefObject<T | null>,
  registration: MotionWorksRegistration,
): void {
  const componentNameRef = useRef<string | null>(null);
  if (IS_DEV && componentNameRef.current === null) {
    componentNameRef.current = getCallerComponentName();
  }

  // Kept up to date on every render so the wrapped update fn below always
  // dispatches to the latest closure — even when we choose not to
  // re-register on every render (which would churn the WS).
  const registrationRef = useRef(registration);
  registrationRef.current = registration;

  const fingerprint = useMemo(
    () => fingerprintRegistration(registration),
    [registration],
  );

  useEffect(() => {
    if (!IS_DEV) return;
    const componentName = componentNameRef.current ?? 'Anonymous';
    const current = registrationRef.current;
    const id = makeEffectId(componentName, current.name);
    const bridge = getBridge();
    const node = (ref.current as unknown as HTMLElement | null) ?? null;

    // Only wrap update when the user actually provided one — otherwise the
    // core validator's read-only branch (rule 4) never fires.
    const stable: MotionWorksRegistration =
      typeof current.update === 'function'
        ? {
            ...current,
            update: (newParams) => {
              registrationRef.current.update?.(newParams);
            },
          }
        : { ...current };
    bridge.register(id, node, stable);
    return () => {
      bridge.unregister(id, node);
    };
    // Re-register when the schema fingerprint changes: covers a rename, an
    // added/removed param, and (crucially for HMR) a baseline value change
    // from an agent writeback that Fast Refresh keeps as a state-preserving
    // update instead of a full remount.
  }, [ref, fingerprint]);
}
