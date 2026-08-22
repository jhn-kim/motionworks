import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import type { JournalEntry } from '../shared/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatChanges, formatStatus, runAck } from './commands.js';
import { appendEntry, readJournal, writeSelected } from './journal.js';

let root: string;
const entry: JournalEntry = { id: 'abc', createdAt: 1, origin: '', page: '/', effectId: 'card#1', effectName: 'Card', elementSelector: '.card', changes: [{ param: 'radius', type: 'spatial-radius', from: 100, to: 120 }], status: 'pending' };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'motionworks-commands-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('commands', () => {
  it('formats agent, brief, and JSON output', () => {
    expect(formatChanges([entry], 'agent')).toBe('Change abc\nEffect: Card (card#1)\nElement: .card\n  radius: 100 → 120');
    expect(formatChanges([entry], 'brief')).toBe('abc  Card  1 change  pending');
    expect(JSON.parse(formatChanges([entry], 'json'))).toEqual([entry]);
  });

  it('falls back to the journal when the daemon refuses connection', async () => {
    await appendEntry(root, entry);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    expect(await runAck(root, 'abc', port)).toEqual(['abc']);
    expect(await readJournal(root)).toEqual([]);
  });

  it('includes the saved selection in status', async () => {
    await writeSelected(root, { effectId: 'card#1', effectName: 'Card', elementSelector: '.card', values: { radius: 120 } });
    expect(await formatStatus(root, 1)).toBe('Daemon: stopped (127.0.0.1:1)\nSelection: Card (card#1)\nElement: .card\nValues: {"radius":120}');
  });
});
