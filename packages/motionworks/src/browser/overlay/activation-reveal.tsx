import { useEffect, useRef, useState } from "react";

import { getBridge } from "../bridge.js";
import { humanizeEffectName } from "./display-name.js";
import { NodeHighlight } from "./highlight.js";
import { useSessionState } from "./hooks.js";

// A one-shot "here's what you can edit" cue when the toolkit opens: every
// on-screen registered surface flashes its NodeHighlight (outline + name chip,
// exactly the hover/selection highlight), staggered top-to-bottom in reading
// order, holds long enough to read, then fades out together. This restores the
// 0.4 activation reveal — a sequential pop + hold, not a single positional
// pulse — while keeping the density guards the sweep added.
//
// Density-aware (detection now surfaces far more than early versions did): only
// on-screen surfaces, capped, sorted once at open. NodeHighlight tracks each
// node's rect per frame, so badges stay glued to elements that move mid-reveal.
// Purely visual (pointer-events:none) — it never touches state or writeback.

const STAGGER_MS = 45; // gap between successive surfaces entering
const IN_MS = 240; // per-surface fade + scale in
const HOLD_MS = 1200; // time fully shown before the fade-out
const OUT_MS = 300; // fade-out (all surfaces together)
const MAX_SURFACES = 60;
const REVEAL_COLOR = "rgb(255, 255, 255)";

interface RevealSurface {
  key: string;
  node: HTMLElement;
  label: string | undefined;
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
      });
    }
  // Reading order ≈ top-to-bottom. A stable rect.top sort avoids the
  // never-returns-0 comparator the 0.4 version used.
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
  // Read the id→name map at open time without re-triggering the reveal on every
  // state change.
  const nameByIdRef = useRef(new Map<string, string>());
  nameByIdRef.current = new Map(
    state.effects.map((effect) => [effect.id, humanizeEffectName(effect.name)]),
  );
  const [surfaces, setSurfaces] = useState<RevealSurface[]>([]);
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (!active) {
      setSurfaces([]);
      setOut(false);
      return;
    }
    setOut(false);
    const timers: number[] = [];
    // Measure after the open frame so rects are settled.
    const raf = requestAnimationFrame(() => {
      const collected = collect(nameByIdRef.current);
      setSurfaces(collected);
      // Last surface finishes entering at (n-1)*STAGGER + IN; hold from there.
      const inDone =
        Math.max(0, collected.length - 1) * STAGGER_MS + IN_MS + HOLD_MS;
      timers.push(window.setTimeout(() => setOut(true), inDone));
      timers.push(
        window.setTimeout(() => {
          setSurfaces([]);
          setOut(false);
        }, inDone + OUT_MS),
      );
    });
    return () => {
      cancelAnimationFrame(raf);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [active]);

  if (surfaces.length === 0) return null;
  return (
    <>
      {surfaces.map((surface, index) => (
        <RevealSurfaceView
          key={surface.key}
          surface={surface}
          delayMs={index * STAGGER_MS}
          out={out}
        />
      ))}
    </>
  );
}

function RevealSurfaceView({
  surface,
  delayMs,
  out,
}: {
  surface: RevealSurface;
  delayMs: number;
  out: boolean;
}): React.JSX.Element {
  // First paint at opacity 0 / slightly scaled up; flip on the next frame so
  // the (delayed) entrance transition actually runs.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const visible = entered && !out;
  return (
    <NodeHighlight
      node={surface.node}
      color={REVEAL_COLOR}
      label={surface.label}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(1.04)",
        // Delays stagger the way in; the way out fades everything together.
        transition: out
          ? `opacity ${String(OUT_MS)}ms ease, transform ${String(OUT_MS)}ms ease`
          : `opacity ${String(IN_MS)}ms ease ${String(delayMs)}ms, transform ${String(IN_MS)}ms cubic-bezier(0.3, 0.9, 0.3, 1) ${String(delayMs)}ms`,
      }}
    />
  );
}
