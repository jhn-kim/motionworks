import { useSyncExternalStore } from "react";

import type { MotionWorksEffect, ParameterType } from "../../shared/index.js";

import { getBridge } from "../bridge.js";
import { useOverlaySession } from "./context.js";
import { SurfaceForParam } from "./surfaces/router.js";

interface Props {
  active: boolean;
  selectedEffect: MotionWorksEffect | null;
  // When set, only params whose effective type is listed get a surface —
  // the toolkit mounts this layer per open editor (e.g. just 'path')
  // rather than resurrecting every on-element surface at once.
  only?: ParameterType[];
}

// SVG layer at z-9998, rendered above the canvas. Holds the surface
// primitives (radius circles, handles). The <svg> itself has
// pointer-events: none — individual surface elements opt in.
export function SvgLayer({
  active,
  selectedEffect,
  only,
}: Props): React.JSX.Element {
  const session = useOverlaySession();
  const node = useTrackedNode(selectedEffect?.id ?? null);
  // Subscribing to the diff store instead of the state manager here is
  // deliberate: live drags flow into applyParamChange which only surfaces
  // via the diff store's `to` — the effect object's params[k].value stays
  // pinned to the baseline until the next re-registration. Version counter
  // gives us a primitive that changes on every diff mutation so React
  // actually re-renders (returning a constant would suppress the update).
  useSyncExternalStore(
    (l) => session.diffs.subscribe(l),
    () => session.diffs.getVersion(),
    () => 0,
  );
  // Also subscribe to type overrides so switching a param's type in the
  // context menu re-renders the surfaces immediately.
  useSyncExternalStore(
    (l) => session.typeOverrides.subscribe(l),
    () => session.typeOverrides.getVersion(),
    () => 0,
  );

  const shouldRender = active && selectedEffect !== null && node !== null;

  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9998,
        overflow: "visible",
      }}
    >
      {shouldRender &&
        Object.entries(selectedEffect.params).map(([paramKey, param]) => {
          const diff = session.diffs.getDiff(selectedEffect.id)[paramKey];
          const liveValue = diff !== undefined ? diff.to : param.value;
          const effectiveType =
            session.resolvedType(selectedEffect.id, paramKey) ?? param.type;
          if (only !== undefined && !only.includes(effectiveType)) return null;
          return (
            <SurfaceForParam
              key={paramKey}
              effect={selectedEffect}
              node={node}
              paramKey={paramKey}
              liveValue={liveValue}
              effectiveType={effectiveType}
            />
          );
        })}
    </svg>
  );
}

function useTrackedNode(effectId: string | null): HTMLElement | null {
  return useSyncExternalStore(
    (l) => getBridge().subscribeToNodes(l),
    () => (effectId === null ? null : (getBridge().getNode(effectId) ?? null)),
    () => null,
  );
}
