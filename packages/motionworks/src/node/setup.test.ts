import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectInstallCommand,
  ensureGitignore,
  ensureReactInstalled,
  isProjectRoot,
  removeStaleMcpEntry,
  runSetup,
} from "./setup.js";

let cwd: string;
const streams = () => ({ input: new PassThrough(), output: new PassThrough() });
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "motionworks-setup-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("detectInstallCommand", () => {
  it("selects the package manager from lockfiles", () => {
    expect(detectInstallCommand(["pnpm-lock.yaml"]).packageManager).toBe(
      "pnpm",
    );
    expect(detectInstallCommand(["yarn.lock"]).packageManager).toBe("yarn");
    expect(detectInstallCommand(["bun.lockb"]).packageManager).toBe("bun");
    expect(detectInstallCommand([]).packageManager).toBe("npm");
  });
});

describe("ensureGitignore", () => {
  it("adds .motionworks/ once", async () => {
    await writeFile(join(cwd, ".gitignore"), "dist\n");
    await ensureGitignore({ cwd, yes: true, ...streams(), log: () => {} });
    expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe(
      "dist\n.motionworks/\n",
    );
    expect(
      (await ensureGitignore({ cwd, yes: true, ...streams(), log: () => {} }))
        .kind,
    ).toBe("gitignore-already-configured");
  });
});

describe("removeStaleMcpEntry", () => {
  it("removes only the stale motionworks server", async () => {
    await writeFile(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          motionworks: { command: "npx" },
          other: { command: "other" },
        },
      }),
    );
    expect((await removeStaleMcpEntry(cwd)).kind).toBe(
      "stale-mcp-entry-removed",
    );
    expect(JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { other: { command: "other" } },
    });
  });
});

describe("ensureReactInstalled", () => {
  const base = () => ({
    cwd,
    yes: true,
    ...streams(),
    log: () => {},
    lockfiles: [],
  });

  it("skips a directory without package.json", async () => {
    expect((await ensureReactInstalled(base())).kind).toBe("react-skipped");
  });

  it("skips a non-React project without installing", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3" } }),
    );
    let ran = false;
    const outcome = await ensureReactInstalled({
      ...base(),
      run: () => {
        ran = true;
        return Promise.resolve(0);
      },
    });
    expect(outcome.kind).toBe("react-skipped");
    expect(ran).toBe(false);
  });

  it("does not reinstall motionworks", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^19", motionworks: "^0.5" } }),
    );
    expect((await ensureReactInstalled(base())).kind).toBe(
      "react-already-installed",
    );
  });

  it("runs the detected install command for React", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );
    const calls: string[][] = [];
    const outcome = await ensureReactInstalled({
      ...base(),
      lockfiles: ["pnpm-lock.yaml"],
      run: (argv) => {
        calls.push(argv);
        return Promise.resolve(0);
      },
    });
    expect(outcome).toMatchObject({
      kind: "react-installed",
      packageManager: "pnpm",
    });
    expect(calls).toEqual([["pnpm", "add", "motionworks"]]);
  });

  it("reports install failures", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );
    expect(
      await ensureReactInstalled({ ...base(), run: () => Promise.resolve(1) }),
    ).toMatchObject({ kind: "react-install-failed", exitCode: 1 });
  });

  it("nudges toward useMotionVar when a JS animation library is present", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19", "framer-motion": "^11" },
      }),
    );
    const logs: string[] = [];
    await ensureReactInstalled({
      ...base(),
      log: (line) => logs.push(line),
      run: () => Promise.resolve(0),
    });
    expect(logs.join("\n")).toContain("framer-motion");
    expect(logs.join("\n")).toContain("useMotionVar");
  });
});

describe("runSetup", () => {
  it("supports non-React projects and prints agent-driven next steps", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3" } }),
    );
    const logs: string[] = [];
    const result = await runSetup({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: (line) => logs.push(line),
      lockfiles: [],
    });
    expect(result.setupOutcomes.map((outcome) => outcome.kind)).toEqual([
      "gitignore-updated",
      "stale-mcp-entry-absent",
      "react-skipped",
    ]);
    const output = logs.join("\n");
    expect(output).toContain("Tell your coding agent to set up MotionWorks");
    expect(output).toContain("MOTIONWORKS.md");
    expect(output).toContain("npx motionworks");
  });
});

describe("isProjectRoot", () => {
  it("is true when package.json is present", async () => {
    await writeFile(join(cwd, "package.json"), "{}");
    expect(await isProjectRoot(cwd)).toBe(true);
  });

  it("is true when .git is present", async () => {
    await mkdir(join(cwd, ".git"));
    expect(await isProjectRoot(cwd)).toBe(true);
  });

  it("is false in a bare directory", async () => {
    expect(await isProjectRoot(cwd)).toBe(false);
  });
});
