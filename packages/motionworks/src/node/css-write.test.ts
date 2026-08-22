import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "../shared/index.js";
import {
  applyCssChanges,
  findDeclarations,
  verifyCssChanges,
} from "./css-write.js";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mw-css-write-"));
});
afterEach(async () => rm(root, { recursive: true, force: true }));
const entry = (
  overrides: Partial<JournalEntry["changes"][number]> = {},
): JournalEntry => ({
  id: "1",
  createdAt: 1,
  origin: "",
  page: "/",
  effectId: "card#1",
  effectName: "Card",
  elementSelector: ".card",
  status: "pending",
  changes: [
    {
      param: "radius",
      type: "spatial-radius",
      from: 100,
      to: 120,
      var: "--mw-radius",
      fromCss: "100px",
      toCss: "120px",
      ...overrides,
    },
  ],
});
describe("CSS write", () => {
  it("replaces only the value and preserves comments/whitespace", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card { /*x*/ --mw-radius: 100px ; color:red }");
    expect((await applyCssChanges(root, entry())).kind).toBe("applied");
    expect(await readFile(file, "utf8")).toBe(
      ".card { /*x*/ --mw-radius: 120px ; color:red }",
    );
  });
  it("skips ambiguity, mismatches, and shorthand", async () => {
    await writeFile(
      join(root, "a.css"),
      ".a{--mw-radius:100px}.b{--mw-radius:100px}",
    );
    expect((await applyCssChanges(root, entry())).kind).toBe("skipped");
    expect(
      await applyCssChanges(root, entry({ fromCss: "99px" })),
    ).toMatchObject({ kind: "skipped" });
    expect(findDeclarations(".a{animation: spin 1s}", "animation")).toEqual([]);
  });
  it("narrows by source file and selector through nested media", async () => {
    await writeFile(join(root, "a.css"), ".a{--mw-radius:100px}");
    await writeFile(
      join(root, "b.css"),
      "@media all{.card{--mw-radius:100px}}",
    );
    const result = await applyCssChanges(
      root,
      entry({
        rule: { sourceFile: "b.css", selectorText: ".card", sheetHref: "" },
      }),
    );
    expect(result).toMatchObject({ kind: "applied", files: ["b.css"] });
  });
  it("is all-or-nothing", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card{--mw-radius:100px}");
    const two = entry();
    two.changes.push({
      param: "strength",
      type: "scalar",
      from: 1,
      to: 2,
      var: "--mw-strength",
      fromCss: "1",
      toCss: "2",
    });
    expect((await applyCssChanges(root, two)).kind).toBe("skipped");
    expect(await readFile(file, "utf8")).toContain("100px");
  });

  it("leaves originals untouched when staging a later file fails", async () => {
    const first = join(root, "a.css");
    const second = join(root, "b.css");
    const firstSource = ".card{--mw-radius:100px}";
    const secondSource = ".card{--mw-strength:1}";
    await writeFile(first, firstSource);
    await writeFile(second, secondSource);
    const two = entry({
      rule: { sourceFile: "a.css", selectorText: ".card", sheetHref: "" },
    });
    two.changes.push({
      param: "strength",
      type: "scalar",
      from: 1,
      to: 2,
      var: "--mw-strength",
      fromCss: "1",
      toCss: "2",
      rule: { sourceFile: "b.css", selectorText: ".card", sheetHref: "" },
    });
    let failed = false;
    const result = await applyCssChanges(root, two, {
      writeFile: async (file, source, encoding) => {
        if (file.startsWith(second) && !failed) {
          failed = true;
          throw new Error("disk full");
        }
        await writeFile(file, source, encoding);
      },
    });
    expect(result).toMatchObject({ kind: "skipped" });
    expect(await readFile(first, "utf8")).toBe(firstSource);
    expect(await readFile(second, "utf8")).toBe(secondSource);
  });

  it("rolls back an earlier replacement when a later atomic swap fails", async () => {
    const first = join(root, "a.css");
    const second = join(root, "b.css");
    const firstSource = ".card{--mw-radius:100px}";
    const secondSource = ".card{--mw-strength:1}";
    await writeFile(first, firstSource);
    await writeFile(second, secondSource);
    const two = entry({
      rule: { sourceFile: "a.css", selectorText: ".card", sheetHref: "" },
    });
    two.changes.push({
      param: "strength",
      type: "scalar",
      from: 1,
      to: 2,
      var: "--mw-strength",
      fromCss: "1",
      toCss: "2",
      rule: { sourceFile: "b.css", selectorText: ".card", sheetHref: "" },
    });
    let failed = false;
    const result = await applyCssChanges(root, two, {
      rename: async (from, to) => {
        if (
          from.startsWith(`${second}.motionworks-`) &&
          to === second &&
          !failed
        ) {
          failed = true;
          throw new Error("rename failed");
        }
        await rename(from, to);
      },
    });
    expect(result).toMatchObject({ kind: "skipped" });
    expect(await readFile(first, "utf8")).toBe(firstSource);
    expect(await readFile(second, "utf8")).toBe(secondSource);
    expect(
      (await readdir(root)).filter((file) => file.includes(".motionworks-")),
    ).toEqual([]);
  });

  it("rejects multiple changes targeting the same declaration", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card{--mw-radius:100px}");
    const overlapping = entry();
    overlapping.changes.push({
      ...overlapping.changes[0]!,
      to: 140,
      toCss: "140px",
    });
    expect(await applyCssChanges(root, overlapping)).toMatchObject({
      kind: "skipped",
      reason: expect.stringContaining("same CSS declaration"),
    });
    expect(await readFile(file, "utf8")).toContain("100px");
  });

  it("verifies that an agent actually wrote every target value", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card{--mw-radius:100px}");

    await expect(verifyCssChanges(root, entry())).resolves.toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("reported success"),
    });

    await writeFile(file, ".card{--mw-radius:120px}");
    await expect(verifyCssChanges(root, entry())).resolves.toEqual({
      kind: "verified",
      files: ["a.css"],
    });
  });
});
