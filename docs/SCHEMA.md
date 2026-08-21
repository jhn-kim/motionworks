# MotionWorks — Parameter Schema

> **Maintenance rule:** The parameter type vocabulary is a core contract between coding agents and MotionWorks. Adding a new type requires: (1) a definition here, (2) a corresponding editing surface in `MANIPULATION_SURFACES.md`, (3) product owner confirmation. Do not add types without all three. Edit existing type definitions in place; do not append variants below the original.

---

## Purpose of the Schema

MotionWorks needs to know two things about each parameter in an effect:

1. **What kind of thing it is** — so it can present the right editing surface with the right perceptual response curve. A radius is edited differently from a spring, which is edited differently from a color gradient.
2. **How to update it live** — so manipulation previews instantly without a round-trip to source.

The schema is the contract the coding agent emits when it creates an effect. MotionWorks reads the schema, builds the editing UI, and calls `update()` when the designer makes changes.

The schema uses **semantic parameter types**, not UI widget types. The agent declares that a parameter is a `spatial-radius`. MotionWorks decides what interaction that maps to. This keeps the agent's job simple (categorize the concept) and MotionWorks's job flexible (evolve the interaction without changing the agent's output).

---

## Registration API

The agent registers an effect with the `useMotionWorks` hook:

```tsx
import { useMotionWorks } from '@motionworks/react';

function MyComponent() {
  const ref = useRef<HTMLDivElement>(null);

  useMotionWorks(ref, {
    name: 'LiquidCursor',          // Human-readable name shown in the overlay UI
    params: {
      distortion: {
        type: 'spatial-strength',
        value: DISTORTION_STRENGTH,
        label: 'Distortion',       // Short human label; without it the raw key leaks into the UI
        min: 0,
        max: 2,
      },
      radius: {
        type: 'spatial-radius',
        value: INFLUENCE_RADIUS,   // In pixels
        label: 'Radius',
        unit: 'px',
        min: 20,
        max: 400,
      },
      trail: {
        type: 'temporal-decay',
        value: TRAIL_PERSISTENCE,  // 0 = instant decay, 1 = no decay
        label: 'Trail',
      },
    },
    update: (newParams) => {
      // Called by MotionWorks on every manipulation event.
      // Must update the live effect immediately — no async, no queuing.
      liquidEffectInstance.update(newParams);
    },
    capabilities: { replay: true },  // Optional; see "Capabilities" below
    sourceHints: {
      // Optional but strongly recommended: where each value lives in source.
      distortion: { file: 'src/effects/liquid.ts', variable: 'DISTORTION_STRENGTH' },
      radius:     { file: 'src/effects/liquid.ts', variable: 'INFLUENCE_RADIUS' },
    },
  });

  return <div ref={ref}>{/* ... */}</div>;
}
```

Register the ref on an element the designer can hover and click: visible, non-zero size, never `pointer-events: none`. The registered element is the click target for selecting the effect in the overlay.

Hook behavior worth knowing:

- **Unregistration is automatic** on unmount.
- **The effect id** is derived from the calling component's name plus the schema `name` (`ProductCard::CardEntrance`) — stable across HMR as long as neither is renamed.
- **Re-registration is fingerprint-driven.** The hook fingerprints the schema (name + each param's type and baseline value) and re-registers when it changes. This is how an agent writeback lands even when React Fast Refresh preserves component state instead of remounting.
- **Multiple instances are supported.** A list rendering the same component registers one effect with many live instances; MotionWorks fans `update()` out to all of them and remembers which instance the designer clicked.
- **Production is a no-op.** The hook can be imported statically; outside development its effect body returns immediately.

---

## TypeScript Interfaces

Defined in `@motionworks/core` (`types.ts`):

```ts
// The registration shape passed to useMotionWorks
interface MotionWorksRegistration {
  name: string;
  params: Record<string, MotionWorksParam>;
  update?: (params: Record<string, unknown>) => void;  // optional so validation can flag its absence
  sourceHints?: Record<string, SourceHint>;
  capabilities?: MotionWorksCapabilities;
}

// A single parameter definition
interface MotionWorksParam {
  type: ParameterType;
  value: unknown;            // Current value — must match what the effect is currently using
  label?: string;            // Display name. Defaults to the key name.
  min?: number;              // For numeric types: lower bound
  max?: number;              // For numeric types: upper bound
  unit?: string;             // Display unit, e.g. 'px', 'ms'
}

// Source location hint for agent writeback
interface SourceHint {
  file: string;              // Path relative to project root
  variable?: string;         // Variable or constant name in that file (preferred)
  line?: number;             // Line number (fragile; prefer variable name)
}

// Opt-in flags for global overlay features
interface MotionWorksCapabilities {
  replay?: boolean;          // Effect re-runs its animation on the reserved __motionworksReplay key
  scrub?: boolean;           // Effect freezes at the reserved __motionworksScrub time offset
}

// Wire/storage form: serializable, carries id and readOnly flag, no update fn
interface MotionWorksEffect {
  id: string;
  name: string;
  params: Record<string, MotionWorksParam>;
  readOnly: boolean;
  sourceHints?: Record<string, SourceHint>;
  capabilities?: MotionWorksCapabilities;
}
```

---

## Capabilities

Capabilities are explicit opt-in flags, kept off the params map so they never participate in validation or diff tracking. There is no implicit detection — an effect that handles a reserved key without declaring the capability simply doesn't get the UI.

- **`replay: true`** — the toolkit shows a Replay button; pressing it sends the reserved `__motionworksReplay` key (a fresh timestamp) through `update()`, and the effect re-runs its animation with the current (possibly uncommitted) values. One-shot effects (entrances, reveals) and interaction-triggered effects (press springs, click bounces) should declare this. Replay must run only the animation, never the interaction's behavior (no cart adds, no navigation) — the overlay intercepts real clicks for selection, so Replay is how a designer watches these animations. Effects on clickable elements that *don't* declare replay get a simulated press instead (see `MANIPULATION_SURFACES.md` → "Replay").
- **`scrub: true`** — the scrubber timeline is shown for the effect; dragging it sends `__motionworksScrub` (milliseconds) through `update()` and the effect should freeze at that offset.

Reserved keys are documented in `RUNTIME_BRIDGE.md`. Effects must ignore reserved keys they don't handle.

---

## Parameter Types

These are the valid values for `MotionWorksParam.type`. How each is edited in the overlay is specified in `MANIPULATION_SURFACES.md`; the notes below give the concept and value contract.

### `spatial-radius`

**Concept:** A distance or area — how far an effect reaches.
**Examples:** Cursor influence radius, magnetic button pull zone, blur spread.
**Value type:** `number` (pixels). Default editing range when `min`/`max` are omitted: 0–400.

### `spatial-strength`

**Concept:** The intensity of a spatial effect — how much something distorts, attracts, or repels.
**Examples:** Liquid distortion amount, cursor repulsion force, warp intensity.
**Value type:** `number` (unitless; use `min`/`max` to constrain to your effect's range). Default range: 0–2.

### `temporal-decay`

**Concept:** How quickly something fades, trails off, or dissipates over time.
**Examples:** Cursor trail persistence, particle fade-out, echo persistence.
**Value type:** `number` (0 = instant decay, 1 = no decay). Default range: 0–1.

### `temporal-response`

**Concept:** How quickly something follows, catches up, or responds to input — a follow/lerp factor.
**Examples:** Cursor follow lag, lerp factor.
**Value type:** `number` (typically 0–1). Not for fixed-length fades — if the animation runs for a set time, use `duration`.

### `spring-response`

**Concept:** The physical behavior of a spring: stiffness, oscillation, settling.
**Examples:** Button snap-back, modal entrance, bounce-in animation.
**Value type:** `{ stiffness: number; damping: number; mass?: number }` — or a single `number` if the effect normalizes spring behavior into a scalar. Object springs are edited as three axes on a logarithmic dial (ranges: stiffness 40–800, damping 2–60, mass 0.4–4).
**Note:** This type abstracts over the underlying library. Whether the effect uses Framer Motion, react-spring, or custom physics, `update()` translates the semantic values into whatever the library expects.

### `gradient`

**Concept:** A sequence of colors along a phenomenon.
**Examples:** Chromatic trail colors, particle color ramp, glow color stops.
**Value type:** `Array<{ stop: number; color: string }>` — stops as 0–1 fractions, colors as CSS color strings.

### `path`

**Concept:** A motion trajectory — the route an element travels along.
**Examples:** Entrance path, patrol route, curved motion.
**Value type:** Array of bezier points: `Array<{ x: number; y: number; cp1?: Point; cp2?: Point }>` in element-relative coordinates. Edited on-canvas, directly over the element.

### `stagger`

**Concept:** The timing offset between elements animating in sequence.
**Examples:** List items entering one-by-one, card grid reveal.
**Value type:** `number` (milliseconds per element). Default range: 0–600.

### `duration`

**Concept:** How long a transition or animation runs.
**Examples:** CSS transition duration, keyframe animation length, scrim fade time.
**Value type:** `number` (milliseconds). Default range: 0–2000. Edited on a quadratic dial so the 100–400ms band where motion actually happens gets most of the resolution.

### `easing-curve`

**Concept:** The acceleration profile of a duration-based animation — a cubic bezier.
**Examples:** CSS `transition-timing-function`, keyframe easing, tween easing.
**Value type:** `{ x1: number; y1: number; x2: number; y2: number }` — matching CSS `cubic-bezier(x1, y1, x2, y2)`. `x` values are clamped to 0–1; `y` values may exceed the range for overshoot ("back") and anticipation curves.
**Note:** Use `easing-curve` + `duration` for duration-based motion and `spring-response` for physics-based motion. They are complementary models — do not expose both for the same movement.

### `scalar`

**Concept:** A generic numeric value with no specific spatial or temporal meaning.
**Examples:** Opacity, noise frequency, any value that doesn't fit a more specific type.
**Value type:** `number`. Default range: 0–1.
**Note:** This is the fallback type; a more specific type always produces a better experience. Because scalar carries no semantics, its `label` is the only thing that tells the designer what the value does — always provide one.

---

> **There is deliberately no boolean/on-off type.** In motion, "off" is the zero of some continuum — no trail is `temporal-decay: 0`, no glow is strength 0 — so expose the continuous parameter whose zero disables the feature instead of gating it behind a flag. Adding or removing a feature entirely is a describe-to-create decision handled in conversation with the agent, not a parameter. Registrations that use a `boolean` type are treated as unknown (validation rule 2) and their non-numeric values are skipped (rule 3).

---

## Validation Rules

`@motionworks/core` validates each registration on receipt (`validateRegistration`). Invalid registrations are accepted in a degraded state rather than rejected:

1. `name` must be a non-empty string.
2. Each param's `type` must be one of the types above. Unknown types → the param falls back to `scalar` (reported in the validation result's `correctedTypes`).
3. `value` must match the (resolved) type — numeric types need numbers, `spring-response` needs a number or `{ stiffness, damping }`, `gradient`/`path` need well-shaped arrays, `easing-curve` needs four numbers. Mismatch → the param is skipped and a console warning names the offending key.
4. `update` must be a function. If missing or not a function, the effect registers **read-only**: it appears in the overlay but changes do not preview live.
5. `min` and `max`, when **both** provided, must satisfy `min < max`. Violation → both bounds are ignored and per-type defaults apply. (A single bound on its own is kept.)

---

## What Happens Without a Schema

If the agent-generated code doesn't call `useMotionWorks`, there are two outcomes:

**CSS `@keyframes` animations are auto-detected.** While the overlay is open, running CSS animations are discovered via `document.getAnimations()` (rescanned every 1.5s) and registered as first-class effects: selectable, named (a readable `@keyframes` name is humanized; hashed names from CSS Modules/styled-jsx get a description derived from what the keyframes do — "Spin", "Pulse", "Fade drift"), with `duration`, `delay`, and `easing` editable live through `KeyframeEffect.updateTiming()`. Auto-detected effects have ids of the form `css::<animationName>#<n>` and **no source hints** — commits carry only the animation name, and the agent locates the `@keyframes`/`animation` declaration by name during writeback. CSS *transitions* are deliberately not auto-detected (they exist only while running and would flicker in and out of the effect list) — agents should register transition-based effects explicitly.

**Everything else is invisible.** Framer Motion, GSAP, react-spring, and custom JS effects have no heuristic detection. The coding agent is responsible for emitting a registration call. See `AGENT_INTEGRATION.md` for the instruction-delivery stack that makes this reliable.
