# MotionWorks — Overlay

> **Maintenance rule:** This file covers `@motionworks/react`: installation, provider setup, element registration, the overlay's rendering model, and selection behavior. If the activation mechanism, rendering layers, or HMR strategy changes, edit the relevant section in place. Do not append. Changes require product owner confirmation.

---

## What the Overlay Is

The MotionWorks overlay is a set of React components that render on top of a running React application at `localhost`. It is not a browser extension. It is not a separate window. It is a layer mounted to `document.body` in its own React root, injected by the developer into their own project.

Closed state: a small draggable launcher chip (the logo square) sits in a screen corner in development — there is no hotkey. Clicking it glides the chip to screen center, where it morphs into the toolkit bar. Clicking the logo again (or Escape) closes it. The launcher and toolkit can be dragged to dock at the top or bottom edge. While the toolkit is closed, only the launcher is visible and nothing intercepts the app.

---

## Installation

```bash
npm install -D @motionworks/react @motionworks/core
```

`@motionworks/react` is a dev dependency. Use a build-time guard so nothing ships to production:

```tsx
// src/main.tsx or src/index.tsx — the application entry point

// Only import and mount MotionWorks in development
if (process.env.NODE_ENV === 'development') {
  import('@motionworks/react').then(({ MotionWorksProvider }) => {
    const container = document.createElement('div');
    container.id = 'motionworks-root';
    document.body.appendChild(container);
    ReactDOM.createRoot(container).render(<MotionWorksProvider />);
  });
}
```

**Why dynamic import?** Tree-shaking is not always reliable enough to guarantee zero production bundle impact when static imports are involved. Dynamic import + `NODE_ENV` guard is belt-and-suspenders — and the provider itself renders `null` outside development even if someone forgets the guard, lazily loading the overlay renderer chunk only in dev.

**Next.js App Router:** `layout.tsx` is a server component, so it cannot import `MotionWorksProvider` and render it directly — the provider uses client-only hooks and will crash the server render. (`@motionworks/react` ships a `"use client"` directive so a stray import degrades to a client boundary instead of a hard 500, but that path does *not* survive HMR — always use the separate root below.) Wrap the mount in a client boot component and render *that* from the layout:

```tsx
// app/_components/motionworks-boot.tsx
'use client';
import { useEffect } from 'react';

// Render <MotionWorksBoot /> once, high in the tree (e.g. app/layout.tsx).
export function MotionWorksBoot(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as typeof window & { __motionworksRoot?: { unmount(): void } };
    if (w.__motionworksRoot) return; // survive StrictMode double-invoke + HMR
    let disposed = false;
    void Promise.all([import('@motionworks/react'), import('react-dom/client')]).then(
      ([{ MotionWorksProvider }, { createRoot }]) => {
        if (disposed || w.__motionworksRoot) return;
        const el = document.createElement('div');
        el.id = 'motionworks-root';
        document.body.appendChild(el);
        const root = createRoot(el);
        root.render(<MotionWorksProvider />);
        w.__motionworksRoot = root;
      },
    );
    return () => {
      disposed = true;
    };
  }, []);
  return null;
}
```

The `MotionWorksProvider` mounts independently of the application's React root. This is intentional: MotionWorks must stay alive across HMR reloads that tear down and recreate the application's component tree.

---

## Provider Configuration

```tsx
<MotionWorksProvider
  port={52340}            // WebSocket port for the MCP bridge. Default: 52340.
  debug={false}           // Log WS client events. Default: false.
/>
```

All props are optional. Change `port` only if 52340 conflicts with another local service; also set the `MOTIONWORKS_PORT` env var so the MCP server uses the same port. The WS client reconnects with exponential backoff (250ms → 5s), so the CLI can be started before or after the app; on every reconnect the overlay re-announces all registrations.

---

## Registering an Effect

Effects are registered from within React components using the `useMotionWorks` hook. This is the agent's job — see `AGENT_INTEGRATION.md` for the instruction stack that makes agents emit these calls, and `SCHEMA.md` for the full registration API.

`useMotionWorks` internally:

1. Captures the calling component's name during render (via React 19's owner internals; falls back to `'Anonymous'`) and derives a stable effect id: `ComponentName::SchemaName`.
2. Registers with the **bridge** on mount — a module-scoped singleton stashed on `globalThis` (keyed by a shape version) so it survives HMR of the module itself. Registrations that arrive before the overlay's lazy chunk has loaded are queued and replayed in order.
3. Unregisters on unmount. Several live instances of the same component share one effect id; the effect only truly unregisters when the last instance goes away, and `update()` fans out to every mounted instance.
4. Re-registers when the schema **fingerprint** changes — the effect name plus each param's type and baseline value. This covers renames, added/removed params, and (crucially) an agent writeback that React Fast Refresh applies as a state-preserving update rather than a remount.
5. Always dispatches `update()` through a ref to the latest closure, so re-renders don't churn the wire.

---

## Overlay Rendering Architecture

The overlay root is a single fixed, full-viewport container (`data-motionworks-overlay`, `z-index: 9997`) with **`pointer-events: none` at all times — even while active**. The app underneath keeps receiving hover and move events so its animations play exactly as they do with MotionWorks off. Interactive overlay pieces (toolkit, panels, scrubber, menus) opt into pointer events individually; selection works through document-level capture listeners (below).

