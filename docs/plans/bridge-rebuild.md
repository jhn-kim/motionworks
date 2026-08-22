# MotionWorks bridge rebuild — plan

> Hand-off document. After approval, step 0 copies this file to `docs/plans/bridge-rebuild.md` in the repo so any agent (Claude Code, Codex) can be pointed at it. Each slice is self-contained: give an agent **one slice**, the prompt in "How to hand a slice to an agent", and nothing else.
>
> **Precedence while the rebuild is in progress.** This plan supersedes `docs/*.md`, `MOTIONWORKS.md`, and the MotionWorks stanza in `CLAUDE.md`/`AGENTS.md` wherever they conflict. Within this plan, the "Decisions" sections outrank slice text. `docs/*.md` still govern anything this plan does not mention (overlay UI behaviour, manipulation surfaces, the parameter type vocabulary). Step 0 records this rule in `CLAUDE.md` and `AGENTS.md`; Slice 6 removes it once the docs are updated.

## Context

The bridge between the browser overlay, the `motionworks` Node process, and the coding agent is ~2,600 lines across three processes, most of it incidental: a primary/secondary port election (`packages/mcp/src/runner.ts`, `bridge-client.ts`, `backend.ts`), an RPC tunnel inside the overlay WebSocket protocol (`packages/core/src/server.ts`, `types.ts`), three retry layers, and an uncommitted regex source-editor (`packages/mcp/src/writeback.ts`). All state lives in process memory, so committed-but-unapplied changes die when Claude Code quits and uncommitted tweaks die on page reload. There is no plain-HTML path (ESM-only build, effect ids from React 19 internals in `packages/react/src/ids.ts`, `init` refuses non-React projects). MCP gives no push: Claude Code never starts a turn from an MCP server, so the designer always copy-pastes anyway.

**Decisions made by the owner (final):**
1. File-first. The journal file is the state. No MCP server. In-flight work parked on a branch.
2. Knobs live in CSS custom properties. Registration is schema-only; no `update()`, no `value`, no `sourceHints`.
3. Apply pipeline: save to journal → daemon writes the CSS declaration itself when it is unambiguous → otherwise spawn `claude -p` / `codex exec` automatically (default on when found) → last resort "Copy prompt" + `npx motionworks changes`.
4. Overlay ships as one `<script>` bundle that works on any page; the React hook stays as a thin convenience.
5. Overlay UI (~7k lines under `packages/react/src/overlay/`) is not rewritten; only its calls into `OverlaySession` change.
6. One published package, `motionworks`, after consolidation (see Slice 2b). `@motionworks/react` and `@motionworks/core` get deprecated, not deleted. Repo stays.

**Decisions taken by default (say so if you disagree):**
- Effect ids become `slug#n` (no React internals). Dragging a param also applies the live value to sibling elements with the same slug and equal baseline, so a list of cards still moves together like today.
- Designer type corrections ride along inside the next journal entry (`typeCorrections` field) rather than a separate file.
- Verification fixture: a committed plain-HTML page under `packages/motionworks/fixtures/plain-html/`. The local `examples/demo` stays gitignored and is converted by hand for manual checks.
- Journal stays in `.motionworks/` (gitignored by `init`).

## Target architecture

```
Browser overlay — motionworks.global.js (React bundled) or import('motionworks/react')
   │ fetch: POST /commit, POST /select, POST /ack, GET /pending, GET /status   (no WebSocket)
   ▼
motionworks daemon  (npx motionworks | npx motionworks serve <dir>)  127.0.0.1:52340
   • GET /motionworks.js serves the bundle
   • .motionworks/changes.json  = pending/applied entries (atomic writes, lock file)
   • .motionworks/selected.json = current selection
   • on commit: direct CSS write → auto-agent (claude -p / codex exec) → leave pending
   ▼
Agent: `npx motionworks changes` / `npx motionworks ack <id>` (or the daemon spawned it)
```

Browser-side: baseline read with `getComputedStyle(el).getPropertyValue('--mw-<key>')`; live preview via `el.style.setProperty`; effects subscribe to `motionworks:change` / `motionworks:replay` / `motionworks:scrub` CustomEvents; uncommitted diffs in `localStorage`; reconciliation (`diff-store.ts`) unchanged, plus auto-`/ack` when a new baseline equals a journal entry's `to`.

## Slice dependency map

```
0 → 1 → 2 → 2a (sweep) → 2b (consolidate) → ┬→ 3 (CSS contract + direct CSS write) ┐
                                             └→ 4 (bundle, serve, ids, init)        ┴→ 5 (auto-agent) → 6 (guide + docs + release) → final sweep
```
0–2b: one agent, main working tree (deletions touch every package). 3 and 4: may run in parallel, each in its own `git worktree`. 5 and 6: one agent each, after both merge. First shippable point: after 2b (behaviour identical for React users, old contract still accepted). Second: after 3+4.

## Playbook: running the rebuild with agents

**Bootstrap (this session, right after approval).** Step 0 is done here, not by a fresh agent, because a fresh agent cannot read the plan until it is in the repo. After Step 0 the repo contains `docs/plans/bridge-rebuild.md` and the "Active rebuild" block in `CLAUDE.md`/`AGENTS.md`, and every later prompt is uniform.

**Starting an agent.** Claude Code: run `claude` in the repo root (reads `CLAUDE.md`). Codex: run `codex` in the repo root (reads `AGENTS.md`). Paste the slice prompt below. Each slice gets a **fresh** agent session; do not carry one session across slices.

