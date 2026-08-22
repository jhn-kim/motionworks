import { useEffect, useRef } from 'react';

import { getCanvasRegistry } from './surfaces/shared/canvas-registry.js';

interface Props {
  active: boolean;
  hasSelection: boolean;
}

// Full-viewport canvas at z-9997. Runs a rAF clear loop only when the
// overlay is active AND an element is selected — no reason to burn frames
// when there is nothing to draw. Individual surfaces contribute draw
// callbacks via `getCanvasRegistry()`; the layer knows nothing about which
// surfaces are contributing.
export function CanvasLayer({ active, hasSelection }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const resize = (): void => {
      const dpr = window.devicePixelRatio ?? 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${String(window.innerWidth)}px`;
      canvas.style.height = `${String(window.innerHeight)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    if (!active || !hasSelection) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    const registry = getCanvasRegistry();
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      registry.runAll(ctx, window.innerWidth, window.innerHeight);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active, hasSelection]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9997,
      }}
    />
  );
}
