# MotionWorks — Architecture

> **Maintenance rule:** When a component's role, communication protocol, or package structure changes, edit the relevant section in place. Do not append new sections below stale ones — this file must remain a single coherent picture. Changes require product owner confirmation before being committed.

---

## System Overview

MotionWorks consists of four components that work together during local development:

```
┌─────────────────────────────────────────────┐
│              Coding Agent                    │
│         (Claude Code / Codex)                │
│                                              │
│  Writes source files, implements effects,    │
│  emits MotionWorks schema in generated code  │
└───────────────────┬─────────────────────────┘
                    │ MCP over stdio (primary)
                    │ motionworks-state.json (fallback)
                    ▼
┌─────────────────────────────────────────────┐
│           @motionworks/mcp                   │
│                                              │
│  The `motionworks` CLI. Runs the MCP server  │
│  (stdio) and the WebSocket bridge in one     │
│  process, sharing a MotionWorksStateManager. │
│  Also: `init` (CLAUDE.md stanza) and the     │
│  startup drift check.                        │
└───────────────────┬─────────────────────────┘
                    │ WebSocket (localhost, default 52340)
                    ▼
┌─────────────────────────────────────────────┐
│        @motionworks/react (overlay)          │
│                                              │
│  Renders on top of the running app in its    │
│  own React root. Selection, toolkit,         │
│  editing surfaces, diff tracking, live       │
│  preview. Installed as a dev dependency.     │
└───────────────────┬─────────────────────────┘
                    │ DOM / update() calls
                    ▼
┌─────────────────────────────────────────────┐
│         Running Application                  │
│         (e.g. localhost:3000)                │
│                                              │
│  The actual product. Effects register via    │
│  useMotionWorks(); CSS keyframe animations   │
│  are auto-detected while the overlay is open.│
└─────────────────────────────────────────────┘
```

---

## Package Structure

The repo is an npm workspace: `packages/core`, `packages/react`, `packages/mcp`, plus a local `examples/demo` harness that is not tracked in the public repository. Packages build with tsup and test with Vitest; the workspace typechecks via TypeScript project references (`npm run typecheck`).

### `@motionworks/core`

Framework-agnostic contract shared by the browser and Node sides. Two entry points:

