import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { GLASS } from "./theme.js";

// 'action' — persistent left section (close, layers). 'type' — the four
// family buttons in the middle. 'verb' — in-time actions on the right
// (apply, discard, play, compare).
type ToolKind = "action" | "type" | "verb";

export interface Tool {
  id: string;
  label: string;
  kind: ToolKind;
  icon: React.ReactNode;
  // One-line explanation (≤6 words) shown under the name in the hover chip.
  hint?: string;
  disabled?: boolean;
  // Like `disabled` (dimmed, no action) but still hoverable, so its hover chip
  // can explain why. Used for Play on motion that must be triggered manually.
  inert?: boolean;
  // Resting tint for semantically colored verbs (green apply, red discard);
  // applied whenever the tool is enabled. hoverColor brightens it on hover.
  tint?: string;
  hoverColor?: string;
  onClick?: () => void;
  // Controlled pressed state. When set, it wins over the toolbox's internal
  // last-clicked tracking — used for expandable type tools, where several
  // can be active (expanded) at once.
  selected?: boolean;
  pulse?: boolean;
  // Hold-style tools (press and keep pressed — e.g. compare-with-baseline).
  // When provided, pointerdown/up drive these instead of a click action.
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
}

export interface ToolboxProps {
  tools: Tool[];
  // Which screen edge the bar is docked to. Anatomy mirrors: icons pin to
  // the docked edge, panels grow toward the content.
  dock: "bottom" | "top";
  onDockChange: (dock: "bottom" | "top") => void;
  // Fired when a bar drag begins — the owner collapses panels/drawers so
  // the user carries a compact bar.
  onDragStart?: () => void;
  // Closing sequence: the chip shrinks symmetrically back into the launcher
  // square (content fading) before the shell unmounts it.
  closing?: boolean;
  // Expanded tool sections rendered inside the chip, stacked above the icon
  // row (the chip is bottom-anchored and grows upward).
  panels?: React.ReactNode;
  // Custom node rendered inline in the icon row, immediately after the tool
  // with the given id (the docked armed-tool chip).
  insertAfter?: { id: string; node: React.ReactNode } | null;
  // Flyout anchored above the tool with the given id (the family drawer).
  flyout?: { anchorId: string; node: React.ReactNode } | null;
  // A transient, non-interactive message anchored beside a tool. Unlike a
  // panel it never participates in chip sizing.
  sidecar?: { anchorId: string; node: React.ReactNode } | null;
}

// The chip is pinned to bottom-center. It starts at the launcher square's
// size so opening reads as the launcher morphing into the toolbar.
const BOTTOM_MARGIN = 16;
const CHIP_SEED = 46;
const TOOLBOX_MAX_WIDTH = 720;
// Height budget: panels taller than this scroll internally so the chip can
// never eat the canvas.
const PANELS_MAX_HEIGHT = "40vh";

// One-shot icon feedback for the in-time verbs. A soft press-and-release
// that stays legible on rapid, repeated presses without dominating the
// peripheral view.
const ICON_CLICK_ANIMATION: Record<string, string> = {
  apply: "nudge",
  garbage: "nudge",
  replay: "nudge",
  agent: "nudge",
  compare: "nudge",
};

// These actions can remove or disable their own button immediately. Give
// the browser one short beat to paint the click feedback before executing
// them; Compare remains immediate because its button persists.
const TRANSIENT_ACTION_DELAY_MS = 155;
const TRANSIENT_ACTION_IDS = new Set(["apply", "garbage", "replay", "agent"]);

// The committing verbs (Apply, discard X, Copy) get an extra press signal on
// top of the icon nudge: a subtle background flash so the click reads clearly.
const PRESS_FLASH_IDS = new Set(["apply", "garbage", "agent"]);

const ICON_ANIMATION_CSS = `
@keyframes ms-ico-spin { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
@keyframes ms-ico-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
@keyframes ms-ico-nudge {
  0% { transform: scale(1); }
  35% { transform: scale(0.92); }
  70% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
.ms-ico { display: grid; place-items: center; }
.ms-ico-spin { animation: ms-ico-spin 380ms cubic-bezier(0.35, 0, 0.25, 1); }
.ms-ico-pulse { animation: ms-ico-pulse 800ms ease-in-out infinite; }
.ms-ico-nudge { animation: ms-ico-nudge 220ms cubic-bezier(0.2, 0.82, 0.25, 1); }
/* Press feedback for the committing verbs: a flat highlight that eases in and
   fades out smoothly — a clean, premium press signal. Layered over the button
   so it never fights the inline background. */
@keyframes ms-btn-press {
  0% { opacity: 0; }
  28% { opacity: 1; }
  100% { opacity: 0; }
}
.ms-press-flash {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  pointer-events: none;
  /* Rests invisible: the span stays mounted after a press, so without this it
     would revert to the default opacity:1 and leave the flash stuck on. */
  opacity: 0;
  background: rgba(255, 255, 255, 0.18);
  animation: ms-btn-press 340ms cubic-bezier(0.33, 0, 0.25, 1);
}
/* One unified settle-breath as the open morph lands: transform scales the
   whole box as a rigid shape, so both edges spring together — the fluid
   overshoot without two animated properties interfering. */
@keyframes ms-open-settle {
  0% { transform: scale(1); }
  45% { transform: scale(1.013); }
  100% { transform: scale(1); }
}
@keyframes ms-agent-quip {
  0% { opacity: 0; transform: translateX(-8px) scale(0.92); }
  12% { opacity: 1; transform: translateX(0) scale(1); }
  82% { opacity: 1; transform: translateX(0) scale(1); }
  100% { opacity: 0; transform: translateX(6px) scale(0.98); }
}
`;

