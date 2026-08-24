import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GUIDE_FILE, renderStanza, scanClaudeMd } from "./claude-md.js";
import { derivePort, readConfigPort } from "./config.js";
import { runInit } from "./init.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "motionworks-init-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("runInit", () => {
  it("creates a lean reference stanza in CLAUDE.md and writes the full guide to its own file (--yes)", async () => {
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    // A fresh project with no instruction file gets both, so Claude
    // (CLAUDE.md) and Codex (AGENTS.md) are covered without guessing.
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ kind: "created", file: "CLAUDE.md" });
    expect(outcomes[1]).toMatchObject({ kind: "created", file: "AGENTS.md" });

    // Both carry the identical stanza; assert it on the AGENTS.md copy too.
    const agents = await readFile(join(cwd, "AGENTS.md"), "utf8");
    expect(scanClaudeMd(agents).present).toBe(true);
    expect(agents).toContain("npx motionworks changes");

    const contents = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    const scan = scanClaudeMd(contents);
    expect(scan.present).toBe(true);
    expect(scan.version).toBe("1.0.0");
    // The instruction file stays lean: it references the guide, not embeds it.
    expect(contents).toContain(GUIDE_FILE);
    expect(contents).not.toContain("[MotionWorks agent guide]");
    expect(contents).toContain("npx motionworks changes");
    expect(contents).toContain("npx motionworks status");
    expect(contents).not.toContain("MCP tool");

    // The full guide lands in its own file, tagged with the same version.
    const guide = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guide).toContain("[MotionWorks agent guide]");
    expect(guide).toContain("CSS custom properties");
    expect(guide).toContain("npx motionworks ack <id>");
    expect(guide).toContain("motionworks-version: 1.0.0");
  });

  it("regenerates the guide file on upgrade and leaves it untouched at the same version", async () => {
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    const guideV1 = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guideV1).toContain("motionworks-version: 1.0.0");

    // Same version rerun: guide is not rewritten.
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    expect(await readFile(join(cwd, GUIDE_FILE), "utf8")).toBe(guideV1);

    // Upgrade: guide is regenerated at the new version.
    await runInit({ cwd, packageVersion: "1.1.0", yes: true, log: () => {} });
    const guideV2 = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guideV2).toContain("motionworks-version: 1.1.0");
  });

  it("is idempotent at the same version: running twice yields byte-identical CLAUDE.md and skipped-same-version", async () => {
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    const first = await readFile(join(cwd, "CLAUDE.md"), "utf8");

    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes[0]!.kind).toBe("skipped-same-version");
    const second = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(second).toBe(first);
  });

  it("appends to an existing CLAUDE.md without touching prior content", async () => {
    const priorContent = "# Project instructions\n\nSome existing notes.\n";
    await writeFile(join(cwd, "CLAUDE.md"), priorContent, "utf8");
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: "appended", file: "CLAUDE.md" });

    const contents = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(contents.startsWith(priorContent)).toBe(true);
    const scan = scanClaudeMd(contents);
    expect(scan.present).toBe(true);
    expect(scan.version).toBe("1.0.0");
  });

  it("replaces an older stanza with confirmation (--yes), leaving surrounding content untouched", async () => {
    const oldStanza = renderStanza("0.5.0");
    const priorContent = `# Project\n\n${oldStanza}\n\nMore notes below.\n`;
    await writeFile(join(cwd, "CLAUDE.md"), priorContent, "utf8");

    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes[0]!.kind).toBe("replaced");

    const contents = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(contents.startsWith("# Project\n\n")).toBe(true);
    expect(contents.endsWith("More notes below.\n")).toBe(true);
    const scan = scanClaudeMd(contents);
    expect(scan.version).toBe("1.0.0");
  });

  it("summarizes instead of dumping a huge diff when migrating a large inline stanza", async () => {
    // Simulate a project on the old pre-split stanza: the whole guide inline.
    const body = Array.from(
      { length: 60 },
      (_, i) => `guide body line ${i}`,
    ).join("\n");
    const oldFat = [
      "<!-- motionworks-instructions-start -->",
      "<!-- motionworks-version: 0.5.0 -->",
      "",
      body,
      "<!-- motionworks-instructions-end -->",
    ].join("\n");
    await writeFile(join(cwd, "CLAUDE.md"), `# Project\n\n${oldFat}\n`, "utf8");

    const logs: string[] = [];
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: (m) => logs.push(m),
    });
    expect(outcomes[0]!.kind).toBe("replaced");

    const out = logs.join("\n");
    // The removed guide body is NOT dumped line-by-line; a summary points at the guide file.
    expect(out).not.toContain("guide body line 30");
    expect(out).toContain(GUIDE_FILE);
  });

  it("does not overwrite a stanza newer than the installed package", async () => {
    const newerStanza = renderStanza("9.9.9");
    await writeFile(join(cwd, "CLAUDE.md"), `${newerStanza}\n`, "utf8");

    const before = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes[0]!.kind).toBe("skipped-same-version");
    const after = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(after).toBe(before);
  });

  it("updates both CLAUDE.md and AGENTS.md when both exist", async () => {
    await writeFile(join(cwd, "CLAUDE.md"), "# Claude notes\n", "utf8");
    await writeFile(join(cwd, "AGENTS.md"), "# Codex notes\n", "utf8");

    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.file).sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(outcomes.every((o) => o.kind === "appended")).toBe(true);

    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const scan = scanClaudeMd(await readFile(join(cwd, file), "utf8"));
      expect(scan.present).toBe(true);
      expect(scan.version).toBe("1.0.0");
    }
  });

  it("targets an AGENTS.md-only project without creating CLAUDE.md", async () => {
    await writeFile(join(cwd, "AGENTS.md"), "# Codex notes\n", "utf8");

    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: "appended", file: "AGENTS.md" });
    await expect(readFile(join(cwd, "CLAUDE.md"), "utf8")).rejects.toThrow();
  });

  it("creates AGENTS.md when forced with the agents flag", async () => {
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      agents: true,
      log: () => {},
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: "created", file: "AGENTS.md" });
    const scan = scanClaudeMd(await readFile(join(cwd, "AGENTS.md"), "utf8"));
    expect(scan.version).toBe("1.0.0");
    await expect(readFile(join(cwd, "CLAUDE.md"), "utf8")).rejects.toThrow();
  });

  it("targets both files when both flags are passed, creating missing ones", async () => {
    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      claude: true,
      agents: true,
      log: () => {},
    });
    expect(outcomes.map((o) => o.kind)).toEqual(["created", "created"]);
    expect(outcomes.map((o) => o.file)).toEqual(["CLAUDE.md", "AGENTS.md"]);
  });

  it("can update the two files at independent versions in one run", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("1.0.0")}\n`,
      "utf8",
    );
    await writeFile(
      join(cwd, "AGENTS.md"),
      `${renderStanza("0.5.0")}\n`,
      "utf8",
    );

    const outcomes = await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: () => {},
    });
    const byFile = new Map(outcomes.map((o) => [o.file, o.kind]));
    expect(byFile.get("CLAUDE.md")).toBe("skipped-same-version");
    expect(byFile.get("AGENTS.md")).toBe("replaced");
  });
});

describe("runInit — per-project port", () => {
  it("pins a derived port on a fresh install and wires it into the guide", async () => {
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    const port = derivePort(cwd);
    expect(await readConfigPort(cwd)).toBe(port);

    const guide = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guide).toContain(`http://127.0.0.1:${String(port)}/motionworks.js`);
    // The React mount now builds a tokened daemonUrl from the pinned port.
    expect(guide).toContain(`'http://127.0.0.1:${String(port)}'`);
    expect(guide).toContain("<MotionWorksProvider daemonUrl={daemonUrl} />");
  });

  it("is idempotent: a same-version rerun keeps the pinned port and guide", async () => {
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    const port = await readConfigPort(cwd);
    const guide = await readFile(join(cwd, GUIDE_FILE), "utf8");

    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    expect(await readConfigPort(cwd)).toBe(port);
    expect(await readFile(join(cwd, GUIDE_FILE), "utf8")).toBe(guide);
  });

  it("respects an explicit port override", async () => {
    await runInit({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      port: 52399,
      log: () => {},
    });
    expect(await readConfigPort(cwd)).toBe(52399);
    const guide = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guide).toContain("http://127.0.0.1:52399/motionworks.js");
  });

  it("keeps a port already pinned in the config", async () => {
    await writeFile(
      join(cwd, "motionworks.config.json"),
      JSON.stringify({ port: 52360 }),
    );
    await runInit({ cwd, packageVersion: "1.0.0", yes: true, log: () => {} });
    expect(await readConfigPort(cwd)).toBe(52360);
    const guide = await readFile(join(cwd, GUIDE_FILE), "utf8");
    expect(guide).toContain("http://127.0.0.1:52360/motionworks.js");
  });
});
