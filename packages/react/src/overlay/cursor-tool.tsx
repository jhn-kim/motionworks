import { createContext, useContext, useEffect, useRef, useState } from 'react';

import type { ParameterType } from '@motionworks/core';

import { getBridge } from '../bridge.js';
import { useOverlaySession } from './context.js';
import {
  clampScale,
  formatReal,
  formatScale,
  scaleToValue,
  valueToScale,
  type ScaleSpec,
} from './scale.js';
import { FONT, GLASS } from './theme.js';

// The cursor tool: a parameter armed from the toolkit attaches to the
// cursor as a frosted counter pill. Hovering an element that carries the
// parameter and scrolling adjusts it on the 0–10 dial — fast scroll steps
// whole numbers, slow scroll steps tenths (Shift forces tenths). The wheel
// is only captured over valid targets; everywhere else the page scrolls
// normally.

export interface ArmedTool {
  effectId: string;
  paramKey: string;
  // Spring params are objects; a tool arms one axis of them.
  axis?: 'stiffness' | 'damping' | 'mass';
  label: string;
  unit?: string | undefined;
  spec: ScaleSpec;
  // Effective parameter type — used for the tool glyph and family lookup.
  type: ParameterType;
}

export function sameTool(a: ArmedTool | null, b: ArmedTool): boolean {
  return (
    a !== null &&
    a.effectId === b.effectId &&
    a.paramKey === b.paramKey &&
    (a.axis ?? null) === (b.axis ?? null)
  );
}

interface CursorToolState {
  armed: ArmedTool | null;
  arm: (tool: ArmedTool) => void;
  disarm: () => void;
}

export const CursorToolContext = createContext<CursorToolState>({
  armed: null,
  arm: () => {},
  disarm: () => {},
});

export function useCursorTool(): CursorToolState {
  return useContext(CursorToolContext);
}

// Wheel deltas accumulate into discrete ticks (one detent ≈ one tick, a
// trackpad stroke sums up to the same). A burst of ticks in a short window
// reads as "fast" and snaps whole numbers.
const TICK_DELTA = 30;
const FAST_WINDOW_MS = 300;
const FAST_TICKS = 4;

