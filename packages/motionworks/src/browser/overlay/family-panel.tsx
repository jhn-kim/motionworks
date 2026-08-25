import type { ParameterType } from "../../shared/index.js";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useOverlaySession } from "./context.js";
import { type ArmedTool } from "./cursor-tool.js";
import { scaleToValue, valueToScale } from "./scale.js";
import { FONT, GLASS } from "./theme.js";
import { HoverChip } from "./toolbox.js";

// The gooey family expansion: clicking a family grows the toolbar upward
// with the family's tools, each as an icon + slider row. Sliders run on the
// perceptual 0–10 dial under the hood (log springs, quadratic timing) while
// writing real values through the session. Editors (gradient / easing /
// path) and boolean toggles get rows of their own kinds.

export type PanelItem =
  | { kind: "slider"; tool: ArmedTool; icon: React.ReactNode; hint: string }
  | {
      kind: "editor";
      editorType: ParameterType;
      label: string;
      icon: React.ReactNode;
      hint: string;
      active: boolean;
    };

const PANEL_CSS = `
@keyframes ms-family-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Modern slider (iOS-like): thin flat track, clean white fill, plain
   white round knob with a single soft shadow. Depth comes from one shadow
   and the press scale, not gradients. --ms-fill carries progress. */
.ms-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 18px;
  background: transparent;
  outline: none;
}
.ms-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.95) var(--ms-fill, 50%),
    rgba(255, 255, 255, 0.18) var(--ms-fill, 50%)
  );
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.28);
  transition: filter 180ms ease;
}
.ms-slider:active::-webkit-slider-runnable-track {
  filter: brightness(1.18);
}
/* Liquid-glass capsule knob: a translucent vertical pill with a hairline
   top rim-light, specular edge, soft inner glow, and (where supported) a
   backdrop blur so the track refracts through it. */
.ms-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 14px;
  margin-top: -5px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow:
    0 1.5px 4px rgba(0, 0, 0, 0.25),
    inset 0 -2px 3px rgba(0, 0, 0, 0.24);
  /* Release: a springy settle back to rest. Press overrides with a quick
     ease so grabbing feels immediate. */
  transition: transform 300ms cubic-bezier(0.3, 1.45, 0.4, 1);
}
.ms-slider:active::-webkit-slider-thumb {
  transform: scale(1.06);
  transition: transform 110ms ease;
}
.ms-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.28);
}
.ms-slider::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.28);
}
.ms-slider::-moz-range-thumb {
  width: 24px;
  height: 14px;
  border: none;
  border-radius: 999px;
  background: #ffffff;
  box-shadow:
    0 1.5px 4px rgba(0, 0, 0, 0.25),
    inset 0 -2px 3px rgba(0, 0, 0, 0.24);
}
`;

