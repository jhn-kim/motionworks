import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, parsePort } from './config.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'motionworks-config-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('uses defaults', async () => { expect(await loadConfig(root, {}, {})).toEqual({ port: 52340, agent: 'auto', agentTimeoutMs: 120000 }); });
  it('applies file, environment, then override precedence', async () => {
    await writeFile(join(root, 'motionworks.config.json'), JSON.stringify({ port: 4000, agent: 'codex', agentTimeoutMs: 99 }));
    expect(await loadConfig(root, {}, { MOTIONWORKS_PORT: '4001' })).toEqual({ port: 4001, agent: 'codex', agentTimeoutMs: 99 });
    expect(await loadConfig(root, { port: 4002, agent: 'off' }, { MOTIONWORKS_PORT: '4001' })).toEqual({ port: 4002, agent: 'off', agentTimeoutMs: 99 });
  });
  it('loads an optional token', async () => { await writeFile(join(root, 'motionworks.config.json'), JSON.stringify({ token: 'secret' })); expect(await loadConfig(root, {}, {})).toMatchObject({ token: 'secret' }); });
  it('parses valid ports and rejects invalid ones', () => { expect(parsePort('52340')).toBe(52340); expect(parsePort('bad')).toBeUndefined(); expect(parsePort('65536')).toBeUndefined(); });
});
