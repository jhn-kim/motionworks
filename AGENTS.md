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

## Active rebuild (remove in Slice 6)

The bridge is being rebuilt per `docs/plans/bridge-rebuild.md`. Where that plan conflicts
with `docs/*.md`, `MOTIONWORKS.md`, or the MotionWorks stanza in `CLAUDE.md`, **the plan wins**.
`docs/*.md` still govern anything the plan does not mention. Do not edit `docs/*.md` to
match the plan; list needed doc changes in your report instead. When assigned a slice,
implement that slice only.

- Any task involving schema, data contracts, or agent-to-agent coordination requires reading SCHEMA.md and AGENT_INTEGRATION.md in full first. Do not infer the contract from code alone.
- These docs are the source of truth. If you find a task in conflict with what's documented, treat the doc as authoritative unless the human operator tells you otherwise.
- If a doc is wrong, outdated, or incomplete: do not edit it silently. Propose the specific change and wait for confirmation before writing.
