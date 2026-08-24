import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  JournalChange,
  JournalEntry,
  JournalStatus,
  SelectRequest,
  TypeCorrection,
} from "../shared/index.js";

const DIRECTORY = ".motionworks";
const JOURNAL = "changes.json";
const SELECTED = "selected.json";
const LOCK = "journal.lock";

const pathFor = (root: string, name: string): string =>
  join(root, DIRECTORY, name);
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

const JOURNAL_STATUSES = new Set<JournalStatus>([
  "pending",
  "agent-working",
  "applied",
]);

/**
 * Minimal shape guard applied to every entry read from disk (P2-12g). A
 * hand-edited or corrupted entry missing an id, a known status, or a changes
 * array is unusable downstream, so it is dropped rather than trusted as a
 * `JournalEntry`.
 */
function isJournalEntry(value: unknown): value is JournalEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as JournalEntry).id === "string" &&
    typeof (value as JournalEntry).createdAt === "number" &&
    JOURNAL_STATUSES.has((value as JournalEntry).status) &&
    Array.isArray((value as JournalEntry).changes)
  );
}

export async function readJournal(root: string): Promise<JournalEntry[]> {
  try {
    const value: unknown = JSON.parse(
      await readFile(pathFor(root, JOURNAL), "utf8"),
    );
    if (!Array.isArray(value)) throw new Error("journal must contain an array");
    return value.filter(isJournalEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Failed to read MotionWorks journal: ${String(error)}`);
  }
}

/** A lock older than this is treated as abandoned by a crashed holder. */
const STALE_LOCK_MS = 5_000;
/**
 * How long a waiter blocks before giving up. It must exceed STALE_LOCK_MS so a
 * legitimately slow holder (a large journal rewrite taking 2–5 s) is never
 * abandoned as "timed out" before it would even be eligible for stale eviction
 * (security finding S7).
 */
const LOCK_WAIT_MS = 10_000;

export async function withJournalLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = pathFor(root, LOCK);
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS) {
          // Steal the exact stale file atomically. `rename` can only move the
          // inode currently at lockPath, so if two waiters both see it as
          // stale, only one rename succeeds; the loser fails ENOENT and re-
          // loops. A fresh lock created in between is never clobbered — the
          // old racy `unlink(lockPath)` could delete someone else's new lock.
          const stolen = `${lockPath}.stale.${process.pid}.${Math.random()
            .toString(16)
            .slice(2)}`;
          await rename(lockPath, stolen);
          await unlink(stolen).catch(() => undefined);
          continue;
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw lockError;
      }
      if (Date.now() - started >= LOCK_WAIT_MS)
        throw new Error("Timed out waiting for MotionWorks journal lock");
      await delay(25);
    }
  }
}

export async function appendEntry(
  root: string,
  entry: JournalEntry,
): Promise<void> {
  await withJournalLock(root, async () =>
    atomicWrite(pathFor(root, JOURNAL), [...(await readJournal(root)), entry]),
  );
}

function pendingKey(entry: JournalEntry): string {
  return JSON.stringify([entry.origin, entry.page, entry.effectId]);
}

function mergeChanges(entries: JournalEntry[]): JournalChange[] {
  const changes = new Map<string, JournalChange>();
  for (const entry of entries) {
    for (const change of entry.changes) {
      const previous = changes.get(change.param);
      changes.set(
        change.param,
        previous === undefined
          ? change
          : isDeepStrictEqual(previous.to, change.from)
            ? {
                ...change,
                from: previous.from,
                ...(previous.fromCss !== undefined && {
                  fromCss: previous.fromCss,
                }),
              }
            : change,
      );
    }
  }
  return [...changes.values()];
}

function mergeCorrections(entries: JournalEntry[]): TypeCorrection[] {
  const corrections = new Map<string, TypeCorrection>();
  for (const entry of entries) {
    for (const correction of entry.typeCorrections ?? []) {
      const previous = corrections.get(correction.paramKey);
      corrections.set(
        correction.paramKey,
        previous === undefined
          ? correction
          : {
              ...correction,
              previousType: previous.previousType,
            },
      );
    }
  }
  return [...corrections.values()];
}

function mergePendingGroup(
  entries: JournalEntry[],
  clearError: boolean,
): JournalEntry {
  const first = entries[0]!;
  const latest = entries.at(-1)!;
  const corrections = mergeCorrections(entries);
  return {
    ...first,
    ...latest,
    id: first.id,
    createdAt: first.createdAt,
    status: "pending",
    changes: mergeChanges(entries),
    ...(corrections.length === 0
      ? { typeCorrections: undefined }
      : { typeCorrections: corrections }),
    ...(clearError && { error: undefined }),
  };
}

/**
 * Adds a new pending commit or folds it into the unresolved intent for the
 * same page/effect. Re-saving one slider therefore replaces that slider's
 * queued destination while preserving the original source value.
 */
export async function upsertPendingEntry(
  root: string,
  entry: JournalEntry,
): Promise<JournalEntry> {
  return withJournalLock(root, async () => {
    const entries = await readJournal(root);
    const key = pendingKey(entry);
    const matchingIndexes = entries.flatMap((candidate, index) =>
      candidate.status === "pending" && pendingKey(candidate) === key
        ? [index]
        : [],
    );
    if (matchingIndexes.length === 0) {
      await atomicWrite(pathFor(root, JOURNAL), [...entries, entry]);
      return entry;
    }

    const matching = matchingIndexes.map((index) => entries[index]!);
    const merged = mergePendingGroup([...matching, entry], true);
    const matchingSet = new Set(matchingIndexes);
    const next = entries.filter((_, index) => !matchingSet.has(index));
    next.splice(matchingIndexes[0]!, 0, merged);
    await atomicWrite(pathFor(root, JOURNAL), next);
    return merged;
  });
}

/** Compacts journals written before pending commits were upserted. */
export async function coalescePendingEntries(root: string): Promise<number> {
  return withJournalLock(root, async () => {
    const entries = await readJournal(root);
    const groups = new Map<string, JournalEntry[]>();
    for (const entry of entries) {
      if (entry.status !== "pending") continue;
      const key = pendingKey(entry);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const duplicates = [...groups.values()].reduce(
      (count, group) => count + Math.max(0, group.length - 1),
      0,
    );
    if (duplicates === 0) return 0;

    const emitted = new Set<string>();
    const compacted = entries.flatMap((entry) => {
      if (entry.status !== "pending") return [entry];
      const key = pendingKey(entry);
      if (emitted.has(key)) return [];
      emitted.add(key);
      return [mergePendingGroup(groups.get(key)!, false)];
    });
    await atomicWrite(pathFor(root, JOURNAL), compacted);
    return duplicates;
  });
}

export async function updateEntry(
  root: string,
  id: string,
  patch: Partial<JournalEntry>,
): Promise<JournalEntry | null> {
  return withJournalLock(root, async () => {
    const entries = await readJournal(root);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    entries[index] = { ...entries[index]!, ...patch };
    await atomicWrite(pathFor(root, JOURNAL), entries);
    return entries[index]!;
  });
}

export async function ackEntries(
  root: string,
  ids: string[] | "all",
): Promise<JournalEntry[]> {
  return withJournalLock(root, async () => {
    const entries = await readJournal(root);
    const removed =
      ids === "all"
        ? entries
        : entries.filter((entry) => ids.includes(entry.id));
    const kept =
      ids === "all" ? [] : entries.filter((entry) => !ids.includes(entry.id));
    await atomicWrite(pathFor(root, JOURNAL), kept);
    return removed;
  });
}

export async function writeSelected(
  root: string,
  selected: SelectRequest,
): Promise<void> {
  await atomicWrite(pathFor(root, SELECTED), selected);
}

export async function readSelected(
  root: string,
): Promise<SelectRequest | null> {
  try {
    return JSON.parse(
      await readFile(pathFor(root, SELECTED), "utf8"),
    ) as SelectRequest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Failed to read MotionWorks selection: ${String(error)}`);
  }
}

export async function pruneAppliedEntries(
  root: string,
  before: number,
): Promise<number> {
  return withJournalLock(root, async () => {
    const entries = await readJournal(root);
    const kept = entries.filter(
      (entry) =>
        entry.status !== "applied" ||
        (entry.appliedAt ?? entry.createdAt) >= before,
    );
    if (kept.length !== entries.length)
      await atomicWrite(pathFor(root, JOURNAL), kept);
    return entries.length - kept.length;
  });
}
