import type { JournalEntry, StatusResponse } from '@motionworks/core';

import { ackEntries, readJournal, readSelected } from './journal.js';

export function formatChanges(entries: JournalEntry[], mode: 'agent' | 'brief' | 'json'): string {
  if (mode === 'json') return JSON.stringify(entries, null, 2);
  if (entries.length === 0) return 'No pending MotionWorks changes.';
  if (mode === 'brief') {
    return entries.map((entry) => `${entry.id}  ${entry.effectName}  ${entry.changes.length} change${entry.changes.length === 1 ? '' : 's'}  ${entry.status}`).join('\n');
  }
  return entries.map((entry) => {
    const changes = entry.changes.map((change) => `  ${change.param}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`).join('\n');
    const corrections = (entry.typeCorrections ?? []).map((item) => `  ${item.paramKey}: type ${item.previousType} → ${item.correctedType}`).join('\n');
    return [`Change ${entry.id}`, `Effect: ${entry.effectName} (${entry.effectId})`, `Element: ${entry.elementSelector}`, changes, corrections].filter(Boolean).join('\n');
  }).join('\n\n');
}

export async function runAck(root: string, id: string | 'all', port: number): Promise<string[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id === 'all' ? { ids: 'all' } : { id }),
    });
    if (!response.ok) throw new Error(`daemon returned ${response.status}`);
    const value = await response.json() as { acknowledged: string[] };
    return value.acknowledged;
  } catch (error) {
    const cause = error instanceof TypeError ? error.cause as NodeJS.ErrnoException | undefined : undefined;
    if (cause?.code !== 'ECONNREFUSED') throw error;
    return (await ackEntries(root, id === 'all' ? 'all' : [id])).map((entry) => entry.id);
  }
}

export async function formatStatus(root: string, port: number): Promise<string> {
  let daemon: StatusResponse | null = null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    if (response.ok) daemon = await response.json() as StatusResponse;
  } catch {
    // A stopped daemon is useful status, not an error.
  }
  const selected = await readSelected(root);
  const lines = [daemon === null ? `Daemon: stopped (127.0.0.1:${port})` : `Daemon: running on 127.0.0.1:${daemon.port} (${daemon.pending} pending)`];
  if (selected === null) lines.push('Selection: none');
  else {
    lines.push(`Selection: ${selected.effectName} (${selected.effectId})`, `Element: ${selected.elementSelector}`);
    if (selected.values !== undefined) lines.push(`Values: ${JSON.stringify(selected.values)}`);
  }
  return lines.join('\n');
}

export async function pendingChanges(root: string): Promise<JournalEntry[]> {
  return (await readJournal(root)).filter((entry) => entry.status !== 'applied');
}
