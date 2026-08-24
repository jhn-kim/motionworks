import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdoptionEntry } from "../shared/index.js";
import {
  appendAdoption,
  readAdoptions,
  removeAdoption,
  updateAdoption,
} from "./adoptions.js";

let root: string;

const entry = (id: string): AdoptionEntry => ({
  id,
  createdAt: Date.now(),
  origin: "http://localhost:3000",
  status: "pending",
  library: "gsap",
  page: "/",
  effectName: "Hero drift",
  elementSelector: ".hero",
  params: [
    { key: "duration", type: "duration", value: 2000, var: "--mw-duration", label: "Duration", unit: "ms" },
  ],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-adopt-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("adoption journal", () => {
  it("returns [] when the file does not exist", async () => {
    expect(await readAdoptions(root)).toEqual([]);
  });

  it("appends and reads back entries", async () => {
    await appendAdoption(root, entry("a"));
    await appendAdoption(root, entry("b"));
    expect((await readAdoptions(root)).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("updates an entry by id and returns null for a missing id", async () => {
    await appendAdoption(root, entry("a"));
    const updated = await updateAdoption(root, "a", {
      status: "applied",
      appliedBy: "agent",
    });
    expect(updated?.status).toBe("applied");
    expect(await updateAdoption(root, "missing", { status: "applied" })).toBeNull();
  });

  it("removes an entry and reports whether one was removed", async () => {
    await appendAdoption(root, entry("a"));
    expect(await removeAdoption(root, "a")).toBe(true);
    expect(await removeAdoption(root, "a")).toBe(false);
    expect(await readAdoptions(root)).toEqual([]);
  });

  it("drops malformed entries on read", async () => {
    await appendAdoption(root, entry("good"));
    // Corrupt the file with a junk entry alongside a valid one.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(root, ".motionworks", "adoptions.json"),
      JSON.stringify([{ id: "bad" }, entry("good")]),
    );
    expect((await readAdoptions(root)).map((e) => e.id)).toEqual(["good"]);
  });
});
