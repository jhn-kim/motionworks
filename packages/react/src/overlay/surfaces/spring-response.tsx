import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SpringValue } from '@motionworks/core';

import { useOverlaySession } from '../context.js';
import { COLORS, FONT, HANDLES, PANEL, SPRING_SURFACE, STROKE } from '../theme.js';
import { NumericEditor, SurfaceContextMenu } from './shared/context-menu.js';
import { useCanvasDrawer, useNodeRect } from './shared/hooks.js';
import type { SurfaceProps } from './shared/props.js';

// Normalises a single-number spring param to a {stiffness, damping, mass?}
// object using the defaults. Exposed so tests can pin down the conversion.
export function toSpringValue(value: unknown): SpringValue {
  if (typeof value === 'number') {
    // A normalised scalar 0–1: map to a natural stiffness/damping curve so
    // 0 = floaty, 1 = crisp.
    const t = Math.max(0, Math.min(1, value));
    return {
      stiffness:
        SPRING_SURFACE.stiffnessRange.min +
        t * (SPRING_SURFACE.stiffnessRange.max - SPRING_SURFACE.stiffnessRange.min),
      damping:
        SPRING_SURFACE.dampingRange.min +
        t * (SPRING_SURFACE.dampingRange.max - SPRING_SURFACE.dampingRange.min),
      mass: SPRING_SURFACE.massRange.default,
    };
  }
  if (typeof value === 'object' && value !== null) {
    const v = value as Partial<SpringValue>;
    return {
      stiffness: typeof v.stiffness === 'number' ? v.stiffness : SPRING_SURFACE.stiffnessRange.default,
      damping: typeof v.damping === 'number' ? v.damping : SPRING_SURFACE.dampingRange.default,
      ...(typeof v.mass === 'number' ? { mass: v.mass } : {}),
    };
  }
  return {
    stiffness: SPRING_SURFACE.stiffnessRange.default,
    damping: SPRING_SURFACE.dampingRange.default,
  };
}

// Discrete spring integrator; called per animation frame. Modifies pos/vel
// in place so we can drive the CSS transform without allocating.
export function springStep(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  mass: number,
  dt: number,
): { pos: number; vel: number } {
  const displacement = pos - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -damping * vel;
  const acceleration = (springForce + dampingForce) / mass;
  const nextVel = vel + acceleration * dt;
  const nextPos = pos + nextVel * dt;
  return { pos: nextPos, vel: nextVel };
}

interface Props extends SurfaceProps<unknown> {}

