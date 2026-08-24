import type {
  AdoptionEntry,
  JournalEntry,
  StatusResponse,
} from "../shared/index.js";

import { readAdoptions, updateAdoption } from "./adoptions.js";
import { buildAdoptInstruction } from "./agent.js";
import { ackEntries, readJournal, readSelected } from "./journal.js";
import { applyCssChanges } from "./css-write.js";

/**
 * Collapses newlines and control characters in page-controlled strings (effect
 * names, selectors, param keys) so a crafted value cannot forge a fake
 * "Change …" block in the human-readable output an agent reads (finding S8).
 */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

export function formatChanges(
  entries: JournalEntry[],
  mode: "agent" | "brief" | "json",
): string {
  if (mode === "json") return JSON.stringify(entries, null, 2);
  if (entries.length === 0) return "No pending MotionWorks changes.";
  if (mode === "brief") {
    return entries
      .map(
        (entry) =>
          `${entry.id}  ${oneLine(entry.effectName)}  ${entry.changes.length} change${entry.changes.length === 1 ? "" : "s"}  ${entry.status}`,
      )
      .join("\n");
  }
  return entries
    .map((entry) => {
      const changes = entry.changes
        .map(
          (change) =>
            `  ${oneLine(change.param)}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`,
        )
        .join("\n");
      const corrections = (entry.typeCorrections ?? [])
        .map(
          (item) =>
            `  ${oneLine(item.paramKey)}: type ${oneLine(item.previousType)} → ${oneLine(item.correctedType)}`,
        )
        .join("\n");
      return [
        `Change ${entry.id}`,
        `Effect: ${oneLine(entry.effectName)} (${oneLine(entry.effectId)})`,
        `Element: ${oneLine(entry.elementSelector)}`,
        changes,
        corrections,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function runAck(
  root: string,
  id: string | "all",
  port: number,
  token?: string,
): Promise<string[]> {
  try {
    const query =
      token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
    const response = await fetch(`http://127.0.0.1:${port}/ack${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id === "all" ? { ids: "all" } : { id }),
    });
    if (!response.ok) throw new Error(`daemon returned ${response.status}`);
    const value = (await response.json()) as { acknowledged: string[] };
    return value.acknowledged;
  } catch (error) {
    const cause =
      error instanceof TypeError
        ? (error.cause as NodeJS.ErrnoException | undefined)
        : undefined;
    if (cause?.code !== "ECONNREFUSED") throw error;
    return (await ackEntries(root, id === "all" ? "all" : [id])).map(
      (entry) => entry.id,
    );
  }
}

export async function formatStatus(
  root: string,
  port: number,
  token?: string,
): Promise<string> {
  let daemon: StatusResponse | null = null;
  try {
    // /status is token-gated when the project has a token (the default), so the
    // token must be sent or the daemon answers 401 and status misreports it as
    // stopped even while it is running.
    const query =
      token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
    const response = await fetch(`http://127.0.0.1:${port}/status${query}`);
    if (response.ok) daemon = (await response.json()) as StatusResponse;
  } catch {
    // A stopped daemon is useful status, not an error.
  }
  const selected = await readSelected(root);
  const lines = [
    daemon === null
      ? `Daemon: stopped (127.0.0.1:${port})`
      : `Daemon: running on 127.0.0.1:${daemon.port} (${daemon.pending} pending)`,
  ];
  if (selected === null) lines.push("Selection: none");
  else {
    lines.push(
      `Selection: ${oneLine(selected.effectName)} (${oneLine(selected.effectId)})`,
      `Element: ${oneLine(selected.elementSelector)}`,
    );
    if (selected.values !== undefined)
      lines.push(`Values: ${JSON.stringify(selected.values)}`);
  }
  return lines.join("\n");
}

export async function pendingChanges(root: string): Promise<JournalEntry[]> {
  return (await readJournal(root)).filter(
    (entry) => entry.status !== "applied",
  );
}

export async function pendingAdoptions(root: string): Promise<AdoptionEntry[]> {
  return (await readAdoptions(root)).filter(
    (entry) => entry.status !== "applied",
  );
}

export function formatAdoptions(
  entries: AdoptionEntry[],
  root: string,
): string {
  if (entries.length === 0) return "No pending adoptions.";
  return entries
    .map((entry) => `# ${entry.id}\n${buildAdoptInstruction(entry, root)}`)
    .join("\n\n");
}

export async function runAdoptAck(
  root: string,
  id: string,
): Promise<AdoptionEntry> {
  const updated = await updateAdoption(root, id, {
    status: "applied",
    appliedBy: "cli",
    appliedAt: Date.now(),
  });
  if (updated === null) throw new Error(`Unknown adoption id: ${id}`);
  return updated;
}

export async function runRevert(root: string, id: string): Promise<string[]> {
  const entry = (await readJournal(root)).find(
    (candidate) => candidate.id === id,
  );
  if (entry === undefined) throw new Error(`Unknown change id: ${id}`);
  if (entry.status !== "applied")
    throw new Error(`Change ${id} has not been applied.`);
  const inverse: JournalEntry = {
    ...entry,
    changes: entry.changes.map((change) => ({
      ...change,
      from: change.to,
      to: change.from,
      fromCss: change.toCss,
      toCss: change.fromCss,
    })),
  };
  const result = await applyCssChanges(root, inverse);
  if (result.kind === "skipped") throw new Error(result.reason);
  await ackEntries(root, [id]);
  return result.files;
}
