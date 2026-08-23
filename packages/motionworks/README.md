# MotionWorks

[![npm version](https://img.shields.io/npm/v/motionworks)](https://www.npmjs.com/package/motionworks)
[![npm downloads](https://img.shields.io/npm/dm/motionworks)](https://www.npmjs.com/package/motionworks)

Refine motion by feel on the running app, and MotionWorks writes the result back to source.

After your agent builds an effect, refining it is a guessing game: nudge numbers in code and reload to see what moved, or loop "yo make this more floaty, ease in a little better" back through the agent and wait on a round-trip. Motion is perceptual, so you can't tell a value is right until you watch it run. MotionWorks renders an overlay on the running page, you select the real element and tune its motion live, and Apply writes the change into your stylesheet.

## Install

```bash
npm install -D motionworks
npx motionworks init
npx motionworks
```

`init` writes an agent guide (`MOTIONWORKS.md`), ignores `.motionworks/`, removes any stale MotionWorks `.mcp.json` entry, and sets up the CLAUDE.md / AGENTS.md stanza. `npx motionworks` runs the daemon alongside your dev server. React and ReactDOM are optional peer dependencies.

## Register an effect

Every tunable value has one home: a CSS custom property on the element's own rule.

```css
.magnetic-button {
  --mw-radius: 120px;
  --mw-strength: 0.8;
}
```

### React

Mount `MotionWorksProvider` once in a development-only root, then register the element with the schema-only hook. Your effect reads the variables and re-reads them on `motionworks:change`:

```tsx
import { useEffect, useRef } from 'react';
import { onParamsChange, readParams, useMotionWorks } from 'motionworks/react';

const schema = {
  name: 'Magnetic button',
  params: {
    radius: { type: 'spatial-radius', label: 'Radius', unit: 'px' },
    strength: { type: 'spatial-strength', label: 'Strength' },
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

Motion driven straight from the variable in CSS repaints with no JavaScript at all; MotionWorks never rewrites your code either way.

### Plain HTML

Load the standalone bundle before `</body>` while `npx motionworks` is running, and register with a `data-motionworks` block:

```html
<script src="http://127.0.0.1:52340/motionworks.js"></script>

<div class="hero"
  data-motionworks='{"name":"Hero radius","params":{"radius":{"type":"spatial-radius","unit":"px"}}}'>
</div>
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

| Export | Contents |
|---|---|
| `motionworks` | Schema, runtime, and journal TypeScript types |
| `motionworks/react` | React hook/provider plus CSS binding helpers |
| `motionworks/browser` | `DEFAULT_VAR_PREFIX`, `readParams`, `readParam`, `onParamsChange`, `EVENTS`, `varNameFor` |
| `motionworks/node` | Programmatic daemon, journal, setup, configuration, and static-serving APIs |
| `motionworks/motionworks.global.js` | Standalone IIFE exposed as `window.MotionWorks` |

## CLI

```text
motionworks                          Start the daemon
motionworks serve <dir>              Serve static files and the overlay
motionworks changes [--json|--brief] Show pending journal entries
motionworks ack <id>|--all           Acknowledge entries
motionworks status                   Show daemon and current selection
motionworks revert <id>              Revert an applied entry
motionworks init                     Configure the project and agent guide
```

Use `--no-agent` for manual-only writeback, `--agent=claude|codex|off` to choose behavior, and `--port` or `MOTIONWORKS_PORT` to change the default `52340` port.

## License

MIT © [John Kim](https://jhn.kim)