export function FamilySliderPanel({
  items,
  onEditor,
}: {
  items: PanelItem[];
  onEditor: (editorType: ParameterType) => void;
}): React.JSX.Element {
  // Cursor-attached chip explaining the hovered tool in ≤6 words. Only the
  // row id and pointer position are stored; the label/hint are re-derived
  // from `items` each render so live label changes (e.g. a slider whose
  // label reflects a toggle elsewhere) update the chip without a re-hover.
  const hoverEntries = items.map((item) =>
    item.kind === "slider"
      ? {
          id: `${item.tool.effectId}|${item.tool.paramKey}|${item.tool.axis ?? ""}`,
          label: item.tool.label,
          hint: item.hint,
        }
      : { id: `ed|${item.editorType}`, label: item.label, hint: item.hint },
  );
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const hover =
    hoverId !== null
      ? (hoverEntries.find((e) => e.id === hoverId) ?? null)
      : null;
  const hoverHandlers = (id: string): Record<string, unknown> => ({
    onPointerEnter: (e: React.PointerEvent) => {
      setHoverId(id);
      setHoverPos({ x: e.clientX, y: e.clientY });
    },
    onPointerMove: (e: React.PointerEvent) => {
      setHoverPos({ x: e.clientX, y: e.clientY });
    },
    onPointerLeave: () => {
      setHoverId(null);
      setHoverPos(null);
    },
  });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "8px 10px 6px",
        // Content stays geometrically still — the chip's gooey growth is
        // the only motion, revealing it at exactly its own speed. Opacity
        // rides along on the same clock.
        animation: "ms-family-in 360ms cubic-bezier(0.32, 1.12, 0.35, 1)",
        fontFamily: FONT.family,
      }}
    >
      <style data-motionworks-overlay-style="">{PANEL_CSS}</style>
      {hover !== null && hoverPos !== null
        ? // Portal out of the toolbar (whose backdrop-filter is a containing
          // block + overflow clip) so the chip isn't pinned inside/under it.
          // Target the overlay root, not document.body: the root is an isolated
          // stacking context at a near-max z-index, so a body portal would sit
          // far below the whole overlay and be buried by the toolbar. Inside the
          // root, the chip's z-index (10001) clears the toolbar (10000) and it
          // renders in the same context as the toolbar's own hover chip, so
          // both read identically.
          createPortal(
            <HoverChip
              label={hover.label}
              hint={hover.hint}
              x={hoverPos.x}
              y={hoverPos.y}
            />,
            document.querySelector("[data-motionworks-overlay]") ??
              document.body,
          )
        : null}
      {items.map((item) => {
        if (item.kind === "slider") {
          const id = `${item.tool.effectId}|${item.tool.paramKey}|${item.tool.axis ?? ""}`;
          return (
            <SliderRow
              key={id}
              tool={item.tool}
              icon={item.icon}
              hoverHandlers={hoverHandlers(id)}
            />
          );
        }
        return (
          <button
            key={`ed|${item.editorType}`}
            type="button"
            aria-pressed={item.active}
            {...hoverHandlers(`ed|${item.editorType}`)}
            onClick={() => {
              onEditor(item.editorType);
            }}
            style={{
              ...rowStyle,
              border: "none",
              borderRadius: GLASS.radiusSmall - 2,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <span style={iconWellStyle}>{item.icon}</span>
            <span style={rowLabelStyle}>{item.label}</span>
            <span
              aria-hidden
              style={{
                display: "grid",
                placeItems: "center",
                color: "rgba(255, 255, 255, 0.55)",
                transform: item.active ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 180ms cubic-bezier(0.3, 0.9, 0.3, 1)",
              }}
            >
              {/* Down = expand; flips up when open (minimize). */}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2 3.4 L5 7 L8 3.4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "2px 2px",
  color: "rgba(255, 255, 255, 0.9)",
  textAlign: "left",
  fontFamily: FONT.family,
  fontSize: FONT.sizeSmall,
};

const iconWellStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 18,
  flexShrink: 0,
  color: "rgba(255, 255, 255, 0.8)",
};

const rowLabelStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: "nowrap",
};

// Fixed-width label column shared by slider and toggle rows so their
// controls start at the same x.
const labelColStyle: React.CSSProperties = {
  width: 78,
  flexShrink: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: FONT.sizeSmall,
  color: "rgba(255, 255, 255, 0.85)",
};

function SliderRow({
  tool,
  icon,
  hoverHandlers,
}: {
  tool: ArmedTool;
  icon: React.ReactNode;
  hoverHandlers: Record<string, unknown>;
}): React.JSX.Element | null {
  const session = useOverlaySession();
  const dragPointerRef = useRef<number | null>(null);

  const readLive = (): {
    real: number | null;
    container: Record<string, unknown> | null;
  } => {
    const effect = session.state.getEffect(tool.effectId);
    const param = effect?.params[tool.paramKey];
    if (param === undefined) return { real: null, container: null };
    const diff = session.diffs.getDiff(tool.effectId)[tool.paramKey];
    const live = diff !== undefined ? diff.to : param.value;
    if (tool.axis !== undefined) {
      if (typeof live !== "object" || live === null)
        return { real: null, container: null };
      const container = live as Record<string, unknown>;
      const v = container[tool.axis];
      return {
        real: typeof v === "number" ? v : tool.axis === "mass" ? 1 : null,
        container,
      };
    }
    return { real: typeof live === "number" ? live : null, container: null };
  };

  const { real } = readLive();
  if (real === null) return null;
  const scale = valueToScale(real, tool.spec);

  const apply = (nextScale: number): void => {
    const nextReal = scaleToValue(nextScale, tool.spec);
    if (tool.axis !== undefined) {
      const { container } = readLive();
      if (container !== null) {
        session.manipulate(tool.effectId, tool.paramKey, {
          ...container,
          [tool.axis]: nextReal,
        });
      }
    } else {
      session.manipulate(tool.effectId, tool.paramKey, nextReal);
    }
  };

  const applyPointer = (input: HTMLInputElement, clientX: number): void => {
    const rect = input.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nextScale = Math.min(
      10,
      Math.max(0, ((clientX - rect.left) / rect.width) * 10),
    );
    apply(nextScale);
  };

  return (
    <div style={rowStyle}>
      {/* Hover chip triggers on the icon + name only — never the slider. */}
      <span
        style={{ display: "flex", alignItems: "center", gap: 8 }}
        {...hoverHandlers}
      >
        <span style={iconWellStyle}>{icon}</span>
        <span style={labelColStyle}>{tool.label}</span>
      </span>
      <span
        style={{
          // Flexes into whatever width the (frozen-for-the-session) bar
          // provides — longer track, finer precision, zero whitespace.
          position: "relative",
          display: "flex",
          alignItems: "center",
          flex: 1,
          minWidth: 150,
          maxWidth: 300,
        }}
      >
        <input
          type="range"
          className="ms-slider"
          min={0}
          max={10}
          step={0.1}
          value={scale}
          onInput={(e) => {
            apply(Number(e.currentTarget.value));
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragPointerRef.current = e.pointerId;
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            applyPointer(e.currentTarget, e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragPointerRef.current !== e.pointerId) return;
            applyPointer(e.currentTarget, e.clientX);
          }}
          onPointerUp={(e) => {
            if (dragPointerRef.current !== e.pointerId) return;
            dragPointerRef.current = null;
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={() => {
            dragPointerRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragPointerRef.current = null;
          }}
          aria-label={`${tool.label} slider`}
          style={
            {
              width: "100%",
              margin: 0,
              cursor: "pointer",
              touchAction: "none",
              "--ms-fill": `${String((scale / 10) * 100)}%`,
            } as React.CSSProperties
          }
        />
      </span>
    </div>
  );
}