// The chip is pinned to bottom-center and always as small as its content —
// panels stack above the icon row, so opening a section grows the chip
// upward from the bottom edge.
export function Toolbox({
  tools,
  dock,
  onDockChange,
  onDragStart,
  panels,
  insertAfter,
  flyout,
  sidecar,
  closing = false,
}: ToolboxProps): React.JSX.Element {
  // Content-driven size changes (tools appearing, panels expanding) can't be
  // CSS-transitioned directly — so the content is measured and the outer
  // chip animates to the measured size, clipping during the change. Seeding
  // with the launcher square's size makes the first measure animate, i.e.
  // the launcher visually morphs into the toolbar.
  const contentRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: CHIP_SEED,
    h: CHIP_SEED,
  });
  // Viewport width for explicit-left centering (see the chip's left/width
  // transition choreography below).
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => {
      setVw(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  useLayoutEffect(() => {
    const el = contentRef.current;
    const bar = barRef.current;
    if (el === null || bar === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      // Panels are passengers: only the icon row defines the chip width.
      // The content adds 6px padding on each side around that row.
      const width = bar.getBoundingClientRect().width + 12;
      setSize((current) =>
        current.w === width && current.h === rect.height
          ? current
          : { w: width, h: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // ── Bar dragging with anchor snap ───────────────────────────────────────
  // Drag starts anywhere on the base bar (never the panels); after a 6px
  // threshold the bar follows the pointer freely, and on release it glides
  // to the nearest anchor (bottom-center or top-center).
  const chipRef = useRef<HTMLDivElement>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [snap, setSnap] = useState<{
    dock: "bottom" | "top";
    top: number;
  } | null>(null);
  const dragRef = useRef({
    tracking: false,
    moved: false,
    startX: 0,
    startY: 0,
    offX: 0,
    offY: 0,
  });
  const suppressClickRef = useRef(false);
  // Removes an in-flight bar-drag's window listeners if the toolbox unmounts
  // mid-drag before pointerup fires (P2-10).
  const dragCleanupRef = useRef<() => void>(() => undefined);
  useEffect(() => () => dragCleanupRef.current(), []);

  const beginBarDrag = (e: React.PointerEvent): void => {
    if (closing) return;
    const rect = chipRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    dragRef.current = {
      tracking: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current;
      if (!d.tracking) return;
      if (!d.moved) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6)
          return;
        d.moved = true;
        suppressClickRef.current = true;
        onDragStart?.();
        setSnap(null);
      }
      setDragPos({ x: ev.clientX - d.offX, y: ev.clientY - d.offY });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragCleanupRef.current = () => undefined;
      const d = dragRef.current;
      d.tracking = false;
      if (!d.moved) return;
      const h = chipRef.current?.getBoundingClientRect().height ?? size.h + 2;
      const centerY = ev.clientY - d.offY + h / 2;
      const targetDock: "bottom" | "top" =
        centerY < window.innerHeight / 2 ? "top" : "bottom";
      const top =
        targetDock === "top"
          ? BOTTOM_MARGIN
          : window.innerHeight - h - BOTTOM_MARGIN;
      setDragPos(null);
      setSnap({ dock: targetDock, top });
      onDockChange(targetDock);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  };

  useEffect(() => {
    if (snap === null) return;
    const timer = window.setTimeout(() => {
      setSnap(null);
    }, 370);
    return () => {
      clearTimeout(timer);
    };
  }, [snap]);
  // Only the id is stored; the current Tool is re-derived from `tools` each
  // render so labels/hints track live prop changes (e.g. Compare toggling
  // between "Compare with original" and "Showing original") without waiting
  // for the pointer to move.
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const hoveredTool =
    hoveredToolId !== null
      ? (tools.find((t) => t.id === hoveredToolId) ?? null)
      : null;

  // The first ~half second after mount is the "opening" morph: it grows
  // symmetrically from the launcher square at center (left animates in step
  // with width). After that, width changes bloom out the RIGHT edge and the
  // delayed left-slide re-centers as follow-through.
  const [openingPhase, setOpeningPhase] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpeningPhase(false);
    }, 450);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Button elements by tool id, for anchoring the drawer flyout.
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const [flyoutPos, setFlyoutPos] = useState<{
    x: number;
    topEdge: number;
    bottomEdge: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (flyout == null) {
      setFlyoutPos(null);
      return;
    }
    const measure = (): void => {
      const btn = buttonsRef.current.get(flyout.anchorId);
      if (btn === undefined) {
        setFlyoutPos(null);
        return;
      }
      const rect = btn.getBoundingClientRect();
      setFlyoutPos({
        x: rect.left + rect.width / 2,
        topEdge: rect.top,
        bottomEdge: rect.bottom,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
    // Size changes shuffle button positions; re-anchor after they settle.
  }, [flyout, tools.length, size]);

  const [sidecarPos, setSidecarPos] = useState<{
    left: number;
    right: number;
    centerY: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (sidecar == null) {
      setSidecarPos(null);
      return;
    }
    let raf = 0;
    const measure = (): void => {
      const button = buttonsRef.current.get(sidecar.anchorId);
      if (button !== undefined) {
        const rect = button.getBoundingClientRect();
        setSidecarPos((current) => {
          const next = {
            left: rect.left,
            right: rect.right,
            centerY: rect.top + rect.height / 2,
          };
          return current?.left === next.left &&
            current.right === next.right &&
            current.centerY === next.centerY
            ? current
            : next;
        });
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [sidecar]);

  const actionTools = tools.filter((t) => t.kind === "action");
  const typeTools = tools.filter((t) => t.kind === "type");
  const verbTools = tools.filter((t) => t.kind === "verb");
  const logoTool = actionTools.find((tool) => tool.id === "logo");
  const maxShellWidth = Math.max(
    CHIP_SEED + 2,
    Math.min(TOOLBOX_MAX_WIDTH + 2, vw - BOTTOM_MARGIN * 2),
  );
  const shellWidth = closing
    ? CHIP_SEED + 2
    : Math.min(size.w + 2, maxShellWidth);
  const contentMaxWidth = maxShellWidth - 2;

  const handleToolEnter = (tool: Tool): void => {
    setHoveredToolId(tool.id);
  };
  const handleToolLeave = (tool: Tool): void => {
    // Clear per-button: moving from a tool into the panel area (still inside
    // the chip) must drop the label immediately.
    setHoveredToolId((current) => (current === tool.id ? null : current));
    setCursor(null);
  };
  const handleToolMove = (event: React.PointerEvent): void => {
    setCursor({ x: event.clientX, y: event.clientY });
  };

  const renderTool = (tool: Tool): React.JSX.Element => (
    <Fragment key={tool.id}>
      <ToolButton
        tool={tool}
        active={tool.selected ?? false}
        onClick={() => {
          tool.onClick?.();
        }}
        onHoverEnter={handleToolEnter}
        onHoverLeave={handleToolLeave}
        onHoverMove={handleToolMove}
        buttonRef={(el) => {
          if (el === null) buttonsRef.current.delete(tool.id);
          else buttonsRef.current.set(tool.id, el);
        }}
      />
      {insertAfter != null && insertAfter.id === tool.id
        ? insertAfter.node
        : null}
    </Fragment>
  );

  return (
    <>
      <style data-motionworks-overlay-style="">{ICON_ANIMATION_CSS}</style>
      <div
        ref={chipRef}
        role="toolbar"
        aria-orientation="horizontal"
        onPointerLeave={() => {
          setHoveredToolId(null);
          setCursor(null);
        }}
        style={{
          position: "fixed",
          // Anchored by the LEFT edge with an explicit pixel position rather
          // than centered by transform: width changes extend the RIGHT edge
          // (where new tools appear), and the slightly delayed, longer `left`
          // transition then glides the whole bar back to center — growth
          // reads as "space opens on the right, bar settles left", not as
          // both edges pushing out symmetrically.
          // Closing: shrink toward the corner in one motion — the chip
          // travels and collapses simultaneously, landing where the
          // launcher square lives.
          // Position: dragging follows the pointer; snapping glides to the
          // nearest anchor; docked rests on the dock edge's margin.
          ...(dragPos !== null
            ? { left: dragPos.x, top: dragPos.y }
            : snap !== null
              ? { left: (vw - shellWidth) / 2, top: snap.top }
              : {
                  left: closing
                    ? vw - (CHIP_SEED + 2) - BOTTOM_MARGIN
                    : (vw - shellWidth) / 2,
                  ...(dock === "bottom"
                    ? { bottom: BOTTOM_MARGIN }
                    : { top: BOTTOM_MARGIN }),
                }),
          overflow: "hidden",
          width: shellWidth,
          height: closing ? CHIP_SEED + 2 : size.h + 2,
          // Gooey: a longer, gently overshooting curve so growth reads as a
          // fluid blob stretching, never a snap. Open/close morphs move left
          // in step with width (symmetric center growth); steady-state width
          // changes let left lag behind as the re-centering follow-through.
          transition:
            dragPos !== null
              ? "none"
              : snap !== null
                ? "left 340ms cubic-bezier(0.3, 0.95, 0.3, 1), top 340ms cubic-bezier(0.3, 0.95, 0.3, 1), width 360ms cubic-bezier(0.32, 1.12, 0.35, 1), height 360ms cubic-bezier(0.32, 1.12, 0.35, 1)"
                : closing
                  ? "width 260ms cubic-bezier(0.4, 0.7, 0.3, 1), height 260ms cubic-bezier(0.4, 0.7, 0.3, 1), left 260ms cubic-bezier(0.4, 0.7, 0.3, 1)"
                  : openingPhase
                    ? "width 325ms cubic-bezier(0.22, 0.9, 0.28, 1), height 325ms cubic-bezier(0.22, 0.9, 0.28, 1), left 325ms cubic-bezier(0.22, 0.9, 0.28, 1)"
                    : "width 360ms cubic-bezier(0.32, 1.12, 0.35, 1), height 360ms cubic-bezier(0.32, 1.12, 0.35, 1), left 480ms cubic-bezier(0.32, 1.08, 0.35, 1) 70ms",
          background: GLASS.background,
          border: GLASS.border,
          borderRadius: GLASS.radiusLarge,
          boxShadow: GLASS.shadow,
          backdropFilter: GLASS.backdrop,
          WebkitBackdropFilter: GLASS.backdrop,
          transformOrigin: dock === "bottom" ? "50% 100%" : "50% 0%",
          animation:
            "ms-open-settle 230ms cubic-bezier(0.33, 0.7, 0.4, 1) 295ms both",
          pointerEvents: "auto",
          // The toolbar is always the very top surface (above the selection
          // highlight at 9999); only transient chips/editors float above it.
          zIndex: 10000,
          color: "rgba(255, 255, 255, 0.95)",
          fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div
          ref={contentRef}
          style={{
            // Anchored to the chip's bottom-LEFT: while the chip's width
            // animates rightward, existing tools stay planted (new space
            // opens beside them) and the bar's own left-slide then carries
            // everything to center as one unit. Height growth still reveals
            // panels upward with the icon row pinned at the bottom.
            position: "absolute",
            ...(dock === "bottom" ? { bottom: 0 } : { top: 0 }),
            left: 0,
            display: "flex",
            flexDirection: dock === "bottom" ? "column" : "column-reverse",
            gap: 6,
            alignItems: "stretch",
            padding: 6,
            width: Math.min(size.w, contentMaxWidth),
            boxSizing: "border-box",
            opacity: closing ? 0 : 1,
            transition: "opacity 140ms ease",
          }}
        >
          {panels != null ? (
            <div
              style={{
                maxHeight: PANELS_MAX_HEIGHT,
                overflowY: "auto",
                overflowX: "hidden",
                maxWidth: "100%",
                minWidth: 0,
                scrollbarWidth: "thin",
                scrollbarColor: GLASS.scrollbarColor,
              }}
            >
              {panels}
            </div>
          ) : null}
          <div
            ref={barRef}
            onPointerDown={beginBarDrag}
            onClickCapture={(e) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              width: "max-content",
              cursor: "grab",
              touchAction: "none",
            }}
          >
            {actionTools.map(renderTool)}
            {actionTools.length > 0 && typeTools.length > 0 ? (
              <Divider />
            ) : null}
            {typeTools.map(renderTool)}
            {verbTools.length > 0 ? <Divider /> : null}
            {verbTools.map(renderTool)}
          </div>
        </div>
        {closing && logoTool !== undefined ? (
          <div
            data-motionworks-closing-logo=""
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 6,
              ...(dock === "bottom" ? { bottom: 6 } : { top: 6 }),
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              color: "rgba(255, 255, 255, 0.95)",
              pointerEvents: "none",
            }}
          >
            {logoTool.icon}
          </div>
        ) : null}
      </div>
      {flyout != null && flyoutPos !== null ? (
        <div
          style={{
            position: "fixed",
            left: flyoutPos.x,
            ...(dock === "bottom"
              ? { bottom: window.innerHeight - flyoutPos.topEdge + 10 }
              : { top: flyoutPos.bottomEdge + 10 }),
            transform: "translateX(-50%)",
            zIndex: 10001,
          }}
        >
          {flyout.node}
        </div>
      ) : null}
      {sidecar != null && sidecarPos !== null ? (
        <div
          style={{
            position: "fixed",
            left:
              sidecarPos.right + 230 < vw
                ? sidecarPos.right + 10
                : sidecarPos.left - 10,
            top: sidecarPos.centerY,
            transform:
              sidecarPos.right + 230 < vw
                ? "translateY(-50%)"
                : "translate(-100%, -50%)",
            pointerEvents: "none",
            zIndex: 10001,
          }}
        >
          {sidecar.node}
        </div>
      ) : null}
      {hoveredTool !== null && cursor !== null ? (
        <HoverChip
          label={hoveredTool.label.split(" — ")[0] ?? hoveredTool.label}
          hint={hoveredTool.hint}
          x={cursor.x}
          y={cursor.y}
        />
      ) : null}
    </>
  );
}

function Divider(): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        background: GLASS.hairline,
        width: 1,
        height: 22,
        margin: "0 5px",
      }}
    />
  );
}

interface ToolButtonProps {
  tool: Tool;
  active: boolean;
  onClick: () => void;
  onHoverEnter: (tool: Tool) => void;
  onHoverLeave: (tool: Tool) => void;
  onHoverMove: (event: React.PointerEvent) => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

function ToolButton({
  tool,
  active,
  onClick,
  onHoverEnter,
  onHoverLeave,
  onHoverMove,
  buttonRef,
}: ToolButtonProps): React.JSX.Element {
  const [hover, setHover] = useState(false);
  // Newly-appearing tools ease in rather than popping.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  // Incremented per click; used as the icon wrapper's key so the CSS
  // animation retriggers on every press.
  const [clickCount, setClickCount] = useState(0);
  const pendingClickRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel a deferred transient action if the button unmounts before it fires,
  // so `onClick` can't run against a torn-down toolkit (P2-11).
  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) clearTimeout(clickTimerRef.current);
    },
    [],
  );
  const clickAnimation = ICON_CLICK_ANIMATION[tool.id];
  const disabled = tool.disabled === true;
  // Inert tools look disabled but stay hoverable so their chip can explain why
  // (Play on scroll-driven / hover-triggered motion). `dimmed` drives the
  // visuals; the native `disabled` attribute is reserved for truly disabled
  // tools, since a disabled <button> stops emitting the hover events the chip
  // needs.
  const inert = tool.inert === true;
  const dimmed = disabled || inert;
  // A result can remain semantically selected while its action becomes
  // unavailable (Apply's brief completed state is the common case). Never
  // render that combination as a dimmed active tile: inactive verbs are a
  // grey icon on transparent glass.
  const visuallyActive = active && !dimmed;
  const background = visuallyActive
    ? GLASS.fillActive
    : hover && !dimmed
      ? GLASS.fillHover
      : "transparent";
  // Enabled icons use their lit (formerly hover-only) colour by default so they
  // read with enough contrast against the dimmed/disabled ones; hovering now
  // only changes the background, never the icon colour. Dimmed tools stay grey.
  const litColor = tool.hoverColor ?? tool.tint ?? "rgb(255, 255, 255)";
  const color = visuallyActive
    ? (tool.tint ?? "rgb(255, 255, 255)")
    : dimmed
      ? "rgba(255, 255, 255, 0.58)"
      : litColor;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={tool.label}
      aria-pressed={active}
      aria-disabled={dimmed || undefined}
      onClick={
        tool.onHoldStart !== undefined || inert
          ? undefined
          : () => {
              if (pendingClickRef.current) return;
              if (clickAnimation !== undefined) setClickCount((c) => c + 1);
              if (TRANSIENT_ACTION_IDS.has(tool.id)) {
                pendingClickRef.current = true;
                clickTimerRef.current = setTimeout(() => {
                  clickTimerRef.current = null;
                  pendingClickRef.current = false;
                  onClick();
                }, TRANSIENT_ACTION_DELAY_MS);
              } else {
                onClick();
              }
            }
      }
      onPointerDown={tool.onHoldStart}
      onPointerUp={tool.onHoldEnd}
      onPointerEnter={() => {
        setHover(true);
        onHoverEnter(tool);
      }}
      onPointerMove={onHoverMove}
      onPointerLeave={() => {
        setHover(false);
        onHoverLeave(tool);
        tool.onHoldEnd?.();
      }}
      disabled={disabled}
      style={{
        position: "relative",
        width: 34,
        height: 34,
        display: "grid",
        placeItems: "center",
        borderRadius: 8,
        border: "none",
        padding: 0,
        background,
        // A hairline inner ring on the active tile — with the brighter fill
        // and full-white icon it separates cleanly from the dim inactive ones.
        boxShadow: visuallyActive
          ? "inset 0 0 0 1px rgba(255, 255, 255, 0.28)"
          : "none",
        color,
        cursor: dimmed ? "default" : "pointer",
        opacity: !entered ? 0 : dimmed ? 0.4 : 1,
        transform: entered ? "scale(1)" : "scale(0.7)",
        transition: dimmed
          ? "color 140ms ease, opacity 260ms ease, transform 320ms cubic-bezier(0.32, 1.2, 0.35, 1)"
          : "background 140ms ease, box-shadow 140ms ease, color 140ms ease, opacity 260ms ease, transform 320ms cubic-bezier(0.32, 1.2, 0.35, 1)",
      }}
    >
      {PRESS_FLASH_IDS.has(tool.id) && clickCount > 0 ? (
        // Keyed on clickCount so the flash retriggers on every press.
        <span
          key={`flash-${clickCount}`}
          className="ms-press-flash"
          aria-hidden
        />
      ) : null}
      <span
        key={clickCount}
        className={
          tool.pulse
            ? "ms-ico ms-ico-pulse"
            : clickCount > 0 && clickAnimation !== undefined
              ? `ms-ico ms-ico-${clickAnimation}`
              : "ms-ico"
        }
      >
        {tool.icon}
      </span>
    </button>
  );
}