What renders inside it:

- **The toolkit chip** — the frosted-glass toolbar and its expanding panels (family drawers, editors, layers list). All parameter editing lives here or in surfaces it mounts. See `MANIPULATION_SURFACES.md`.
- **Selection highlights** — absolutely-positioned outlines with an effect-name label, for the hovered and the selected element.
- **The activation reveal** — on every toolkit open, each registered element flashes its outline and effect name in a reading-order stagger, answering "what can I touch?" before fading out.
- **The scrubber** — shown only for effects that declare `capabilities.scrub`.
- **Scoped canvas + SVG layers** — a full-viewport 2D canvas (rAF clear-and-redraw via a draw-callback registry) and an SVG layer for interactive handles. These are **not mounted globally**: an editor that needs the element itself as the control surface mounts them scoped, from inside the toolkit. Today the path editor is the only one that does (canvas + SVG filtered to `path` params). The per-type on-element surface components live in `overlay/surfaces/` and render through this same mechanism.
- **The cursor tool pill** — a frosted counter that follows the cursor while a parameter is armed, positioned imperatively (no render per pointermove).

The overlay is strictly grayscale (`overlay/theme.ts` owns every color and pixel constant) so it never competes with the product's own colors.

---

## Element Selection

Only registered elements are selectable — those with `useMotionWorks` refs, plus auto-detected CSS animations while the overlay is open (see `SCHEMA.md`).

The `SelectionEngine` attaches capture-phase listeners on `document` while the toolkit is open:

- **Hover:** `pointermove` hit-tests via `document.elementsFromPoint` against the bridge's registered nodes. The hover highlight outlines the *outermost* registered ancestor under the cursor — that's what a single click grabs — with the effect's humanized name as a label. Moves are never intercepted.
- **Click:** `pointerdown` (and the follow-up `click`) are intercepted with `preventDefault` + `stopPropagation`, so selecting never triggers the app's own click handlers (no accidental navigation or cart adds). A click on a registered element selects it; a click on empty space deselects.
- **Drill:** a second click within 450ms and 8px — or a native double-click — selects the *deepest* registered element under the point, for nested registrations (a card entrance wrapping a button press spring). The Layers panel is the discoverable equivalent.
- **Synthetic events are ignored** (`isTrusted` check), so the Replay verb's simulated press reaches the app instead of being swallowed as a selection click.
- **Overlay-owned UI is exempt** — clicks on the toolkit and panels are handled by them, never hit-tested through to the app.

### Selection persistence across HMR

The selected effect id is stored in `sessionStorage`. On re-registration after an HMR reload, if the incoming effect id matches the stored selection, it is restored automatically. Effect ids (`ComponentName::SchemaName`) are stable as long as neither name changes; if either changes, selection is lost — acceptable behavior.

Opening or closing the toolkit clears the selection — every editing session starts clean. The sessionStorage restore exists solely to survive HMR reloads *mid-session*.

---

## Parameter Type Overrides

Right-clicking a parameter row opens a context menu offering exact numeric entry and **"Edit parameter type."** Choosing a different semantic type switches the editing surface immediately (a local override in the `TypeOverrideStore`) and sends a `type-correction` message to the MCP bridge. The correction persists in bridge state until the agent writes the corrected type to source; when HMR re-registers the effect with the corrected type, the local override is dropped automatically. Full protocol: `AGENT_INTEGRATION.md` → "Handling Type Corrections".

---

## HMR Resilience

HMR is the most disruptive event in MotionWorks's lifecycle — and also the normal way agent writebacks arrive. The approach:

- **`MotionWorksProvider` lives in its own React root**, unaffected by HMR in the application's root. Its portal container is created imperatively so it survives provider-level HMR too.
- **The bridge is a `globalThis` singleton** with a shape-version key, so hot-swapping the bridge module never orphans the registered node map.
- **The overlay session owns its own state manager and diff store.** Registration/unregistration events update the registry; the designer's uncommitted intent (`from → to` per param) lives in the `DiffStore`, which nothing about HMR touches.
- **Fingerprint-driven re-registration** (see above) means a writeback that only changes a named constant still produces a fresh registration with the new baseline.
- **Reconciliation** runs on every re-registration of an effect with an outstanding diff: if the new baseline equals the designer's chosen value, the diff is cleared (the writeback landed); if it equals the old baseline, the diff is kept and re-applied to the live effect (the write didn't take); anything else is flagged. Full matrix in `SOURCE_SYNC.md`.

---

## Multi-Effect Scenarios

A single component can register multiple effects (e.g., a hover animation and an entrance animation) — each `useMotionWorks` call is a separate registration. Nested registrations on the same DOM subtree are reached by drill-clicking or through the **Layers** panel, which lists every animation on or inside the selected element. When nothing is selected, the same slot shows the page-wide **Animated surfaces** list — a navigator that highlights each entry's element on hover and selects on click (useful for offscreen, tiny, or stacked elements).

One effect is edited at a time. There is no multi-selection; simultaneous multi-element manipulation is a post-MVP feature. The **Time** family is the partial exception: it edits every duration/stagger parameter across the whole selection scope (nested animations included) in one panel.
