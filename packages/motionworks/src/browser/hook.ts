import { useEffect, useMemo, useRef, type RefObject } from "react";

import type { MotionWorksRegistration } from "../shared/index.js";

import { getBridge } from "./bridge.js";
import { allocateEffectId, slugify } from "./ids.js";

const IS_DEV = process.env.NODE_ENV === "development";

function fingerprintRegistration(reg: MotionWorksRegistration): string {
  const parts: string[] = [reg.name];
  const keys = Object.keys(reg.params).sort();
  for (const key of keys) {
    const p = reg.params[key];
    parts.push(key, p?.type ?? "", p?.var ?? "");
  }
  return parts.join("|");
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
  const idRef = useRef<string | null>(null);
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
    const current = registrationRef.current;
    const bridge = getBridge();
    const node = (ref.current as unknown as HTMLElement | null) ?? null;
    if (node === null) return;
    const slug = slugify(current.name);
    const id = idRef.current?.startsWith(`${slug}#`)
      ? idRef.current
      : allocateEffectId(slug, node, bridge.getAllNodes());
    idRef.current = id;

    bridge.register(id, node, current);
    return () => {
      bridge.unregister(id, node);
    };
    // Re-register when the schema fingerprint changes: covers a rename, an
    // added/removed param, and (crucially for HMR) a baseline value change
    // from an agent writeback that Fast Refresh keeps as a state-preserving
    // update instead of a full remount.
  }, [ref, fingerprint]);
}
