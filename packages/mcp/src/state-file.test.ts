import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MotionWorksStateManager } from '@motionworks/core';

import { createStateFileWriter } from './state-file.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'motionworks-fallback-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function readSnapshot(cwd: string): Promise<unknown> {
  const raw = await readFile(join(cwd, 'motionworks-state.json'), 'utf8');
  return JSON.parse(raw);
}

describe('createStateFileWriter', () => {
  it('writes a snapshot after state changes (debounce respected)', async () => {
    const state = new MotionWorksStateManager();
    const writer = createStateFileWriter(state, { projectRoot: cwd, debounceMs: 20 });
    writer.start();

    state.registerEffect('e1', {
      name: 'Test',
      params: { radius: { type: 'spatial-radius', value: 100 } },
      update: () => {},
    });

    // Immediately after the change no file exists yet — the write is debounced.
    let existed = false;
    try {
      await stat(join(cwd, 'motionworks-state.json'));
      existed = true;
    } catch {
      /* expected */
    }
    expect(existed).toBe(false);

    // After ~2× the debounce interval, the file exists.
    await new Promise((r) => setTimeout(r, 60));
    const payload = (await readSnapshot(cwd)) as {
      registeredEffects: { id: string; name: string }[];
      pendingChanges: unknown[];
      selectedEffect: string | null;
    };
    expect(payload.registeredEffects).toHaveLength(1);
    expect(payload.registeredEffects[0]?.name).toBe('Test');
    expect(payload.pendingChanges).toEqual([]);
    writer.stop();
  });

  it('does not include typeCorrections in the file payload', async () => {
    const state = new MotionWorksStateManager();
    const writer = createStateFileWriter(state, { projectRoot: cwd, debounceMs: 5 });
    writer.start();
    state.addTypeCorrection({
      effectName: 'Test',
      paramKey: 'trail',
      previousType: 'scalar',
      correctedType: 'temporal-decay',
      correctedAt: Date.now(),
    });
    await writer.flush();
    const payload = (await readSnapshot(cwd)) as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('typeCorrections');
    writer.stop();
  });

  it('stops writing after stop() is called even if state changes', async () => {
    const state = new MotionWorksStateManager();
    const writer = createStateFileWriter(state, { projectRoot: cwd, debounceMs: 5 });
    writer.start();
    state.registerEffect('e1', {
      name: 'A',
      params: {},
      update: () => {},
    });
    await writer.flush();
    const before = (await readSnapshot(cwd)) as { registeredEffects: unknown[] };
    expect(before.registeredEffects).toHaveLength(1);

    writer.stop();
    state.registerEffect('e2', {
      name: 'B',
      params: {},
      update: () => {},
    });
    // Wait past the debounce interval.
    await new Promise((r) => setTimeout(r, 30));
    const after = (await readSnapshot(cwd)) as { registeredEffects: unknown[] };
    expect(after.registeredEffects).toHaveLength(1);
  });
});
