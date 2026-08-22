import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOverlaySession } from "../context.js";
import { COLORS, DECAY_SURFACE, FONT, HANDLES, PANEL } from "../theme.js";
import { NumericEditor, SurfaceContextMenu } from "./shared/context-menu.js";
import { useCanvasDrawer, useNodeRect } from "./shared/hooks.js";
import type { SurfaceProps } from "./shared/props.js";

// Maps a designer-drawn trail length (in pixels) to the parameter value in
// [min, max]. Longer trail → higher decay (slower fade). Exposed for tests.
export function decayValueFromTrailLength(
  pixels: number,
  min: number,
  max: number,
): number {
  const range = DECAY_SURFACE.maxTrailPx - DECAY_SURFACE.minTrailPx;
  const t = Math.max(
    0,
    Math.min(1, (pixels - DECAY_SURFACE.minTrailPx) / range),
  );
  return min + t * (max - min);
}

export function trailLengthFromValue(
  value: number,
  min: number,
  max: number,
): number {
  const range = max - min;
  if (range <= 0) return DECAY_SURFACE.minTrailPx;
  const t = Math.max(0, Math.min(1, (value - min) / range));
  return (
    DECAY_SURFACE.minTrailPx +
    t * (DECAY_SURFACE.maxTrailPx - DECAY_SURFACE.minTrailPx)
  );
}

interface Props extends SurfaceProps<number> {}

interface TrackedPoint {
  x: number;
  y: number;
  t: number;
}

export function TemporalDecaySurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const historyRef = useRef<TrackedPoint[]>([]);
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const [movingRecently, setMovingRecently] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const liveRef = useRef(liveValue);
  liveRef.current = liveValue;

  const min = param.min ?? 0;
  const max = param.max ?? 1;

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const step = (): void => {
      if (cancelled) return;
      const r = rectRef.current;
      if (r !== null) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const prev = lastCenterRef.current;
        const now = performance.now();
        const moved =
          prev !== null &&
          Math.hypot(cx - prev.x, cy - prev.y) > DECAY_SURFACE.motionThreshold;
        if (moved) {
          historyRef.current.push({ x: cx, y: cy, t: now });
          if (historyRef.current.length > DECAY_SURFACE.historyCap) {
            historyRef.current.shift();
          }
          lastMoveTimeRef.current = now;
        }
        lastCenterRef.current = { x: cx, y: cy };
        const activeNow =
          now - lastMoveTimeRef.current < DECAY_SURFACE.stationaryPromptMs;
        setMovingRecently((prev) => (prev !== activeNow ? activeNow : prev));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Tapered trail draw: from newest point (full opacity) back through
  // history, fading, until the visual length matches liveValue.
  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D): void => {
      const history = historyRef.current;
      if (history.length < 2) return;
      const targetLength = trailLengthFromValue(liveRef.current, min, max);
      let accumulated = 0;
      const points: Array<{ x: number; y: number; opacity: number }> = [];
      // Walk from newest to oldest.
      for (let i = history.length - 1; i >= 0; i--) {
        const p = history[i]!;
        if (points.length === 0) {
          points.push({ x: p.x, y: p.y, opacity: 1 });
          continue;
        }
        const prev = points[points.length - 1]!;
        const segLen = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (segLen === 0) continue;
        accumulated += segLen;
        if (accumulated > targetLength) break;
        const opacity = 1 - accumulated / targetLength;
        points.push({ x: p.x, y: p.y, opacity });
      }
      ctx.save();
      // Draw as a series of small circles (dots) — feels more organic than
      // a stroked path and handles opacity per-segment cheaply.
      for (const p of points) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(94, 234, 212, ${p.opacity.toFixed(3)})`;
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
  }, [max, min]);
  useCanvasDrawer(draw);

  const handleTailDrag = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      if (rect === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDragging(true);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const move = (ev: PointerEvent): void => {
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        const next = decayValueFromTrailLength(dist, min, max);
        session.manipulate(effectId, paramKey, roundDecay(next));
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
    [effectId, max, min, paramKey, rect, session],
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
  const trailLen = trailLengthFromValue(liveValue, min, max);

  // Tail-end handle: prefer the actual oldest visible point when we have
  // history; otherwise place it to the right of the element as a fallback so
  // the designer can still drag.
  const tail =
    historyRef.current.length >= 2 && movingRecently
      ? historyRef.current[0]!
      : { x: cx + trailLen, y: cy };

  return (
    <>
      <circle
        cx={tail.x}
        cy={tail.y}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={handleTailDrag}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <circle
        cx={tail.x}
        cy={tail.y}
        r={HANDLES.visibleRadius}
        fill={COLORS.accent}
        pointerEvents="none"
      />
      {!movingRecently && historyRef.current.length < 2 && (
        <foreignObject
          x={rect.left}
          y={rect.bottom + 12}
          width={rect.width + 240}
          height={FALLBACK_HEIGHT + 16}
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          <div
            style={{
              fontFamily: FONT.family,
              fontSize: FONT.sizeSmall,
              color: COLORS.neutralInkMuted,
              padding: "4px 8px",
              background: COLORS.panelBg,
              border: `1px solid ${COLORS.panelBorder}`,
              borderRadius: PANEL.radius,
              display: "inline-block",
            }}
          >
            Move the cursor over this element to see the trail
          </div>
        </foreignObject>
      )}
      <DecayFallbackBar
        rect={rect}
        liveValue={liveValue}
        min={min}
        max={max}
        onChange={(v) => session.manipulate(effectId, paramKey, roundDecay(v))}
      />
      {editing && (
        <foreignObject
          x={tail.x + 20}
          y={tail.y - 14}
          width={140}
          height={30}
          style={{ overflow: "visible" }}
        >
          <NumericEditor
            initial={liveValue}
            step={0.01}
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

// Horizontal bar fallback — always available so the designer has a way to
// commit the change even if the trail visualization isn't visible.
interface BarProps {
  rect: DOMRect;
  liveValue: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const FALLBACK_HEIGHT = 14;

function DecayFallbackBar({
  rect,
  liveValue,
  min,
  max,
  onChange,
}: BarProps): React.JSX.Element {
  const y = rect.bottom + 60;
  const width = rect.width;
  const fraction = Math.max(0, Math.min(1, (liveValue - min) / (max - min)));
  const knobX = rect.left + fraction * width;
  const onDown = (event: React.PointerEvent<SVGCircleElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent): void => {
      const clampedX = Math.max(
        rect.left,
        Math.min(rect.left + width, ev.clientX),
      );
      const f = (clampedX - rect.left) / width;
      onChange(min + f * (max - min));
    };
    const up = (): void => {
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
  };
  return (
    <>
      <rect
        x={rect.left}
        y={y}
        width={width}
        height={4}
        rx={2}
        fill={COLORS.panelHairline}
        pointerEvents="none"
      />
      <rect
        x={rect.left}
        y={y}
        width={knobX - rect.left}
        height={4}
        rx={2}
        fill={COLORS.accentFaint}
        pointerEvents="none"
      />
      <circle
        cx={knobX}
        cy={y + 2}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: "grab" }}
        onPointerDown={onDown}
      />
      <circle
        cx={knobX}
        cy={y + 2}
        r={HANDLES.visibleRadius - 1}
        fill={COLORS.accentSoft}
        pointerEvents="none"
      />
    </>
  );
}

function roundDecay(v: number): number {
  return Math.round(v * 1000) / 1000;
}
