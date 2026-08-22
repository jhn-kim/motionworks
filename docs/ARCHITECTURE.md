# MotionWorks — Architecture

> **Maintenance rule:** When a component's role, communication protocol, or package structure changes, edit the relevant section in place. Do not append new sections below stale ones — this file must remain a single coherent picture. Changes require product owner confirmation before being committed.

---

## System Overview

MotionWorks has three cooperating parts during local development:

```
┌──────────────────────────────────────────────────────────┐
│ Running page                                             │
│                                                          │
│ motionworks.global.js or motionworks/react               │
│ • registers schema against real DOM elements             │
│ • reads CSS custom-property baselines                    │
│ • previews with inline custom properties                 │
│ • dispatches change / replay / scrub events              │
│ • keeps uncommitted intent in localStorage               │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP on 127.0.0.1:52340
                           │ GET status/pending/script
                           │ POST select/commit/ack
                           ▼
┌──────────────────────────────────────────────────────────┐
│ motionworks daemon                                       │
│                                                          │
│ • .motionworks/changes.json: durable journal             │
│ • .motionworks/selected.json: current selection          │
│ • direct, all-or-nothing CSS declaration write           │
│ • optional FIFO Claude/Codex runner                      │
│ • standalone bundle and optional static-file serving     │
└──────────────────────────┬───────────────────────────────┘
                           │ only when direct write skips
                           ▼
┌──────────────────────────────────────────────────────────┐
│ Coding agent                                             │
│                                                          │
│ claude -p / codex exec, or manual CLI handoff            │
│ • edits exactly listed declarations/type corrections     │
│ • does not refactor or reinterpret page-controlled data  │
└──────────────────────────────────────────────────────────┘
```

There is no MCP server, WebSocket protocol, primary/secondary daemon election, or in-memory source-of-truth state. The journal file is authoritative across browser reloads and daemon restarts.

---

## Package Structure

The repository is an npm workspace with one publishable package at `packages/motionworks`, versioned as `motionworks`. It builds with tsup, typechecks with TypeScript, and tests with Vitest.

Public exports:

- **`motionworks`** — browser-safe schema, runtime, journal, request, and status types.
- **`motionworks/react`** — `useMotionWorks`, `MotionWorksProvider`, and the framework-free CSS binding helpers. The ESM output carries a `"use client"` banner.
- **`motionworks/browser`** — `DEFAULT_VAR_PREFIX`, `readParams`, `readParam`, `onParamsChange`, `EVENTS`, and `varNameFor` without a React dependency.
- **`motionworks/node`** — programmatic daemon, journal, setup, configuration, and static-serving APIs.
- **`motionworks/motionworks.global.js`** — one bundled IIFE exposed as `window.MotionWorks`, including the overlay and browser helpers.
- **`motionworks` bin** — daemon, static server, journal commands, setup, status, and revert.

React and ReactDOM are optional peer dependencies. The old `@motionworks/react` and `@motionworks/core` names are no longer packages in this repository; the 0.5.0 release procedure deprecates their existing npm records rather than deleting them.

Source is divided by execution environment:

```
packages/motionworks/src/
├── shared/    schema, validation, state, journal types, CSS codecs
├── browser/   hook, DOM bridge, standalone mount, overlay, CSS bindings
└── node/      CLI, daemon, journal, CSS writer, agent, setup, static serving
```

The module-scoped browser bridge is only an in-page coordination object between registrations and the overlay. It is not a network bridge and does not own persistent state.

---

## Browser Runtime

### Registration and baselines

React components call `useMotionWorks(ref, schema)`. Plain pages use `data-motionworks` or `<script type="application/motionworks+json">`. Registration contains parameter metadata only; values are read from computed CSS.

For each parameter the bridge:

1. Resolves the property name from `param.var` or `--mw-<kebab-key>`.
2. Reads the computed CSS value from the registered element.
3. Decodes it according to the semantic parameter type.
4. Stores the runtime baseline plus the CSS property name, unit, and bound status.

React and DOM registrations use readable `slug#n` ids allocated by DOM order and never renumbered while live. Auto-detected CSS animations retain `css::<animation-name>#<n>` ids so their keyframe name remains available.

### Live preview

Live manipulation is entirely browser-local. The overlay writes an inline custom property, dispatches a bubbling `motionworks:change` event, and records the `from → to` intent in the diff store. Sibling elements sharing the same slug and baseline receive the same live value.

