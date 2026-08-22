# MotionWorks — Challenges and Mitigations

> **Maintenance rule:** When a challenge is resolved — a mitigation shipped, a constraint lifted — move it to a "Resolved" section at the bottom with a note on what solved it. Do not delete challenges that were real; they may recur. New challenges should be added in place (keep the list ordered: hardest/most systemic first). Changes require product owner confirmation.

---

## Challenge 1: Agent Instrumentation Reliability

**Root cause:** Coding agents are probabilistic. They may omit the MotionWorks schema, keep values in JavaScript, choose the wrong semantic type, or create CSS that cannot be decoded or written safely.

**What breaks:** The element is invisible to MotionWorks, the parameter is unbound, or Apply always requires handoff.

**Chosen mitigation:**

1. `npx motionworks init` writes a versioned `MOTIONWORKS.md` from the package's canonical guide and a short reference stanza into the project's agent instruction files.
2. The stanza tells agents to read the guide, check `npx motionworks changes` before motion-value edits, and use `status` for “this one” context.
3. Registration validation warns about legacy `value`/`update`, unknown types, invalid `var`, and invalid bounds instead of silently rejecting the whole effect.
4. Binding warns when CSS is absent, malformed, or uses an unsupported relative unit.
5. CSS keyframe animation auto-detection provides useful coverage when no explicit schema exists.

**Remaining risk:** An agent can still ignore its instructions or omit explicit registration for a JavaScript-driven effect. Framer Motion, GSAP, react-spring, WebGL, and custom loops cannot be inferred reliably; generated code still needs the schema and CSS bridge.

---

## Challenge 3: Source Writeback Precision

**Root cause:** The daemon must update exactly one canonical source declaration. A custom property may appear in multiple selectors, files, themes, tests, or generated output.

**What breaks:** A guessed edit could change the wrong surface or several unrelated effects.

**Chosen mitigation:**

1. Adjustable values use uniquely declared `--mw-*` properties rather than common numeric literals or JavaScript constants.
2. Commits carry the exact property, semantic type, `fromCss`, `toCss`, selector, stylesheet URL, and developer-server source file when visible.
3. Direct write is comment/string-aware, narrows by source file and selector, requires exactly one candidate, and resolves every change before writing any file.
4. A skipped direct write never guesses. It moves to a narrowly instructed auto-agent or remains pending for inspected manual handoff.
5. Paths are constrained to the project root; values, names, paths, and selectors are treated as data.

**Remaining risk:** The auto-agent instruction is a behavioral constraint, not an enforcement layer. A workspace-edit-capable agent can still make a broader change. Operators can use `--no-agent` when they prefer manual review.

---

## Challenge 11: CSSOM Visibility and Source Mapping

**Root cause:** The browser can compute a property even when it cannot expose the rule or map it to a source file. Cross-origin stylesheets throw on `cssRules`; constructed stylesheets, CSS-in-JS, Tailwind-generated output, and some CSS Module pipelines hide or transform authoring locations.

**What breaks:** The commit has a correct property/value but incomplete rule or source-file context, reducing direct-write precision.

**Chosen mitigation:**

- `findDeclaringRule` walks readable stylesheets and nested grouping rules, skips inaccessible sheets, accepts matching `:root` declarations, and takes the last matching cascade rule.
- Vite's `data-vite-dev-id` is captured as `sourceFile` when available.
- The CSS writer can fall back to project-wide property plus semantic `fromCss` uniqueness; CSS Module hash selectors therefore do not automatically block direct write.
- Missing/ambiguous context falls through to the agent instead of weakening the uniqueness policy.

**Remaining risk:** Some valid effects will always require agent handoff. MotionWorks deliberately favors a safe skip over a speculative source edit.

---

## Challenge 12: Localhost Trust and Auto-Agent Authority

**Root cause:** The daemon must accept browser POSTs from local development servers. Loopback CORS prevents remote origins but another localhost page could attempt a commit, and a spawned agent has workspace edit permission.

**What breaks:** Without additional constraints, an unrelated local page could trigger file or agent work.

**Chosen mitigation:**

1. The daemon binds to `127.0.0.1` and accepts browser Origins only from loopback hostnames.
2. Commit properties are allowlisted to `--mw-*` and three animation longhands.
3. `motionworks.config.json` may define a token; the standalone/React URL carries it and every POST must present it.
4. Claude runs with Edit/Read/Grep/Glob but not Bash; Codex runs in workspace-write rooted at the project.
5. Agent instructions limit work to named declarations, prohibit refactors, and label all page-supplied strings as untrusted data.

**Remaining risk:** The token is optional and agent restrictions are not a declaration-level sandbox. Do not expose the daemon outside loopback; use `--no-agent` where manual approval is required.

