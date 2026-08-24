import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AdoptionEntry, JournalStatus } from "../shared/index.js";

// Adoption journal (`.motionworks/adoptions.json`). Kept separate from the value
// journal (changes.json): adoptions have a different lifecycle (a one-time source
// lift, not a CSS declaration swap) and verification model, so mixing them would
// muddy the value journal's single-declaration invariant. Adoptions are
// low-frequency and agent-triggered, so a plain read-modify-write with an atomic
// rename is sufficient — no cross-process lock like the value journal needs.

const DIRECTORY = ".motionworks";
const ADOPTIONS = "adoptions.json";

const pathFor = (root: string): string => join(root, DIRECTORY, ADOPTIONS);

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${String(process.pid)}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

const STATUSES = new Set<JournalStatus>(["pending", "agent-working", "applied"]);

function isAdoptionEntry(value: unknown): value is AdoptionEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as AdoptionEntry).id === "string" &&
    typeof (value as AdoptionEntry).createdAt === "number" &&
    STATUSES.has((value as AdoptionEntry).status) &&
    Array.isArray((value as AdoptionEntry).params) &&
    typeof (value as AdoptionEntry).elementSelector === "string"
  );
}

export async function readAdoptions(root: string): Promise<AdoptionEntry[]> {
  try {
    const value: unknown = JSON.parse(await readFile(pathFor(root), "utf8"));
    if (!Array.isArray(value))
      throw new Error("adoptions must contain an array");
    return value.filter(isAdoptionEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendAdoption(
  root: string,
  entry: AdoptionEntry,
): Promise<AdoptionEntry> {
  await atomicWrite(pathFor(root), [...(await readAdoptions(root)), entry]);
  return entry;
}

export async function updateAdoption(
  root: string,
  id: string,
  patch: Partial<AdoptionEntry>,
): Promise<AdoptionEntry | null> {
  const entries = await readAdoptions(root);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const updated = { ...entries[index], ...patch } as AdoptionEntry;
  entries[index] = updated;
  await atomicWrite(pathFor(root), entries);
  return updated;
}

export async function removeAdoption(
  root: string,
  id: string,
): Promise<boolean> {
  const entries = await readAdoptions(root);
  const kept = entries.filter((entry) => entry.id !== id);
  if (kept.length === entries.length) return false;
  await atomicWrite(pathFor(root), kept);
  return true;
}
