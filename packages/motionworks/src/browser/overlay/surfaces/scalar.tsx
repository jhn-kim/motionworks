import { useCallback, useMemo, useState } from 'react';

import type { MotionWorksParam } from '../../../shared/index.js';

import { useOverlaySession } from '../context.js';
import { COLORS, FONT, HANDLES, STROKE } from '../theme.js';
import { NumericEditor, SurfaceContextMenu } from './shared/context-menu.js';
import { useNodeRect } from './shared/hooks.js';
import type { SurfaceProps } from './shared/props.js';

const TRACK_HEIGHT = 140;
const TRACK_WIDTH = 4;
const TRACK_OFFSET_X = 24;
const FINE_MULTIPLIER = 0.1;

// Maps a knob y position (viewport-space) to a parameter value, clamped to
// [min, max]. Split out so the wire-mapping is unit-testable independently
// of DOM state.
export function scalarValueFromDrag(
  startY: number,
  startValue: number,
  currentY: number,
  min: number,
  max: number,
  trackHeight: number,
  fine: boolean,
): number {
  const range = max - min;
  const deltaY = startY - currentY; // up = positive
  const fraction = (deltaY / trackHeight) * (fine ? FINE_MULTIPLIER : 1);
  const raw = startValue + fraction * range;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}

interface Props extends SurfaceProps<number> {}

export function ScalarSurface({ effectId, paramKey, param, liveValue, node }: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const bounds = useMemo(() => {
    const min = param.min ?? 0;
    const max = param.max ?? 1;
    return min < max ? { min, max } : { min: 0, max: 1 };
  }, [param.min, param.max]);

  const clamp = useCallback(
    (v: number): number => {
      if (v < bounds.min) return bounds.min;
      if (v > bounds.max) return bounds.max;
      return v;
    },
    [bounds],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDragging(true);
      const startY = event.clientY;
      const startValue = liveValue;
      const move = (ev: PointerEvent): void => {
        const next = scalarValueFromDrag(
          startY,
          startValue,
          ev.clientY,
          bounds.min,
          bounds.max,
          TRACK_HEIGHT,
          ev.shiftKey,
        );
        session.manipulate(effectId, paramKey, roundFor(next, bounds));
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
    [bounds, effectId, liveValue, paramKey, session],
  );

  const submitEdit = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (Number.isFinite(n)) session.manipulate(effectId, paramKey, clamp(n));
      setEditing(false);
    },
    [clamp, effectId, paramKey, session],
  );

  if (rect === null) return null;

  const trackX = rect.right + TRACK_OFFSET_X;
  const trackTop = rect.top + rect.height / 2 - TRACK_HEIGHT / 2;
  const trackBottom = trackTop + TRACK_HEIGHT;
  const fraction = (liveValue - bounds.min) / (bounds.max - bounds.min);
  const knobY = trackBottom - fraction * TRACK_HEIGHT;
  const label = formatScalar(liveValue, param, bounds);

  return (
    <>
      <rect
        x={trackX - TRACK_WIDTH / 2}
        y={trackTop}
        width={TRACK_WIDTH}
        height={TRACK_HEIGHT}
        rx={TRACK_WIDTH / 2}
        fill={COLORS.panelHairline}
        pointerEvents="none"
      />
      <line
        x1={trackX}
        y1={knobY}
        x2={trackX}
        y2={trackBottom}
        stroke={COLORS.accentSoft}
        strokeWidth={TRACK_WIDTH}
        strokeLinecap="round"
        pointerEvents="none"
      />
      <circle
        cx={trackX}
        cy={knobY}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <circle
        cx={trackX}
        cy={knobY}
        r={HANDLES.visibleRadius}
        fill={COLORS.accent}
        pointerEvents="none"
      />
      <text
        x={trackX + HANDLES.hitRadius + 6}
        y={knobY + 4}
        fill={COLORS.neutralInk}
        fontFamily={FONT.mono}
        fontSize={FONT.sizeSmall}
        pointerEvents="none"
      >
        {label}
      </text>
      <line
        x1={trackX - TRACK_WIDTH}
        y1={trackTop}
        x2={trackX + TRACK_WIDTH}
        y2={trackTop}
        stroke={COLORS.panelBorder}
        strokeWidth={STROKE.secondary}
        pointerEvents="none"
      />
      <line
        x1={trackX - TRACK_WIDTH}
        y1={trackBottom}
        x2={trackX + TRACK_WIDTH}
        y2={trackBottom}
        stroke={COLORS.panelBorder}
        strokeWidth={STROKE.secondary}
        pointerEvents="none"
      />
      {editing && (
        <foreignObject x={trackX + 20} y={knobY - 14} width={140} height={30} style={{ overflow: 'visible' }}>
          <NumericEditor
            initial={liveValue}
            step={rangeStep(bounds)}
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

function rangeStep(bounds: { min: number; max: number }): number {
  const range = bounds.max - bounds.min;
  if (range <= 2) return 0.01;
  if (range <= 20) return 0.1;
  return 1;
}

function roundFor(value: number, bounds: { min: number; max: number }): number {
  const range = bounds.max - bounds.min;
  if (range <= 2) return Math.round(value * 1000) / 1000;
  if (range <= 20) return Math.round(value * 100) / 100;
  return Math.round(value);
}

function formatScalar(value: number, param: MotionWorksParam, bounds: { min: number; max: number }): string {
  const unit = param.unit ?? '';
  const range = bounds.max - bounds.min;
  const text = range <= 2 ? value.toFixed(2) : range <= 20 ? value.toFixed(1) : String(Math.round(value));
  return `${text}${unit}`;
}
