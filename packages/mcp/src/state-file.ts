import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MotionWorksStateManager } from '@motionworks/core';

export interface StateFileWriterOptions {
  /** Absolute project root; the file is written to `<root>/motionworks-state.json`. */
  projectRoot: string;
  /** Debounce interval in ms. Defaults to 100ms. */
  debounceMs?: number;
  /** Resolves the DOM selector for an effect (from the WS bridge). */
  getSelector?: (effectId: string) => string | undefined;
}

export interface StateFileWriter {
  /** Begin listening to the state manager and write on every change. */
  start(): void;
  /** Stop listening. Any pending debounced write is cancelled. */
  stop(): void;
  /** Force an immediate write, cancelling any pending debounced write. */
  flush(): Promise<void>;
}

/**
 * Writes a debounced JSON snapshot of the state manager to the project root.
 * The shape matches AGENT_INTEGRATION.md's file-based fallback section
 * (does not include `typeCorrections` — that's by design).
 */
export function createStateFileWriter(
  state: MotionWorksStateManager,
  { projectRoot, debounceMs = 100, getSelector }: StateFileWriterOptions,
): StateFileWriter {
  const filePath = join(projectRoot, 'motionworks-state.json');
  let unsubscribe: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function writeNow(): Promise<void> {
    const snapshot = state.getSnapshot();
    const selectedEffect = snapshot.effects.find((e) => e.id === snapshot.selectedEffectId);
    const selectedElement =
      selectedEffect !== undefined && getSelector !== undefined
        ? getSelector(selectedEffect.id) ?? null
        : null;
    const payload = {
      selectedEffect: selectedEffect?.name ?? null,
      selectedElement,
      registeredEffects: snapshot.effects.map((e) => ({
        id: e.id,
        name: e.name,
        params: e.params,
      })),
      pendingChanges: snapshot.changesets.map((cs) => ({
        effectId: cs.effectId,
        effectName: cs.effectName,
        changes: cs.changes,
      })),
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void writeNow().catch((err) => {
        console.error(`[MotionWorks] Failed to write motionworks-state.json: ${String(err)}`);
      });
    }, debounceMs);
  }

  return {
    start(): void {
      if (unsubscribe !== null) return;
      unsubscribe = state.subscribe(schedule);
    },
    stop(): void {
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await writeNow();
    },
  };
}
