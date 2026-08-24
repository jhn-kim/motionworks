# Changelog

## 0.6.0

Zero-config detection now covers almost all of a hand-built app's motion, and
JavaScript-driven animations can be adopted.

### Added

- **CSS transition detection.** Hover, Tailwind `transition-*`, menu/drawer
  transitions are detected and their duration/delay/easing edit and persist
  through the `transition-*` longhands. Play is inert with a "trigger it
  manually" chip (`:hover` and class toggles can't be re-triggered from script).
  Single-value transitions only; multi-property comma lists are skipped.
- **Entrance one-shots.** CSS animations are now detected from provider mount
  with an `animationstart` listener, so entrances that finish before the toolkit
  opens are still captured and stay selectable.
- **Pseudo-element animations.** `::before`/`::after` animations are detected,
  previewed, and — new — have durable Apply (baseline read from the
  pseudo-element's computed style; writeback targets the pseudo rule).
- **`capabilities.manualTrigger`.** Marks motion that can't be re-run from
  script; the toolkit renders Play inert with an explanatory chip.
- **GSAP adoption.** GSAP animations (invisible to `document.getAnimations()`)
  are detected via `gsap.globalTimeline` and can be adopted — a one-time agent
  lift of their values into CSS variables — from the overlay. New
  `.motionworks/adoptions.json` journal, `POST /adopt` + `GET /adoptions`
  endpoints, and `npx motionworks adoptions` / `adopt-ack <id>` commands.

### Fixed

- **Scroll-driven animations** (`animation-timeline: scroll()`/`view()`) no
  longer offer a Play button that does nothing; they are marked `manualTrigger`,
  skipped in subtree replay, and their inapplicable duration control is
  suppressed while delay/easing stay editable.

### Notes

- Framer Motion and react-spring run on main-thread engines and expose no
  runtime registry, so they cannot be auto-detected; adopt them by finding the
  animation in source and lifting its values into CSS variables.
