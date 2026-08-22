import { useEffect, useRef } from "react";

import type { MotionWorksEffect } from "../../shared/index.js";

import { getBridge } from "../bridge.js";
import { useOverlaySession } from "./context.js";
import { humanizeEffectName } from "./display-name.js";
import { useSessionState } from "./hooks.js";
import { FONT, GLASS } from "./theme.js";

// Width 0 + minWidth 100%: the list never contributes to the chip's
// intrinsic width — it stretches to whatever the toolbar row is, so opening
// it only ever grows the chip upward.
const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 10px 8px",
  width: 0,
  minWidth: "100%",
  boxSizing: "border-box",
};

// At most seven rows visible, then the list scrolls.
const LIST_ROW_MAX_HEIGHT = 7 * 24;

// Subtle dock-style magnification: rows swell toward the cursor with a
// cosine falloff, so the list reads as a lens passing over it rather than
// items snapping bigger on hover.
const MAGNIFY_BOOST = 0.03;
const MAGNIFY_RANGE_PX = 52;

function MagnifyList({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const apply = (pointerY: number | null): void => {
    const el = ref.current;
    if (el === null) return;
    const children = Array.from(el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    const listRect = el.getBoundingClientRect();
    const localPointerY =
      pointerY === null ? null : pointerY - listRect.top + el.scrollTop;
    // The row nearest the cursor is THE hovered row — it alone gets the fill.
    let closest: HTMLElement | null = null;
    let closestD = Infinity;
    const info = children.map((child) => {
      // offsetTop/offsetHeight are stable layout coordinates: unlike
      // getBoundingClientRect they do not include the scale written below,
      // so magnification cannot feed back into the next hover measurement.
      const center = child.offsetTop + child.offsetHeight / 2;
      const d = localPointerY === null ? Infinity : localPointerY - center;
      if (Math.abs(d) < closestD) {
        closestD = Math.abs(d);
        closest = child;
      }
      return { child, d };
    });
    for (const { child, d } of info) {
      const label = child.firstElementChild;
      const abs = Math.abs(d);
      let scale = 1;
      if (pointerY !== null && abs < MAGNIFY_RANGE_PX) {
        const window = 0.5 + 0.5 * Math.cos((Math.PI * abs) / MAGNIFY_RANGE_PX);
        scale = 1 + MAGNIFY_BOOST * window;
      }
      const isClosest =
        pointerY !== null && child === closest && abs < MAGNIFY_RANGE_PX;
      if (label instanceof HTMLElement) {
        label.style.transformOrigin = "left center";
        label.style.transition = "transform 55ms ease-out";
        label.style.transform = scale === 1 ? "" : `scale(${scale.toFixed(3)})`;
      }
      child.style.transition = "border-left-color 60ms ease-out";
      child.style.transform = "";
      child.style.zIndex = isClosest ? "2" : scale > 1 ? "1" : "";
      child.style.position = "relative";
      child.style.background = "transparent";
      child.style.backdropFilter = "";
      child.style.setProperty("-webkit-backdrop-filter", "");
      child.style.boxShadow = "none";
      child.style.borderRadius = "";
      child.style.borderLeftColor = isClosest
        ? "rgba(255, 255, 255, 0.92)"
        : child.hasAttribute("data-motionworks-list-selected")
          ? "rgba(255, 255, 255, 0.85)"
          : "rgba(255, 255, 255, 0.15)";
    }
  };
  return (
    <div
      ref={ref}
      style={listStyle}
      onPointerMove={(e) => {
        apply(e.clientY);
      }}
      onPointerLeave={() => {
        apply(null);
      }}
      onScroll={() => {
        apply(null);
      }}
    >
      {children}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxHeight: LIST_ROW_MAX_HEIGHT,
  overflowY: "auto",
  scrollbarWidth: "thin",
  scrollbarColor: GLASS.scrollbarColor,
  // Let the scrollbar hug the chip's edge instead of sitting inset by the
  // section padding; content keeps its own right breathing room.
  marginRight: -8,
  paddingRight: 9,
};

const headerStyle: React.CSSProperties = {
  fontSize: FONT.sizeLabel,
  letterSpacing: 0.08,
  textTransform: "uppercase",
  color: "rgba(255, 255, 255, 0.45)",
  fontFamily: FONT.family,
};

const hintStyle: React.CSSProperties = {
  fontSize: FONT.sizeSmall,
  color: "rgba(255, 255, 255, 0.5)",
  fontFamily: FONT.family,
  lineHeight: 1.4,
};

const TEMPORAL_TYPES = new Set(["stagger", "duration"]);

export interface ScopedEffect {
  effect: MotionWorksEffect;
  scopeNodes: HTMLElement[];
  timingParams: string[];
  otherTypes: string[];
}

// All registered animations on the selected element or nested inside it —
// the shared scope for the Layers and Choreography panels (and the toolbox's
// decision to show the Layers tool at all).
export function scopedEffects(
  effects: MotionWorksEffect[],
  selectedEffectId: string,
  resolvedType: (effectId: string, paramKey: string) => string | null,
): ScopedEffect[] {
  const bridge = getBridge();
  const allNodes = bridge.getAllNodes();
  const selectedNode = bridge.getNode(selectedEffectId) ?? null;

  const out: ScopedEffect[] = [];
  for (const effect of effects) {
    const nodes = allNodes.get(effect.id) ?? [];
    const scopeNodes =
      effect.id === selectedEffectId
        ? [...nodes]
        : selectedNode === null
          ? []
          : nodes.filter((n) => selectedNode.contains(n));
    if (effect.id !== selectedEffectId && scopeNodes.length === 0) continue;

    const timingParams: string[] = [];
    const otherTypes = new Set<string>();
    for (const [paramKey, param] of Object.entries(effect.params)) {
      if (!param.bound) continue;
      const effective = resolvedType(effect.id, paramKey) ?? param.type;
      if (TEMPORAL_TYPES.has(effective)) timingParams.push(paramKey);
      else otherTypes.add(effective.replace(/-/g, " "));
    }
    out.push({ effect, scopeNodes, timingParams, otherTypes: [...otherTypes] });
  }
  return out;
}

// ── Layers ────────────────────────────────────────────────────────────────
// Outline of the animations inside the selection. Clicking an entry selects
// that animation — the discoverable equivalent of double-click drilling.

export function LayersPanel({
  selectedEffectId,
  onJump,
}: {
  selectedEffectId: string;
  onJump: (effectId: string, node: HTMLElement | null) => void;
}): React.JSX.Element {
  const session = useOverlaySession();
  const state = useSessionState();
  const entries = scopedEffects(state.effects, selectedEffectId, (id, key) =>
    session.resolvedType(id, key),
  );

  return (
    <div style={sectionStyle}>
      <span style={headerStyle}>Layers</span>
      <MagnifyList>
        {entries.map(({ effect, scopeNodes }) => {
          const node = scopeNodes[0] ?? null;
          const isSelected = effect.id === selectedEffectId;
          return (
            <button
              key={effect.id}
              data-motionworks-list-selected={isSelected ? "" : undefined}
              type="button"
              onClick={() => {
                if (!isSelected) onJump(effect.id, node);
              }}
              title={
                isSelected
                  ? "Currently selected"
                  : "Click to edit this animation"
              }
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                border: "none",
                borderLeft: isSelected
                  ? "2px solid rgba(255, 255, 255, 0.85)"
                  : "2px solid rgba(255, 255, 255, 0.15)",
                background: "transparent",
                padding: "2px 0 2px 8px",
                cursor: isSelected ? "default" : "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  fontSize: FONT.sizeSmall,
                  color: "rgba(255, 255, 255, 0.92)",
                  fontFamily: FONT.family,
                }}
              >
                {humanizeEffectName(effect.name)}
                {scopeNodes.length > 1 ? ` × ${String(scopeNodes.length)}` : ""}
              </span>
            </button>
          );
        })}
      </MagnifyList>
    </div>
  );
}

// ── Elements ──────────────────────────────────────────────────────────────
// Nothing-selected state: every registered animation on the page, in one
// layers-style list. This is what keeps the open-but-idle toolkit legible —
// the chip is never empty — and it doubles as a navigator for elements that
// are hard to find by pointing (offscreen, tiny, or stacked).

export function ElementsPanel({
  onJump,
  onHover,
}: {
  onJump: (effectId: string, node: HTMLElement | null) => void;
  onHover: (info: { node: HTMLElement; label: string } | null) => void;
}): React.JSX.Element {
  const state = useSessionState();
  const bridge = getBridge();

  // Clear any lingering hover highlight when the panel goes away (a selection
  // was made or the toolkit closed mid-hover).
  useEffect(() => () => onHover(null), [onHover]);

  const entries = state.effects.map((effect) => {
    const nodes = [...(bridge.getAllNodes().get(effect.id) ?? [])];
    return { effect, nodes };
  });
  // Reading order: entries with a live DOM node sort by document position;
  // node-less registrations sink to the end.
  entries.sort((a, b) => {
    const na = a.nodes[0] ?? null;
    const nb = b.nodes[0] ?? null;
    if (na === null || nb === null)
      return na === null ? (nb === null ? 0 : 1) : -1;
    return (na.compareDocumentPosition(nb) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
      0
      ? -1
      : 1;
  });

  return (
    <div style={sectionStyle}>
      <span style={headerStyle}>Animated surfaces</span>
      {entries.length === 0 ? (
        <span style={hintStyle}>
          Nothing registered yet. Ask your coding agent to add a motion effect —
          it will appear here, ready to refine.
        </span>
      ) : (
        <>
          <MagnifyList>
            {entries.map(({ effect, nodes }) => {
              const node = nodes[0] ?? null;
              return (
                <button
                  key={effect.id}
                  type="button"
                  onClick={() => {
                    onJump(effect.id, node);
                  }}
                  onPointerEnter={() => {
                    if (node !== null) {
                      onHover({ node, label: humanizeEffectName(effect.name) });
                    }
                  }}
                  onPointerLeave={() => {
                    onHover(null);
                  }}
                  title="Click to edit this animation"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 1,
                    border: "none",
                    borderLeft: "2px solid rgba(255, 255, 255, 0.15)",
                    background: "transparent",
                    padding: "2px 0 2px 8px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontSize: FONT.sizeSmall,
                      color: "rgba(255, 255, 255, 0.92)",
                      fontFamily: FONT.family,
                    }}
                  >
                    {humanizeEffectName(effect.name)}
                    {nodes.length > 1 ? ` × ${String(nodes.length)}` : ""}
                  </span>
                </button>
              );
            })}
          </MagnifyList>
        </>
      )}
    </div>
  );
}
