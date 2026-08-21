/**
 * The schema emission guide, kept verbatim between the sentinel markers
 * defined in docs/AGENT_INTEGRATION.md. This is the single source of truth for:
 *   - `motionworks_get_instructions` (returned as tool text)
 *   - the `npx motionworks init` stanza appended to CLAUDE.md
 * Keep this file in sync with the "[MotionWorks schema emission guide]" section
 * in AGENT_INTEGRATION.md.
 */
export const SCHEMA_EMISSION_GUIDE = `**[MotionWorks schema emission guide]**

You are working in a project that uses MotionWorks for motion design.

**Mounting the overlay (one-time project setup).** The overlay only appears if \`@motionworks/react\` is mounted, in **its own React root from a client component**. Never render \`<MotionWorksProvider>\` inside a Server Component (a Next.js App Router \`layout.tsx\`/\`page.tsx\`) — it uses client-only hooks and crashes the server render. Mount it dev-only so it never ships to production, and render \`<MotionWorksBoot />\` once from your layout:

\`\`\`tsx
'use client';
import { useEffect } from 'react';

export function MotionWorksBoot(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & { __motionworksRoot?: unknown };
    if (w.__motionworksRoot) return; // one overlay root; survive StrictMode + HMR
    let disposed = false;
    void Promise.all([import('@motionworks/react'), import('react-dom/client')]).then(
      ([{ MotionWorksProvider }, { createRoot }]) => {
        if (disposed || w.__motionworksRoot) return;
        const el = document.createElement('div');
        el.id = 'motionworks-root';
        document.body.appendChild(el);
        const root = createRoot(el);
        root.render(<MotionWorksProvider />);
        w.__motionworksRoot = root;
      },
    );
    return () => { disposed = true; };
  }, []);
  return null;
}
\`\`\`

In a non-Next app (Vite, CRA), run the same dev-only mount directly in your client entry.

When you implement a motion effect on a DOM element, you must also emit a MotionWorks registration. This is not optional — without it, the designer cannot visually refine the effect.

A registration has three required parts:

**1. The schema** — a description of each adjustable parameter, tagged with a semantic type.

**2. The update function** — a synchronous function that applies new parameter values to the live effect immediately. This must work without a page reload.

**3. The source hints** — optional but strongly recommended: where each parameter value is defined in source, so MotionWorks can tell you exactly what to change when the designer commits refinements.

The valid parameter types are:
- \`spatial-radius\` — a distance (pixels). Example: influence radius, magnetic pull zone.
- \`spatial-strength\` — an intensity (unitless). Example: distortion amount, repulsion force.
- \`temporal-decay\` — how quickly something fades (0 = instant, 1 = permanent). Example: trail length, echo persistence.
- \`temporal-response\` — how quickly something follows input (a unitless follow/lerp factor). Example: lerp factor, lag time. Not for fixed-length fades — if the animation runs for a set time, use \`duration\`.
- \`spring-response\` — spring physics. Value: \`{ stiffness, damping, mass? }\`.
- \`gradient\` — a color sequence. Value: \`[{ stop: 0–1, color: string }]\`.
- \`path\` — a motion trajectory. Value: array of bezier points.
- \`stagger\` — delay between sequential elements (ms).
- \`duration\` — how long a transition/animation runs (ms). Example: CSS transition duration, scrim fade time.
- \`easing-curve\` — a cubic-bezier easing. Value: \`{ x1, y1, x2, y2 }\` (CSS cubic-bezier order).
- \`scalar\` — generic number (fallback only; prefer a more specific type).

There is no boolean/on-off type. If a feature can be disabled, expose the continuous parameter whose zero disables it (trail persistence 0 = no trail, glow strength 0 = no glow). Adding or removing a feature entirely is handled in conversation, not as a parameter.

Register the ref on an element the designer can hover and click: visible, non-zero size, and never \`pointer-events: none\`. The registered element is the click target for selecting the effect in the overlay — a node that can't be hit-tested can't be selected.

Give every parameter a short human \`label\` (one or two words) and a \`unit\` when the value is in px or ms. The overlay shows the label in tooltips and cursor chips; without one, the raw key (\`trailPersistence\`) leaks into the UI. Name parameters after what they are, not how they feel: a follow/lerp factor is labeled "Response", not "Speed" — "speed" sends designers looking for a timing control that doesn't exist.

One-shot effects (entrances, reveals) should also declare \`capabilities: { replay: true }\` and re-run their animation when \`update()\` receives the reserved \`__motionworksReplay\` key — this powers the designer's Replay button.

Interaction-triggered effects (press springs, click bounces, toggle transitions) must do the same: declare \`capabilities: { replay: true }\` and re-run the animation when \`update()\` receives \`__motionworksReplay\`. Replay must run only the animation — never the behavior the interaction performs (no cart adds, no navigation, no form submits, no state changes). If the animation code lives inside the interaction handler next to that behavior, factor it out so the animation can fire on its own. This matters because the MotionWorks overlay intercepts real clicks for selection — the Replay button is the only way a designer can watch an interaction animation.

**Example registration for a liquid cursor effect:**

\`\`\`tsx
import { useMotionWorks } from '@motionworks/react';

function HeroImage() {
  const ref = useRef<HTMLDivElement>(null);
  const effectRef = useRef<LiquidEffect | null>(null);

  useEffect(() => {
    effectRef.current = new LiquidEffect(ref.current!, {
      distortion: DISTORTION_STRENGTH,
      radius: INFLUENCE_RADIUS,
    });
    return () => effectRef.current?.destroy();
  }, []);

  useMotionWorks(ref, {
    name: 'LiquidCursor',
    params: {
      distortion: { type: 'spatial-strength', value: DISTORTION_STRENGTH, min: 0, max: 2,   label: 'Distortion' },
      radius:     { type: 'spatial-radius',   value: INFLUENCE_RADIUS,    min: 20, max: 400, label: 'Radius', unit: 'px' },
      trail:      { type: 'temporal-decay',   value: TRAIL_PERSISTENCE,   min: 0, max: 1,   label: 'Trail' },
    },
    update: (newParams) => {
      effectRef.current?.update(newParams);
    },
    sourceHints: {
      distortion: { file: 'src/effects/liquid.ts', variable: 'DISTORTION_STRENGTH' },
      radius:     { file: 'src/effects/liquid.ts', variable: 'INFLUENCE_RADIUS' },
      trail:      { file: 'src/effects/liquid.ts', variable: 'TRAIL_PERSISTENCE' },
    },
  });

  return <div ref={ref} />;
}
\`\`\`

Always extract parameter values into named constants (like \`DISTORTION_STRENGTH\`) so they are easy to locate for source writeback. Inline literals are harder for source-change tooling to find reliably.

**[End of schema emission guide]**`;

/** Tool description suffix appended to every MCP tool description. */
export const TOOL_NUDGE =
  'Before implementing a motion effect, call `motionworks_get_instructions` to get the current type vocabulary.';
