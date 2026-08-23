# Agent Instructions

## Before you start

Read docs/OVERVIEW.md first — it orients you to the project with no prior context assumed.
Then read whichever of the following apply to your task:
- docs/ARCHITECTURE.md — system structure and design decisions
- docs/SCHEMA.md — data contracts and schema definitions
- docs/AGENT_INTEGRATION.md — how agents interface with the system
- docs/RUNTIME_BRIDGE.md — runtime coordination between agents
- docs/OVERLAY.md — overlay layer design
- docs/MANIPULATION_SURFACES.md — surfaces agents can act on
- docs/SOURCE_SYNC.md — source-of-truth sync behavior
- docs/CHALLENGES.md — known risks and how they're mitigated

## Rules

- Any task involving schema, data contracts, or agent-to-agent coordination requires reading SCHEMA.md and AGENT_INTEGRATION.md in full first. Do not infer the contract from code alone.
- These docs are the source of truth. If you find a task in conflict with what's documented, treat the doc as authoritative unless the human operator tells you otherwise.
- If a doc is wrong, outdated, or incomplete: do not edit it silently. Propose the specific change and wait for confirmation before writing.

<!-- motionworks-instructions-start -->
<!-- motionworks-version: 0.5.4 -->

This project uses **MotionWorks** for motion design. Before you implement or refine motion, read [`MOTIONWORKS.md`](./MOTIONWORKS.md) — it defines the CSS-variable contract, overlay setup, and journal writeback rules. Whenever you scaffold or mount motion, start the daemon yourself in the background (`npx motionworks` from the project root) and confirm it with `npx motionworks status` before you report the work done — the overlay is inert until it runs. Before editing motion values, run `npx motionworks changes` and process entries oldest first.
<!-- motionworks-instructions-end -->
