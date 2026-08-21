# @motionworks/mcp

MCP server and CLI for [MotionWorks](https://github.com/jhn-kim/motionworks), a direct manipulation motion design layer for projects built with AI coding agents. It connects a coding agent (Claude Code or any MCP client) to the MotionWorks overlay running in your app, so designer refinements flow back to the agent as precise parameter changes for source writeback.

## Setup

In your project root:

```bash
npx motionworks init
```

This adds the MCP server entry to `.mcp.json`, installs `@motionworks/react` in React projects, and writes the agent instruction stanza — each step confirmed before it runs, each skipped when already done. `--yes` skips confirmations, `--stanza-only` writes only the instructions.

Or add the server entry to `.mcp.json` yourself:

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

## What it provides

Tools for the agent to list registered effects, read the currently selected effect, fetch pending parameter changes (with source hints for writeback), and clear them once applied.

Use with [`@motionworks/react`](https://www.npmjs.com/package/@motionworks/react) in the running app.
