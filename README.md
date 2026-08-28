# MotionWorks

[![npm version](https://img.shields.io/npm/v/motionworks)](https://www.npmjs.com/package/motionworks)
[![npm downloads](https://img.shields.io/npm/dm/motionworks)](https://www.npmjs.com/package/motionworks)

Refine motion by feel on the running app, and MotionWorks writes the result back to source.

![MotionWorks: refining motion on the running app and applying it back to source](https://raw.githubusercontent.com/jhn-kim/motionworks/main/demo.gif)

After your agent builds an effect, refining it means one of two slow guessing games: nudging numbers in code and reloading to see what moved, or feeding "yo make this more floaty, ease in a little better, **and make no mistakes**" back through the agent and waiting on a round-trip. Motion is perceptual, so you can't tell a value is right until you watch it run.

MotionWorks closes that loop, it renders an overlay on the running page, you select the real DOM element, and you tune its motion live on a normalized dial while the effect runs. Replay it, compare against the baseline, and when it's right, Apply writes the change into your stylesheet.

## Features

- Select and tune real elements on the running page, no separate canvas
- Parameters on a perceptual dial with per-type response curves, grouped into four families (Space, Feel, Time, Style)
- Replay one-shot and interaction animations, and compare against the original
- Zero-config detection of CSS motion — `@keyframes` (including scroll-driven, pseudo-element, and entrance-on-load animations) and CSS transitions — with duration, delay, and easing editable, no schema required
- Adopt JavaScript animations into editable, CSS-variable-backed effects: GSAP is detected automatically; Framer Motion / react-spring are lifted from source with the `useMotionVar` helper
- Dedicated editors for gradients, easing curves, and on-canvas motion paths
- Direct source writeback to a single CSS declaration (including inside the `animation`/`transition` shorthand); ambiguous edits delegate to Claude or Codex
- One package: a React hook plus a framework-free standalone bundle, React as an optional peer

## Install

```bash
npx motionworks init
```

`init` is a full installer: it adds `motionworks`, writes an agent guide (`MOTIONWORKS.md`), ignores `.motionworks/`, and sets up the CLAUDE.md / AGENTS.md stanza. Run the app and the daemon side by side:

```bash
npm run dev
npx motionworks
```

The daemon is token-authenticated by default. In React, mount `MotionWorksProvider` once in a dev-only root, passing the token in `daemonUrl` (`MOTIONWORKS.md` includes the full snippet). Any other page loads the overlay from the daemon:

```html
<script src="http://127.0.0.1:<port>/motionworks.js"></script>
```

## How it works

Every tunable value has one home: a CSS custom property on the element's own rule.

```css
.card {
  --mw-radius: 120px;
  --mw-response: 0.18;
}
```

Effect code reads those variables (Framer Motion, GSAP, WebGL, hand-written) and re-reads them on the `motionworks:change` event. Motion driven straight from the variable in CSS repaints with no JavaScript at all. Tuning a value never rewrites your code, it just changes one number in your stylesheet that the effect reads live. Adopting a JS animation is the one case that edits source, and the agent does it one value at a time, running your typecheck and build after each, with the new variable falling back to the original number so the animation stays the same until you change it.

Apply is durable before it's automatic. Each change is journaled to `.motionworks/changes.json`, then the daemon replaces the one uniquely matching declaration in your `.css`/`.scss`/`.less`. If that declaration is ambiguous, it runs Claude or Codex on the single bounded edit; if neither is available, the entry stays pending for `npx motionworks changes` and a copyable prompt. A small CLI (`changes`, `ack`, `status`, `revert`, and `adoptions`/`adopt-ack` for lifts) handles the queue.

## License

MIT © [John Kim](https://jhn.kim)