- **`@motionworks/core`** (browser-safe): the parameter type system and TypeScript interfaces (`types.ts`, see `SCHEMA.md`), registration validation (`validate.ts`), and `MotionWorksStateManager` (`state.ts`) — the registry of effects, live values, selection, the changeset queue, and pending type corrections, with a subscribe/notify API.
- **`@motionworks/core/server`** (Node-only): `MotionWorksServer`, the WebSocket bridge server (`ws`). It applies upstream overlay messages to a shared state manager, tracks which connection registered which effects (so a page reload drops only that peer's registrations), remembers element selectors from `select`/`commit` messages, and broadcasts downstream notifications. The bridge binds to 127.0.0.1 and rejects browser connections whose Origin is not a loopback host; connections without an Origin header (local tools) are accepted.

**Why a shared core package?** The overlay runs in the browser; the MCP server runs in Node. If types and state shape were defined in two places they would diverge. Both `@motionworks/react` and `@motionworks/mcp` depend on core; it is the contract between them.

### `@motionworks/react`

Browser-only. Contains:

- `useMotionWorks(ref, registration)` — the registration hook. Statically importable from app code; in production builds its effect body is a no-op. Derives a stable effect id from the calling component's name plus the schema `name`, and re-registers when the schema fingerprint (name, param types, baseline values) changes — which is how agent writebacks land under React Fast Refresh.
- `MotionWorksProvider` — a thin wrapper that renders nothing in production and lazily imports the overlay renderer chunk in development.
- The **bridge** (`bridge.ts`) — a module-scoped singleton stored on `globalThis` (survives HMR) that connects app-side hook calls to the overlay. It tracks every live DOM instance per effect id, fans out `update()` calls to all instances, and queues registrations that happen before the overlay attaches.
- The **overlay** (`overlay/`) — the `OverlaySession` (overlay-side state manager + diff store + type-override store + WS client), the selection engine, the toolkit chip and its panels, the scoped canvas/SVG editing layers, the CSS-animation auto-detector, and the scrubber. See `OVERLAY.md` and `MANIPULATION_SURFACES.md`.

### `@motionworks/mcp`

Node-only. Ships the `motionworks` bin. Contains:

- `motionworks` (no args) — boots the runtime: WebSocket bridge on port 52340 (`MOTIONWORKS_PORT` to override), MCP server over stdio (seven tools, listed below), and the file-based fallback writer, which writes a debounced `motionworks-state.json` to the project root **until an MCP client completes its handshake**, at which point it stops.
- `motionworks init [--yes]` — appends or updates the sentinel-delimited, versioned instructions stanza in the project's `CLAUDE.md` (see `AGENT_INTEGRATION.md`).
- A startup **drift check** that compares the stanza's version tag against the installed package version and logs a warning if the stanza is missing or outdated. It never writes files.
- `instructions.ts` — the schema emission guide, the single source for both the CLAUDE.md stanza and the `motionworks_get_instructions` tool.

---

## Data Flow: Typical Session

### 1. Session start

The developer starts the project. Two processes run:

```
npm run dev          → starts the app (in this repo: npm run dev -w examples/demo, a local harness on :3001)
npx motionworks      → starts the MCP server + WebSocket bridge
```

In practice Claude Code launches the second process itself: the project's `.mcp.json` lists `motionworks` as an MCP server, so opening the project starts it. The overlay's WebSocket client reconnects with exponential backoff, so starting the CLI after the app (or restarting it mid-session) works — on reconnect the overlay re-announces every registration.

### 2. Agent generates an effect

The designer asks the agent to add a motion effect. The agent writes the effect plus a `useMotionWorks()` registration (schema, `update()` function, source hints — see `SCHEMA.md`). HMR loads the component; the hook registers with the bridge; the overlay stores the validated effect and mirrors the registration to the WS bridge so the agent can see it via MCP.

### 3. Designer selects the element

The designer clicks the MotionWorks launcher chip (mounted in a screen corner in development). The toolkit opens; every registered element flashes its outline and effect name (the activation reveal). The designer clicks an element — or picks it from the "Animated surfaces" list — and the toolkit's parameter families unlock.

### 4. Designer manipulates

The designer drags a slider, scrolls with the armed cursor tool, edits a curve, or drags a path anchor. Every input calls the effect's registered `update()` synchronously with the changed parameter — no network round-trip, no file change, no HMR. The overlay records the delta in its diff store and mirrors a coalesced `change` message (at most one per parameter per frame) to the bridge.

### 5. Designer commits

The designer clicks Apply. The overlay sends a `commit` message with the parameter diffs and a human-readable element selector. The bridge mints a changeset (id, timestamp, effect id/name, changes, source hints filtered to the changed params), queues it, and acks. The Apply button shows a "sent, waiting for agent" state.

### 6. Agent writes the source change

The agent reads the queue via `motionworks_get_changes`, updates the source values, and calls `motionworks_clear_changes` with each changeset's id — which also broadcasts `source-synced` to the overlay. HMR fires; the hook re-registers with the new baseline; the overlay reconciles the diff (see `SOURCE_SYNC.md`) and clears the pending state.

---

## MCP Tools (exposed by `@motionworks/mcp`)

| Tool | Description |
|---|---|
| `motionworks_get_state` | Full state: all registered effects, selected effect id, queued changesets (oldest first), pending type corrections |
| `motionworks_get_selected` | The selected effect (schema, current values, source hints, read-only flag) or null |
| `motionworks_get_changes` | All queued changesets plus pending type corrections |
| `motionworks_clear_changes` | Acknowledges **one changeset by id**, pops it from the queue, and notifies the overlay (`source-synced`) |
| `motionworks_list_effects` | All registered effects with full schemas |
| `motionworks_get_instructions` | Returns the schema emission guide |
| `motionworks_clear_type_corrections` | Clears the pending type-corrections queue after they are written to source |

Every tool description carries a nudge to call `motionworks_get_instructions` before implementing a motion effect. The agent should call `motionworks_get_changes` before any motion-related edit; if there are pending changes or type corrections, apply them to source first so agent edits never overwrite in-progress design work.

---

## Communication Protocol

### Overlay ↔ MCP bridge (WebSocket)

Messages are JSON over a local WebSocket (default port `52340`, configurable via the `port` prop on the provider and the `MOTIONWORKS_PORT` env var — keep them in sync).

Upstream (overlay → bridge), defined in `@motionworks/core` as `UpstreamMessage`:

```ts
{ type: 'register',        payload: MotionWorksEffect }            // serializable wire form, no update fn
{ type: 'unregister',      payload: { effectId: string } }
{ type: 'select',          payload: { effectId: string; selector?: string } }
{ type: 'change',          payload: { effectId: string; param: string; value: unknown } }
{ type: 'commit',          payload: { effectId: string; elementSelector: string; diffs: ParamDiff[] } }
{ type: 'type-correction', payload: TypeCorrection }
```

`change` messages are coalesced client-side to one per (effect, param) per animation frame. `register` is idempotent; the overlay resends all registrations on reconnect. There is no explicit deselect message. The `type-correction` message carries a designer override of a parameter's declared type (see `AGENT_INTEGRATION.md` → "Handling Type Corrections").

Downstream (bridge → overlay), `DownstreamMessage`:

```ts
{ type: 'ack',           payload: { changeId: string } }   // commit accepted; changeset minted
{ type: 'source-synced', payload: { effectId: string } }   // sent when the agent clears a changeset
```

### Agent ↔ MCP bridge (MCP protocol)

Standard MCP over stdio. Claude Code handles this natively via the project's `.mcp.json`:

```json
{ "mcpServers": { "motionworks": { "command": "npx", "args": ["motionworks"] } } }
```

(This repo points at the local build instead: `node packages/mcp/dist/cli.js`.)

---

## Deployment Model

MotionWorks runs **only in local development**. It is never deployed to staging or production environments.

Three layers of guard: consumers mount the provider behind a `NODE_ENV === 'development'` check with a dynamic import (see `OVERLAY.md`); the provider itself renders nothing outside development even if mounted; and `useMotionWorks`'s effect body returns immediately in production, so the statically-imported hook is a near-zero-cost no-op. The `@motionworks/mcp` process is a dev-only CLI tool with no production role.

This simplifies security: all WebSocket connections are localhost-only, no authentication is required, and no MotionWorks data leaves the developer's machine.