// Interaction:
//   1. Pointer down on the element's pull handle → begin drag.
//   2. Drag → element follows the cursor via CSS translate (no spring during
//      drag).
//   3. Release → the sim runs, animating back to (0, 0).
//   4. Stiffness handle (horizontal) and damping handle (vertical) appear
//      after release; dragging either re-runs the sim with the new param.
export function SpringResponseSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const spring = useMemo(() => toSpringValue(liveValue), [liveValue]);
  const springRef = useRef(spring);
  springRef.current = spring;
  const posRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });
  const simRunningRef = useRef(false);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  // Apply the current pos to the actual DOM element via CSS transform. The
  // update() function still fires on parameter changes; this transform is
  // purely the sim's preview.
  const applyTransform = useCallback((): void => {
    node.style.transform = `translate3d(${String(posRef.current.x)}px, ${String(posRef.current.y)}px, 0)`;
  }, [node]);

  useEffect(() => {
    return () => {
      // On unmount / re-select, restore the element transform.
      node.style.transform = '';
    };
  }, [node]);

  const runSim = useCallback((): void => {
    if (simRunningRef.current) return;
    simRunningRef.current = true;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      const dtRaw = (now - last) / 1000;
      const dt = Math.min(dtRaw, 1 / 30);
      last = now;
      const s = springRef.current;
      const mass = s.mass ?? SPRING_SURFACE.massRange.default;
      const stepX = springStep(posRef.current.x, velRef.current.x, 0, s.stiffness, s.damping, mass, dt);
      const stepY = springStep(posRef.current.y, velRef.current.y, 0, s.stiffness, s.damping, mass, dt);
      posRef.current = { x: stepX.pos, y: stepY.pos };
      velRef.current = { x: stepX.vel, y: stepY.vel };
      applyTransform();
      const settled =
        Math.abs(posRef.current.x) < 0.05 &&
        Math.abs(posRef.current.y) < 0.05 &&
        Math.abs(velRef.current.x) < 0.05 &&
        Math.abs(velRef.current.y) < 0.05;
      if (settled) {
        simRunningRef.current = false;
        posRef.current = { x: 0, y: 0 };
        velRef.current = { x: 0, y: 0 };
        applyTransform();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [applyTransform]);

  const startPull = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      if (rect === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      setDragging(true);
      // Cancel any running sim by zeroing velocity — the drag position wins.
      velRef.current = { x: 0, y: 0 };
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startPos = { ...posRef.current };
      const move = (ev: PointerEvent): void => {
        const rawDX = ev.clientX - startClientX + startPos.x;
        const rawDY = ev.clientY - startClientY + startPos.y;
        posRef.current = { x: clampPull(rawDX), y: clampPull(rawDY) };
        applyTransform();
      };
      const up = (): void => {
        draggingRef.current = false;
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // pointer already released
        }
        runSim();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [applyTransform, rect, runSim],
  );

  const commitSpring = useCallback(
    (next: Partial<SpringValue>): void => {
      const merged: SpringValue = { ...spring, ...next };
      session.manipulate(effectId, paramKey, merged);
      // Re-run so the designer feels the change immediately.
      posRef.current = { x: SPRING_SURFACE.maxPullPx * 0.6, y: 0 };
      velRef.current = { x: 0, y: 0 };
      runSim();
    },
    [effectId, paramKey, runSim, session, spring],
  );

  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D): void => {
      const r = rectRef.current;
      if (r === null) return;
      // Draw the rest-position outline (thin dashed rect).
      ctx.save();
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = STROKE.secondary;
      ctx.strokeRect(r.left, r.top, r.width, r.height);
      ctx.restore();
    };
  }, []);
  useCanvasDrawer(draw);

  const stiffnessDrag = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      if (rect === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startS = spring.stiffness;
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const range = SPRING_SURFACE.stiffnessRange.max - SPRING_SURFACE.stiffnessRange.min;
        const next = startS + (dx / SPRING_SURFACE.stiffnessHandleOffset) * range;
        const clamped = Math.max(
          SPRING_SURFACE.stiffnessRange.min,
          Math.min(SPRING_SURFACE.stiffnessRange.max, next),
        );
        commitSpring({ stiffness: Math.round(clamped) });
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
    [commitSpring, rect, spring.stiffness],
  );

  const dampingDrag = useCallback(
    (event: React.PointerEvent<SVGCircleElement>) => {
      if (rect === null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startD = spring.damping;
      const move = (ev: PointerEvent): void => {
        // Up = more damping (less oscillation).
        const dy = startY - ev.clientY;
        const range = SPRING_SURFACE.dampingRange.max - SPRING_SURFACE.dampingRange.min;
        const next = startD + (dy / SPRING_SURFACE.dampingHandleOffset) * range;
        const clamped = Math.max(SPRING_SURFACE.dampingRange.min, Math.min(SPRING_SURFACE.dampingRange.max, next));
        commitSpring({ damping: Math.round(clamped * 10) / 10 });
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
    [commitSpring, rect, spring.damping],
  );

  const submitEdit = useCallback(
    (raw: string) => {
      // Expected input format: "stiffness,damping" (comma-separated). Not
      // discoverable in the UI, but that's what "power-user escape hatch"
      // means — the primary interaction is the pull-and-release.
      const parts = raw.split(',').map((p) => Number(p.trim()));
      if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
        commitSpring({ stiffness: parts[0]!, damping: parts[1]! });
      }
      setEditing(false);
    },
    [commitSpring],
  );

  if (rect === null) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const stiffnessX = cx + SPRING_SURFACE.stiffnessHandleOffset;
  const dampingY = cy - SPRING_SURFACE.dampingHandleOffset;

  return (
    <>
      <circle
        cx={cx + posRef.current.x}
        cy={cy + posRef.current.y}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={startPull}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <circle
        cx={cx + posRef.current.x}
        cy={cy + posRef.current.y}
        r={HANDLES.visibleRadius + 2}
        fill={COLORS.accent}
        stroke={COLORS.panelBg}
        strokeWidth={2}
        pointerEvents="none"
      />
      {/* Stiffness axis handle */}
      <line
        x1={cx}
        y1={cy}
        x2={stiffnessX}
        y2={cy}
        stroke={COLORS.accentSoft}
        strokeWidth={STROKE.secondary}
        strokeDasharray="2 4"
        pointerEvents="none"
      />
      <circle
        cx={stiffnessX}
        cy={cy}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: 'ew-resize' }}
        onPointerDown={stiffnessDrag}
      />
      <circle
        cx={stiffnessX}
        cy={cy}
        r={HANDLES.visibleRadius}
        fill={COLORS.accentAlt}
        pointerEvents="none"
      />
      <text
        x={stiffnessX + 10}
        y={cy + 4}
        fill={COLORS.neutralInkMuted}
        fontFamily={FONT.mono}
        fontSize={FONT.sizeSmall}
        pointerEvents="none"
      >
        stiffness {String(Math.round(spring.stiffness))}
      </text>
      {/* Damping axis handle */}
      <line
        x1={cx}
        y1={cy}
        x2={cx}
        y2={dampingY}
        stroke={COLORS.accentSoft}
        strokeWidth={STROKE.secondary}
        strokeDasharray="2 4"
        pointerEvents="none"
      />
      <circle
        cx={cx}
        cy={dampingY}
        r={HANDLES.hitRadius}
        fill="rgba(94, 234, 212, 0.001)"
        stroke="none"
        pointerEvents="all"
        style={{ cursor: 'ns-resize' }}
        onPointerDown={dampingDrag}
      />
      <circle
        cx={cx}
        cy={dampingY}
        r={HANDLES.visibleRadius}
        fill={COLORS.accentAlt}
        pointerEvents="none"
      />
      <text
        x={cx + 10}
        y={dampingY - 8}
        fill={COLORS.neutralInkMuted}
        fontFamily={FONT.mono}
        fontSize={FONT.sizeSmall}
        pointerEvents="none"
      >
        damping {spring.damping.toFixed(1)}
      </text>
      {editing && (
        <foreignObject
          x={cx + posRef.current.x + 20}
          y={cy + posRef.current.y - 14}
          width={160}
          height={30}
          style={{ overflow: 'visible' }}
        >
          <NumericEditor
            initial={spring.stiffness}
            step={1}
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

function clampPull(v: number): number {
  const max = SPRING_SURFACE.maxPullPx;
  if (v > max) return max;
  if (v < -max) return -max;
  return v;
}