Replay and scrub use `motionworks:replay` and `motionworks:scrub` CustomEvents. Effects read CSS through `readParams` and subscribe through `onParamsChange` or direct event listeners. No per-frame traffic reaches the daemon.

Uncommitted diffs are persisted in `localStorage` under the page origin. On reload or stylesheet replacement, the overlay restores the declaration, re-reads the baseline, re-registers, reconciles the stored intent, and re-applies it when source has not caught up.

---

## Daemon and HTTP API

`npx motionworks` starts a Node HTTP server bound to `127.0.0.1` (default port `52340`). `npx motionworks serve <dir>` starts the same daemon and serves a static directory after API routes are checked.

| Method | Route | Role |
|---|---|---|
| `GET` | `/status` | Daemon health, root, pending count, and agent status |
| `GET` | `/pending` | Journal entries for the request Origin; `?all=1` or no Origin returns all |
| `GET` | `/motionworks.js` | Standalone browser bundle, `no-store` |
| `POST` | `/select` | Atomically write the current selection |
| `POST` | `/commit` | Validate, journal, and begin the Apply pipeline |
| `POST` | `/ack` | Remove one, several, or all acknowledged entries |
| `OPTIONS` | API routes | Loopback CORS preflight |

Static serving rejects traversal, resolves directories to `index.html`, injects `/motionworks.js` before `</body>`, and uses a small explicit MIME table. API routes win over same-named files.

Browser Origins must be loopback hosts. Requests without an Origin are allowed for local CLI use. A project may set `token` in `motionworks.config.json`; when set, the injected script/React daemon URL carries it and every POST requires it. The token is defense in depth, not remote-deployment support.

---

## Journal

`.motionworks/changes.json` is an ordered JSON array of entries:

```ts
interface JournalEntry {
  id: string;
  createdAt: number;
  origin: string;
  page: string;
  effectId: string;
  effectName: string;
  elementSelector: string;
  changes: Array<{
    param: string;
    type: ParameterType;
    from: unknown;
    to: unknown;
    var?: string;
    fromCss?: string;
    toCss?: string;
    rule?: { selectorText: string; sheetHref: string; sourceFile?: string };
  }>;
  typeCorrections?: TypeCorrection[];
  status: 'pending' | 'agent-working' | 'applied';
  appliedAt?: number;
  appliedBy?: 'css' | 'agent' | 'cli';
  files?: string[];
  error?: string;
}
```

Every read-modify-write takes an exclusive `.motionworks/changes.lock`, retries for up to two seconds, and reclaims locks older than five seconds. Writes go to a temporary file followed by atomic rename. Applied entries older than seven days are pruned at daemon startup; interrupted `agent-working` entries return to `pending`.

`.motionworks/selected.json` stores the latest selection and current values. `npx motionworks status` reads it even when the daemon is stopped.

---

## Apply Pipeline

1. The overlay sends a `CommitRequest`; the daemon validates that every writable property is a `--mw-*` variable or one of the supported animation longhands.
2. The daemon appends the entry before attempting source work.
3. `applyCssChanges` scans CSS, SCSS, Less, and CSS Module files outside ignored build/vendor directories. It matches the property and `fromCss`, narrows by source file and selector when known, and writes only when exactly one candidate remains. The operation is all-or-nothing.
4. A successful direct write marks the entry `applied/css` with the changed files.
5. A skipped direct write becomes `agent-working` when Claude or Codex is configured. Agent jobs run FIFO, one child at a time. Success marks `applied/agent`; failure returns the entry to `pending` with an error.
6. With no usable agent, the entry stays `pending`. The overlay shows Copy prompt and a coding agent uses `npx motionworks changes` followed by `npx motionworks ack <id>`.

When a stylesheet reload makes the registered baseline equal the entry's `to` value—and any type correction is present in the schema—the overlay acknowledges the entry automatically. With no HMR, an applied entry can trigger a cache-busted stylesheet link reload.

`npx motionworks revert <id>` sends an applied entry's inverse through the same unique CSS-write path and removes the entry only after the inverse succeeds.

---

## Deployment and Security Model

MotionWorks is a local development tool. It binds only to loopback and should not be deployed with the product.

The React hook is a no-op outside development, the provider renders nothing outside development, and recommended mounts use a build-time development guard. Plain pages include the standalone script only during local work.

CORS prevents non-loopback browser origins, and optional tokens protect POST routes from other localhost pages. A configured auto-agent still has workspace edit permission; its command removes shell tools where supported and its instruction limits edits, but the restriction is instructional rather than a filesystem-level declaration allowlist. See `CHALLENGES.md`.