export function CursorToolLayer({
  armed,
  disarm,
}: {
  armed: ArmedTool;
  disarm: () => void;
}): React.JSX.Element | null {
  const session = useOverlaySession();
  // Position is applied imperatively (transform on the pill element) rather
  // than through React state — following the cursor must not depend on a
  // render per pointermove.
  const pillRef = useRef<HTMLDivElement>(null);
  const hasPosRef = useRef(false);
  const [overTarget, setOverTarget] = useState(false);
  // Step granularity of the LAST adjustment — the pill's neighbor numbers
  // follow it so the wheel's current gear is always visible.
  const [lastStep, setLastStep] = useState(1);
  const [scale, setScale] = useState<number | null>(null);
  const scaleRef = useRef<number | null>(null);
  const accumRef = useRef(0);
  const tickTimesRef = useRef<number[]>([]);

  // Current live value of the armed param, read fresh from the session so
  // stale closures can never write against an old spring object.
  const readLive = (): { real: number | null; container: Record<string, unknown> | null } => {
    const effect = session.state.getEffect(armed.effectId);
    const param = effect?.params[armed.paramKey];
    if (param === undefined) return { real: null, container: null };
    const diff = session.diffs.getDiff(armed.effectId)[armed.paramKey];
    const live = diff !== undefined ? diff.to : param.value;
    if (armed.axis !== undefined) {
      if (typeof live !== 'object' || live === null) return { real: null, container: null };
      const container = live as Record<string, unknown>;
      const v = container[armed.axis];
      return { real: typeof v === 'number' ? v : armed.axis === 'mass' ? 1 : null, container };
    }
    return { real: typeof live === 'number' ? live : null, container: null };
  };

  // Initialize the dial from the live value each time a different tool arms.
  const armedKey = `${armed.effectId}|${armed.paramKey}|${armed.axis ?? ''}`;
  useEffect(() => {
    const { real } = readLive();
    const s = real === null ? null : valueToScale(real, armed.spec);
    scaleRef.current = s;
    setScale(s);
    setLastStep(1);
    hasPosRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedKey]);

  useEffect(() => {
    const nodesForEffect = (): readonly HTMLElement[] =>
      getBridge().getAllNodes().get(armed.effectId) ?? [];

    const isOverEffect = (target: EventTarget | null): boolean =>
      target instanceof Node && nodesForEffect().some((n) => n.contains(target));

    const placePill = (x: number, y: number): void => {
      const el = pillRef.current;
      if (el !== null) {
        el.style.transform = `translate(${String(x + 18)}px, ${String(y + 16)}px)`;
        if (!hasPosRef.current) {
          hasPosRef.current = true;
          el.style.visibility = 'visible';
        }
      }
    };

    const onMove = (event: PointerEvent | MouseEvent): void => {
      placePill(event.clientX, event.clientY);
      setOverTarget(isOverEffect(event.target));
    };

    const onWheel = (event: WheelEvent): void => {
      if (!isOverEffect(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      placePill(event.clientX, event.clientY);

      accumRef.current += event.deltaY;
      if (Math.abs(accumRef.current) < TICK_DELTA) return;
      const direction = accumRef.current > 0 ? -1 : 1;
      accumRef.current = 0;

      const now = performance.now();
      tickTimesRef.current = tickTimesRef.current.filter((t) => now - t < FAST_WINDOW_MS);
      tickTimesRef.current.push(now);
      const fast = !event.shiftKey && tickTimesRef.current.length >= FAST_TICKS;
      const step = fast ? 1 : 0.1;

      const current = scaleRef.current;
      if (current === null) return;
      // Fast mode rides whole numbers: snap first, then step.
      const base = fast ? Math.round(current) : current;
      const next = clampScale(Math.round((base + direction * step) * 10) / 10);
      const real = scaleToValue(next, armed.spec);
      const { container } = readLive();
      if (armed.axis !== undefined) {
        if (container !== null) {
          session.manipulate(armed.effectId, armed.paramKey, {
            ...container,
            [armed.axis]: real,
          });
        }
      } else {
        session.manipulate(armed.effectId, armed.paramKey, real);
      }
      scaleRef.current = next;
      setScale(next);
      setLastStep(step);
    };

    // Escape disarms the tool instead of closing the toolkit — the capture
    // listener runs before the shell's bubble-phase close handler.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        disarm();
      }
    };

    // mousemove alongside pointermove: belt and suspenders so the pill
    // follows on every input stack.
    document.addEventListener('pointermove', onMove, { capture: true });
    document.addEventListener('mousemove', onMove, { capture: true });
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('mousemove', onMove, { capture: true });
      document.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('keydown', onKey, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedKey, session, disarm]);

  if (scale === null) return null;

  const upper = scale + lastStep <= 10 ? formatScale(scale + lastStep) : '';
  const lower = scale - lastStep >= 0 ? formatScale(scale - lastStep) : '';
  const real = scaleToValue(scale, armed.spec);

  return (
    <div
      ref={pillRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        // Hidden until the first cursor position arrives; placePill reveals.
        visibility: hasPosRef.current ? 'visible' : 'hidden',
        zIndex: 10000,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        padding: '6px 12px 7px',
        minWidth: 54,
        background: GLASS.background,
        backdropFilter: GLASS.backdrop,
        WebkitBackdropFilter: GLASS.backdrop,
        border: GLASS.border,
        borderRadius: GLASS.radiusLarge,
        boxShadow: GLASS.shadow,
        fontFamily: FONT.family,
        color: 'rgba(255, 255, 255, 0.96)',
        opacity: overTarget ? 1 : 0.55,
        transition: 'opacity 140ms ease',
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.06,
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.6)',
          whiteSpace: 'nowrap',
        }}
      >
        {armed.label}
      </span>
      <span style={{ fontSize: 10, lineHeight: 1.2, color: 'rgba(255, 255, 255, 0.4)' }}>
        {upper || ' '}
      </span>
      <span style={{ fontSize: 19, lineHeight: 1.1, fontWeight: 600 }}>
        {formatScale(scale)}
      </span>
      <span style={{ fontSize: 9, lineHeight: 1.2, color: 'rgba(255, 255, 255, 0.55)' }}>
        {formatReal(real, armed.unit)}
      </span>
      <span style={{ fontSize: 10, lineHeight: 1.2, color: 'rgba(255, 255, 255, 0.4)' }}>
        {lower || ' '}
      </span>
    </div>
  );
}
