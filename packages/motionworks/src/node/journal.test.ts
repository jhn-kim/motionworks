import {
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JournalEntry } from "../shared/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ackEntries,
  appendEntry,
  coalescePendingEntries,
  readJournal,
  updateEntry,
  upsertPendingEntry,
  withJournalLock,
} from "./journal.js";

let root: string;
const entry = (id: string): JournalEntry => ({
  id,
  createdAt: Date.now(),
  origin: "",
  page: "/",
  effectId: "card#1",
  effectName: "Card",
  elementSelector: ".card",
  changes: [],
  status: "pending",
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionworks-journal-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("journal", () => {
  it("writes atomically without leaving temp files", async () => {
    const value = entry("one");
    await appendEntry(root, value);
    expect(await readJournal(root)).toEqual([value]);
    expect(
      (await readdir(join(root, ".motionworks"))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("serializes concurrent appends", async () => {
    await Promise.all([
      appendEntry(root, entry("one")),
      appendEntry(root, entry("two")),
    ]);
    expect((await readJournal(root)).map((item) => item.id).sort()).toEqual([
      "one",
      "two",
    ]);
  });

  it("updates entries and acknowledges requested ids without reordering the rest", async () => {
    await appendEntry(root, entry("one"));
    await appendEntry(root, entry("two"));
    await appendEntry(root, entry("three"));
    await updateEntry(root, "two", { status: "applied" });
    expect((await ackEntries(root, ["two"])).map((item) => item.id)).toEqual([
      "two",
    ]);
    expect((await readJournal(root)).map((item) => item.id)).toEqual([
      "one",
      "three",
    ]);
    expect((await ackEntries(root, "all")).map((item) => item.id)).toEqual([
      "one",
      "three",
    ]);
  });

  it("replaces a repeatedly saved slider in the same pending entry", async () => {
    const first: JournalEntry = {
      ...entry("first"),
      changes: [
        {
          param: "radius",
          type: "spatial-radius",
          from: 100,
          to: 120,
          var: "--mw-radius",
          fromCss: "100px",
          toCss: "120px",
        },
      ],
    };
    const second: JournalEntry = {
      ...entry("second"),
      changes: [
        {
          param: "radius",
          type: "spatial-radius",
          from: 120,
          to: 160,
          var: "--mw-radius",
          fromCss: "120px",
          toCss: "160px",
        },
      ],
    };

    expect((await upsertPendingEntry(root, first)).id).toBe("first");
    expect((await upsertPendingEntry(root, second)).id).toBe("first");
    expect(await readJournal(root)).toEqual([
      expect.objectContaining({
        id: "first",
        changes: [
          expect.objectContaining({
            param: "radius",
            from: 100,
            to: 160,
            fromCss: "100px",
            toCss: "160px",
          }),
        ],
      }),
    ]);
  });

  it("starts a fresh pending chain when a stale source value does not connect", async () => {
    const first: JournalEntry = {
      ...entry("first"),
      changes: [
        {
          param: "radius",
          type: "spatial-radius",
          from: 40,
          to: 60,
          var: "--mw-radius",
          fromCss: "40px",
          toCss: "60px",
        },
      ],
    };
    const fresh: JournalEntry = {
      ...entry("fresh"),
      changes: [
        {
          param: "radius",
          type: "spatial-radius",
          from: 100,
          to: 140,
          var: "--mw-radius",
          fromCss: "100px",
          toCss: "140px",
        },
      ],
    };

    await upsertPendingEntry(root, first);
    await upsertPendingEntry(root, fresh);

    expect(await readJournal(root)).toEqual([
      expect.objectContaining({
        id: "first",
        changes: [
          expect.objectContaining({
            param: "radius",
            from: 100,
            to: 140,
            fromCss: "100px",
            toCss: "140px",
          }),
        ],
      }),
    ]);
  });

  it("compacts duplicate pending entries while preserving unique sliders", async () => {
    await appendEntry(root, {
      ...entry("first"),
      changes: [
        { param: "radius", type: "spatial-radius", from: 100, to: 120 },
      ],
    });
    await appendEntry(root, {
      ...entry("second"),
      changes: [
        { param: "radius", type: "spatial-radius", from: 120, to: 160 },
        { param: "duration", type: "duration", from: 200, to: 300 },
      ],
    });

    expect(await coalescePendingEntries(root)).toBe(1);
    expect(await readJournal(root)).toEqual([
      expect.objectContaining({
        id: "first",
        changes: [
          expect.objectContaining({ param: "radius", from: 100, to: 160 }),
          expect.objectContaining({ param: "duration", from: 200, to: 300 }),
        ],
      }),
    ]);
  });

  it("reclaims a stale lock", async () => {
    const dir = join(root, ".motionworks");
    await mkdir(dir);
    const lock = join(dir, "journal.lock");
    await writeFile(lock, "stale");
    await utimes(lock, new Date(0), new Date(0));
    await appendEntry(root, entry("one"));
    expect(await readJournal(root)).toHaveLength(1);
  });

  it("serializes concurrent lock holders without losing updates (S7)", async () => {
    // Every critical section reads then writes a shared counter; if the lock
    // let two holders overlap (or a stale-eviction race dropped a fresh lock),
    // increments would be lost. All 20 must land.
    let counter = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        withJournalLock(root, async () => {
          const seen = counter;
          await new Promise((r) => setTimeout(r, 1));
          counter = seen + 1;
        }),
      ),
    );
    expect(counter).toBe(20);
  });

  it("reports malformed JSON", async () => {
    const dir = join(root, ".motionworks");
    await mkdir(dir);
    await writeFile(join(dir, "changes.json"), "{bad");
    await expect(readJournal(root)).rejects.toThrow(
      "Failed to read MotionWorks journal",
    );
  });

  it("drops entries that fail the shape guard on read (P2-12g)", async () => {
    const dir = join(root, ".motionworks");
    await mkdir(dir);
    await writeFile(
      join(dir, "changes.json"),
      JSON.stringify([
        entry("valid"),
        { id: "no-status", createdAt: 1, changes: [] }, // missing status
        { status: "pending", createdAt: 1, changes: [] }, // missing id
        { id: "bad-status", createdAt: 1, status: "weird", changes: [] },
        "not-an-object",
        { id: "no-changes", createdAt: 1, status: "pending" }, // missing changes
      ]),
    );
    expect((await readJournal(root)).map((e) => e.id)).toEqual(["valid"]);
  });
});
