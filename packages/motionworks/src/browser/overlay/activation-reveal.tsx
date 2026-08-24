import { useEffect, useRef, useState } from "react";

import { getBridge } from "../bridge.js";
import { humanizeEffectName } from "./display-name.js";
import { NodeHighlight } from "./highlight.js";
import { useSessionState } from "./hooks.js";

// A one-shot "here's what you can edit" cue when the toolkit opens: every
// registered surface flashes its NodeHighlight (outline + name chip, exactly the
// hover/selection highlight) in a top-to-bottom sweep, then fades out. The only
// added motion is a per-surface opacity pulse whose delay is proportional to the
// surface's vertical position, so it reads as a line sweeping down the page
// rather than a strobe of every box at once.
//
// Density-aware (detection now surfaces far more than early versions did): only
// on-screen surfaces, capped, delay measured once at open, self-cleaning, and
// purely visual (pointer-events:none) — it never touches state or writeback.

const SWEEP_MS = 340; // time for the sweep line to travel top → bottom
const PULSE_MS = 620; // each surface's fade in → hold → out
const MAX_SURFACES = 60;
const REVEAL_COLOR = "rgb(255, 255, 255)";

interface RevealSurface {
  key: string;
  node: HTMLElement;
  label: string | undefined;
  delay: number;
}

function collect(nameById: Map<string, string>): RevealSurface[] {
  if (typeof window === "undefined") return [];
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const seen = new Set<HTMLElement>();
  const surfaces: RevealSurface[] = [];
  for (const [id, nodes] of getBridge().getAllNodes())
    for (const node of nodes) {
      if (seen.has(node) || !node.isConnected) continue;
      seen.add(node);
      const rect = node.getBoundingClientRect();
      // On-screen and non-zero only — off-screen boxes are wasted work.
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom < 0 ||
        rect.top > vh ||
        rect.right < 0 ||
        rect.left > vw
      )
        continue;
      surfaces.push({
        key: `${id}:${String(surfaces.length)}`,
        node,
        label: nameById.get(id),
        // Delay ∝ vertical position → a line sweeping down the page.
        delay: Math.max(0, (rect.top / vh) * SWEEP_MS),
      });
    }
  surfaces.sort(
    (a, b) =>
      a.node.getBoundingClientRect().top - b.node.getBoundingClientRect().top,
  );
  return surfaces.slice(0, MAX_SURFACES);
}

export function ActivationReveal({
  active,
}: {
  active: boolean;
}): React.JSX.Element | null {
  const state = useSessionState();
  // Read the id→name map at open time without re-triggering the sweep on every
  // state change.
  const nameByIdRef = useRef(new Map<string, string>());
  nameByIdRef.current = new Map(
    state.effects.map((effect) => [effect.id, humanizeEffectName(effect.name)]),
  );
  const [surfaces, setSurfaces] = useState<RevealSurface[]>([]);

  useEffect(() => {
    if (!active) {
      setSurfaces([]);
      return;
    }
    // Measure after the open frame so rects are settled.
    const raf = requestAnimationFrame(() =>
      setSurfaces(collect(nameByIdRef.current)),
    );
    const clear = window.setTimeout(
      () => setSurfaces([]),
      SWEEP_MS + PULSE_MS + 100,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [active]);

  if (surfaces.length === 0) return null;
  return (
    <>
      <style
        data-motionworks-overlay-style
      >{`@keyframes mw-activation-reveal{0%{opacity:0}18%{opacity:1}55%{opacity:1}100%{opacity:0}}`}</style>
      {surfaces.map((surface) => (
        // A zero-box wrapper carries the staggered opacity pulse; opacity on the
        // ancestor applies to the fixed-position NodeHighlight it wraps.
        <div
          key={surface.key}
          style={{
            opacity: 0,
            animation: `mw-activation-reveal ${String(PULSE_MS)}ms ease ${String(surface.delay)}ms both`,
          }}
        >
          <NodeHighlight
            node={surface.node}
            color={REVEAL_COLOR}
            label={surface.label}
          />
        </div>
      ))}
    </>
  );
}
