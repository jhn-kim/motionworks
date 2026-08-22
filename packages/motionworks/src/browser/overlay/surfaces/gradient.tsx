import { useCallback, useMemo, useRef, useState } from 'react';

import type { GradientStop } from '../../../shared/index.js';

import { ColorPickerPopover } from '../color-picker.js';
import { useOverlaySession } from '../context.js';
import { COLORS, FONT, GRADIENT_SURFACE, HANDLES } from '../theme.js';
import { SurfaceContextMenu } from './shared/context-menu.js';
import { useCanvasDrawer, useNodeRect } from './shared/hooks.js';
import type { SurfaceProps } from './shared/props.js';

const MIN_STOPS = 2;

// Sorts stops by position and clamps positions to [0, 1]. Used before
// committing changes so downstream code can rely on sorted, valid stops.
export function normaliseStops(stops: GradientStop[]): GradientStop[] {
  return [...stops]
    .map((s) => ({ stop: Math.max(0, Math.min(1, s.stop)), color: s.color }))
    .sort((a, b) => a.stop - b.stop);
}

// Interpolate a colour between two adjacent stops at a given position.
// Handles common CSS colour formats: hex (#rgb, #rrggbb) and rgb(...).
export function interpolateStopColor(stops: GradientStop[], t: number): string {
  const sorted = normaliseStops(stops);
  if (sorted.length === 0) return '#ffffff';
  if (sorted.length === 1 || t <= sorted[0]!.stop) return sorted[0]!.color;
  if (t >= sorted[sorted.length - 1]!.stop) return sorted[sorted.length - 1]!.color;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (t >= a.stop && t <= b.stop) {
      const range = b.stop - a.stop;
      const local = range === 0 ? 0 : (t - a.stop) / range;
      return mixColors(a.color, b.color, local);
    }
  }
  return sorted[0]!.color;
}

function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bch = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${String(r)}, ${String(g)}, ${String(bch)})`;
}

function parseColor(input: string): { r: number; g: number; b: number } {
  const s = input.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  const rgbMatch = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (rgbMatch !== null) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }
  // Fallback: unknown syntax → white so nothing crashes.
  return { r: 255, g: 255, b: 255 };
}

interface Props extends SurfaceProps<GradientStop[]> {}

// Gradient stops render as a horizontal bar below the element (the §10
// fallback form). The primary "along a phenomenon" form requires a visible
// path phenomenon — for MVP we ship the fallback across the board because it
// composes with any effect.
export function GradientSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorEditor, setColorEditor] = useState<{ index: number; x: number; y: number } | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const liveRef = useRef(liveValue);
  liveRef.current = liveValue;

  const stops = useMemo(() => normaliseStops(liveValue), [liveValue]);

  const commit = useCallback(
    (next: GradientStop[]): void => {
      session.manipulate(effectId, paramKey, normaliseStops(next));
    },
    [effectId, paramKey, session],
  );

  const barX = rect?.left ?? 0;
  const barY = (rect?.bottom ?? 0) + GRADIENT_SURFACE.barMarginTop;
  const barWidth = rect?.width ?? 0;
  const barHeight = GRADIENT_SURFACE.barHeight;

  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D): void => {
      const r = rectRef.current;
      if (r === null) return;
      const bx = r.left;
      const by = r.bottom + GRADIENT_SURFACE.barMarginTop;
      const bw = r.width;
      const bh = GRADIENT_SURFACE.barHeight;
      const gradient = ctx.createLinearGradient(bx, by, bx + bw, by);
      for (const s of normaliseStops(liveRef.current)) {
        gradient.addColorStop(Math.max(0, Math.min(1, s.stop)), s.color);
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = COLORS.panelBorder;
      ctx.strokeRect(bx, by, bw, bh);
    };
  }, []);
  useCanvasDrawer(draw);

  const startStopDrag = useCallback(
    (index: number) => (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const rectNow = rectRef.current;
      if (rectNow === null) return;
      const move = (ev: PointerEvent): void => {
        const local = ev.clientX - rectNow.left;
        const t = Math.max(0, Math.min(1, local / rectNow.width));
        // Dragging vertically off the bar removes the stop (as long as we
        // still have at least MIN_STOPS).
        const dy = Math.abs(ev.clientY - (rectNow.bottom + GRADIENT_SURFACE.barMarginTop + GRADIENT_SURFACE.barHeight / 2));
        const current = liveRef.current;
        if (dy > 40 && current.length > MIN_STOPS) {
          commit(current.filter((_, i) => i !== index));
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          return;
        }
        const next = current.map((s, i) => (i === index ? { ...s, stop: t } : s));
        commit(next);
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
    },
    [commit],
  );

  const onBarClick = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const rectNow = rectRef.current;
      if (rectNow === null) return;
      const local = event.clientX - rectNow.left;
      const t = Math.max(0, Math.min(1, local / rectNow.width));
      const interp = interpolateStopColor(liveRef.current, t);
      commit([...liveRef.current, { stop: t, color: interp }]);
    },
    [commit],
  );

  if (rect === null) return null;

  return (
    <>
      <rect
        x={barX}
        y={barY}
        width={barWidth}
        height={barHeight}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: 'copy' }}
        onClick={onBarClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      {stops.map((stop, i) => {
        const x = barX + stop.stop * barWidth;
        const y = barY + barHeight / 2;
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={HANDLES.hitRadius}
              fill="rgba(94, 234, 212, 0.001)"
              stroke="none"
              pointerEvents="all"
              style={{ cursor: 'grab' }}
              onPointerDown={startStopDrag(i)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setColorEditor({ index: i, x: e.clientX, y: e.clientY });
              }}
            />
            <circle
              cx={x}
              cy={y}
              r={GRADIENT_SURFACE.stopRadius}
              fill={stop.color}
              stroke={COLORS.neutralInk}
              strokeWidth={GRADIENT_SURFACE.stopBorderPx}
              pointerEvents="none"
            />
          </g>
        );
      })}
      {colorEditor !== null && (
        <ColorPickerPopover
          x={colorEditor.x}
          y={colorEditor.y}
          color={stops[colorEditor.index]?.color ?? '#ffffff'}
          onChange={(color) => {
            const next = liveRef.current.map((s, i) => (i === colorEditor.index ? { ...s, color } : s));
            commit(next);
          }}
          onClose={() => setColorEditor(null)}
        />
      )}
      <foreignObject
        x={barX}
        y={barY + barHeight + 4}
        width={barWidth + 300}
        height={28}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div
          style={{
            fontFamily: FONT.family,
            fontSize: FONT.sizeSmall,
            color: COLORS.neutralInkMuted,
          }}
        >
          Click to add a stop · double-click a stop to change colour · drag off to remove (min {String(MIN_STOPS)})
        </div>
      </foreignObject>
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
            onEnterExactValue={() => setMenu(null)}
            onClose={() => setMenu(null)}
          />
        </foreignObject>
      )}
    </>
  );
}