**After every slice, before moving on:**
1. Run `npm run build && npm run typecheck && npm test` yourself. All green or the slice is not done.
2. Read the agent's report. It must list what it changed and any doc lines it says need updating (save those; Slice 6 needs them).
3. `git add -A && git commit -m "Slice N: <one line>"` on `main` (or merge the worktree branch for Slices 3/4).
4. Run the slice's "Verify" commands from the plan at least once by hand. For Slices 2–5 that means opening a page and clicking Apply.

**Order and who can run in parallel:**

| Step | Agent | Where | Prompt |
|---|---|---|---|
| 0 | this session | main | (done here) |
| 1 | one agent | main | slice prompt, N=1 |
| 2 | one agent | main | slice prompt, N=2 |
| 2a | one agent | main | sweep prompt (Slice 2a section) |
| 2b | one agent | main | slice prompt, N=2b |
| 3 ∥ 4 | two agents (e.g. Claude on 3, Codex on 4) | worktrees: `git worktree add ../pinch-slice-3 -b slice-3` and `../pinch-slice-4 -b slice-4` | slice prompt, N=3 / N=4, run inside each worktree |
| merge | you | main | `git merge slice-3 && git merge slice-4`; if conflicts, use the conflict prompt below |
| 5 | one agent | main | slice prompt, N=5 |
| 6 | one agent | main | slice prompt, N=6; then confirm the doc proposals it reports and give the doc-write prompt |
| final | one agent | main | sweep prompt again, then the release commands in Slice 6 |

**Slice prompt (the only prompt you need for 1, 2, 2b, 3, 4, 5, 6):**

> Read `docs/plans/bridge-rebuild.md`. Implement **Slice N only**. Do not start other slices. Reuse the existing functions the plan names; do not re-implement them. Match the surrounding code style and test style (Vitest; temp dirs via `mkdtemp`, see `packages/mcp/src/init.test.ts`). Before finishing run `npm run build`, `npm run typecheck`, `npm test` and make them green. Do not edit anything under `docs/` or `MOTIONWORKS.md`; list needed doc changes in your report instead. If the plan is wrong or ambiguous, stop and report rather than improvising. End with a report: files created/modified/deleted, tests added, anything skipped and why, and doc lines that need updating.

**Conflict prompt (after merging 3 and 4, only if `git merge` reports conflicts):**

> `git status` shows merge conflicts between branches `slice-3` and `slice-4`. Read `docs/plans/bridge-rebuild.md` Slices 3 and 4. Resolve every conflict so that both slices' behaviour is preserved; do not drop either side's work. Then run `npm run build`, `npm run typecheck`, `npm test` green and report what you resolved.

