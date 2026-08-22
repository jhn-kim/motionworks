import { useCallback, useEffect, useRef, useState } from 'react';

import type { MotionWorksParam } from '../../../shared/index.js';

import { useOverlaySession } from '../context.js';
import { COLORS, HANDLES, RADIUS_SURFACE, STROKE } from '../theme.js';
import { NumericEditor, SurfaceContextMenu } from './shared/context-menu.js';

// Applies the spatial-radius clamping rule from MANIPULATION_SURFACES.md:
// minimum is max(param.min, 8), maximum is min(param.max, viewport short side).
export function clampRadius(raw: number, param: MotionWorksParam, viewportShort: number): number {
  const min = Math.max(param.min ?? 0, RADIUS_SURFACE.minHandlePx);
  const cap = Math.min(param.max ?? Number.POSITIVE_INFINITY, viewportShort);
  const upper = Math.max(min, cap);
  if (raw < min) return min;
  if (raw > upper) return upper;
  return raw;
}

interface Props {
  effectId: string;
  paramKey: string;
  param: MotionWorksParam;
  liveValue: number;
  node: HTMLElement;
}

// Draws the spatial-radius surface: a circle centred on the element's bbox
// with a drag handle at the rightmost point. The circle position is
// re-derived from getBoundingClientRect on every animation frame so it
// keeps tracking the element even during scroll or layout shifts.
export function SpatialRadiusSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element {
  const session = useOverlaySession();
  const [center, setCenter] = useState(() => centerOfNode(node));
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const rafRef = useRef<number | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const next = centerOfNode(node);
      const prev = centerRef.current;
      if (next.x !== prev.x || next.y !== prev.y) setCenter(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [node]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDragging(true);
      // Freeze the drag origin at pointerdown. If we re-read
      // getBoundingClientRect on every move, an update() that translates
      // the element (like a live-preview entrance animation) shifts the
      // bbox mid-drag and creates a runaway feedback loop.
      const dragCenter = centerOfNode(node);
      const move = (ev: PointerEvent): void => {
        const raw = Math.hypot(ev.clientX - dragCenter.x, ev.clientY - dragCenter.y);
        // spatial-radius values are pixels; sub-pixel precision just noises
        // up changesets and reads badly in the panel.
        const clamped = Math.round(clampRadius(raw, param, viewportShortSide()));
        session.manipulate(effectId, paramKey, clamped);
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
    [effectId, node, param, paramKey, session],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const submitEdit = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        const clamped = clampRadius(n, param, viewportShortSide());
        session.manipulate(effectId, paramKey, clamped);
      }
      setEditing(false);
    },
    [effectId, param, paramKey, session],
  );

  const r = Math.max(0, liveValue);
  const handleX = center.x + r;
  const handleY = center.y;

  return (
    <>
      <circle
        cx={center.x}
        cy={center.y}
        r={r}
        fill="none"
        stroke={COLORS.accentSoft}
        strokeWidth={STROKE.primary}
        strokeDasharray={STROKE.dashed}
        pointerEvents="none"
      />
      <circle
        cx={handleX}
        cy={handleY}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        // Parent <svg> is pointer-events: none, so SVG children inherit
        // that. `all` forces hit-testing regardless of the near-transparent
        // fill and lets pointerdown reach onPointerDown.
        pointerEvents="all"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
      />
      <circle
        cx={handleX}
        cy={handleY}
        r={HANDLES.visibleRadius}
        fill={COLORS.accent}
        pointerEvents="none"
      />
      {editing && (
        <foreignObject
          x={handleX + HANDLES.hitRadius}
          y={handleY - HANDLES.hitRadius}
          width={120}
          height={30}
          style={{ overflow: 'visible' }}
        >
          <NumericEditor initial={liveValue} onSubmit={submitEdit} onCancel={() => setEditing(false)} />
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
            currentType="spatial-radius"
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

function centerOfNode(node: HTMLElement): { x: number; y: number } {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function viewportShortSide(): number {
  if (typeof window === 'undefined') return 800;
  return Math.min(window.innerWidth, window.innerHeight);
}
