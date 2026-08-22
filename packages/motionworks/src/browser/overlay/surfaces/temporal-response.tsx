import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOverlaySession } from '../context.js';
import { COLORS, FONT, HANDLES, PANEL, RESPONSE_SURFACE, STROKE } from '../theme.js';
import { NumericEditor, SurfaceContextMenu } from './shared/context-menu.js';
import { useCanvasDrawer, useNodeRect } from './shared/hooks.js';
import type { SurfaceProps } from './shared/props.js';

// Non-linear gap ↔ response mapping. Response is a lerp factor between 0 and
// 1 (or a param-max). Larger response → less lag → smaller gap. The curve is
// biased so tiny changes in lag at low values move the gap more (matches how
// a designer perceives a slow-following effect).
export function responseFromGap(gap: number, min: number, max: number): number {
  const clampedGap = Math.max(0, Math.min(gap, RESPONSE_SURFACE.maxGhostLagPx));
  // gap 0 → response max; gap maxGhostLagPx → response min
  const t = clampedGap / RESPONSE_SURFACE.maxGhostLagPx;
  // Non-linear: exponent > 1 pushes more of the curve into the small-value
  // region so slow-follow adjustments feel finer.
  const shaped = 1 - Math.pow(t, RESPONSE_SURFACE.gapCurveExponent);
  const value = min + shaped * (max - min);
  return Math.max(min, Math.min(max, value));
}

export function gapFromResponse(value: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return 0;
  const shaped = (value - min) / range;
  const clamped = Math.max(0, Math.min(1, shaped));
  // Invert the exponent to go value → gap.
  const t = Math.pow(1 - clamped, 1 / RESPONSE_SURFACE.gapCurveExponent);
  return t * RESPONSE_SURFACE.maxGhostLagPx;
}

interface Props extends SurfaceProps<number> {}

