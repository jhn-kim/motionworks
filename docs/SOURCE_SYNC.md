# MotionWorks — Source Sync

> **Maintenance rule:** This file covers everything that happens after the designer clicks "Apply": how changes flow from MotionWorks to the coding agent, how the agent writes source, and how MotionWorks knows the write succeeded. Edit in place when the changeset format or the acknowledgment protocol changes. Do not append. Changes require product owner confirmation.

---

## Overview

MotionWorks operates in two distinct modes during a design session:

**Live preview mode** — parameter changes preview instantly via `update()`, with no source involvement. The designer is exploring.

**Commit mode** — the designer has settled on values and clicks "Apply." MotionWorks packages the uncommitted diff and hands it to the coding agent to write into source.

Source sync is a one-way push from MotionWorks to the agent. MotionWorks never reads, parses, or writes source files directly. The agent is always responsible for source edits.

---

## The Commit Flow

```
Designer clicks "Apply"
       ↓
MotionWorks packages the uncommitted diff as a Changeset
       ↓
Changeset is sent to motionworks (via WebSocket)
       ↓
Agent reads the changeset via motionworks_get_changes
       ↓
Agent locates each changed value in source using sourceHints
       ↓
Agent updates source values, writes files
       ↓
Agent calls motionworks_clear_changes
       ↓
HMR fires; component re-mounts with new baseline values
       ↓
useMotionWorks re-registers with updated values
       ↓
MotionWorks reconciles: uncommitted diff cleared if new baseline matches intent
```

---

## Changeset Format

```ts
interface Changeset {
  id: string;                          // UUID; used for acknowledgment
  timestamp: number;                   // Unix ms
  effectName: string;
  elementSelector: string;             // CSS selector or description for agent context
  changes: {
    [paramKey: string]: {
      from: unknown;                   // Baseline value (from last registration)
      to: unknown;                     // Designer's chosen value
    };
  };
  sourceHints?: {
    [paramKey: string]: {
      file: string;                    // Relative to project root
      variable?: string;              // Preferred: the named constant
      line?: number;                  // Fragile; use only if variable is unknown
    };
  };
}
```

**Example:**

```json
{
  "id": "cs-7f3a1b2c",
  "timestamp": 1720000000000,
  "effectName": "LiquidCursor",
  "elementSelector": "#hero-section > div.liquid-wrapper",
  "changes": {
    "radius": { "from": 120, "to": 165 },
    "trail":  { "from": 0.6, "to": 0.4  }
  },
  "sourceHints": {
    "radius": { "file": "src/effects/liquid.ts", "variable": "INFLUENCE_RADIUS" },
    "trail":  { "file": "src/effects/liquid.ts", "variable": "TRAIL_PERSISTENCE" }
  }
}
```

---

## Agent Writeback Rules

These rules govern how the agent must handle a changeset. They are included in the system prompt injected via the MCP resource `motionworks://instructions` (see `AGENT_INTEGRATION.md`).

**Rule 1: Apply only what is in the changeset.** Do not infer additional changes. Do not refactor. Do not rename variables. Change only the values listed in `changes`.

**Rule 2: Use sourceHints as the primary target.** If a `sourceHint` with a `variable` name is present, find that variable in the specified file and update its value. This is the most reliable path. Do not search the codebase for other occurrences.

**Rule 3: If no sourceHint is present**, use code understanding to find the most likely location for the value. Locate the `useMotionWorks` call for this effect, then trace the parameter's default value back to its definition. Update only the definition — not any intermediate variable or prop that happens to share the value.

**Rule 4: Do not change the `useMotionWorks` registration itself.** The `value` field in the schema is a default — it gets overridden by live manipulation. The agent updates the underlying constant, not the schema's `value` field (those will update automatically on the next re-registration via HMR).

**Rule 5: Acknowledge the changeset.** After successfully writing all changes, call `motionworks_clear_changes` via MCP. This tells MotionWorks the writeback is complete. If using the file-based fallback, set `pendingChanges` to an empty array in `motionworks-state.json`.

**Rule 6: If a change cannot be applied** (file not found, variable not found, ambiguous location), do not silently skip it. Report the specific failure in the chat response so the designer knows a value was not committed.

---

## HMR Reconciliation After Writeback

