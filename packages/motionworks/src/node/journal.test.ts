import { mkdtemp, readdir, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JournalEntry } from '../shared/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ackEntries, appendEntry, readJournal, updateEntry } from './journal.js';

let root: string;
const entry = (id: string): JournalEntry => ({ id, createdAt: Date.now(), origin: '', page: '/', effectId: 'card#1', effectName: 'Card', elementSelector: '.card', changes: [], status: 'pending' });

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'motionworks-journal-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('journal', () => {
  it('writes atomically without leaving temp files', async () => {
    const value = entry('one');
    await appendEntry(root, value);
    expect(await readJournal(root)).toEqual([value]);
    expect((await readdir(join(root, '.motionworks'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('serializes concurrent appends', async () => {
    await Promise.all([appendEntry(root, entry('one')), appendEntry(root, entry('two'))]);
    expect((await readJournal(root)).map((item) => item.id).sort()).toEqual(['one', 'two']);
  });

  it('updates entries and acknowledges requested ids without reordering the rest', async () => {
    await appendEntry(root, entry('one')); await appendEntry(root, entry('two')); await appendEntry(root, entry('three'));
    await updateEntry(root, 'two', { status: 'applied' });
    expect((await ackEntries(root, ['two'])).map((item) => item.id)).toEqual(['two']);
    expect((await readJournal(root)).map((item) => item.id)).toEqual(['one', 'three']);
    expect((await ackEntries(root, 'all')).map((item) => item.id)).toEqual(['one', 'three']);
  });

  it('reclaims a stale lock', async () => {
    const dir = join(root, '.motionworks'); await mkdir(dir); const lock = join(dir, 'journal.lock');
    await writeFile(lock, 'stale'); await utimes(lock, new Date(0), new Date(0));
    await appendEntry(root, entry('one'));
    expect(await readJournal(root)).toHaveLength(1);
  });

  it('reports malformed JSON', async () => {
    const dir = join(root, '.motionworks'); await mkdir(dir); await writeFile(join(dir, 'changes.json'), '{bad');
    await expect(readJournal(root)).rejects.toThrow('Failed to read MotionWorks journal');
  });
});
