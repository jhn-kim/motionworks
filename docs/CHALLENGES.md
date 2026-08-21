# MotionWorks — Challenges and Mitigations

> **Maintenance rule:** When a challenge is resolved — a mitigation shipped, a constraint lifted — move it to a "Resolved" section at the bottom with a note on what solved it. Do not delete challenges that were real; they may recur. New challenges should be added in place (keep the list ordered: hardest/most systemic first). Changes require product owner confirmation.

---

## Challenge 1: Agent Schema Emission Reliability

**Root cause:** Coding agents are probabilistic. Even with a clear system prompt, an agent may omit the `useMotionWorks()` registration, emit an incomplete schema, use an unknown parameter type, or forget the `update()` function — especially when generating long files, when the agent is working quickly, or when the system prompt isn't fresh in context.

**What breaks:** If the registration is missing, MotionWorks has nothing to display. The overlay shows the element as unregistered and manipulation is unavailable.

**Chosen mitigation:**

Three layers of defense, in order of reliability:

1. **`CLAUDE.md` stanza + tool description nudges.** MCP resources are pull-based — they require an explicit `resources/read` call and are not automatically surfaced in Claude Code's system prompt when the server connects. The primary delivery mechanism is `npx motionworks init`, which appends a versioned, sentinel-delimited stanza to `CLAUDE.md`. Claude Code reads `CLAUDE.md` at every session start, making this reliable without any runtime agent action. Every MCP tool description also includes a compact nudge to call `motionworks_get_instructions` before implementing a motion effect — visible whenever the agent lists available tools. The `motionworks_get_instructions` tool returns the full guide on explicit fetch. See `AGENT_INTEGRATION.md` for the `init` command's idempotency handling, drift detection, and confirmation-before-overwrite behavior.

2. **Validation with useful errors.** When a registration arrives, `@motionworks/core` validates it fully. Invalid registrations produce console errors that name the specific problem (missing `update`, unknown type, type/value mismatch). The agent sees these in its tool output and can self-correct.

3. **Degraded mode instead of silent failure.** Even a partial registration is accepted. MotionWorks shows what it can: if `update` is missing, surfaces render read-only. If a type is unknown, that param falls back to `scalar`. The designer can still see what was registered and the agent can fix it on the next iteration.

**What was not chosen and why:**

- *MCP resource auto-injection* — MCP resources require an explicit fetch; they do not auto-inject into the agent's system prompt on server connect. The original design assumed this was possible — it is not. Tool descriptions and `CLAUDE.md` are the real automatic surfaces.
- *Auto-appending to `CLAUDE.md` on server startup* — injecting into user files as a side effect of `npx motionworks` creates idempotency, conflict, and drift problems without a clean resolution. Splitting into `init` (writes once, with confirmation) and `start` (reads version tag, never writes) separates these responsibilities cleanly.
- *Automatic post-generation code analysis* — parsing generated code to infer parameter semantics is fragile. Variable names, code structure, and library usage are too varied. High maintenance cost, unreliable results.
- *Requiring agents to use a fixed code scaffold/template* — rigid scaffolding fights against agents' tendency to write code contextually. Guide-based instruction is more flexible.