After the agent writes source, Vite/webpack HMR fires and the affected components remount. The `useMotionWorks` hook re-registers with the new source values as the baseline.

MotionWorks compares the new baseline to the uncommitted diff:

- If `new baseline value == changeset.to value` → the write succeeded. Clear the uncommitted diff for this param.
- If `new baseline value == changeset.from value` → the write did not take effect. Keep the uncommitted diff. Show the designer a warning.
- If `new baseline value` is some other value → the agent changed something unexpected. Flag it in the overlay.

This reconciliation happens automatically on every re-registration. The designer does not need to manually confirm the writeback succeeded.

---

## Multiple Pending Changesets

If the designer applies changes, then makes more changes before the agent commits, MotionWorks queues multiple changesets. The agent should apply them in order (oldest first). After applying each, call `motionworks_clear_changes` with the changeset's `id` to pop it from the queue.

The MCP tool `motionworks_get_changes` returns all queued changesets. The agent should loop over them, applying and acknowledging each.

```
agent calls motionworks_get_changes
→ returns [changeset-A, changeset-B]

agent applies changeset-A to source
agent calls motionworks_clear_changes({ id: 'changeset-A' })

agent applies changeset-B to source
agent calls motionworks_clear_changes({ id: 'changeset-B' })
```

---

## Source Location Stability

`sourceHints` with `line` numbers are fragile — any edit above the target line shifts it. Prefer `variable` names, which remain valid as long as the variable isn't renamed.

To maximize stability:

- Parameters should be defined as named constants at the top of the file or in a dedicated config file, not as inline literals
- Constants should have names that clearly identify their purpose (`TRAIL_PERSISTENCE`, not `t` or `val2`)
- Constants should not be duplicated — if multiple components share a value, it should live in one shared file, with one constant

The schema emission guide in `AGENT_INTEGRATION.md` enforces the named constant convention when the agent generates code. This is the primary mechanism for maintaining source location stability over time.

---

## When Source Hints Are Stale

Source hints become stale when the codebase is refactored — files renamed, constants moved to a different module, directories restructured — without the `useMotionWorks` registration being updated to match.

MotionWorks has no way to detect this proactively. Hints are strings stored in source; MotionWorks reads them from the running registration, not from the filesystem. The stale condition only surfaces when a writeback is attempted.

**What happens:** The agent receives a changeset with a stale `sourceHint` (e.g., `file: "src/effects/liquid.ts"` when the file is now `src/effects/liquidCursor/config.ts`). The agent opens the specified file, cannot find the named variable, and must report this failure explicitly in the chat response — naming the expected file, the variable it looked for, and the fact that the hint appears stale. Silent skipping is not acceptable (see Rule 6 in Agent Writeback Rules above).

**Recovery flow — this is an agent action, not automatic detection and not a designer action:**

1. Agent reports the stale hint failure in chat, naming the specific file and variable that could not be found.
2. Designer provides the correct location, or the agent searches the codebase for the constant by name.
3. Agent updates the `sourceHints` field in the `useMotionWorks` registration in source. This is a source edit — the hint field in the registration changes from the stale path to the correct one. The changeset's `from`/`to` values remain unchanged; only the lookup path is corrected.
4. HMR fires. The component re-registers with the corrected hint now in the running registration.
5. Agent retries the writeback. The changeset data is unchanged; MotionWorks resends it if it was not yet cleared. The agent applies it using the now-correct source location.

**Prevention:** Keeping parameter constants in a dedicated, stable config file (e.g., `src/motion-config.ts`) that is unlikely to move as the component tree evolves is the most reliable way to prevent stale hints. The schema emission guide recommends this practice.

---

## When There Are No Source Hints

If the agent generated the effect without source hints (e.g., an older version of the system prompt was used, or the agent skipped the hints), MotionWorks still sends the changeset — just without the `sourceHints` field.

In this case, the agent must reason about source location from the changeset's `effectName` and `elementSelector`. The most reliable heuristic:

1. Search for `useMotionWorks` calls in the codebase
2. Find the call where `name` matches `effectName`
3. Trace each changed param's `value` expression back to its declaration
4. Update the declaration

This is slower and less reliable than source hints. It is the fallback, not the normal path. If this situation occurs frequently, consider retroactively adding source hints to existing registrations.
