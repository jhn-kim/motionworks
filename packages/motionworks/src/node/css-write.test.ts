import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
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

  it("targets the duration token inside the animation shorthand", () => {
    const src = ".badge { animation: wobble 1.2s ease-in-out infinite; }";
    const decls = findDeclarations(src, "animation-duration");
    expect(decls).toHaveLength(1);
    expect(src.slice(decls[0]!.start, decls[0]!.end)).toBe("1.2s");
    // delay = the second <time>, which this shorthand doesn't have.
    expect(findDeclarations(src, "animation-delay")).toHaveLength(0);
  });

  it("ignores a time-like token inside a comment in the shorthand", () => {
    const src = ".a { animation: spin 2s /* was 1s */ linear; }";
    const decls = findDeclarations(src, "animation-duration");
    expect(decls).toHaveLength(1);
    // the real duration (2s), not the "1s" buried in the comment
    expect(src.slice(decls[0]!.start, decls[0]!.end)).toBe("2s");
  });

  it("auto-applies a duration edit written in the animation shorthand", async () => {
    const file = join(root, "a.css");
    await writeFile(
      file,
      ".badge { animation: wobble 1.2s ease-in-out infinite; }",
    );
    const change = entry({
      param: "duration",
      type: "duration",
      var: "animation-duration",
      from: 1200,
      to: 1306.8,
      fromCss: "1.2s",
      toCss: "1.3068s",
    });
    expect((await applyCssChanges(root, change)).kind).toBe("applied");
    expect(await readFile(file, "utf8")).toBe(
      ".badge { animation: wobble 1.3068s ease-in-out infinite; }",
    );
  });

  it("auto-applies a duration edit written in the transition shorthand", async () => {
    const file = join(root, "t.css");
    await writeFile(file, ".btn { transition: background-color 0.3s ease; }");
    const change = entry({
      param: "duration",
      type: "duration",
      var: "transition-duration",
      from: 300,
      to: 250,
      fromCss: "0.3s",
      toCss: "0.25s",
    });
    expect((await applyCssChanges(root, change)).kind).toBe("applied");
    expect(await readFile(file, "utf8")).toBe(
      ".btn { transition: background-color 0.25s ease; }",
    );
  });

  it("leaves a multi-animation shorthand to agent handoff (comma list)", async () => {
    await writeFile(
      join(root, "a.css"),
      ".x { animation: spin 1.2s linear, fade 2s ease; }",
    );
    const change = entry({
      param: "duration",
      type: "duration",
      var: "animation-duration",
      from: 1200,
      to: 1300,
      fromCss: "1.2s",
      toCss: "1.3s",
    });
    expect((await applyCssChanges(root, change)).kind).toBe("skipped");
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

  it("matches sourceFile at a path boundary, not any trailing substring (P2-12d)", async () => {
    await writeFile(join(root, "motion.css"), ".card{--mw-radius:100px}");
    await writeFile(join(root, "evil-motion.css"), ".card{--mw-radius:100px}");
    const result = await applyCssChanges(
      root,
      entry({
        rule: {
          sourceFile: "motion.css",
          selectorText: ".card",
          sheetHref: "",
        },
      }),
    );
    // The unanchored endsWith would have matched evil-motion.css too and made
    // this ambiguous; the boundary-aware match resolves to exactly one file.
    expect(result).toMatchObject({ kind: "applied", files: ["motion.css"] });
    expect(await readFile(join(root, "evil-motion.css"), "utf8")).toContain(
      "100px",
    );
  });

  it("preserves the original file mode across the atomic replace (P2-12e)", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card{--mw-radius:100px}");
    await chmod(file, 0o640);
    expect((await applyCssChanges(root, entry())).kind).toBe("applied");
    expect((await stat(file)).mode & 0o777).toBe(0o640);
  });

  it("serializes concurrent writers so neither change is lost (P2-12i)", async () => {
    const file = join(root, "a.css");
    await writeFile(file, ".card{--mw-radius:100px; --mw-strength:1}");
    const strengthEntry = entry({
      param: "strength",
      type: "scalar",
      from: 1,
      to: 2,
      var: "--mw-strength",
      fromCss: "1",
      toCss: "2",
    });
    // Two independent writers touch the same file at once. Without the shared
    // lock, the second read-modify-write would clobber the first's edit.
    const [a, b] = await Promise.all([
      applyCssChanges(root, entry()),
      applyCssChanges(root, strengthEntry),
    ]);
    expect(a.kind).toBe("applied");
    expect(b.kind).toBe("applied");
    const contents = await readFile(file, "utf8");
    expect(contents).toContain("--mw-radius:120px");
    expect(contents).toContain("--mw-strength:2");
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
