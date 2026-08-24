# MotionWorks — Editing Surfaces

> **Maintenance rule:** Every parameter type in `SCHEMA.md` must have its editing surface specified here, and a new parameter type must land with its surface definition in the same PR. Edit definitions in place when interaction behavior changes — do not add variants below the original definition. Changes require product owner confirmation.

---

## The Editing Model

Parameter editing lives in the **toolkit chip** — the frosted-glass bar that morphs open from the launcher. The bar is a fixed scaffold:

```
[logo] [verbs: replay · compare · discard · apply] [layers] [Space] [Feel] [Time] [Style]
```

- **Four parameter families** — Space (radius, strength, path), Feel (spring, easing, response, decay), Time (durations & stagger), Style (gradient, scalar) — are always present in the same order. A family with no matching params on the current selection renders disabled, never hidden, so the designer builds spatial memory while the contents stay contextual.
- Clicking a family expands its **drawer**: one row per parameter, each an icon + slider (or an editor row for gradient / easing / path). Rows lead with the fixed tool name ("Duration", "Stiffness"); the agent's `label` steps in when several params share a type — and always for `scalar`, where the label is the only thing that says what the value does.
- **Verbs** (apply, discard, compare, replay) appear once a selection exists; apply/discard/compare stay as disabled ghosts until an actual change exists, so the bar's width is frozen for the whole editing session.
- The **layers slot** shows the selection-scoped Layers list, or the page-wide Animated surfaces navigator when nothing is selected (see `OVERLAY.md`).

### Design principles

**Perceptual, not raw.** Every scalar tool runs on a normalized **0–10 dial**. The mapping to real units is per-type so equal input produces equal *perceived* change: linear for spatial distances and 0–1 fractions, logarithmic for spring physics (the low end is where feel character lives), quadratic for durations and staggers (resolution concentrated in the 100–400ms band where motion actually happens). Real values remain the source of truth everywhere — CSS, journal entries, and agents never see 0–10.

**Feedback is immediate.** Every input writes the bound CSS property inline and dispatches `motionworks:change` synchronously. There is no preview button and no per-frame network traffic; effects consume the property directly or refresh through `readParams`/`onParamsChange`.

**Precision is available but secondary.** Right-clicking a row opens a context menu with exact numeric entry (and the parameter-type override, see `OVERLAY.md`).

**The overlay is grayscale.** All colors and interaction constants live in `overlay/theme.ts`; surfaces own no pixel values of their own.

### Slider ranges

Sliders use the schema's `min`/`max` when valid; otherwise per-type defaults apply (`sliderBoundsFor`): radius 0–400, strength 0–2, decay 0–1, response 0–1, stagger 0–600ms, duration 0–2000ms, scalar 0–1. Spring axes use the fixed physics ranges below.

---

## The Cursor Tool

Any slider row can be **armed** as a cursor tool by clicking its label. The armed parameter attaches to the cursor as a frosted counter pill; hovering an element that carries the parameter and **scrolling** adjusts it on the 0–10 dial — fast scrolling steps whole numbers, slow scrolling steps tenths (Shift forces tenths). The wheel is only captured over valid targets; everywhere else the page scrolls normally. Clicking the row again disarms.

This is the closest interaction to "the element is the control" for scalar parameters: the designer's eyes stay on the effect, not the toolbar, while adjusting.

---

## Per-Type Surfaces

### Numeric slider types

`spatial-radius`, `spatial-strength`, `temporal-decay`, `temporal-response`, `stagger`, `duration`, `scalar` — a slider row in the owning family's drawer, armable as a cursor tool, on the per-type curve described above. Each row carries a short hover hint ("How far the effect reaches", "How slowly the trail fades") so the designer never needs the type vocabulary. A repeated sequence is registered on its shared container and normally exposes one `stagger` control for the relationship across the group; implementation-level child timings stay hidden unless a child is explicitly registered as an independent effect.

### `spring-response`

Spring objects (`{ stiffness, damping, mass? }`) expand into **three axis rows** — Stiffness, Damping, Mass — each a slider/cursor tool on a logarithmic dial. Ranges: stiffness 40–800, damping 2–60, mass 0.4–4 (`SPRING_SURFACE` in the theme). Hints describe the perceptual outcome: "Snappier, more energetic" / "Calmer settle, less wobble" / "Weight and momentum". A numeric spring value (normalized scalar) renders as a single slider instead. Pair spring tuning with the Replay verb to feel each adjustment.

### `easing-curve`

