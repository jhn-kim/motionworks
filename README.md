# MotionWorks

A direct manipulation motion design layer for projects built with AI coding agents.

Refine motion by feel instead of prompts. A dev overlay that lets designers adjust animation parameters on the real running app and sends the results to your coding agent via MCP.

AI coding agents are good at creating motion from a description. They are slow at refining it: every "less floaty" or "shorter trail" costs a describe, wait, watch, describe again round trip. MotionWorks closes that loop.

> Describe to create. Manipulate to refine.

<!-- TODO: demo GIF of the select → drag → writeback loop goes here -->

## Packages

| Package | What it does |
|---|---|
| [`@motionworks/react`](packages/react) | The in-app overlay for React 19: effect registration hook, selection layer, perceptual editing surfaces |
| [`@motionworks/mcp`](packages/mcp) | MCP server for Claude Code and other MCP clients, plus the WebSocket bridge and `motionworks` CLI |
| [`@motionworks/core`](packages/core) | Framework agnostic contract: schema types, validation, state, bridge server |

## Quickstart

The fastest path is to let your coding agent do the setup. Paste this into Claude Code (or any agent with terminal access):

> Set up MotionWorks in this project: install @motionworks/react, mount MotionWorksProvider at the app root, add a "motionworks" MCP server to .mcp.json with command "npx" and args ["-y", "@motionworks/mcp"], then run npx motionworks init --yes.

Or by hand. In a React 19 project:

```bash
npm install @motionworks/react
```

Mount the overlay once (it renders nothing in production):

```tsx
import { MotionWorksProvider } from "@motionworks/react";

<MotionWorksProvider />
```

Connect your coding agent by adding the MCP server to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "motionworks": {
      "command": "npx",
      "args": ["-y", "@motionworks/mcp"]
    }
  }
}
```

Then run `npx motionworks init` once to teach your agent to register the effects it creates. From there the loop is: ask the agent for a motion effect, click the MotionWorks chip in your app, select the effect, adjust it until it feels right, hit Apply, and the agent writes your refinements into source.

## How it works

Effects register through a `useMotionWorks()` hook the agent emits alongside the effect code, declaring each adjustable parameter with a semantic type (`spring-response`, `temporal-decay`, `spatial-radius`, `gradient`, `path`, and friends). The overlay maps each type to a perceptual editing surface: normalized dials, gradient and easing editors, and an on-canvas path editor. Running CSS keyframe animations are detected automatically, no registration needed.

MotionWorks never edits your source. Committed refinements are queued as precise changesets, and the coding agent applies them, guided by source hints that point at the exact constant to change.

The full design is documented in [`docs/`](docs/), starting with [OVERVIEW.md](docs/OVERVIEW.md). The parameter schema contract lives in [SCHEMA.md](docs/SCHEMA.md); agent integration in [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md).

## Development

This is an npm workspaces monorepo.

```bash
npm install
npm run build        # build all three packages
npm test
npm run typecheck
```

## License

MIT © [John Kim](https://jhn.kim)
