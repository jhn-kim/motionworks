# MotionWorks — Product Overview

> **Maintenance rule:** This file is the canonical product definition. When the product direction changes materially, edit or replace the relevant section in place — do not append. Section changes require written confirmation from the product owner before being committed to the repository.

---

## What MotionWorks Is

MotionWorks is a **direct-manipulation motion design layer for developer projects built with AI coding agents**.

It installs into a running local development project — e.g., a React app at `localhost:3000` — and renders a visual overlay on top of the actual running product. Designers use it to refine motion: springs, trails, trajectories, timing, influence radii, color gradients along moving phenomena. Refinement happens on the running product itself — selecting the real elements, adjusting parameters on a perceptual dial, replaying animations, and comparing against the original — not in a separate design environment.

MotionWorks is not a standalone application. It is a development tool that sits between a coding agent (Claude Code, Codex, or similar) and the running application. It captures perceptual design decisions — "less floaty," "shorter trail," "more snap" — and communicates them back to the coding agent as precise parameter changes, which the agent then writes into source code.

---

## The Problem MotionWorks Solves

AI coding agents are effective at creating motion effects from natural language descriptions. A designer can write:

> "Make these images distort toward the cursor like liquid and leave a chromatic trail."

An agent will decide whether to use CSS, GSAP, WebGL, shaders, or something else, and it will build the effect. This works well.

The problem is refinement. After the effect is generated, the designer needs to adjust subtle perceptual qualities:

- The distortion follows too slowly
- The trail lasts too long
- The spring feels too floaty
- The settling is too abrupt
- The color progression feels wrong

These adjustments can be expressed in language, but each one requires a round-trip:

```
describe → agent changes → watch → describe again → agent changes → watch again
```

Motion is perceptual. A designer often cannot know whether something is right until they see it. Forcing every small adjustment through a language interface is slow and imprecise — the designer cannot point at the quality they want to change, only describe it.

**MotionWorks shortens that loop.** The designer selects the actual element, adjusts the parameter while the effect runs live, replays the animation until it feels right, and applies the result. Refinement happens through manipulation, not language.

---

## What MotionWorks Is Not

**Not a developer inspector.** The toolkit is built for designers making perceptual judgments, not developers reading raw values. Parameters are grouped into four perceptual families (Space, Feel, Time, Style), adjusted on a normalized 0–10 dial whose per-type response curves make equal input produce equal *perceived* change, and named in designer language ("Response", not `lerpFactor`). Spatial parameters that benefit from on-canvas editing (motion paths) are edited directly on the element. Exact numeric entry exists as an escape hatch, not the primary interaction.

**Not an AI animation generator.** MotionWorks does not generate motion effects. The coding agent generates them. MotionWorks refines what the agent created. Conflating the two would dilute the product's focus.

**Not a replacement for the coding agent.** The agent continues to write all implementation code, choose animation libraries, handle complex or creative effects, and edit source files. MotionWorks never edits source files directly. It sends refined parameter values back to the agent and lets the agent do the writing.

**Not a tool that reimplements the interface.** Tools like Figma or Framer require the designer to rebuild the interface in a separate environment. MotionWorks works on the actual running product in the actual browser. The element being manipulated is the real component in the real application — not a proxy, not a preview, not a simulation.

---

## Core Interaction Model

> **Describe to create. Manipulate to refine.**

These two modes are complementary, not competing.

**Language is best for:**
- Inventing new behaviors ("add a chromatic trail")
- Changing structure or implementation approach
- Requesting effects that don't yet exist
- Generating complex behaviors the designer can't predetermine

**Direct manipulation is best for:**
- Judging whether something feels right
- Adjusting spatial relationships
- Refining timing and feel
- Making perceptual decisions that resist verbal description

MotionWorks makes it possible to move fluidly between both modes without leaving the development environment. The coding agent handles possibility; MotionWorks handles taste.

---

## Target User

A designer or developer working in an AI-assisted ("vibe coding") workflow who:

- Uses a coding agent to build motion-heavy UIs
- Needs precise control over perceptual qualities
- Currently loses time in the describe → watch → re-describe loop
- Works in a React project running locally

---

## Current Scope

What is built today:

- **Framework:** React only (`@motionworks/react`, React 19). The framework-agnostic contract — types, validation, state management, the WebSocket bridge server — lives in `@motionworks/core` so Vue and Svelte wrappers are possible later; they are not built.
- **Agent integration:** Claude Code via MCP (`@motionworks/mcp`) is the primary path and the only path where the full workflow — schema emission, live manipulation, type corrections, and source writeback — operates reliably. A file-based fallback (`motionworks-state.json`) exists and is active only until an MCP client connects, but it is meaningfully weaker: it requires the developer to control the agent's system prompt, has no push notification when changes arrive, and does not carry type corrections or source hints. Agents running with a fixed provider-managed system prompt that the developer cannot modify are effectively read-only. Do not design features assuming parity between the MCP and file-based paths. See `AGENT_INTEGRATION.md` → "What the file-based path cannot do".
- **Effect detection:** Two paths. Primary: explicit registration by the coding agent (`useMotionWorks()` calls in generated code). Secondary: while the overlay is open, running CSS `@keyframes` animations are auto-detected via `document.getAnimations()` and registered as selectable effects with editable duration, delay, and easing (see `SCHEMA.md` → "What Happens Without a Schema"). Heuristic detection of Framer Motion, GSAP, and react-spring is not built.
- **Editing surfaces:** The toolkit chip with its four parameter families, perceptual sliders, cursor tool, gradient and easing editors, and the on-canvas path editor. Defined in `MANIPULATION_SURFACES.md`; no new surface types should be added without updating that file and `SCHEMA.md` together.
- **Source writeback:** Communicated via MCP or file; the agent performs the actual source edit. MotionWorks does not parse or write source files directly.
- **Demo:** a local development harness (`examples/demo`, Next.js 15, port 3001) exercises every registration path. It is not committed to the public repository; a rebuilt demo will be added later.

Explicitly out of scope: multi-user collaboration, cloud-hosted effects library, animation export, non-localhost deployments, mobile gesture input.
