# MotionWorks

[![npm version](https://img.shields.io/npm/v/motionworks)](https://www.npmjs.com/package/motionworks)
[![npm downloads](https://img.shields.io/npm/dm/motionworks)](https://www.npmjs.com/package/motionworks)

Refine motion by feel on the running app, and MotionWorks writes the result back to source.

After your agent builds an effect, refining it is a guessing game: nudge numbers in code and reload to see what moved, or loop "yo make this more floaty, ease in a little better" back through the agent and wait on a round-trip. Motion is perceptual, so you can't tell a value is right until you watch it run. MotionWorks renders an overlay on the running page, you select the real element and tune its motion live, and Apply writes the change into your stylesheet.

## Install

```bash
npx motionworks init
npx motionworks
```

`init` is a full installer: it adds `motionworks`, writes an agent guide (`MOTIONWORKS.md`), ignores `.motionworks/`, removes any stale MotionWorks `.mcp.json` entry, and sets up the CLAUDE.md / AGENTS.md stanza. `npx motionworks` runs the (token-authenticated) daemon alongside your dev server. React and ReactDOM are optional peer dependencies.

## What it detects

With no schema at all, MotionWorks auto-detects CSS motion on the running page: `@keyframes` animations — including scroll-driven (`animation-timeline`), pseudo-element (`::before`/`::after`), and entrance-on-load one-shots — and CSS transitions, exposing their duration, delay, and easing. JavaScript animations run on their own engines and can't be auto-detected the same way: GSAP is enumerated through its own timeline and offered for one-click **adoption**, while Framer Motion / react-spring are lifted from source. Adoption backs each tunable value with a CSS variable read via the SSR-safe `useMotionVar` hook, after which it edits like any other effect.

## Register an effect

Every tunable value has one home: a CSS custom property on the element's own rule.

```css
.magnetic-button {
  --mw-radius: 120px;
  --mw-strength: 0.8;
}
```

### React

Mount `MotionWorksProvider` once in a development-only root, passing the daemon token in `daemonUrl` (the daemon is token-authenticated; `MOTIONWORKS.md` includes the full tokened boot snippet). Register the element with the schema-only hook, and your effect reads the variables and re-reads them on `motionworks:change`:

```tsx
import { useEffect, useRef } from "react";
import { onParamsChange, readParams, useMotionWorks } from "motionworks/react";

const schema = {
  name: "Magnetic button",
  params: {
    radius: { type: "spatial-radius", label: "Radius", unit: "px" },
    strength: { type: "spatial-strength", label: "Strength" },
  },
} as const;

function MagneticButton() {
  const ref = useRef<HTMLButtonElement>(null);
  useMotionWorks(ref, schema);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const effect = createMagneticEffect(el, readParams(el, schema.params));
    const stop = onParamsChange(el, () =>
      effect.update(readParams(el, schema.params)),
    );
    return () => {
      stop();
      effect.destroy();
    };
  }, []);

  return <button ref={ref} className="magnetic-button" />;
}
```

Motion driven straight from the variable in CSS repaints with no JavaScript at all, and tuning a value never rewrites your code. Adopting a JS animation is the one case that edits source, and the agent does it one reviewable change at a time.

### Plain HTML

Load the standalone bundle before `</body>` while `npx motionworks` is running, and register with a `data-motionworks` block:

```html
<script src="http://127.0.0.1:<port>/motionworks.js"></script>

<div
  class="hero"
  data-motionworks='{"name":"Hero radius","params":{"radius":{"type":"spatial-radius","unit":"px"}}}'
></div>
```

Read values with `window.MotionWorks.readParams` and subscribe with `window.MotionWorks.onParamsChange`. For a static directory, `npx motionworks serve .` serves the files with the overlay already injected.

The generated `MOTIONWORKS.md` documents the provider mount, every parameter type and its CSS encoding, and the replay and scrub events.

## Apply

Apply is durable before it's automatic. Each change is journaled to `.motionworks/changes.json`, then the daemon:

1. replaces the one uniquely matching CSS declaration directly;
2. falls back to an auto-detected `claude` or `codex` on the single bounded edit;
3. leaves the entry pending for manual handoff if neither completes it.

For manual handoff, run `npx motionworks changes`, edit only the listed declarations, then `npx motionworks ack <id>`. `npx motionworks status` shows the current selection.

## Exports

| Export                              | Contents                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `motionworks`                       | Schema, runtime, and journal TypeScript types                                                              |
| `motionworks/react`                 | `MotionWorksProvider`, `useMotionWorks`, `useMotionVar`, plus CSS binding helpers                          |
| `motionworks/browser`               | `readParams`, `readParam`, `readMotionVar`, `onParamsChange`, `EVENTS`, `varNameFor`, `DEFAULT_VAR_PREFIX` |
| `motionworks/node`                  | Programmatic daemon, journal, setup, configuration, and static-serving APIs                                |
| `motionworks/motionworks.global.js` | Standalone IIFE exposed as `window.MotionWorks`                                                            |

## CLI

```text
motionworks                          Start the daemon
motionworks serve <dir>              Serve static files and the overlay
motionworks changes [--json|--brief] Show pending journal entries
motionworks ack <id>|--all           Acknowledge entries
motionworks adoptions                Show JS animations awaiting adoption
motionworks adopt-ack <id>           Mark an adoption done
motionworks status                   Show daemon and current selection
motionworks revert <id>              Revert an applied entry
motionworks init                     Configure the project and agent guide
```

Use `--no-agent` for manual-only writeback and `--agent=claude|codex|off` to choose behavior. `init` pins a stable per-project port derived from the project path; override it with `--port` or `MOTIONWORKS_PORT` (the base default is `52340`). The daemon prints its port on startup.

## License

MIT © [John Kim](https://jhn.kim)