interface HoverChipProps {
  label: string;
  hint?: string | undefined;
  x: number;
  y: number;
}

// Cursor-anchored label, floated ABOVE the pointer so it never sits between
// the designer and the toolbar. Flips to the left when it would run off the
// right edge.
export function HoverChip({
  label,
  hint,
  x,
  y,
}: HoverChipProps): React.JSX.Element {
  const OFFSET_X = 14;
  const OFFSET_Y = 12;
  // Measure the content and drive the chip's width from it, so a label swap
  // (e.g. "Apply changes" → "Applied") smoothly tweens the width instead of
  // snapping. The inner box keeps its natural (max-content) size; the outer
  // box animates toward it.
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el !== null) setWidth(el.offsetWidth);
  }, [label, hint]);
  const estWidth = width ?? Math.max(60, label.length * 7 + 20);
  const overflowsRight = x + OFFSET_X + estWidth > window.innerWidth - 8;
  const chipX = overflowsRight ? x - OFFSET_X : x + OFFSET_X;
  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: chipX,
        top: y - OFFSET_Y,
        transform: `translateY(-100%)${overflowsRight ? " translateX(-100%)" : ""}`,
        ...(width !== null ? { width } : {}),
        overflow: "hidden",
        background: GLASS.background,
        backdropFilter: GLASS.backdrop,
        WebkitBackdropFilter: GLASS.backdrop,
        color: "rgba(255, 255, 255, 0.96)",
        borderRadius: GLASS.radiusSmall,
        border: GLASS.border,
        boxShadow: "0 6px 14px rgba(0, 0, 0, 0.24)",
        fontSize: 11,
        lineHeight: 1.2,
        fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
        letterSpacing: 0.01,
        pointerEvents: "none",
        // Above the toolbar (10000) so the chip is never buried by it.
        zIndex: 10001,
        transition: "width 200ms cubic-bezier(0.22, 0.61, 0.36, 1)",
      }}
    >
      <div
        ref={contentRef}
        style={{
          width: "max-content",
          padding: "4px 9px",
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ fontWeight: 600 }}>{label}</div>
        {hint !== undefined ? (
          <div style={{ color: "rgba(255, 255, 255, 0.62)", marginTop: 1 }}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────
// All icons render into a 20x20 viewBox using currentColor stroke so button
// state controls the tint. Each icon is meant to read as a small typographic
// pictogram of the underlying MotionWorks surface — the shape a designer
// would recognise from manipulating the effect itself.

const iconProps: React.SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const ICONS = {
  apply: (
    <svg {...iconProps} aria-hidden>
      <path d="M4 10.5l3.6 3.5L16 6" />
    </svg>
  ),
  agent: (
    <svg {...iconProps} aria-hidden>
      <g transform="translate(1 1) scale(0.9)">
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <path d="M4.5 3 H11.5 A1.5 1.5 0 0 1 13 4.5 V7 H7 V13 H4.5 A1.5 1.5 0 0 1 3 11.5 V4.5 A1.5 1.5 0 0 1 4.5 3 Z" />
      </g>
    </svg>
  ),
  garbage: (
    <svg {...iconProps} aria-hidden>
      <path d="M5 5l10 10" />
      <path d="M15 5L5 15" />
    </svg>
  ),
  // Family emblem — Space. Used only by the family button, never by tools.
  familySpace: (
    <svg {...iconProps} aria-hidden>
      <circle cx="10" cy="10" r="6" strokeDasharray="2 2" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <line x1="10" y1="10" x2="16" y2="10" />
    </svg>
  ),
  // Radius tool: a ripple — arcs radiating from a source, fading with
  // distance. "How far the effect reaches."
  spatialRadius: (
    <svg {...iconProps} aria-hidden>
      <circle cx="6.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="M8.7 7.2a3.6 3.6 0 0 1 0 5.6" />
      <path d="M10.6 4.8a6.6 6.6 0 0 1 0 10.4" opacity="0.55" />
    </svg>
  ),
  spatialStrength: (
    <svg {...iconProps} aria-hidden>
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="M10 5.5V3M14.5 10H17M10 14.5V17M5.5 10H3" />
      <path d="M9.2 3.8L10 3l0.8 0.8M16.2 9.2L17 10l-0.8 0.8M10.8 16.2L10 17l-0.8-0.8M3.8 10.8L3 10l0.8-0.8" />
    </svg>
  ),
  temporalDecay: (
    <svg {...iconProps} aria-hidden>
      <circle cx="15" cy="10" r="2.2" fill="currentColor" stroke="none" />
      <circle
        cx="11"
        cy="10"
        r="1.6"
        fill="currentColor"
        stroke="none"
        opacity="0.7"
      />
      <circle
        cx="8"
        cy="10"
        r="1.1"
        fill="currentColor"
        stroke="none"
        opacity="0.45"
      />
      <circle
        cx="5.5"
        cy="10"
        r="0.8"
        fill="currentColor"
        stroke="none"
        opacity="0.25"
      />
    </svg>
  ),
  temporalResponse: (
    <svg {...iconProps} aria-hidden>
      <circle cx="6" cy="10" r="2.2" strokeDasharray="2 1.5" />
      <path d="M8.2 10h3.6" strokeDasharray="1.5 1.5" />
      <circle cx="14" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Family emblem — Feel. Used only by the family button, never by tools.
  familyFeel: (
    <svg {...iconProps} aria-hidden>
      <path d="M3 10c1-3 3-3 4 0s3 3 4 0 3-3 4 0 1 0 2 0" />
    </svg>
  ),
  // Spring tool: a coil anchored to a wall with a mass on the free end —
  // the pull-and-release interaction itself.
  springResponse: (
    <svg {...iconProps} aria-hidden>
      <path d="M3.5 6.8v6.4" />
      <path d="M3.5 10c0.7-2.2 1.4-2.2 2.1 0s1.4 2.2 2.1 0 1.4-2.2 2.1 0L12.6 10" />
      <circle cx="14.6" cy="10" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Stiffness: a tighter, higher-frequency coil than the family spring.
  stiffness: (
    <svg {...iconProps} aria-hidden>
      <path d="M3 10c0.7-2.6 1.5-2.6 2.3 0s1.6 2.6 2.3 0 1.6-2.6 2.3 0 1.6 2.6 2.3 0 1.6-2.6 2.3 0 1.6 2.6 2.3 0" />
    </svg>
  ),
  // Damping: an oscillation dying out — shrinking amplitude left to right.
  damping: (
    <svg {...iconProps} aria-hidden>
      <path d="M3 10c1-5.5 2-5.5 3 0s1.8 4 2.8 0 1.4-2.6 2.3 0 1.1 1.6 1.9 0 0.9-0.9 2-0.4" />
      <line
        x1="3"
        y1="10"
        x2="17"
        y2="10"
        strokeDasharray="1 2.4"
        opacity="0.45"
      />
    </svg>
  ),
  // Mass: a kettlebell weight.
  mass: (
    <svg {...iconProps} aria-hidden>
      <path d="M6.4 9h7.2l1.6 6.4a0.8 0.8 0 0 1-0.78 1H5.58a0.8 0.8 0 0 1-0.78-1z" />
      <path d="M8.2 9V7.2a1.8 1.8 0 0 1 3.6 0V9" />
    </svg>
  ),
  // Family emblem — Style. Used only by the family button, never by tools.
  familyStyle: (
    <svg {...iconProps} aria-hidden>
      <defs>
        <linearGradient
          id="motionworks-family-grad-mw7"
          x1="0"
          x2="1"
          y1="0"
          y2="0"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="7"
        width="14"
        height="6"
        rx="1.5"
        fill="url(#motionworks-family-grad-mw7)"
        stroke="none"
      />
      <circle cx="3.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Gradient tool: stop handles on a track — the editing anatomy of a
  // gradient, with the color sequence carried by the fading nibs.
  gradient: (
    <svg {...iconProps} aria-hidden>
      <path d="M3 14.5h14" />
      <path d="M5 14.5V8.8M10 14.5V8.8M15 14.5V8.8" />
      <circle cx="5" cy="7.2" r="1.6" fill="currentColor" stroke="none" />
      <circle
        cx="10"
        cy="7.2"
        r="1.6"
        fill="currentColor"
        stroke="none"
        opacity="0.6"
      />
      <circle
        cx="15"
        cy="7.2"
        r="1.6"
        fill="currentColor"
        stroke="none"
        opacity="0.3"
      />
    </svg>
  ),
  path: (
    <svg {...iconProps} aria-hidden>
      <path d="M4 15C5 8 9 16 10 10s5 2 6-5" />
      <circle cx="4" cy="15" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  stagger: (
    <svg {...iconProps} aria-hidden>
      <rect
        x="3.5"
        y="6"
        width="2.4"
        height="10"
        rx="0.7"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="7.5"
        y="8"
        width="2.4"
        height="8"
        rx="0.7"
        fill="currentColor"
        stroke="none"
        opacity="0.8"
      />
      <rect
        x="11.5"
        y="10"
        width="2.4"
        height="6"
        rx="0.7"
        fill="currentColor"
        stroke="none"
        opacity="0.6"
      />
      <rect
        x="15.5"
        y="12"
        width="2.4"
        height="4"
        rx="0.7"
        fill="currentColor"
        stroke="none"
        opacity="0.4"
      />
    </svg>
  ),
  scalar: (
    <svg {...iconProps} aria-hidden>
      <line x1="3" y1="10" x2="17" y2="10" />
      <circle cx="13" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  duration: (
    <svg {...iconProps} aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.6 1.8" />
    </svg>
  ),
  easingCurve: (
    <svg {...iconProps} aria-hidden>
      <path d="M3.5 16.5C9 16.5 11 3.5 16.5 3.5" />
      <circle cx="6.5" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="7" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  // Play triangle, filled — nudged slightly right of center so it reads
  // optically centered.
  replay: (
    <svg {...iconProps} aria-hidden>
      <path
        d="M7.2 5.2v9.6a0.6 0.6 0 0 0 0.92 0.5l7.4-4.8a0.6 0.6 0 0 0 0-1l-7.4-4.8a0.6 0.6 0 0 0-0.92 0.5z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  ),
  compare: (
    <svg {...iconProps} aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5v13" />
      <path
        d="M10 3.5a6.5 6.5 0 0 1 0 13"
        fill="currentColor"
        stroke="none"
        opacity="0.4"
      />
    </svg>
  ),
  // Active (showing-original) variant: the fill sits on the LEFT half. The
  // flip animation starts mirrored, so swapping to this variant mid-click
  // reads as the fill physically flipping across.
  compareActive: (
    <svg {...iconProps} aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5v13" />
      <path
        d="M10 3.5a6.5 6.5 0 0 0 0 13"
        fill="currentColor"
        stroke="none"
        opacity="0.4"
      />
    </svg>
  ),
  choreography: (
    <svg {...iconProps} aria-hidden>
      <rect
        x="3"
        y="5"
        width="9"
        height="2.4"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="6"
        y="9"
        width="9"
        height="2.4"
        rx="1.2"
        fill="currentColor"
        stroke="none"
        opacity="0.7"
      />
      <rect
        x="9"
        y="13"
        width="8"
        height="2.4"
        rx="1.2"
        fill="currentColor"
        stroke="none"
        opacity="0.45"
      />
    </svg>
  ),
  layers: (
    <svg {...iconProps} aria-hidden>
      <path d="M10 3.5l6.5 3.5L10 10.5 3.5 7 10 3.5z" />
      <path d="M3.5 10.5L10 14l6.5-3.5" />
      <path d="M3.5 13.5L10 17l6.5-3.5" opacity="0.5" />
    </svg>
  ),
  // A mouse cursor — Select mode: clicks pick an element to edit.
  select: (
    <svg {...iconProps} aria-hidden>
      {/* Nudge only the drawn cursor ~1px right (viewBox is 20u @ 18px, so
          1.1u ≈ 1px); the <svg> container stays fixed in the toolbar. */}
      <g transform="translate(1.1 0)">
        <path d="M5 3l0 13 3.3-3.4 2 4.6 2.1-.9-2-4.5 4.9-.1L5 3z" />
      </g>
    </svg>
  ),
  // The mark: a keyframe echo — a solid keyframe diamond (the universal
  // animation symbol) with two ghost diamonds trailing off behind it. A
  // keyframe in motion. Rendered ~30% larger than the tool pictograms; the
  // ghosts carry more weight than a classic echo so they never sink into
  // the glass.
  logo: (
    <svg width={23} height={23} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M14.1 5.2 L18.4 10 L14.1 14.8 L9.8 10 Z" fill="currentColor" />
      <path
        d="M9.3 6.6 L12.4 10 L9.3 13.4 L6.2 10 Z"
        fill="currentColor"
        opacity="0.68"
      />
      <path
        d="M4.9 7.6 L7.1 10 L4.9 12.4 L2.7 10 Z"
        fill="currentColor"
        opacity="0.42"
      />
    </svg>
  ),
};
