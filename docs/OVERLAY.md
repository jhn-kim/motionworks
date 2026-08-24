# MotionWorks — Overlay

> **Maintenance rule:** This file covers overlay installation, mounting, element registration, rendering, selection, and reload resilience. If the activation mechanism, rendering layers, or stylesheet/HMR strategy changes, edit the relevant section in place. Do not append. Changes require product owner confirmation.

---

## What the Overlay Is

The MotionWorks overlay renders over a locally running web page. It is not a browser extension or separate editor: selection and manipulation happen on the real DOM and real motion effect.

The UI is implemented in React and ships in two forms from the single `motionworks` package:

- `motionworks/react` for a thin React hook/provider integration;
- `motionworks.global.js`, a bundled IIFE that mounts on any HTML page and exposes helpers as `window.MotionWorks`.

Closed state is a small draggable launcher chip in a screen corner. Clicking it moves and morphs it into the toolkit bar. Clicking the logo again or pressing Escape closes it. The launcher/toolkit can dock at the top or bottom edge. While closed, only the launcher is visible and nothing intercepts the app.

---

## Installation and Mounting

```bash
npx motionworks init
```

`init` is a full installer: it adds `motionworks`, writes the `.gitignore` entry, assigns a per-project port, and scaffolds the agent stanza plus `MOTIONWORKS.md`. A separate `npm install` is not needed. (To test an unpublished build, `npm install <path-to>.tgz` first so `init` uses that local version rather than the registry.)

Start `npx motionworks` from the project root alongside the application's development server.

### React

Mount `MotionWorksProvider` in its own development-only React root. The independent root keeps the overlay alive when application HMR remounts the product tree.

The daemon is token-authenticated by default, and the browser cannot read `.motionworks/token`. The mount must therefore pass the token in `daemonUrl` — passing only `port` sends no token, so every `/status` poll is rejected (401) and the overlay silently never connects. A development-only route exposes the token to the page:

```ts
// app/api/motionworks-token/route.ts
import { readFile } from 'node:fs/promises';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  try { return Response.json({ token: (await readFile('.motionworks/token', 'utf8')).trim() }); }
  catch { return Response.json({ token: null }); }
}
```

Next.js App Router projects must mount from a client boot component rather than rendering the provider directly in a Server Component, fetching the token first:

```tsx
'use client';
import { useEffect } from 'react';

export function MotionWorksBoot(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & { __motionworksRoot?: unknown };
    if (w.__motionworksRoot) return;
    let disposed = false;
    void Promise.all([
      import('motionworks/react'),
      import('react-dom/client'),
      fetch('/api/motionworks-token').then((r) => r.json()).catch(() => ({ token: null })),
    ]).then(([{ MotionWorksProvider }, { createRoot }, { token }]) => {
      if (disposed || w.__motionworksRoot) return;
      const element = document.createElement('div');
      element.id = 'motionworks-root';
      document.body.appendChild(element);
      const daemonUrl = 'http://127.0.0.1:52340' + (token ? '?token=' + token : '');
      const root = createRoot(element);
      root.render(<MotionWorksProvider daemonUrl={daemonUrl} />);
      w.__motionworksRoot = root;
    });
    return () => { disposed = true; };
  }, []);
  return null;
}
```

The overlay renders its own fixed `[data-motionworks-overlay]` container on `<body>`, so `motionworks-root` staying empty is expected. Vite, CRA, and other client-only React apps use the same development guard and separate-root mount in their client entry, exposing the token another dev-only way (a dev middleware or a build-time `define`).

### Any HTML page

With another development server, add the daemon-served bundle before `</body>`:

```html
<script src="http://127.0.0.1:52340/motionworks.js"></script>
```

The script auto-mounts on `DOMContentLoaded`. Set `data-auto-mount="false"` to opt out and call `window.MotionWorks.mount()` manually. Its default daemon URL is the script URL's origin; a configured token is preserved from the script query.

For static content:

```bash
npx motionworks serve .
```

The daemon serves the directory and injects `/motionworks.js` before `</body>` in HTML responses.

---

## Configuration

```tsx
<MotionWorksProvider
  daemonUrl="http://127.0.0.1:52340"
  debug={false}
/>
```

`daemonUrl` is the full HTTP base, including a token query when configured. If omitted, the provider uses `http://127.0.0.1:<port>`; `port` defaults to `52340` and remains available as a convenience prop. `debug` logs daemon-client activity.

The client polls `/status` every five seconds for launcher health. While the toolkit is open it polls `/pending` every 1.5 seconds; otherwise pending polling uses the status cadence. Offline retries back off from one to ten seconds. Live manipulation never uses HTTP.

---

## Registering Effects

### React hook

`useMotionWorks(ref, schema)` attaches schema metadata to a real DOM node. Values come from computed CSS, not from registration. The hook:

1. slugifies the schema name and allocates `slug#n` by DOM order;
2. registers the node and reads each CSS baseline on mount;
3. unregisters that node on unmount;
4. re-registers when name, parameter keys/types, or `var` bindings change;
5. becomes a no-op outside development.

