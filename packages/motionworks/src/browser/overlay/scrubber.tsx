import { useCallback, useState } from 'react';

import type { MotionWorksEffect } from '../../shared/index.js';

import { useOverlaySession } from './context.js';
import { COLORS, FONT, PANEL, RESERVED_KEYS, SCRUBBER } from './theme.js';

interface Props {
  active: boolean;
  selectedEffect: MotionWorksEffect | null;
}

// Global scrubber. Only rendered when the currently-selected effect has
// opted in via `capabilities.scrub === true`. Sends `__motionworksScrub`
// through the same manipulate() pipeline as normal params — effects that
// don't handle the reserved key just ignore it (this is fine because a
// non-opted-in effect never shows the UI in the first place).
export function Scrubber({ active, selectedEffect }: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const [time, setTime] = useState(0);
  const [dragging, setDragging] = useState(false);

  const shouldRender = active && selectedEffect !== null && selectedEffect.capabilities?.scrub === true;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (selectedEffect === null) return;
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setDragging(true);
      const rect = target.getBoundingClientRect();
      const compute = (x: number): number => {
        const f = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        return f * SCRUBBER.defaultDurationMs;
      };
      const move = (ev: PointerEvent): void => {
        const next = compute(ev.clientX);
        setTime(next);
        session.manipulate(selectedEffect.id, RESERVED_KEYS.scrub, next);
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
      // Immediate update on the down event too so a click without drag registers.
      const initial = compute(event.clientX);
      setTime(initial);
      session.manipulate(selectedEffect.id, RESERVED_KEYS.scrub, initial);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [selectedEffect, session],
  );

  if (!shouldRender) return null;

  const fraction = time / SCRUBBER.defaultDurationMs;

  return (
    <div
      style={{
        position: 'fixed',
        left: SCRUBBER.padding,
        right: SCRUBBER.padding,
        bottom: SCRUBBER.bottomOffset,
        zIndex: 9999,
        background: COLORS.panelBg,
        border: `1px solid ${COLORS.panelBorder}`,
        borderRadius: PANEL.radius,
        padding: `8px ${String(SCRUBBER.padding)}px`,
        fontFamily: FONT.family,
        fontSize: FONT.sizeSmall,
        color: COLORS.neutralInk,
        boxShadow: PANEL.shadow,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <span style={{ opacity: 0.7, fontFamily: FONT.mono }}>
        {formatTime(time)} / {formatTime(SCRUBBER.defaultDurationMs)}
      </span>
      <div
        onPointerDown={handlePointerDown}
        style={{
          flex: 1,
          height: 16,
          position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 4,
            transform: 'translateY(-50%)',
            background: COLORS.panelHairline,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            width: `${String(fraction * 100)}%`,
            height: 4,
            transform: 'translateY(-50%)',
            background: COLORS.accentSoft,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `calc(${String(fraction * 100)}% - ${String(SCRUBBER.handleRadius)}px)`,
            width: SCRUBBER.handleRadius * 2,
            height: SCRUBBER.handleRadius * 2,
            transform: 'translateY(-50%)',
            borderRadius: '50%',
            background: COLORS.accent,
            boxShadow: PANEL.shadow,
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          if (selectedEffect === null) return;
          setTime(0);
          session.manipulate(selectedEffect.id, RESERVED_KEYS.scrub, 0);
        }}
        style={{
          padding: '4px 10px',
          fontSize: FONT.sizeSmall,
          fontFamily: FONT.family,
          border: `1px solid ${COLORS.panelBorder}`,
          background: 'transparent',
          borderRadius: 4,
          color: COLORS.neutralInk,
          cursor: 'pointer',
        }}
      >
        Reset
      </button>
    </div>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const remainder = Math.floor(ms % 1000);
  return `${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}s`;
}