**Stuck prompt (when an agent's report says the plan is wrong or it stopped):**

> The previous agent working on Slice N reported: "<paste the report>". Read `docs/plans/bridge-rebuild.md`. Decide whether the plan or the code is wrong, explain which in one paragraph, then finish Slice N. If the plan needs a change, append a short "Deviation" note at the end of the Slice N section in `docs/plans/bridge-rebuild.md` saying what you did differently and why (this is the one file under `docs/` you may edit).

**Cross-check prompt (optional, after any slice; good for having Claude review Codex's work or vice versa):**

> Read `docs/plans/bridge-rebuild.md` Slice N. Review the last commit on this branch against that slice: anything the slice asked for that is missing, anything changed that the slice did not ask for, tests that are weaker than specified, and behaviour regressions. Do not fix anything; report findings ordered by severity with file and line.

**Doc-write prompt (Slice 6, only after you have read and approved the agent's proposed doc changes):**

> The owner has approved the doc changes you proposed for Slice 6. Apply them to `docs/*.md` and `MANIPULATION_SURFACES.md` exactly as proposed, editing sections in place (each doc's maintenance rule says no appending). Then remove the "Active rebuild" block from `CLAUDE.md` and `AGENTS.md`, add the line "Completed in 0.5.0" at the top of `docs/plans/bridge-rebuild.md`, run `npm test`, and report.

## How to hand a slice to an agent

Prompt (Claude Code or Codex, unchanged):

> Read `docs/plans/bridge-rebuild.md`. Implement **Slice N only**. Do not start other slices. Reuse the existing functions the plan names; do not re-implement them. Match the surrounding code style and test style (Vitest; temp dirs via `mkdtemp`, see `packages/mcp/src/init.test.ts`). Before finishing run `npm run build`, `npm run typecheck`, `npm test` and make them green. Do not edit anything under `docs/` or `MOTIONWORKS.md`; list needed doc changes in your report instead. If the plan is wrong or ambiguous, stop and report rather than improvising.

For parallel slices: `git worktree add ../pinch-slice-3 -b slice-3` (and `-4`), run the agent inside that directory, merge back after tests pass.

---

## Slice 0 — Park in-flight work, reset main (owner, ~15 min)

```
git checkout -b wip/bridge-sharing-mcp && git add -A
git commit -m "WIP: park primary/secondary election, RPC, direct writeback"
git push -u origin wip/bridge-sharing-mcp && git checkout main
```
Then on main: copy this plan to `docs/plans/bridge-rebuild.md`; delete root `.mcp.json` (otherwise Claude Code keeps spawning the new daemon as a broken MCP server) and `motionworks-state.json`; change `.gitignore`'s `motionworks-state.json` line to `.motionworks/`.

Insert this block at the top of the "Rules" section in `CLAUDE.md`, and the same block in `AGENTS.md` (owner-approved here, so no separate confirmation needed):

```
## Active rebuild (remove in Slice 6)

The bridge is being rebuilt per `docs/plans/bridge-rebuild.md`. Where that plan conflicts
with `docs/*.md`, `MOTIONWORKS.md`, or the MotionWorks stanza below, **the plan wins**.
`docs/*.md` still govern anything the plan does not mention. Do not edit `docs/*.md` to
match the plan; list needed doc changes in your report instead. When assigned a slice,
implement that slice only.
```

Commit.

## Slice 1 — Journal + HTTP daemon + CLI (Node side; no overlay changes)

**Create**
- `packages/core/src/journal-types.ts` (browser-safe; export from `index.ts`): `JournalStatus = 'pending'|'agent-working'|'applied'`; `JournalChange { param, type, from, to, var?, fromCss?, toCss?, rule?: {selectorText, sheetHref, sourceFile?}, sourceHint? }` (`sourceHint` exists only until Slice 3); `JournalEntry { id, createdAt, origin, page, effectId, effectName, elementSelector, changes[], typeCorrections?, status, appliedAt?, appliedBy?: 'css'|'agent'|'cli', files?, error? }`; `CommitRequest`, `SelectRequest`, `StatusResponse`.
- `packages/mcp/src/journal.ts`: `readJournal(root)`, `appendEntry(root, entry)`, `updateEntry(root, id, patch)`, `ackEntries(root, ids|'all')`, `writeSelected`, `readSelected`, `withJournalLock(root, fn)`. Writes are temp-file + `rename`; every read-modify-write runs under an `open(lock,'wx')` lock (25 ms retry, 2 s max, stale after 5 s).
- `packages/mcp/src/cors.ts`: move `isAllowedOrigin` + `LOOPBACK_HOSTNAMES` out of `packages/core/src/server.ts`; add `applyCors(req,res)` (loopback origins only; preflight; no-Origin requests pass).
- `packages/mcp/src/config.ts`: `loadConfig(root, overrides, env)` → `{ port, agent: 'auto'|'claude'|'codex'|'off', agentTimeoutMs }`; precedence flag > env (`MOTIONWORKS_PORT`, reuse `parsePort` from `cli.ts`) > `motionworks.config.json` > defaults (52340, `auto`, 120000).
- `packages/mcp/src/daemon.ts`: `startDaemon({ projectRoot, port, staticDir?, agent?, overlayBundlePath? })` on `node:http`, bound to `127.0.0.1`. In this slice `staticDir` and `overlayBundlePath` are accepted and ignored (Slice 4 uses them), and `agent` is typed as an optional `{ run(entry: JournalEntry): Promise<{ ok: boolean }> }` that this slice never calls (Slice 5 implements it); `config.agent` is parsed and echoed in `/status` but otherwise unused. On start, prune `applied` entries older than 7 days (see "Gaps closed" 3). Routes: `GET /status`, `GET /pending` (entries whose `origin` equals the request's `Origin` header; no Origin → all; `?all=1`), `POST /select`, `POST /commit` (validate body with hand-written guards, read `Origin` from the header never the body, `appendEntry`), `POST /ack` (`{id}` or `{ids}`), `GET /motionworks.js` (404 with a hint until Slice 4), `OPTIONS`. 1 MB body limit. No in-memory state. `EADDRINUSE` rejects untouched.
- `packages/mcp/src/commands.ts`: `formatChanges(entries, 'agent'|'brief'|'json')` (pure), `runAck(root, id|'all', port)` (POST to the daemon first; on `ECONNREFUSED` edit the file under the lock), `formatStatus(root, port)` (daemon status plus the current selection from `selected.json`, see "Gaps closed" 4). No `revert` in this slice.
- `packages/mcp/src/cli.ts` rewrite: `motionworks` (daemon; on `EADDRINUSE` probe `/status` → "already running on 127.0.0.1:52340, use that one or set MOTIONWORKS_PORT", exit 1), `changes [--json|--brief]`, `ack <id>|--all`, `status`, `serve <dir>` (Slice 4), `init`, `help`, `--version`; flags `--port`, `--agent=`, `--no-agent`. Keep `checkDrift` at startup.

**Delete:** `packages/mcp/src/{runner,mcp-server,state-file,backend,bridge-client,writeback}.ts` and their tests (`mcp.test.ts`, `bridge-sharing.test.ts`, `bridge-hygiene.test.ts`, `writeback.test.ts`, `state-file.test.ts`); `packages/core/src/server.ts` + `server.test.ts`. Remove `@modelcontextprotocol/sdk`, `ws`, `@types/ws`, `zod` from `packages/mcp/package.json`; remove `ws` and the `./server` export from `packages/core`; `npm install` to refresh the lockfile. The overlay's `ws-client.ts` stays until Slice 2 (it reconnects forever against nothing; indicator shows red).

**Tests:** `journal.test.ts` (atomic, no `*.tmp` left; concurrent appends both land; ack order; stale lock reclaimed; malformed JSON error), `daemon.test.ts` (`port: 0` + global `fetch`: commit→201 with origin recorded; pending filtered by Origin; ack; preflight 204; `Origin: https://evil.example` → 403; bad JSON 400; oversize 413; second daemon on same port rejects `EADDRINUSE`), `cors.test.ts` (port the three cases from `server.test.ts`), `commands.test.ts` (golden strings; ack file fallback), `config.test.ts` (precedence).

**Verify:** `npm run build && npm test && npm run typecheck`; `npx motionworks &`; `curl /status`; `curl -X POST -H 'Origin: http://localhost:3000' … /commit`; `npx motionworks changes`; `npx motionworks ack --all`; second `npx motionworks` → "already running".

## Slice 2 — Overlay transport swap + deletions (old contract still works)

Invariant: a React app using today's `useMotionWorks(ref, {params:{k:{type,value}}, update, sourceHints})` still selects, previews, applies, and reconciles on HMR. Only the transport changes.

**Create** `packages/react/src/overlay/daemon-client.ts` (replaces `ws-client.ts`): `DaemonClient { start, stop, onStatus(cb), onPending(cb), select(req), commit(req) → {id}|null, ack(id), refresh() }`. Polls `/pending` every 1.5 s while the toolkit is open, `/status` every 5 s for the launcher; backoff 1→10 s offline; `fetch(..., {mode:'cors', credentials:'omit', cache:'no-store'})`. No per-frame `change` traffic at all.

**Modify**
- `packages/react/src/overlay/session.ts`: `ws` → `daemon`; constructor `({ daemonUrl, debug })`. `selectEffect` → `daemon.select`. `commit` → `CommitRequest` from `diffs.getDiff` (+ `sourceHints` filtered to changed params, old contract) → `daemon.commit`. `pendingCommits` is now derived from polled entries: `isCommitPending` = entry for that effect with status `pending`/`agent-working`; `getAgentQueue` = entries with status `pending`; `buildAgentPrompt()` = "Run `npx motionworks changes` and apply them, then `npx motionworks ack <id>`." with ids listed. In `reconcileEffect`, after `diffs.reconcile`: when every changed param of a journal entry is `clean` → `daemon.ack(entry.id)` (decision 9). Drop the register-replay in `handleConnectionChange`. `correctType` stores in `typeOverrides` only; corrections are attached to the next `commit` as `typeCorrections`.
- `packages/react/src/overlay/diff-store.ts`: add `toJSON()` / `hydrate(data)`. New `overlay/diff-persistence.ts`: `loadPersistedDiffs(origin)` / `persistDiffs(origin, data)` (debounced 100 ms, key `motionworks:diffs:<origin>`, try/catch around `localStorage`). Session hydrates on `start()`; first registration reconciles exactly like HMR, so a reload re-applies `to` through `update()`.
- `packages/react/src/overlay/hooks.ts`: `useConnection` fed by `onStatus`; `usePendingCommit`/`useAgentQueue` keep signatures; add `useEntryStatus(effectId)`.
- `packages/react/src/overlay/renderer.tsx` + `provider.tsx`: `daemonUrl?` prop (default `http://127.0.0.1:<port>`); hint text "Start it with `npx motionworks` in your project root". Nothing else in UI files.
- `packages/react/src/bridge.ts`: `attach(state)` without the sender; bump `BRIDGE_SHAPE_VERSION` to 4.
- `packages/core/src/state.ts`: delete `commitEffect`, `clearChangeset`, type-correction methods, `changesets`/`typeCorrections` from the snapshot. `packages/core/src/types.ts`: delete `UpstreamMessage`, `DownstreamMessage`, `BridgeRpcMethod`, `MotionWorksChangeset`.
- Delete `ws-client.ts`, `ws-client.test.ts`.

**Tests:** `daemon-client.test.ts` (stubbed fetch + fake timers: polling, backoff, status flips, commit/ack payloads), `session.test.ts` (fetch stub replaces `FakeWebSocket`; commit posts filtered `sourceHints`; pending entry → `isCommitPending`; baseline == `to` → `/ack` posted; diffs persist and hydrate), `state.test.ts` (drop changeset describes), `hook.test.tsx` (`bridge.attach(state)`; assert via `state.getAllEffects()`), `diff-store.test.ts` (round trip).

**Verify (manual, local demo):** `npx motionworks` + `npm run dev -w examples/demo`; drag, Apply → entry with `sourceHints` in `.motionworks/changes.json`; hand-off notice shows; edit `examples/demo/src/motion-config.ts` by hand → HMR → overlay reconciles clean → `/ack` → file empties. Reload mid-drag → tweak restored.

## Slice 2a — Hygiene sweep #1 (single agent, main tree)

Prompt to give the agent, verbatim:

> Read `docs/plans/bridge-rebuild.md`, section "Slice 2a". Do a dead-code and dependency sweep of this monorepo. Do not change behavior, add features, or refactor working code.
> 1. Run `npx knip` at the workspace root (do not add it to package.json). Also run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p .` in each package.
> 2. For every unused file, export, or dependency reported: confirm with a grep that nothing imports it (including tests and `docs/`), then delete it. In `packages/mcp/package.json` specifically check `ws`, `@types/ws`, `@modelcontextprotocol/sdk`, `zod`; in `packages/core/package.json` check the `./server` export. Check `computeUncommittedDiff` in `packages/core/src/state.ts`, `getSelector`, `ParamDiff`, and the provider `port`/`debug` props.
> 3. Delete tests whose only subject was deleted. Do not delete tests for code that still exists.
> 4. Remove stale references in non-doc files: help text in `packages/mcp/src/cli.ts`, comments describing the old WebSocket/MCP/election flow, the `TOOL_NUDGE` constant.
> 5. Do not edit anything under `docs/` or `MOTIONWORKS.md`. List every doc line that references a deleted symbol or flow in your final report.
> 6. "Unused" means no importer; it does not mean "looks idle". `validate.ts`, `diff-store.ts`, `type-overrides.ts`, `auto-detect.ts` stay. If unsure, leave it and list it.
> 7. Finish with `npm run build`, `npm run typecheck`, `npm test` green, then report: deletions (files, exports, deps), line count before/after (`wc -l` over `packages/*/src/**/*.ts{,x}`), and the doc references from step 5.

## Slice 2b — Consolidate into one package (single agent, main tree)

Move `packages/core`, `packages/react`, `packages/mcp` into `packages/motionworks/` with `src/shared/` (types, validate, state, journal-types, later css-values), `src/browser/` (hook, bridge, ids, overlay/*, later css-bindings + standalone), `src/node/` (cli, daemon, journal, cors, config, commands, init, setup, claude-md, instructions, drift, ui, version, later css-write/agent/static-serve). One `package.json` named `motionworks` at version `0.5.0`: `bin` → node cli; exports `.` (shared types), `./react` (hook + provider, ESM, `"use client"` banner), `./browser` (framework-free helpers), `./motionworks.global.js` (Slice 4). `react`/`react-dom` as **optional** peer dependencies. One `tsup.config.ts` exporting an array: node ESM entries (`platform:'node'`, `target:'node18'`), browser ESM entries (`platform:'browser'`, externals react/react-dom), IIFE entry added in Slice 4. Root `package.json` workspaces/build scripts collapse to the single package; TS project references collapse to one `tsconfig`. Tests move with their modules; import paths updated. Old packages are not removed from npm; after the 0.5.0 release run `npm deprecate @motionworks/react@"*" "Merged into motionworks"` and the same for `@motionworks/core` (Slice 6).

**Verify:** `npm run build && npm test && npm run typecheck`; `npm pack --dry-run` lists `dist/` only; `node dist/cli.js --version` prints 0.5.0.

## Slice 3 — CSS-variables contract + direct CSS write

**Create**
- `src/shared/css-values.ts` (lift `parseEasing`/`KEYWORD_CURVES` from `overlay/auto-detect.ts`): `decodeCssValue(type, css) → {value, unit}|null`, `encodeCssValue(type, value, unit)`, `defaultUnitFor(type, schemaUnit?)`, `cssValuesEqual(type, a, b)`, `formatNumber(n)` (≤4 dp). Grammar per type: numeric → `<number><unit?>` (`s`↔`ms` normalised; `rem/em/vw/%` → null → param unbound with a console warning); `easing-curve` → `cubic-bezier(x1,y1,x2,y2)` (+ keywords); `spring-response` → `<stiffness> <damping> [mass]` or one number; `gradient` → `<color> <stop%>, …` (split at paren depth 0); `path` → `path("M … C …")` (M/L/C only). The unit **seen in CSS** is preserved on encode (unitless stays unitless).
- `src/browser/css-bindings.ts` (public): `DEFAULT_VAR_PREFIX='--mw-'`, `varNameFor(key, spec)`, `readParams(el, params)`, `readParam(el, key, spec)`, `onParamsChange(el, cb)`, `EVENTS = { change:'motionworks:change', replay:'motionworks:replay', scrub:'motionworks:scrub' }`.
- `src/browser/overlay/css-apply.ts`: `readBaseline(node, key, spec) → {value, binding:{var, unit, inlineBefore, bound}}`, `applyLive(node, spec, binding, value)` (setProperty + dispatch `motionworks:change`, bubbles; never dispatch on restore/reads), `restoreLive`, `findDeclaringRule(node, varName)` (walk `document.styleSheets`, skip sheets whose `cssRules` throws, recurse `@media/@supports/@layer`, match `node.closest(rule.selectorText)`, take the last match; `sourceFile` from `ownerNode.dataset.viteDevId`), `watchStylesheets(cb)` (MutationObserver on head/body + `load` on links).
- `src/browser/overlay/dom-registration.ts`: `parseDomSchema(el)` for `data-motionworks='{json}'`, `parseScriptSchemas(doc)` for `<script type="application/motionworks+json">{ "<selector>": {schema} }</script>`, `startDomRegistration()` (initial scan + MutationObserver; registers through `getBridge()`), started next to `startAutoDetect()` in the overlay shell.
- `src/node/css-write.ts`: `applyCssChanges(projectRoot, entry) → {kind:'applied', files}|{kind:'skipped', reason}` (all-or-nothing); `listCssFiles(root)` (`*.css|scss|less|module.css`; skip `node_modules .git dist build out .next coverage .motionworks`); `findDeclarations(source, varName)` (comment/string-aware; returns value span + enclosing selector). Policy: candidate = same var and `cssValuesEqual(fromCss)`; narrow by `rule.sourceFile`, then `rule.selectorText`; exactly one candidate across the project required; path must stay inside root (reuse the `relative(...).startsWith('..')` guard pattern); replace only the value text. `animation` shorthand never matches → skipped.

**Modify**
- `src/shared/types.ts`: `MotionWorksParam = { type, label?, min?, max?, unit?, var? }`; `MotionWorksRegistration = { name, params, capabilities? }`; runtime `MotionWorksEffect.params[k]` adds `{ value, var, cssUnit, bound }` (UI files keep reading `param.value`, so they do not change); drop `readOnly`, `SourceHint`, `JournalChange.sourceHint`.
- `src/shared/validate.ts`: rule 3 → `var` must start with `--` or be one of `animation-duration|animation-delay|animation-timing-function`, else warn and fall back to `--mw-<key>`; rule 4 (readOnly) removed; a registration still carrying `value`/`update` warns once: "MotionWorks 0.5 reads values from CSS custom properties; see MOTIONWORKS.md".
- `src/shared/state.ts`: `registerEffect(id, registration, baseline)`; `applyParamChange` updates `liveValues` only.
- `src/browser/hook.ts`: `useMotionWorks(ref, schema)`; fingerprint = name + keys + type + var. `src/browser/bridge.ts`: instances are `{node}` only; `register` calls `readBaseline` per param; sibling application helper for `manipulate`; shape version 5.
- `src/browser/overlay/session.ts`: `manipulate` → record diff + `applyLive` on the selected node and on same-slug siblings with equal baseline; `discard`/`holdBaseline` → `applyLive(from)`/`restoreLive`; `sendReserved(effectId|null, 'replay'|'scrub', detail)` dispatches the event; `commit` fills `var`, `fromCss`, `toCss`, `rule` per change; `start()` installs `watchStylesheets(() => this.refreshBaselines())` (restore → re-read → re-register → reconcile, synchronously); when a polled entry turns `applied`, bump `?mw=<ts>` on the matching `<link>` href to force a reload where there is no HMR.
- `overlay/scrubber.tsx` (3 lines) and the replay verb in `renderer.tsx`: call `session.sendReserved(...)`. `overlay/theme.ts` `RESERVED_KEYS` → event names.
- `overlay/auto-detect.ts`: schema-only registration with `var: 'animation-duration'|'animation-delay'|'animation-timing-function'`; baseline from `getComputedStyle` comma lists indexed by the animation's position; live preview still via `KeyframeEffect.updateTiming` (special-cased in `applyLive` for non-`--` vars, keyframe effects kept in a `WeakMap`).
- `src/node/daemon.ts` `POST /commit`: after `appendEntry` → `applyCssChanges`; applied → `updateEntry(status:'applied', appliedBy:'css', files)`; skipped → stays `pending` with `error: reason` (Slice 5 inserts the agent here).
- `src/browser/index.ts` (`motionworks/browser`) exports `readParams`, `readParam`, `onParamsChange`, `EVENTS`, `varNameFor`; `motionworks/react` re-exports them plus the hook/provider.
- `src/node/commands.ts` + `cli.ts`: add `motionworks revert <id>` — for an `applied` entry, swap each change's `from`/`to` and run it through `applyCssChanges`; on success remove the entry; on skip print the reason. (Moved here from the "Gaps closed" list because it depends on `applyCssChanges`.)

**Tests:** `commands.test.ts` (revert applies the inverse and removes the entry; unknown id errors), `css-values.test.ts` (table-driven per type; unit preservation; `rem` → null; `0.3s` vs `300ms` equal; `formatNumber`), `validate.test.ts` (new rules), `css-apply.test.ts` (jsdom: baseline from stylesheet/inline/absent; event detail; restore; `findDeclaringRule` last-match, ancestor `:root`, `@media`, throwing sheet skipped, `data-vite-dev-id`), `dom-registration.test.ts`, `css-bindings.test.ts`, `session.test.ts` rewritten around a `<style>.card{--mw-radius:100px}</style>` fixture (manipulate sets inline var; discard restores; sheet swap to `160px` → clean + `/ack`; to `100px` → preserved + re-applied; replay event), `hook.test.tsx`, `css-write.test.ts` (unique replace preserving whitespace/comments; two candidates → skipped; `from` mismatch → skipped; `sourceFile` narrows; nested `@media`; shorthand → skipped; outside root → skipped; all-or-nothing), `daemon.test.ts` (commit against a tmp `.css` → `applied` and file changed).

**Verify (manual):** convert `examples/demo` (`MagneticButton` reads `--mw-radius/--mw-strength/--mw-response` via `readParams` + `onParamsChange`; `CardGrid` listens for `motionworks:replay`; vars declared in `examples/demo/src/motion.css`). Drag → inline var + effect reacts → Apply → daemon edits `motion.css` → Vite swaps the style → `watchStylesheets` → baseline == `to` → auto-ack → journal empty. Then declare the var in a second file on purpose → hand-off notice.

## Slice 4 — Standalone bundle, `serve`, ids, non-React `init`

- `src/browser/standalone.ts`: exports `mount({daemonUrl?, debug?})` and the `css-bindings` helpers; side effect: auto-mount on `DOMContentLoaded` unless `document.currentScript.dataset.autoMount === 'false'`, with `daemonUrl = new URL(currentScript.src).origin`. Imports `OverlayRenderer` directly (no dynamic import).
- `tsup.config.ts`: add the IIFE config `{ entry: {'motionworks.global': 'src/browser/standalone.ts'}, format:['iife'], globalName:'MotionWorks', platform:'browser', target:'es2020', noExternal:[/.*/], define:{'process.env.NODE_ENV':'"development"'}, minify:true, sourcemap:true, dts:false, clean:false, outExtension: () => ({js:'.js'}) }`. Package export `./motionworks.global.js`.
- `src/node/overlay-asset.ts`: `resolveOverlayBundle(projectRoot)` → project-local `motionworks/motionworks.global.js` via `createRequire` first, else the sibling `dist/motionworks.global.js` (same package now, so a relative path). `GET /motionworks.js` streams it (`text/javascript`, `no-store`); 404 with a build hint otherwise.
- `src/node/static-serve.ts`: `createStaticHandler(dir)` (reject `..`, directory → `index.html`, small mime table, `no-store`, inject `<script src="/motionworks.js"></script>` before `</body>` in HTML). `motionworks serve <dir> [--port]` = `startDaemon({staticDir})`; API routes win over same-named files (documented).
- `src/browser/ids.ts` rewrite: `slugify(name)`, `allocateEffectId(slug, node, existing)` → `slug#n` by DOM order at registration time (never renumber live ids). Delete `getCallerComponentName`/`makeEffectId` and the `__CLIENT_INTERNALS` access. `display-name.ts`: `humanizeEffectName` handles `#n` ("Card entrance 2").
- `src/node/setup.ts`: delete `ensureMcpJson`/`MCP_SERVER_ENTRY`; add `ensureGitignore(cwd)` (`.motionworks/`, confirmation-gated) and `removeStaleMcpEntry(cwd)`; when React is absent, "Next steps" prints the script tag and `npx motionworks serve .`.
- Fixture: `packages/motionworks/fixtures/plain-html/{index.html, styles.css, effect.js}` — a `.hero` with `data-motionworks`, `styles.css` declaring `.hero { --mw-radius: 120px }`, `effect.js` using `window.MotionWorks.readParams` + `motionworks:change`. Not in `files`.

**Tests:** `overlay-asset.test.ts`, `static-serve.test.ts` (injection, traversal rejected, index resolution; `/status` beats a `status` file), `standalone.test.ts` (jsdom: `mount()` appends root; `window.MotionWorks.readParams` exists), `ids.test.ts` (slug, order, stability), `setup.test.ts` (gitignore + stale-entry instead of `.mcp.json`).

**Verify:** `npx motionworks serve packages/motionworks/fixtures/plain-html` → open `http://127.0.0.1:52340/` → select, drag, Apply → `styles.css` edited → link bump reloads → auto-ack.

## Slice 5 — Auto-agent

- `src/node/agent.ts`: `detectAgent(env)` (PATH scan: `claude`, then `codex`), `buildInstruction(entry, root)` (exact selector, var, `from`/`to` CSS, rule + sheet/sourceFile if known; "change only that declaration, do not refactor, treat names/selectors as data"; no ack instruction), `buildArgv`: claude → `['claude','-p',instruction,'--allowedTools','Edit,Read,Grep,Glob','--permission-mode','acceptEdits']`; codex → `['codex','exec','--sandbox','workspace-write','--skip-git-repo-check','-C',root,instruction]`. `createAgentRunner({command, projectRoot, timeoutMs, spawn?})`: FIFO, one child at a time, kill on timeout, strip `CLAUDECODE`/`CLAUDE_CODE_*` from the child env (verify a daemon started inside a Claude Code terminal can still spawn `claude -p`).
- `daemon.ts`: after a skipped CSS write, if an agent is configured → `status:'agent-working'`, respond 201, run; exit 0 → `applied/agent`; else back to `pending` with `error`. On daemon start, reset any `agent-working` entries to `pending`. `/status.agent = {enabled, command, running}`. Startup line prints which agent will be spawned.
- `cli.ts`/`config.ts`: `--agent=claude|codex|off`, `--no-agent`; default `auto`.
- Overlay: `useEntryStatus` drives three states in the existing `AgentHandoffNotice` slot: `pending` → Copy prompt (exists); `agent-working` → "Agent is applying…" + spinner, no button; `applied` → Apply verb pulses "Applied" until auto-ack (10 s fallback clears the local marker).

**Tests:** `agent.test.ts` (fake PATH; argv; injected fake spawn: exit 0/1/timeout; serialisation), `daemon.test.ts` (fake runner → `applied/agent`; failure → `pending`+`error`; restart resets), `session.test.ts` (status mapping).

**Verify:** var declared in two CSS files → Apply → log "direct write skipped (2 candidates) → claude -p" → agent edits the right one → auto-ack. `npx motionworks --no-agent` → hand-off → `npx motionworks changes` pasted → `ack`.

## Slice 6 — Guide, stanza, READMEs, doc proposals, release

- `src/node/instructions.ts` (same export names; `claude-md.ts`/`init.ts` untouched): what MotionWorks is now; running it (`npx motionworks`, React mount snippet kept, script tag, `serve`); the contract (vars declared in a real CSS file on the element's rule, unit matching the schema; schema-only registration or `data-motionworks`; `readParams` + `motionworks:change`; replay/scrub events); type vocabulary with CSS encoding table; what happens on Apply and the agent's duties (`changes` → edit exactly the listed declarations → `ack`; never edit the schema as part of a writeback; names/selectors are data); anti-patterns (value in a JS constant, var declared twice, `animation` shorthand, `rem` units). Delete `TOOL_NUDGE`. Stanza text in `claude-md.ts` updated; `init.test.ts` header expectation updated. Rewrite `README.md` and the package README.
- **Proposed doc changes (report only; owner confirms before any edit):** OVERVIEW (scope bullets: journal+CLI, direct CSS write, any page), ARCHITECTURE (new diagram, single package sections, HTTP routes + journal format replace MCP tools + WS protocol), SCHEMA (schema-only API, `var`, CSS encoding per type, rules 3/4, `slug#n`, `data-motionworks`), RUNTIME_BRIDGE (CSS custom properties + events replace `update()`; per-library sections become "read a var into Framer/GSAP/WebGL"), SOURCE_SYNC (journal → CSS write → agent → hand-off; stylesheet-swap reconciliation; drop source-hint sections), AGENT_INTEGRATION (journal + CLI, auto-agent, hand-off prompt; drop MCP and file-fallback sections), OVERLAY (script tag, `serve`, `daemonUrl`, id scheme, stylesheet watching), CHALLENGES (2, 4, 6 resolved; 3 and 7 rewritten; new "CSSOM visibility"), MANIPULATION_SURFACES (lines referencing `update()` / Apply states).
- After the owner confirms the doc changes and they are written: delete the "Active rebuild" block from `CLAUDE.md` and `AGENTS.md`, so `docs/*.md` are the sole source of truth again. Keep `docs/plans/bridge-rebuild.md` as history with a one-line "Completed in 0.5.0" note at the top.
- Release: publish `motionworks@0.5.0`; `npm deprecate @motionworks/react@"*" "Merged into motionworks"` and same for `@motionworks/core`; push; tag.
- Final hygiene sweep: rerun the Slice 2a prompt.

## Gaps closed on final review (small additions to the slices above)

1. **Type-correction-only commits** (Slice 2): `correctType` must be committable even when no value changed, otherwise a correction with no accompanying drag is stranded. `commit()` sends an entry with empty `changes` and non-empty `typeCorrections`; `formatChanges` prints them; the CSS-write step skips such entries and the agent step handles them.
2. **Any localhost page can POST to the daemon** (Slices 3 and 5): CORS blocks non-loopback origins, but another dev server on localhost could submit a commit that triggers a direct write or an agent run. Mitigations: the daemon rejects commits whose `changes[].var` is not `--mw-*` or one of the three animation properties; the agent is spawned without Bash (`--allowedTools Edit,Read,Grep,Glob` already) and with an instruction limited to named CSS declarations; `motionworks.config.json` may set `"token"`, which `serve` injects into the script tag (`/motionworks.js?token=…`) and the React mount passes via `daemonUrl`, and when set the daemon requires it on every POST. Documented as a known limitation in CHALLENGES.
3. **Journal retention and undo** (prune in Slice 1; `revert` in Slice 3): `applied` entries are auto-acked only when an overlay sees them land; with no page open they would linger. Slice 1: on daemon start prune `applied` entries older than 7 days. Slice 3 (after `applyCssChanges` exists): add `npx motionworks revert <id>` that re-applies `from` through the same `applyCssChanges` path (applied entries keep `from`/`to`, so this is ~20 lines) — the overlay's "Discard" stays local; `revert` is the post-apply undo without reaching for git. Slice 1 must not implement `revert`.
4. **"This element" conversations** (Slice 1 and 6): `npx motionworks status` prints the current selection from `.motionworks/selected.json` (effect name, selector, current values), and the guide tells the agent to read it when the designer says "this one". This replaces today's `motionworks_get_selected`.

## Risks to watch (from design review)

1. Journal read-modify-write: lock file + daemon-first ack covers it; hand-edits to `changes.json` while the daemon writes are unprotected.
2. CSSOM blind spots: cross-origin sheets, constructed sheets, CSS-in-JS, Tailwind arbitrary properties → rule unknown → var+value uniqueness or agent. CSS Modules hash selectors → rely on var+value.
3. Stylesheet swap detection differs per server (Vite replaces `<style>`, Next swaps `<link>`, `serve` has no HMR → link bump is the only trigger). Test all three.
4. Units: only the unit seen in CSS is trusted; `rem/em/vw` leave the param unbound with a warning.
5. Auto-agent: `claude -p --permission-mode acceptEdits` can edit any file in the root; the instruction constrains, nothing enforces. Nested-Claude env stripping needs an empirical check. Codex flags verified on 0.145.0.
6. Legacy `.mcp.json` entries in user projects make Claude Code spawn the daemon as a failed MCP server; `init` removes them and the daemon should print a migration line if it sees an MCP `initialize` message on stdin.
7. `animation` shorthand is the common authoring form for auto-detected animations; direct write usually skips → agent.

## Verification summary (end to end, after Slice 6)

1. `npm run build && npm run typecheck && npm test` green; `npm pack --dry-run` clean.
2. Plain HTML: `npx motionworks serve packages/motionworks/fixtures/plain-html` → tweak → Apply → `styles.css` changes without any agent → reload → no pending entries.
3. React (local demo): ambiguous var → Apply → daemon spawns `claude -p` → file edited → HMR → auto-ack. With `--no-agent` → Copy prompt → `npx motionworks changes` in Claude Code → `ack`.
4. Restart safety: Apply with the daemon stopped → Apply disabled and red dot; start daemon → Apply → kill daemon → `cat .motionworks/changes.json` still has the entry → restart → `npx motionworks changes` shows it.
5. Reload safety: drag, reload page, tweak restored from `localStorage`.
