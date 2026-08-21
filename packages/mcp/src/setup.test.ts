import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectInstallCommand,
  ensureMcpJson,
  ensureReactInstalled,
  runSetup,
} from "./setup.js";

let cwd: string;
const silent = () => {};
const streams = () => ({ input: new PassThrough(), output: new PassThrough() });

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "motionworks-setup-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("detectInstallCommand", () => {
  it("picks the package manager from lockfiles, npm as fallback", () => {
    expect(detectInstallCommand(["pnpm-lock.yaml"]).packageManager).toBe(
      "pnpm",
    );
    expect(detectInstallCommand(["yarn.lock"]).packageManager).toBe("yarn");
    expect(detectInstallCommand(["bun.lockb"]).packageManager).toBe("bun");
    expect(detectInstallCommand(["package-lock.json"]).packageManager).toBe(
      "npm",
    );
    expect(detectInstallCommand([]).packageManager).toBe("npm");
  });
});

describe("ensureMcpJson", () => {
  it("creates .mcp.json with the motionworks entry when absent", async () => {
    const outcome = await ensureMcpJson({
      cwd,
      yes: true,
      ...streams(),
      log: silent,
    });
    expect(outcome.kind).toBe("mcp-json-created");
    const written = JSON.parse(
      await readFile(join(cwd, ".mcp.json"), "utf8"),
    ) as {
      mcpServers: { motionworks: { command: string; args: string[] } };
    };
    expect(written.mcpServers.motionworks.command).toBe("npx");
    expect(written.mcpServers.motionworks.args).toEqual(["-y", "motionworks"]);
  });

  it("merges into an existing .mcp.json without touching other servers", async () => {
    await writeFile(
      join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "foo" } } }),
      "utf8",
    );
    const outcome = await ensureMcpJson({
      cwd,
      yes: true,
      ...streams(),
      log: silent,
    });
    expect(outcome.kind).toBe("mcp-json-updated");
    const written = JSON.parse(
      await readFile(join(cwd, ".mcp.json"), "utf8"),
    ) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(written.mcpServers).sort()).toEqual([
      "motionworks",
      "other",
    ]);
  });

  it("is idempotent when motionworks is already configured", async () => {
    await ensureMcpJson({ cwd, yes: true, ...streams(), log: silent });
    const before = await readFile(join(cwd, ".mcp.json"), "utf8");
    const outcome = await ensureMcpJson({
      cwd,
      yes: true,
      ...streams(),
      log: silent,
    });
    expect(outcome.kind).toBe("mcp-json-already-configured");
    expect(await readFile(join(cwd, ".mcp.json"), "utf8")).toBe(before);
  });
});

describe("ensureReactInstalled", () => {
  const base = () => ({ cwd, yes: true, ...streams(), log: silent });

  it("skips when there is no package.json", async () => {
    const outcome = await ensureReactInstalled({ ...base(), lockfiles: [] });
    expect(outcome.kind).toBe("react-skipped");
  });

  it("skips non-React projects without running an install", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { vue: "^3" } }),
    );
    let ran = false;
    const outcome = await ensureReactInstalled({
      ...base(),
      lockfiles: [],
      run: () => ((ran = true), Promise.resolve(0)),
    });
    expect(outcome.kind).toBe("react-skipped");
    expect(ran).toBe(false);
  });

  it("short-circuits when @motionworks/react is already a dependency", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19", "@motionworks/react": "^0.1.0" },
      }),
    );
    const outcome = await ensureReactInstalled({ ...base(), lockfiles: [] });
    expect(outcome.kind).toBe("react-already-installed");
  });

  it("runs the detected install command in a React project", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );
    const calls: string[][] = [];
    const outcome = await ensureReactInstalled({
      ...base(),
      lockfiles: ["pnpm-lock.yaml"],
      run: (argv) => (calls.push(argv), Promise.resolve(0)),
    });
    expect(outcome).toMatchObject({
      kind: "react-installed",
      packageManager: "pnpm",
    });
    expect(calls).toEqual([["pnpm", "add", "@motionworks/react"]]);
  });

  it("reports a failed install with its exit code", async () => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^19" } }),
    );
    const outcome = await ensureReactInstalled({
      ...base(),
      lockfiles: [],
      run: () => Promise.resolve(1),
    });
    expect(outcome).toMatchObject({
      kind: "react-install-failed",
      exitCode: 1,
    });
  });
});

describe("runSetup", () => {
  it("does mcp.json + stanza and skips install gracefully in a non-React dir, all with --yes", async () => {
    const { setupOutcomes, initOutcomes } = await runSetup({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      log: silent,
      lockfiles: [],
    });
    expect(setupOutcomes.map((o) => o.kind)).toEqual([
      "mcp-json-created",
      "react-skipped",
    ]);
    expect(initOutcomes[0]).toMatchObject({
      kind: "created",
      file: "CLAUDE.md",
    });
  });

  it("--stanza-only preserves the previous init behavior exactly", async () => {
    const { setupOutcomes, initOutcomes } = await runSetup({
      cwd,
      packageVersion: "1.0.0",
      yes: true,
      stanzaOnly: true,
      log: silent,
    });
    expect(setupOutcomes).toEqual([]);
    expect(initOutcomes[0]).toMatchObject({
      kind: "created",
      file: "CLAUDE.md",
    });
    let mcpJsonExists = true;
    try {
      await readFile(join(cwd, ".mcp.json"));
    } catch {
      mcpJsonExists = false;
    }
    expect(mcpJsonExists).toBe(false);
  });
});
