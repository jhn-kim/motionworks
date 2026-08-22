# MotionWorks

A direct-manipulation motion design layer for projects built with AI coding agents.

MotionWorks runs over your local app so you can select a real element, tune motion by feel, replay it, compare against the original, and apply the result. Adjustable values live in CSS custom properties, so the browser can preview them immediately and the local daemon can write precise changes back to source.

> Describe to create. Manipulate to refine.

## Quick start

Install the single package and initialize the project:

```bash
npm install -D motionworks
npx motionworks init
```

`init` adds `.motionworks/` to `.gitignore`, removes a stale MotionWorks MCP entry if one exists, and writes a generated `MOTIONWORKS.md` guide plus a short reference stanza for Claude Code and Codex. In React projects it also confirms the package install when needed.

Start your app and the MotionWorks daemon in separate terminals:

```bash
npm run dev
npx motionworks
```

For React, follow the generated guide to mount `MotionWorksProvider` once in a development-only, independent React root. For any other page, load the standalone overlay before `</body>`:

```html
<script src="http://127.0.0.1:52340/motionworks.js"></script>
```

MotionWorks can also serve a static directory and inject the overlay automatically:

```bash
npx motionworks serve .
```

## The CSS contract

Each adjustable value has one canonical declaration in a real stylesheet on the registered element's rule:

```css
.card {
  --mw-radius: 120px;
  --mw-response: 0.18;
}
```

React effects register only the schema. The hook reads baselines from CSS; effect code consumes them with `readParams` and responds to `motionworks:change` through `onParamsChange`:

```tsx
import { useEffect, useRef } from 'react';
import { onParamsChange, readParams, useMotionWorks } from 'motionworks/react';

const schema = {
  name: 'Magnetic card',
  params: {
    radius: { type: 'spatial-radius', label: 'Radius', unit: 'px' },
    response: { type: 'temporal-response', label: 'Response' },
  },
} as const;

function MagneticCard() {
  const ref = useRef<HTMLDivElement>(null);
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

  return <div ref={ref} className="card" />;
}
```

Plain HTML can register the same schema with `data-motionworks` and use `window.MotionWorks.readParams` / `window.MotionWorks.onParamsChange`.

## What happens on Apply

Apply is durable before it is automatic:

1. The overlay appends an entry to `.motionworks/changes.json`.
2. The daemon edits the unique matching CSS declaration directly.
3. If the declaration is ambiguous, the daemon runs Claude or Codex when available.
4. If no agent can complete it, the entry remains pending for Copy prompt and `npx motionworks changes`.

The agent changes exactly the listed declarations and acknowledges a manual writeback with `npx motionworks ack <id>`. `npx motionworks status` reports the currently selected effect when a designer refers to “this one.”

## Package exports

The repository has one publishable package, `motionworks`:

| Export | Purpose |
|---|---|
| `motionworks` | Browser-safe schema and journal types |
| `motionworks/react` | `useMotionWorks`, `MotionWorksProvider`, and browser helpers |
| `motionworks/browser` | Framework-free CSS binding and event helpers, including `DEFAULT_VAR_PREFIX` |
| `motionworks/node` | Programmatic daemon, journal, setup, configuration, and static-serving APIs |
| `motionworks/motionworks.global.js` | Standalone browser bundle |
| `motionworks` CLI | Daemon, static serving, journal commands, setup, and status |

React and ReactDOM are optional peers; non-React pages use the standalone bundle.

## CLI

```text
npx motionworks                          Start the local daemon
npx motionworks serve <dir>              Serve a static site with the overlay
npx motionworks changes [--json|--brief] Show pending journal entries
npx motionworks ack <id>|--all           Acknowledge manual writebacks
npx motionworks status                   Show daemon and current selection
npx motionworks revert <id>              Revert an applied entry
npx motionworks init                     Set up the project and agent guide
```

Automatic agent execution is enabled when `claude` or `codex` is found. Use `--no-agent` for manual handoff or `--agent=claude|codex|off` to choose explicitly. The daemon binds to `127.0.0.1:52340`; `MOTIONWORKS_PORT` or `--port` changes the port.

## Development

The repository is an npm workspace with one package under `packages/motionworks`. It builds with tsup and tests with Vitest.

```bash
npm install
npm run build
npm run typecheck
npm test
```

The completed 0.5.0 bridge rebuild is recorded in [`docs/plans/bridge-rebuild.md`](docs/plans/bridge-rebuild.md); the maintained architecture and contracts live in [`docs/`](docs/).

## License

MIT © [John Kim](https://jhn.kim)
