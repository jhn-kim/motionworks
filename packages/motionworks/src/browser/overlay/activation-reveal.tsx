import { useEffect, useState } from "react";

import { getBridge } from "../bridge.js";
import { HIGHLIGHT } from "./theme.js";

// A one-shot "here's what you can edit" cue when the toolkit opens: every
// registered surface flashes its highlight box in a top-to-bottom sweep, then
// fades out. Reuses the NodeHighlight box style; the only motion is a staggered
// opacity pulse whose delay is proportional to each box's vertical position, so
// it reads as a line sweeping down rather than a strobe of every box at once.
//
// Density-aware (detection now surfaces far more than early versions did):
// only on-screen surfaces, capped, snapshot rects once (no per-frame tracking),
// and fully self-cleaning — it's transient, pointer-events:none, and never
// touches state or writeback.

const SWEEP_MS = 340; // time for the sweep line to travel top → bottom
const PULSE_MS = 460; // each box's fade in → hold → out
const MAX_SURFACES = 80;

interface RevealBox {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  delay: number;
}

function snapshotBoxes(): RevealBox[] {
  if (typeof window === "undefined") return [];
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const seen = new Set<HTMLElement>();
  const boxes: RevealBox[] = [];
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
      boxes.push({
        key: `${id}:${String(boxes.length)}`,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        // Delay ∝ vertical position → a line sweeping down the page.
        delay: Math.max(0, (rect.top / vh) * SWEEP_MS),
      });
    }
  boxes.sort((a, b) => a.top - b.top);
  return boxes.slice(0, MAX_SURFACES);
}

export function ActivationReveal({
  active,
}: {
  active: boolean;
}): React.JSX.Element | null {
  const [boxes, setBoxes] = useState<RevealBox[]>([]);

  useEffect(() => {
    if (!active) {
      setBoxes([]);
      return;
    }
    // Measure after the open frame so rects are settled.
    const raf = requestAnimationFrame(() => setBoxes(snapshotBoxes()));
    const clear = window.setTimeout(
      () => setBoxes([]),
      SWEEP_MS + PULSE_MS + 100,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [active]);

  if (boxes.length === 0) return null;
  return (
    <>
      <style
        data-motionworks-overlay-style
      >{`@keyframes mw-activation-reveal{0%{opacity:0}22%{opacity:1}58%{opacity:1}100%{opacity:0}}`}</style>
      {boxes.map((box) => (
        <div
          key={box.key}
          style={{
            position: "fixed",
            left: box.left - HIGHLIGHT.offset,
            top: box.top - HIGHLIGHT.offset,
            width: box.width + HIGHLIGHT.offset * 2,
            height: box.height + HIGHLIGHT.offset * 2,
            border: "1.5px solid rgba(255, 255, 255, 0.92)",
            boxShadow: "0 0 0 1.5px rgba(0, 0, 0, 0.55)",
            borderRadius: 4,
            boxSizing: "border-box",
            pointerEvents: "none",
            opacity: 0,
            animation: `mw-activation-reveal ${String(PULSE_MS)}ms ease ${String(box.delay)}ms both`,
          }}
        />
      ))}
    </>
  );
}
