import { useCallback, useState } from "react";

import { useOverlaySession } from "../context.js";
import { COLORS, STRENGTH_SURFACE, STROKE } from "../theme.js";
import { NumericEditor, SurfaceContextMenu } from "./shared/context-menu.js";
import { useNodeRect } from "./shared/hooks.js";
import type { SurfaceProps } from "./shared/props.js";

// Distance from centre → parameter value, clamped to [min, max]. Exposed
// for unit tests independent of DOM state.
export function strengthValueFromDistance(
  distance: number,
  min: number,
  max: number,
  maxDrag: number,
): number {
  const range = max - min;
  const raw = min + (Math.min(distance, maxDrag) / maxDrag) * range;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}

export function arrowLengthForValue(
  value: number,
  min: number,
  max: number,
  maxLen: number,
): number {
  const range = max - min;
  if (range <= 0) return 0;
  const fraction = (value - min) / range;
  return Math.max(0, Math.min(1, fraction)) * maxLen;
}

interface Props extends SurfaceProps<number> {}

export function SpatialStrengthSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const validBounds = min < max;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (!validBounds || rect === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDragging(true);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const move = (ev: PointerEvent): void => {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        const next = strengthValueFromDistance(
          dist,
          min,
          max,
          STRENGTH_SURFACE.maxDragDistance,
        );
        session.manipulate(effectId, paramKey, roundStrength(next, min, max));
      };
      const up = (): void => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // pointer already released
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [effectId, max, min, paramKey, rect, session, validBounds],
  );

  const submitEdit = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        const clamped = Math.max(min, Math.min(max, n));
        session.manipulate(effectId, paramKey, clamped);
      }
      setEditing(false);
    },
    [effectId, max, min, paramKey, session],
  );

  if (rect === null) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const arrowLen = arrowLengthForValue(
    liveValue,
    min,
    max,
    STRENGTH_SURFACE.arrowMaxLength,
  );

  const arrows = Array.from({ length: STRENGTH_SURFACE.arrowCount }, (_, i) => {
    const angle = (i / STRENGTH_SURFACE.arrowCount) * Math.PI * 2;
    return {
      angle,
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(angle) * arrowLen,
      y2: cy + Math.sin(angle) * arrowLen,
    };
  });

  return (
    <>
      <rect
        x={rect.left}
        y={rect.top}
        width={rect.width}
        height={rect.height}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      {arrows.map((arrow, i) => (
        <g key={i} pointerEvents="none">
          <line
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
            stroke={COLORS.accentSoft}
            strokeWidth={STROKE.chunky}
            strokeLinecap="round"
          />
          {arrowLen > 6 && (
            <ArrowHead
              x={arrow.x2}
              y={arrow.y2}
              angle={arrow.angle}
              color={COLORS.accent}
            />
          )}
        </g>
      ))}
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={COLORS.accent}
        stroke={COLORS.panelBg}
        strokeWidth={2}
        pointerEvents="none"
      />
      {editing && (
        <foreignObject
          x={cx + STRENGTH_SURFACE.arrowMaxLength + 20}
          y={cy - 14}
          width={140}
          height={30}
          style={{ overflow: "visible" }}
        >
          <NumericEditor
            initial={liveValue}
            step={max - min <= 2 ? 0.01 : 0.1}
            onSubmit={submitEdit}
            onCancel={() => setEditing(false)}
          />
        </foreignObject>
      )}
      {menu !== null && (
        <foreignObject
          x={0}
          y={0}
          width={window.innerWidth}
          height={window.innerHeight}
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          <SurfaceContextMenu
            x={menu.x}
            y={menu.y}
            currentType={param.type}
            effectId={effectId}
            paramKey={paramKey}
            onEnterExactValue={() => {
              setMenu(null);
              setEditing(true);
            }}
            onClose={() => setMenu(null)}
          />
        </foreignObject>
      )}
    </>
  );
}

interface ArrowHeadProps {
  x: number;
  y: number;
  angle: number;
  color: string;
}

function ArrowHead({ x, y, angle, color }: ArrowHeadProps): React.JSX.Element {
  const head = STRENGTH_SURFACE.arrowHeadLength;
  const wing = STRENGTH_SURFACE.arrowHeadWidth;
  const backX = x - Math.cos(angle) * head;
  const backY = y - Math.sin(angle) * head;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const p1x = backX + nx * wing;
  const p1y = backY + ny * wing;
  const p2x = backX - nx * wing;
  const p2y = backY - ny * wing;
  return (
    <polygon points={`${x},${y} ${p1x},${p1y} ${p2x},${p2y}`} fill={color} />
  );
}

function roundStrength(value: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 2) return Math.round(value * 1000) / 1000;
  if (range <= 20) return Math.round(value * 100) / 100;
  return Math.round(value);
}