An interactive cubic-bezier editor opened from its row in the Feel drawer: the curve drawn with value-0/value-1 gridlines, two draggable control handles connected to the endpoints by stems, the current `(x1, y1, x2, y2)` readout, and a preset row (linear, ease, in, out, in-out, back). `x` is clamped to 0–1; `y` may exceed the range for overshoot/anticipation. Every change encodes and applies the bound CSS value immediately.

### `gradient`

A gradient editor opened from its row in the Style drawer: the stop sequence rendered as a horizontal bar, stops draggable along it to change their 0–1 fraction, a color input per stop, add/remove stops (minimum 2 remain). Every change encodes the full stop array into the bound CSS custom property.

### `path`

The one surface that edits **on the canvas, over the actual element**. Opening the path editor from the Space drawer mounts the overlay's canvas + SVG layers scoped to path params: the bezier curve is drawn over the product, with SVG anchors and control handles.

- **Drag an anchor** — reshape the path. **Drag a bezier handle** — adjust the curve at the adjacent anchor.
- **Click the path line** — add an anchor at that position. **Double-click an anchor** — remove it (minimum 2 anchors).
- Coordinates are element-relative pixels (0,0 = the element's top-left at rest); the surface converts to and from screen space automatically.
- The drawer panel keeps the numeric escape hatch alongside the canvas editor.

The canvas layer runs its rAF clear-and-redraw loop only while a scoped editor has it mounted; surfaces contribute draw callbacks through a shared registry.

---

## Global Verbs (Not Parameter Types)

### Replay

How a designer watches an animation that doesn't run continuously — entrances that fired on page load, and interaction animations whose real trigger (click) is intercepted by selection.

- **Capability replay:** effects declaring `capabilities: { replay: true }` re-run their animation when the registered node receives a bubbling `motionworks:replay` CustomEvent (a fresh timestamp in `detail` per press), using the current uncommitted CSS values.
- **Simulated press:** effects on clickable elements that *don't* declare the capability get a synthetic `pointerdown`/`mousedown`, held ~140ms, then `pointerup`/`mouseup` — enough to fire press springs. Deliberately no `click` is dispatched: click is the element's real activation (add to cart, navigate), and replay must show the animation without running the behavior. Effects whose animation lives in the click handler itself must declare the capability and re-run the animation from the replay event instead.
- **Capability manualTrigger:** effects declaring `capabilities: { manualTrigger: true }` cannot be re-run from script — scroll-driven animations (progress is bound to scroll position) and hover/app-state CSS transitions (`:hover` can't be forced, class toggles are app-owned). Play is rendered inert: dimmed and unclickable but still hoverable, so its chip reads "trigger it manually." Auto-detection sets this for scroll-driven animations and transitions.

### Compare

A toggle (not a pointer hold — hover- and press-triggered animations need the mouse free while comparing) that temporarily applies the pre-manipulation baselines through the same live CSS path, so the designer can A/B their uncommitted changes against the original. Toggling back restores the manipulated values. Diffs are untouched either way.

### Apply / Discard

Apply packages the uncommitted diff into a journal entry and posts it to the daemon (see `SOURCE_SYNC.md`). The existing handoff slot reflects the entry state: `pending` shows Copy prompt, `agent-working` shows “Agent is applying…” with no button, and `applied` pulses “Applied” until stylesheet reconciliation auto-acknowledges it (with a ten-second local fallback). Discard restores every touched property's prior inline state so the stylesheet baseline is visible again, then clears the diff.

### Scrubber

Shown only for effects that declare `capabilities: { scrub: true }`. A timeline bar; dragging the playhead dispatches `motionworks:scrub` with the millisecond offset in `detail`, and the effect freezes at that position. Effects without the capability never see the UI.

---

## Retired: On-Element Surfaces for Scalar Types

Earlier iterations rendered a bespoke on-element surface per parameter type — a draggable radius circle, force-field arrows for strength, a draggable position-history trail for decay, a lag ghost for response, pull-and-release spring manipulation, gradient stops along the phenomenon, a stagger ghost timeline. The implementations (and their tests) remain in `packages/motionworks/src/browser/overlay/surfaces/` and can be mounted through the same scoped canvas/SVG mechanism the path editor uses, but they are **not part of the current UI**: in practice the toolkit's perceptual sliders plus the cursor tool proved faster and more legible for scalar values, and the on-canvas treatment is reserved for genuinely spatial data (paths today; gradients-along-a-phenomenon is the most likely next candidate). Reviving one of these surfaces is a product decision — update this file and get confirmation first.
