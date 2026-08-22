import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDaemon, type RunningDaemon } from './daemon.js';
import { appendEntry, readJournal } from './journal.js';

let root: string;
let daemon: RunningDaemon | null;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'motionworks-daemon-')); daemon = await startDaemon({ projectRoot: root, port: 0 }); });
afterEach(async () => { await daemon?.stop(); await rm(root, { recursive: true, force: true }); });

const commit = (page = '/demo') => ({ page, effectId: 'card#1', effectName: 'Card', elementSelector: '.card', changes: [{ param: 'radius', type: 'spatial-radius', from: 100, to: 120 }] });
const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${daemon!.port}${path}`, init);

describe('daemon', () => {
  it('commits with the header origin, filters pending, and acknowledges', async () => {
    const created = await request('/commit', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...commit(), origin: 'https://evil.example' }) });
    expect(created.status).toBe(201);
    const entry = await created.json() as { id: string; origin: string };
    expect(entry.origin).toBe('http://localhost:3000');
    expect(await (await request('/pending', { headers: { Origin: 'http://localhost:3001' } })).json()).toEqual([]);
    expect(await (await request('/pending?all=1', { headers: { Origin: 'http://localhost:3001' } })).json()).toHaveLength(1);
    const ack = await request('/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
    expect(ack.status).toBe(200);
    expect(await (await request('/pending')).json()).toEqual([]);
  });

  it('handles preflight and rejects remote origins', async () => {
    expect((await request('/commit', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })).status).toBe(204);
    expect((await request('/status', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('rejects bad JSON and oversized bodies', async () => {
    expect((await request('/commit', { method: 'POST', body: '{bad' })).status).toBe(400);
    expect((await request('/commit', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status).toBe(413);
  });

  it('leaves EADDRINUSE untouched', async () => {
    await expect(startDaemon({ projectRoot: root, port: daemon!.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('prunes applied entries older than seven days on startup', async () => {
    await daemon!.stop();
    daemon = null;
    const now = Date.now();
    await appendEntry(root, {
      id: 'old', createdAt: now - 9 * 24 * 60 * 60 * 1000, appliedAt: now - 8 * 24 * 60 * 60 * 1000,
      origin: '', page: '/', effectId: 'card#1', effectName: 'Card', elementSelector: '.card', changes: [], status: 'applied',
    });
    await appendEntry(root, {
      id: 'recent', createdAt: now, appliedAt: now,
      origin: '', page: '/', effectId: 'card#1', effectName: 'Card', elementSelector: '.card', changes: [], status: 'applied',
    });
    daemon = await startDaemon({ projectRoot: root, port: 0 });
    expect((await readJournal(root)).map((entry) => entry.id)).toEqual(['recent']);
  });
});
