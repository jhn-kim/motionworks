// Small pub-sub the CanvasLayer subscribes to. Each canvas-using surface
// registers a draw callback while it's mounted; the CanvasLayer's rAF loop
// clears once per frame and invokes every callback in registration order.
// Keeps canvas contributions decoupled from the CanvasLayer component so
// surfaces can appear/disappear without the CanvasLayer needing to know
// their names.

export type CanvasDraw = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) => void;

class CanvasDrawRegistry {
  private drawers = new Map<string, CanvasDraw>();
  private listeners = new Set<() => void>();
  private nextId = 0;

  register(draw: CanvasDraw): () => void {
    const id = `d${String(this.nextId++)}`;
    this.drawers.set(id, draw);
    this.notify();
    return () => {
      if (this.drawers.delete(id)) this.notify();
    };
  }

  runAll(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    for (const d of this.drawers.values()) d(ctx, width, height);
  }

  hasDrawers(): boolean {
    return this.drawers.size > 0;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

let registry: CanvasDrawRegistry | null = null;

export function getCanvasRegistry(): CanvasDrawRegistry {
  registry ??= new CanvasDrawRegistry();
  return registry;
}

export type { CanvasDrawRegistry };