Ids are never renumbered while live. Repeated component instances get distinct ids. Live manipulation fans out to same-slug siblings only when their baseline equals the selected instance's baseline.

### DOM schemas

The standalone overlay scans `data-motionworks` attributes and `<script type="application/motionworks+json">` selector maps. A MutationObserver registers added nodes, responds to attribute changes, and unregisters disconnected nodes.

### CSS animation and transition auto-detection

CSS `@keyframes` animations are auto-detected from provider mount: `document.getAnimations()` is scanned every 1.5 seconds and an `animationstart` listener catches new ones immediately, so entrance one-shots that finish before the toolkit opens are still captured and retained while their element stays in the DOM. Running `CSSAnimation` instances receive selectable effects with duration, delay, and easing when decodable. Scroll-driven animations (non-document timeline) are marked `manualTrigger` — Play is inert with a "trigger it manually" chip — and their duration control is suppressed. Pseudo-element animations are attributed to their host element and read/write against the pseudo-element rule.

CSS transitions are auto-detected while the toolkit is open, from `document.getAnimations()` (a running transition is a `CSSTransition`) and promptly on `transitionrun`. They edit and persist duration/delay/easing through the `transition-*` longhands and are marked `manualTrigger` (`:hover` and class toggles can't be re-triggered from script). Single-value transitions only; multi-property comma lists are skipped. Effects are keyed by element so re-hovering reuses the registration, and retained until the element leaves the DOM so a finished transition stays selectable.

An explicitly registered element owns the animation semantics of its subtree, so descendant CSS animations are not also auto-detected; register a descendant explicitly only when it is a genuinely independent effect.

---

## Rendering Architecture

The overlay root is one fixed full-viewport container (`data-motionworks-overlay`, `z-index: 9997`) with `pointer-events: none` at all times. The underlying app keeps receiving hover and move events. Interactive overlay controls opt into pointer events individually; selection uses capture listeners on `document`.

The root contains:

- **Toolkit chip** — launcher, verbs, family drawers, editors, and layers/navigation lists.
- **Selection highlights** — positioned outlines and human-readable effect labels.
- **Activation reveal** — a reading-order flash of every registered surface when the toolkit opens.
- **Scrubber** — only for effects declaring `capabilities.scrub`.
- **Scoped canvas and SVG layers** — mounted only by editing surfaces that need on-element drawing; currently the path editor.
- **Cursor tool pill** — positioned imperatively beside the pointer while a parameter is armed.

The overlay is grayscale. Shared color, spacing, timing, and interaction constants live in `browser/overlay/theme.ts`.

---

## Element Selection

Selectable nodes come from React hooks, DOM schemas, or CSS animation auto-detection. The `SelectionEngine` attaches capture-phase document listeners while the toolkit is open:

- **Hover** uses `document.elementsFromPoint` and outlines the outermost registered ancestor under the pointer.
- **Click** prevents the app's activation behavior and selects the registered node; clicking empty space deselects.
- **Drill/double-click** selects the deepest registered node for nested effects. The Layers panel offers the discoverable equivalent.
- **Synthetic events** are ignored so safe simulated Replay presses reach the app.
- **Overlay UI** is excluded from application hit testing.

Opening or closing the toolkit clears selection. The selected id is also stored in `sessionStorage` so a mid-session application HMR can restore it when the same `slug#n` registers again. Every selection is posted to `/select` for `.motionworks/selected.json` and `npx motionworks status`.

---

## Parameter Type Overrides

Right-clicking a parameter row offers exact numeric entry and “Edit parameter type.” A new type takes effect immediately through the local `TypeOverrideStore` and is attached as `typeCorrections` to the next journal entry. A correction can be applied without a value drag.

When refreshed source registers the corrected type, the local override is dropped. There is no separate type-correction transport or file.

---

## Diff and Stylesheet Resilience

The overlay session owns the state manager, diff store, and type overrides independently of application components. Uncommitted diffs are serialized to `localStorage` per origin with a short debounce.

`watchStylesheets` observes head/body subtree changes and load events on stylesheet links. On a detected swap it:

1. restores prior inline values;
2. re-reads computed CSS baselines;
3. re-registers live nodes;
4. reconciles journal entries and local diffs;
5. re-applies outstanding intent when source still has the old baseline.

Journal acknowledgment is entry-driven. Each polled entry is compared directly to current registered baselines and type declarations, so an entry arriving after hydration/reconciliation is still acknowledged correctly.

For static serving without HMR, an applied entry can add `?mw=<timestamp>` to the matching stylesheet link, forcing the new source value to load.

---

## Multi-Effect Scenarios

One DOM subtree may contain multiple registrations. Drill selection and the Layers panel reach nested effects. With no selection, Animated surfaces lists every registered effect and highlights its node on hover.

One effect is selected at a time; general multi-selection remains out of scope. The Time family is the partial exception: it can edit duration/stagger parameters across the current nested selection scope.
