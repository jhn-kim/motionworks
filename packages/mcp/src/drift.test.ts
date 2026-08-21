import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderStanza } from "./claude-md.js";
import { checkDrift } from "./drift.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "motionworks-drift-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("checkDrift", () => {
  it("warns when no instruction file exists", async () => {
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).not.toBeNull();
    expect(warning!).toContain(
      "MotionWorks: agent instructions may be outdated.",
    );
    expect(warning!).toContain("Installed: motionworks@1.0.0");
    expect(warning!).toContain("no CLAUDE.md or AGENTS.md found");
    expect(warning!).toContain('Run "npx motionworks init" to refresh.');
  });

  it("warns when CLAUDE.md exists but has no stanza", async () => {
    await writeFile(join(cwd, "CLAUDE.md"), "# just some notes\n", "utf8");
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).not.toBeNull();
    expect(warning!).toContain("CLAUDE.md: no stanza");
  });

  it("warns when the stanza is older than the installed package", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("0.9.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).not.toBeNull();
    expect(warning!).toContain("Installed: motionworks@1.0.0");
    expect(warning!).toContain("CLAUDE.md: v0.9.0");
  });

  it("does not warn when the stanza matches the installed package", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("1.0.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).toBeNull();
  });

  it("does not warn when the stanza is newer than the installed package", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("1.5.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).toBeNull();
  });

  it("does not demand AGENTS.md from a Claude-only project", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("1.0.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).toBeNull();
  });

  it("accepts an AGENTS.md-only project with a current stanza", async () => {
    await writeFile(
      join(cwd, "AGENTS.md"),
      `${renderStanza("1.0.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).toBeNull();
  });

  it("warns about a stale AGENTS.md even when CLAUDE.md is current", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("1.0.0")}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "AGENTS.md"), "# codex notes\n", "utf8");
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).not.toBeNull();
    expect(warning!).toContain("AGENTS.md: no stanza");
    expect(warning!).not.toContain("CLAUDE.md:");
  });

  it("lists both files when both are stale", async () => {
    await writeFile(
      join(cwd, "CLAUDE.md"),
      `${renderStanza("0.8.0")}\n`,
      "utf8",
    );
    await writeFile(
      join(cwd, "AGENTS.md"),
      `${renderStanza("0.9.0")}\n`,
      "utf8",
    );
    const warning = await checkDrift({ cwd, packageVersion: "1.0.0" });
    expect(warning).not.toBeNull();
    expect(warning!).toContain("CLAUDE.md: v0.8.0");
    expect(warning!).toContain("AGENTS.md: v0.9.0");
  });
});
