# MotionWorks

[![npm version](https://img.shields.io/npm/v/motionworks)](https://www.npmjs.com/package/motionworks)
[![npm downloads](https://img.shields.io/npm/dm/motionworks)](https://www.npmjs.com/package/motionworks)

Refine motion by feel on the running app, and MotionWorks writes the result back to source.

After your agent builds an effect, refining it means one of two slow guessing games: nudging numbers in code and reloading to see what moved, or feeding "yo make this more floaty, ease in a little better" back through the agent and waiting on a round-trip. Motion is perceptual, so you can't tell a value is right until you watch it run.

MotionWorks closes that loop, it renders an overlay on the running page, you select the real DOM element, and you tune its motion live on a normalized dial while the effect runs. Replay it, compare against the baseline, and when it's right, Apply writes the change into your stylesheet.

## Features

- Select and tune real elements on the running page, no separate canvas
- Parameters on a perceptual dial with per-type response curves, grouped into four families (Space, Feel, Time, Style)
- Replay one-shot and interaction animations, and compare against the original
- Auto-detects running CSS `@keyframes` via `document.getAnimations()`; duration, delay, and easing become editable with no schema
- Dedicated editors for gradients, easing curves, and on-canvas motion paths
- Direct source writeback to a single CSS declaration; ambiguous edits delegate to Claude or Codex
- One package: a React hook plus a framework-free standalone bundle, React as an optional peer

## Install

```bash
npm install -D motionworks
npx motionworks init
```

`init` writes an agent guide (`MOTIONWORKS.md`), ignores `.motionworks/`, and sets up the CLAUDE.md / AGENTS.md stanza. Run the app and the daemon side by side:

```bash
npm run dev
npx motionworks
```

React mounts `MotionWorksProvider` once in a dev-only root. Any other page loads the overlay from the daemon:

```html
<script src="http://127.0.0.1:52340/motionworks.js"></script>
```

## How it works

Every tunable value has one home: a CSS custom property on the element's own rule.

```css
.card {
  --mw-radius: 120px;
  --mw-response: 0.18;
}
```

Effect code reads those variables (Framer Motion, GSAP, WebGL, hand-written) and re-reads them on the `motionworks:change` event. Motion driven straight from the variable in CSS repaints with no JavaScript at all. Either way, MotionWorks never rewrites your code; it changes the number in the stylesheet and your effect consumes it live.

Apply is durable before it's automatic. Each change is journaled to `.motionworks/changes.json`, then the daemon replaces the one uniquely matching declaration in your `.css`/`.scss`/`.less`. If that declaration is ambiguous, it runs Claude or Codex on the single bounded edit; if neither is available, the entry stays pending for `npx motionworks changes` and a copyable prompt. A small CLI (`changes`, `ack`, `status`, `revert`) handles the queue.

## License

MIT © [John Kim](https://jhn.kim)
