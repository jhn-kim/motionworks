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
    // Include bounds/unit/label, not just key/type/var: an edit to any of them
    // changes the surface or slider range and must re-register (P2-5). The old
    // fingerprint omitted these despite the comment below claiming to cover
    // schema changes.
    parts.push(
      key,
      p?.type ?? "",
      p?.var ?? "",
      String(p?.min ?? ""),
      String(p?.max ?? ""),
      p?.unit ?? "",
      p?.label ?? "",
    );
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

  // What we last registered, so we can detect a changed/attached element and a
  // changed schema without re-registering on every render.
  const activeRef = useRef<{
    node: HTMLElement;
    id: string;
    fingerprint: string;
  } | null>(null);

  // Runs after every commit (cheap when nothing changed). This is what lets a
  // ref that was null at mount register once it attaches, and a ref reused for
  // a different element re-point to the new node — the old effect keyed on the
  // stable ref *object* and never retried either (P2-5). Production stays a
  // no-op via the IS_DEV guard.
  useEffect(() => {
    if (!IS_DEV) return;
    const bridge = getBridge();
    const node = (ref.current as unknown as HTMLElement | null) ?? null;
    const active = activeRef.current;
    // The element detached or the ref now points elsewhere: drop the old one.
    if (active !== null && (node === null || active.node !== node)) {
      bridge.unregister(active.id, active.node);
      activeRef.current = null;
    }
    if (node === null) return;
    if (
      activeRef.current !== null &&
      activeRef.current.node === node &&
      activeRef.current.fingerprint === fingerprint
    )
      return; // nothing changed
    const current = registrationRef.current;
    const slug = slugify(current.name);
    const id =
      idRef.current?.startsWith(`${slug}#`) === true
        ? idRef.current
        : allocateEffectId(slug, node, bridge.getAllNodes());
    // A rename allocates a new slug id; retire the stale registration on the
    // same node so it doesn't linger as a duplicate.
    const stale = activeRef.current;
    if (stale !== null && stale.id !== id)
      bridge.unregister(stale.id, stale.node);
    idRef.current = id;
    bridge.register(id, node, current);
    activeRef.current = { node, id, fingerprint };
  });

  // Unregister on unmount only, so the per-render effect above never churns the
  // registry by tearing down and rebuilding each commit.
  useEffect(
    () => () => {
      if (!IS_DEV) return;
      const active = activeRef.current;
      if (active !== null) getBridge().unregister(active.id, active.node);
      activeRef.current = null;
    },
    [],
  );
}