**Remaining risk:** An agent that ignores its system prompt (or where the prompt isn't loaded) will not emit schema. There is no fully automatic fallback. In the long term, heuristic detection of CSS animations, Framer Motion props, and GSAP tweens would reduce this risk — but that is explicitly post-MVP.

---

## Challenge 2: Live Update API Surface Across Libraries

**Root cause:** The effect's `update()` function must work synchronously across whatever animation library the agent chose — CSS, Framer Motion, GSAP, Three.js, custom WebGL, or combinations. Each library has a different API for mutating live animation values.

**What breaks:** If `update()` uses async patterns, triggers React re-renders, or is implemented incorrectly for the library, the live preview is laggy or broken. This makes MotionWorks feel worse than just typing in the chat.

**Chosen mitigation:**

The `RUNTIME_BRIDGE.md` document provides concrete, copy-pasteable implementation patterns for each major library. The system prompt references these patterns. The agent's job is to match the effect's library to the correct `update()` pattern.

The key insight: each library has exactly one right way to do a synchronous live update:
- CSS: `setProperty` on a custom property
- Framer Motion: `MotionValue.set()`
- GSAP: `gsap.set()` with duration 0
- WebGL/Three.js: direct uniform mutation

The agent should not invent its own approach. It should use the documented pattern.

MotionWorks validates that `update` is a function at registration time. If it is not, surfaces render read-only with a visible warning that includes a link to the implementation guide.

**Remaining risk:** Novel effects using libraries not covered in the guide will require the agent to infer the correct approach. The agent's code understanding is usually sufficient for this, but it is an untested path. The guide should be expanded over time as new libraries appear in agent-generated code.

---

## Challenge 3: Source Writeback Precision

**Root cause:** When MotionWorks sends a changeset to the agent, the agent must find exactly the right location in source to update. A value like `0.8` for `distortion` might appear in many places — inline in a component, in a config object, in a default prop, in a test. The agent must update exactly one of them.

**What breaks:** The agent updates the wrong instance, or updates multiple instances, or updates a computed intermediate rather than the canonical source. The designer's intent is applied incorrectly.

**Chosen mitigation:**

The `sourceHints` system in the schema. When the agent generates an effect, it is required (by the system prompt) to extract all parameter values into named constants and include those constants' names and file locations as `sourceHints` in the registration:

```ts
sourceHints: {
  distortion: { file: 'src/effects/liquid.ts', variable: 'DISTORTION_STRENGTH' },
}
```

With this hint, the agent's writeback task is trivial: open the specified file, find the variable, update its value. No search, no ambiguity.

Named constants also prevent the underlying problem: there is only one place the value exists in source. If the agent uses inline literals (`distortion: 0.8`), that `0.8` might appear in tests, stories, and documentation. Named constants have one canonical location.

**Remaining risk:** Source hints can become stale if the codebase is refactored (files renamed, constants moved). MotionWorks has no way to detect stale hints. The changeset will include the stale path; the agent will fail to find it and should report the failure. This is acceptable — stale hints produce a clear error rather than a silent wrong edit. The designer can re-register with updated hints after a refactor.

---

## Challenge 4: Framework and Library Agnosticism

**Root cause:** There is no standard API for "update this animation's parameters at runtime." CSS animations, Framer Motion, GSAP, react-spring, Three.js, custom WebGL — each has a completely different model. MotionWorks's manipulation surfaces are library-agnostic (they produce a `Record<string, unknown>` and call `update()`), but the `update()` function must be library-specific.

**What breaks:** If the library-specific `update()` pattern is wrong, either the preview doesn't work or it works but causes side effects (React state updates, new tweens, frame skips).

**Chosen mitigation:**

The `update()` function is the abstraction boundary. MotionWorks knows nothing about the library; the effect knows nothing about MotionWorks's manipulation model. This boundary is well-defined and testable.

The agent implements `update()` using the library-specific pattern from `RUNTIME_BRIDGE.md`. The system prompt specifies which pattern to use for which library. The only requirement on MotionWorks's side: `update()` must be called with the new param values, and the visual result must be visible on the next frame.

This architecture means adding support for a new library is entirely a matter of documenting the correct `update()` pattern — it requires no changes to MotionWorks's overlay or schema code.

**Remaining risk:** Exotic effects (e.g., a custom canvas simulation with its own physics engine) may not have a simple "mutate this property" path. The agent will need to implement a more complex `update()` — pausing the simulation, applying new params, and resuming. This is possible but requires the agent to understand MotionWorks's synchronous requirement. Include this case in the agent system prompt's examples over time.

---

## Challenge 5: Overlay Performance on Complex Pages

**Root cause:** The canvas layer redraws on every `requestAnimationFrame` when the overlay is active. On pages with many animated elements, tracking positions and rendering ghost frames can be expensive. The overlay must not slow down the product's own animations.

**What breaks:** The product feels sluggish while the overlay is active. The designer cannot accurately judge motion feel when the overlay degrades performance.

**Chosen mitigation:**

1. **Canvas redraw only when active and selected.** If no element is selected, the canvas is cleared and not redrawn. The `requestAnimationFrame` loop pauses when the overlay is inactive.

2. **Selective canvas layers.** Each surface type uses its own canvas layer (not one giant canvas). The ghost-frames canvas only redraws when the selected element is animating. The radius canvas only redraws when dragging.

3. **Bounded position history.** The temporal-decay surface records a maximum of 120 historical positions (~2 seconds at 60fps) per element. Older positions are discarded. This caps memory and redraw cost.

4. **One element selected at a time.** Only the selected element's surfaces are rendered. Multi-element scenarios are post-MVP.

5. **No overlay rendering in production builds.** The dynamic import guard means zero MotionWorks code runs in production — there is no performance penalty outside development.

**Remaining risk:** Canvas rendering for WebGL or Three.js effects (where the effect itself is a full-canvas render) may conflict with the MotionWorks canvas overlay. In these cases, MotionWorks should use a transparent overlay canvas on top rather than trying to introspect the effect's own canvas. The radius and handle surfaces (SVG layer) are unaffected; only the trail visualization (canvas layer) may have issues on full-canvas effects.

---

## Challenge 6: Multi-Agent Compatibility

**Root cause:** MCP is native to Claude Code but not to all agents. Codex (OpenAI API) has no MCP client. Custom agent setups may use their own protocols. MotionWorks cannot assume MCP is available.

**What breaks:** Without MCP, the agent has no push notification when changes arrive. It must remember to check for changes proactively, which it will sometimes forget.

**Chosen mitigation:**

The file-based fallback: `motionworks-state.json` written to the project root. The agent's system prompt instructs it to read this file at the start of any motion-related task. The file is always current — MotionWorks writes it on every state change.

This fallback is less reliable (pull rather than push, depends on the agent remembering) but is sufficient for cases where MCP is unavailable.

**Priority:** MCP (Claude Code) is the primary and supported integration for MVP. File-based is a documented escape hatch. Codex-native integration is post-MVP.

**Remaining risk:** Agents without system prompt customization (i.e., where the developer is using a fixed system prompt from a provider) cannot be instructed to use the file-based approach. In these cases, MotionWorks is effectively limited to read-only mode — the designer can manipulate but cannot commit changes automatically; they must apply values manually.

---

## Challenge 7: HMR State Preservation

**Root cause:** Hot Module Replacement unmounts and remounts React components when source files change. This fires `useMotionWorks` cleanup (unregistration) followed by re-registration with the new schema. Between these two events, MotionWorks's state is inconsistent — the selected effect no longer exists.

**What breaks:** The designer loses their selection, active manipulation state, and potentially uncommitted changes mid-session whenever the agent makes a source edit.

**Chosen mitigation:**

1. **`MotionWorksProvider` mounts independently of the application's React root.** HMR does not affect it.
2. **Selected effect ID is stored in `sessionStorage`**, which survives HMR. On re-registration, if the incoming effect ID matches the stored selection, selection is restored immediately.
3. **Uncommitted changes are stored in the Provider's state**, not in the registered effect's component state. They survive HMR because the Provider survives.
4. **Effect IDs are stable across HMR.** An effect ID is derived from the component's display name plus the `name` prop of the schema. Both are stable as long as the component is not renamed and the effect name doesn't change.

**Remaining risk:** If the agent changes a component's name or the effect's `name` string during an HMR cycle, the effect ID changes and the selection is lost. This is a rare case — agents refactoring component names while also adjusting motion parameters is unlikely. The designer loses their selection but not their uncommitted changes (changes are stored by effect ID; a warning is shown if the previously-selected ID is no longer found after HMR).

---

## Challenge 8: WebGL and Shader Effects

**Root cause:** Shader effects (Three.js materials, raw WebGL, GLSL) have parameters that are GPU-side. They are not inspectable from JavaScript without explicit wiring by the code author. MotionWorks cannot infer what a shader's uniforms are or what they mean.

**What breaks:** MotionWorks cannot present any manipulation surfaces for a shader effect unless the agent explicitly exposes the uniforms through the `useMotionWorks` schema and `update()` function.

**Chosen mitigation:**

Shader effects must wire their uniforms manually in the `update()` function. This is not optional — there is no fallback. The system prompt specifies the pattern (see `RUNTIME_BRIDGE.md`: Three.js and WebGL sections).

The agent must also know which uniforms are designer-adjustable (semantic parameters) versus internal (implementation details). The system prompt instructs the agent to only expose uniforms that the designer would meaningfully want to adjust — not internal step counters, resolution uniforms, or device-pixel-ratio adjustments.

**Remaining risk:** Highly complex shaders with dozens of uniforms that interact non-linearly may be difficult to expose meaningfully. In these cases, the agent should use judgment to expose only the 2–5 most perceptually significant uniforms. MotionWorks does not need to cover every shader parameter — it needs to cover the ones the designer would actually want to adjust.

---

## Challenge 9: Parameter Type Misassignment

**Root cause:** The agent decides which semantic type to assign to each parameter (e.g., `spatial-strength` vs. `scalar`). A wrong assignment means the wrong manipulation surface is shown. A `temporal-decay` value assigned as `scalar` renders as a drag handle instead of a visual trail.

**What breaks:** The designer gets a less useful surface. In the worst case (e.g., a `path` assigned as `scalar`), the surface is actively misleading.

**Chosen mitigation:**

1. **The type vocabulary is small and well-named.** The 11 types in `SCHEMA.md` cover essentially all motion parameter concepts. Clear names and examples in the system prompt make correct assignment likely.
2. **Validation produces console warnings for type/value mismatches.** If a `spatial-radius` receives a non-number value, MotionWorks logs a specific warning naming the param and type.
3. **The designer can override types.** Right-clicking a manipulation surface in the overlay exposes an "Edit parameter type" option. The designer can change the type, which updates the surface immediately. The correction is stored in MotionWorks state as a `typeCorrections` entry and is included in the response of both `motionworks_get_state` and `motionworks_get_changes`. The agent updates the `type` field in the `useMotionWorks` call in source, then calls `motionworks_clear_type_corrections`. Full protocol in `AGENT_INTEGRATION.md` → "Handling Type Corrections."

**Remaining risk:** If the agent consistently assigns the wrong type (a systemic pattern), the system prompt needs to be updated with clearer examples or explicit anti-examples ("do NOT use `scalar` for trail persistence — use `temporal-decay`"). Monitor for these patterns in practice.

---

## Challenge 10: Effects Without a Clear "Phenomenon"

**Root cause:** Some surface types require a visually identifiable phenomenon to render on — `temporal-decay` needs a trail, `gradient` needs something to put stops on. Some effects produce no such visible path (e.g., a color-only animation, an ambient blur, a textured overlay).

**What breaks:** The manipulation surface cannot render in its primary form. The designer sees a less intuitive fallback.

**Chosen mitigation:**

Each surface type has a defined fallback for when the phenomenon is not identifiable:

- `temporal-decay` without a moving element → show a horizontal time bar below the element; drag bar length.
- `gradient` without a path phenomenon → show a horizontal gradient swatch below the element; drag stops along it.
- `temporal-response` without visible follow behavior → show a before/after indicator with a gap slider.

These fallbacks are less good than the primary surface. They are not considered the acceptable default — they are emergency behavior. The agent should be coached (via the system prompt) to prefer effects that have clear spatial or temporal phenomena when possible.