---

## Challenge 5: Overlay Performance on Complex Pages

**Root cause:** Selection tracking, highlights, toolkit interaction, and on-canvas editing share a frame budget with the product's own motion.

**What breaks:** The designer judges an effect while tooling-induced jank changes its apparent feel.

**Chosen mitigation:**

- Live custom-property writes are browser-local; no network message or React application render occurs per pointer move.
- The overlay root is separate from the product root and imperative pointer-follow visuals avoid render-per-move.
- Canvas/SVG layers mount only for scoped editors that need them; today the path editor is the only active on-canvas surface.
- Only one effect is selected at a time, and the overlay is development-only.

**Remaining risk:** Full-canvas WebGL or Three.js products compete for the same GPU/frame budget. Performance needs profiling against complex real applications, especially at high device-pixel ratios.

---

## Challenge 7: Reload and Stylesheet-Swap Preservation

**Root cause:** Vite may replace style nodes, Next may reload links, static serving has no HMR, and a page can reload after source writeback. Registration and the first journal poll can arrive in either order.

**What breaks:** Selection can disappear, uncommitted intent can be lost, or an applied journal entry can remain pending after its diff already reconciled.

**Chosen mitigation:**

1. The overlay mounts in an independent React root and the in-page bridge lives on `globalThis` behind a shape version.
2. Selection uses `sessionStorage`; uncommitted diffs use origin-scoped `localStorage`.
3. `watchStylesheets` observes style/link replacement and link load events, then restores, re-reads, re-registers, reconciles, and re-applies synchronously.
4. Acknowledgment is entry-driven: each polled entry compares directly to current baselines and types, so late `/pending` responses still clear correctly.
5. Applied entries can cache-bust the matching stylesheet link when there is no HMR.

**Remaining risk:** Development servers differ in how they update stylesheets, and cross-origin/constructed sheets can evade observation. Vite, Next, and static serving remain explicit regression targets.

---

## Challenge 8: WebGL and Shader Effects

**Root cause:** GPU uniforms are not semantically discoverable from the DOM. MotionWorks can store a CSS value but cannot infer which shader field it controls.

**What breaks:** A registered parameter changes in CSS but the visual effect does not react.

**Chosen mitigation:** The coding agent declares only meaningful uniforms as schema parameters, reads them with `readParams`, subscribes to `motionworks:change`, and writes the values to cached uniform/material locations. Replay and scrub likewise use explicit CustomEvent listeners.

**Remaining risk:** Large shaders can have nonlinear interactions across dozens of uniforms. Agents should expose only the small set a designer can understand and tune independently.

---

## Challenge 9: Parameter Type Misassignment

**Root cause:** The coding agent chooses semantic types. A wrong choice produces the wrong editing curve or editor.

**What breaks:** The designer receives a misleading manipulation surface even when the CSS value itself is valid.

**Chosen mitigation:**

1. The vocabulary remains small and is documented with meaning, runtime shape, and CSS encoding.
2. Validation corrects unknown types to `scalar`; binding warns about incompatible CSS.
3. The designer can override a type from the parameter context menu.
4. Corrections ride in the next journal entry, including correction-only commits. An agent changes only the listed schema `type`, and reconciliation drops the local override once source matches.

**Remaining risk:** Repeated misclassification indicates the generated guide needs clearer examples or anti-examples. Type-correction frequency should inform future guide changes.

---

## Resolved

### Challenge 2: Live Update API Surface Across Libraries

**Resolved in 0.5.0 by the CSS binding contract.** MotionWorks no longer requires every library to implement a registration `update()` callback. It writes one CSS custom property and dispatches one standard event; effects translate CSS into their own imperative primitive only when CSS cannot drive them directly.

### Challenge 4: Framework and Library Agnosticism

**Resolved in 0.5.0 by the standalone bundle and schema-only DOM registration.** Any page can load `motionworks.global.js`, register through attributes/JSON, and consume the same CSS helpers. React is a thin convenience and an optional peer rather than the platform boundary.

### Challenge 6: Multi-Agent Compatibility

**Resolved in 0.5.0 by the file-first journal and CLI.** Claude and Codex can be spawned automatically, while any terminal-capable agent can use `changes`, `status`, and `ack`. No agent-specific client protocol is required.

### Challenge 10: Effects Without a Clear “Phenomenon”

**Resolved before 0.5.0 by consolidating scalar editing in the toolkit.** Radius, strength, decay, response, spring, timing, and scalar parameters use perceptual drawers/cursor tools rather than requiring a bespoke visible phenomenon. On-canvas editing is reserved for genuinely spatial path data.
