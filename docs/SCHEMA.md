# MotionWorks — Parameter Schema

> **Maintenance rule:** The parameter type vocabulary is a core contract between coding agents and MotionWorks. Adding a new type requires: (1) a definition here, (2) a corresponding editing surface in `MANIPULATION_SURFACES.md`, (3) product owner confirmation. Do not add types without all three. Edit existing type definitions in place; do not append variants below the original.

---

## Purpose of the Schema

MotionWorks needs to know what each adjustable value means so it can choose the right editing surface and perceptual response curve. The schema describes that meaning; CSS holds the value.

Registration is deliberately schema-only:

- `type`, `label`, bounds, unit, and optional CSS property name describe a parameter.
- The baseline comes from the registered element's computed CSS.
- Live preview writes the same property inline and dispatches a CustomEvent.
- Source writeback targets the declaration in the real stylesheet.

There is no registration `value`, `update()`, or `sourceHints` contract. Effects consume CSS values through the helpers and events described in `RUNTIME_BRIDGE.md`.

---

## CSS Binding Contract

Every adjustable value must have one canonical declaration in a real CSS, SCSS, Less, or CSS Module source file. Put it on the registered element's matching rule and match the CSS unit to the schema:

```css
.hero-image {
  --mw-distortion: 0.8;
  --mw-radius: 120px;
  --mw-trail: 0.6;
}
```

The default property name is `--mw-` plus the kebab-cased parameter key:

```text
radius          → --mw-radius
influenceRadius → --mw-influence-radius
```

Use `var` to bind a different property:

```ts
radius: { type: 'spatial-radius', var: '--mw-influence', unit: 'px' }
```

Normal authored parameters should use the `--mw-*` namespace. Validation accepts any custom property beginning with `--` for live preview, but the daemon intentionally accepts Apply requests only for `--mw-*` variables. The only non-custom properties accepted are the auto-detection longhands `animation-duration`, `animation-delay`, `animation-timing-function`, `transition-duration`, `transition-delay`, and `transition-timing-function`.

The unit read from CSS is preserved on encode. A declaration written as `0.3s` remains seconds even though the runtime/editing value is normalized to `300` milliseconds. Relative numeric units (`rem`, `em`, viewport units, and `%`) cannot be converted without changing meaning; they leave the parameter unbound and emit a warning.

---

## Registration APIs

### React

```tsx
import { useMotionWorks } from 'motionworks/react';

function HeroImage() {
  const ref = useRef<HTMLDivElement>(null);

  useMotionWorks(ref, {
    name: 'Liquid cursor',
    params: {
      distortion: {
        type: 'spatial-strength',
        label: 'Distortion',
        min: 0,
        max: 2,
      },
      radius: {
        type: 'spatial-radius',
        label: 'Radius',
        unit: 'px',
        min: 20,
        max: 400,
      },
      trail: {
        type: 'temporal-decay',
        label: 'Trail',
        min: 0,
        max: 1,
      },
    },
    capabilities: { replay: true },
  });

  return <div ref={ref} className="hero-image" />;
}
```

The hook unregisters on unmount and re-registers when its fingerprint changes: name plus each parameter's key, type, and `var`. It is a no-op outside development.

Effect ids use `slug#n`: the humanized schema name is slugified and the instance number is allocated by DOM order at registration time. Existing live ids never renumber. Repeated component instances therefore have distinct ids, while a live drag is also applied to same-slug siblings whose source baseline equals the selected instance's baseline.

### HTML attribute

Framework-free pages can put the schema directly on the selectable element:

```html
<div
  class="hero-image"
  data-motionworks='{"name":"Liquid cursor","params":{"radius":{"type":"spatial-radius","label":"Radius","unit":"px"}}}'
></div>
```

### JSON schema block

A page can register one schema against every match for each selector:

```html
<script type="application/motionworks+json">
{
  ".hero-image": {
    "name": "Liquid cursor",
    "params": {
      "radius": { "type": "spatial-radius", "label": "Radius", "unit": "px" }
    }
  }
}
</script>
```

DOM registration scans initially and observes the page for added or disconnected schema-bearing nodes. Registered nodes must be visible, non-zero size, and hit-testable; `pointer-events: none` prevents selection.

---

## TypeScript Interfaces

Defined in `motionworks`:

```ts
interface MotionWorksRegistration {
  name: string;
  params: Record<string, MotionWorksParam>;
  capabilities?: MotionWorksCapabilities;
}

interface MotionWorksParam {
  type: ParameterType;
  label?: string;
  min?: number;
  max?: number;
  unit?: string;
  var?: string;
}

interface MotionWorksCapabilities {
  replay?: boolean;
  scrub?: boolean;
}

interface MotionWorksRuntimeParam extends MotionWorksParam {
  value: unknown;
  var: string;
  cssUnit: string;
  bound: boolean;
}

interface MotionWorksEffect {
  id: string;
  name: string;
  params: Record<string, MotionWorksRuntimeParam>;
  capabilities?: MotionWorksCapabilities;
}
```

The runtime form is internal overlay state derived from CSS. It is not the registration shape authors write.

---

## Capabilities

Capabilities opt into global overlay controls and stay outside the parameter map.

- **`replay: true`** — shows Replay and dispatches a bubbling `motionworks:replay` CustomEvent on the registered node. Its `detail` is a fresh timestamp. Replay must rerun only the animation, never the interaction's behavior such as navigation, submission, or cart mutation. Clickable effects without this capability receive the overlay's safe simulated press instead.
- **`scrub: true`** — shows the scrubber and dispatches `motionworks:scrub`; `detail` is the playhead time in milliseconds.

The event names are exported in `EVENTS`. See `RUNTIME_BRIDGE.md` for consumption patterns.