export function TemporalResponseSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const cursorRef = useRef<{ x: number; y: number; lastMove: number }>({
    x: 0,
    y: 0,
    lastMove: 0,
  });
  const [motionActive, setMotionActive] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const liveRef = useRef(liveValue);
  liveRef.current = liveValue;
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const min = param.min ?? 0;
  const max = param.max ?? 1;

  // Watch for cursor movement over the element to know whether the primary
  // visualization applies. If the cursor hasn't moved over the element in a
  // while, the fallback prompt renders.
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const r = rectRef.current;
      if (r === null) return;
      const inside =
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom;
      if (!inside) return;
      cursorRef.current = { x: event.clientX, y: event.clientY, lastMove: performance.now() };
      setMotionActive(true);
    };
    window.addEventListener('pointermove', onMove);
    const staleInterval = window.setInterval(() => {
      if (
        cursorRef.current.lastMove === 0 ||
        performance.now() - cursorRef.current.lastMove > RESPONSE_SURFACE.stationaryPromptMs
      ) {
        setMotionActive(false);
      }
    }, 200);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearInterval(staleInterval);
    };
  }, []);

  // Ghost render on the canvas. The ghost sits behind the element by an
  // amount derived from the current response value.
  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D): void => {
      const r = rectRef.current;
      if (r === null) return;
      const gap = gapFromResponse(liveRef.current, min, max);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const cursor = cursorRef.current;
      let dirX = 0;
      let dirY = 0;
      if (cursor.lastMove !== 0 && performance.now() - cursor.lastMove < 1200) {
        const dx = cx - cursor.x;
        const dy = cy - cursor.y;
        const mag = Math.hypot(dx, dy);
        if (mag > 0.1) {
          dirX = dx / mag;
          dirY = dy / mag;
        }
      }
      const gx = cx + dirX * gap;
      const gy = cy + dirY * gap;
      ctx.save();
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = STROKE.primary;
      ctx.strokeRect(gx - r.width / 2, gy - r.height / 2, r.width, r.height);
      ctx.setLineDash([]);
      // Gap arrow ghost → real
      ctx.strokeStyle = COLORS.accentSoft;
      ctx.lineWidth = STROKE.chunky;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.restore();
    };
  }, [max, min]);
  useCanvasDrawer(draw);

  const handleGapDrag = useCallback(
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
        const gap = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        const next = responseFromGap(gap, min, max);
        session.manipulate(effectId, paramKey, roundResponse(next));
      };
      const up = (): void => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // pointer already released
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
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

  // For the interactive handle in SVG, place it on a horizontal axis to the
  // right. Whether or not the cursor is over the element, dragging the
  // handle is meaningful — the fallback surfaces the same control.
  const gapPx = gapFromResponse(liveValue, min, max);

  return (
    <>
      {motionActive ? (
        <circle
          cx={cx + gapPx}
          cy={cy}
          r={HANDLES.hitRadius}
          fill="rgba(94, 234, 212, 0.001)"
          stroke="none"
          pointerEvents="all"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={handleGapDrag}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        />
      ) : (
        <ResponseFallback
          rect={rect}
          liveValue={liveValue}
          min={min}
          max={max}
          onDrag={(newValue) => session.manipulate(effectId, paramKey, roundResponse(newValue))}
          onContextMenu={(x, y) => setMenu({ x, y })}
        />
      )}
      {motionActive && (
        <circle
          cx={cx + gapPx}
          cy={cy}
          r={HANDLES.visibleRadius}
          fill={COLORS.accent}
          pointerEvents="none"
        />
      )}
      {editing && (
        <foreignObject
          x={cx + gapPx + 20}
          y={cy - 14}
          width={140}
          height={30}
          style={{ overflow: 'visible' }}
        >
          <NumericEditor initial={liveValue} step={0.01} onSubmit={submitEdit} onCancel={() => setEditing(false)} />
        </foreignObject>
      )}
      {menu !== null && (
        <foreignObject
          x={0}
          y={0}
          width={window.innerWidth}
          height={window.innerHeight}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
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

// Fallback (CHALLENGES.md §10): before/after slider below the element.
interface FallbackProps {
  rect: DOMRect;
  liveValue: number;
  min: number;
  max: number;
  onDrag: (value: number) => void;
  onContextMenu: (x: number, y: number) => void;
}

const FALLBACK_HEIGHT = 32;

function ResponseFallback({
  rect,
  liveValue,
  min,
  max,
  onDrag,
  onContextMenu,
}: FallbackProps): React.JSX.Element {
  const trackY = rect.bottom + 24;
  const trackX = rect.left;
  const trackWidth = rect.width;
  const fraction = (liveValue - min) / (max - min);
  const knobX = trackX + Math.max(0, Math.min(1, fraction)) * trackWidth;

  const onDown = (event: React.PointerEvent<SVGCircleElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent): void => {
      const clampedX = Math.max(trackX, Math.min(trackX + trackWidth, ev.clientX));
      const f = (clampedX - trackX) / trackWidth;
      onDrag(min + f * (max - min));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // pointer already released
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <rect
        x={trackX}
        y={trackY}
        width={trackWidth}
        height={4}
        rx={2}
        fill={COLORS.panelHairline}
        pointerEvents="none"
      />
      <rect
        x={trackX}
        y={trackY}
        width={knobX - trackX}
        height={4}
        rx={2}
        fill={COLORS.accentSoft}
        pointerEvents="none"
      />
      <circle
        cx={knobX}
        cy={trackY + 2}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: 'grab' }}
        onPointerDown={onDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY);
        }}
      />
      <circle
        cx={knobX}
        cy={trackY + 2}
        r={HANDLES.visibleRadius}
        fill={COLORS.accent}
        pointerEvents="none"
      />
      <foreignObject
        x={trackX}
        y={trackY + FALLBACK_HEIGHT / 2 + 8}
        width={trackWidth + 100}
        height={40}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div
          style={{
            fontFamily: FONT.family,
            fontSize: FONT.sizeSmall,
            color: COLORS.neutralInkMuted,
            padding: '4px 8px',
            background: COLORS.panelBg,
            border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: PANEL.radius,
            display: 'inline-block',
          }}
        >
          Move the cursor over this element to feel the response
        </div>
      </foreignObject>
    </>
  );
}

function roundResponse(v: number): number {
  return Math.round(v * 1000) / 1000;
}
