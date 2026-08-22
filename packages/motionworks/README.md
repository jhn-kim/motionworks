# motionworks

Direct-manipulation motion design for local developer projects. MotionWorks overlays the real running page, previews parameter changes through CSS custom properties, and persists Apply operations in a journal before writing them back to source.

The package supports React and plain HTML from one install. React and ReactDOM are optional peer dependencies.

## Install and run

```bash
npm install -D motionworks
npx motionworks init
npx motionworks
```

`init` adds `.motionworks/` to `.gitignore`, removes an obsolete MotionWorks entry from `.mcp.json` if present, and generates `MOTIONWORKS.md` with the current overlay, registration, and agent-writeback contract.

### React

Mount `MotionWorksProvider` once in its own development-only React root, then register adjustable elements with the schema-only hook:

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
    const sync = () => effect.update(readParams(el, schema.params));
    const stop = onParamsChange(el, sync);
    return () => {
      stop();
      effect.destroy();
    };
  }, []);

  return <button ref={ref} className="magnetic-button" />;
}
```

Declare the values once in a source stylesheet on that element's rule:

```css
.magnetic-button {
  --mw-radius: 120px;
  --mw-strength: 0.8;
}
```

The generated `MOTIONWORKS.md` includes the required development-only provider mount, replay and scrub events, every parameter type, and its CSS encoding.

### Plain HTML

Add the standalone bundle before `</body>` while `npx motionworks` is running:

```html
<script src="http://127.0.0.1:52340/motionworks.js"></script>

<div class="hero"
  data-motionworks='{"name":"Hero radius","params":{"radius":{"type":"spatial-radius","unit":"px"}}}'>
</div>
```

Use `window.MotionWorks.readParams`, `window.MotionWorks.onParamsChange`, and `window.MotionWorks.EVENTS` in the page's JavaScript. For a static directory, `npx motionworks serve .` serves the files and injects the bundle automatically.

## Apply pipeline

Apply appends to `.motionworks/changes.json`, then the daemon:

1. updates the unique matching CSS declaration directly;
2. falls back to an automatically detected `claude` or `codex` command;
3. leaves the entry pending for manual handoff if neither path completes it.

For manual handoff, run `npx motionworks changes`, edit only the listed declarations, then run `npx motionworks ack <id>`. Use `npx motionworks status` to inspect the current selection.

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

Use `--no-agent` for manual-only writeback, `--agent=claude|codex|off` to select behavior, and `--port` or `MOTIONWORKS_PORT` to change the default `52340` port.

## License

MIT