---

## Parameter Types and CSS Encoding

These are the valid `MotionWorksParam.type` values. The overlay surface for each is specified in `MANIPULATION_SURFACES.md`.

| Type | Concept and runtime value | CSS encoding |
|---|---|---|
| `spatial-radius` | Distance/reach as a number, normally pixels | `120px` |
| `spatial-strength` | Spatial intensity as a unitless number | `0.8` |
| `temporal-decay` | Fade/trail persistence, normally 0–1 | `0.6` |
| `temporal-response` | Follow/lerp response, normally 0–1 | `0.15` |
| `spring-response` | `{ stiffness, damping, mass? }` or a normalized scalar | `240 20 1` or `0.65` |
| `gradient` | `Array<{ stop: number; color: string }>` with 0–1 stops | `#ff006e 0%, rgb(0 229 255) 100%` |
| `path` | Bezier points in element-relative coordinates | `path("M 0 0 C 40 0 80 80 120 80")` |
| `stagger` | Milliseconds between sequential elements | `80ms` or `0.08s` |
| `duration` | Animation/transition length in milliseconds | `300ms` or `0.3s` |
| `easing-curve` | `{ x1, y1, x2, y2 }` | `cubic-bezier(0.2, 0.8, 0.2, 1)` or a supported CSS keyword |
| `scalar` | Generic unitless numeric fallback | `0.5` |

### Semantic guidance

- Use `spatial-radius` for reach, pull zones, blur spread, or another distance.
- Use `spatial-strength` for distortion, attraction, repulsion, or warp intensity.
- Use `temporal-decay` for how slowly a phenomenon dissipates; zero means immediate decay.
- Use `temporal-response` for follow lag/lerp behavior, not fixed-length playback.
- Use `spring-response` for physics-based motion. Do not expose easing and spring controls for the same movement.
- Use `gradient` for color progression along a trail, particle field, glow, or similar phenomenon.
- Use `path` for M/L/C trajectories only. Coordinates are relative to the element at rest.
- Use `stagger` for per-element offsets and `duration` for total playback time.
- Use `easing-curve` for duration-based acceleration. CSS keywords `linear`, `ease`, `ease-in`, `ease-out`, and `ease-in-out` decode to cubic-bezier values.
- Use `scalar` only when no semantic type fits, and always give it a human label.

There is deliberately no boolean type. Expose the continuous parameter whose zero disables the phenomenon. Adding or removing a feature is a conversational code change, not a manipulation parameter.

---

## Validation and Binding Rules

`validateRegistration` accepts degraded registrations rather than failing the whole effect:

1. `name` must be a non-empty string.
2. Unknown parameter types fall back to `scalar` and are reported as corrected types.
3. `var` must begin with `--` or equal `animation-duration`, `animation-delay`, or `animation-timing-function`. An invalid value warns and falls back to `--mw-<key>`.
4. Legacy registrations containing parameter `value` fields or an `update` function warn once that MotionWorks 0.5 reads from CSS custom properties. Those legacy fields are not the baseline contract.
5. When both `min` and `max` are supplied, `min` must be less than `max`; otherwise both are ignored and the per-type default range applies. A single bound is retained.

After validation, binding decodes the computed CSS value. Missing values, malformed encodings, and unsupported relative units produce a warning and `bound: false`; live preview writes for that binding become no-ops until a decodable CSS baseline is present.

---

## What Happens Without an Explicit Schema

Running CSS `@keyframes` animations are auto-detected. `document.getAnimations()` is rescanned every 1.5 seconds and an `animationstart` listener catches new animations immediately; each `CSSAnimation` becomes a selectable effect with any decodable duration, delay, and easing controls. Live preview uses `KeyframeEffect.updateTiming()` while commits name the corresponding animation longhand. Detection runs from provider mount, not only while the toolkit is open, so an entrance one-shot that finishes on load is still captured and — via retention while its element stays in the DOM — stays selectable.

An explicitly registered element owns the animation semantics of its subtree. CSS animations on its descendants are not separately auto-detected, which keeps repeated staggered children or implementation-level keyframes from producing duplicate surfaces and arbitrary timing sliders. Register a descendant explicitly when it is independently meaningful and should be selected on its own.

Readable keyframe names become display names; hashed names are described from their keyframes. Pseudo-element animations (`.x::after { animation }`) are attributed to their host element, read their baseline from the pseudo-element's computed style, and write back to the full `::after` rule.

**Scroll-driven animations** (`animation-timeline: scroll()`/`view()`) are detected but carry a non-document timeline, so their progress follows scroll position, not time. Play is rendered inert (a "trigger it manually" chip) because it can't be advanced from script, and the duration control is suppressed because duration doesn't drive scroll playback; decodable delay/easing stay editable.

**CSS transitions** are auto-detected while the toolkit is open — surfaced from `document.getAnimations()` (a running transition is a `CSSTransition`) and captured promptly on `transitionrun`. Duration, delay, and easing edit and persist through the `transition-*` longhands. They are marked `manualTrigger` (Play inert) because `:hover` can't be forced and class toggles are app-owned. Scope: single-value transitions (`transition-property` "all" or one property, single-valued timing); multi-property comma lists are skipped to avoid clobbering sibling properties.

Framer Motion, GSAP, react-spring, WebGL, canvas, and custom JavaScript effects run on their own main-thread engines and do **not** appear in `document.getAnimations()` (verified: even Motion's `animate()` and `<motion.div>` use a rAF engine, not WAAPI). They cannot be auto-detected by runtime enumeration. GSAP is enumerable through its own `gsap.globalTimeline`; the rest need the coding agent to add an explicit schema and make the effect read the CSS-backed values (see the adoption workflow).
