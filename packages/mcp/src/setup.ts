import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  confirm,
  runInit,
  type InitOptions,
  type InitOutcome,
} from "./init.js";

export type SetupOutcome =
  | { kind: "mcp-json-created"; path: string }
  | { kind: "mcp-json-updated"; path: string }
  | { kind: "mcp-json-already-configured"; path: string }
  | { kind: "react-installed"; packageManager: string }
  | { kind: "react-already-installed" }
  | { kind: "react-skipped"; reason: string }
  | { kind: "react-install-failed"; packageManager: string; exitCode: number }
  | { kind: "cancelled"; step: "mcp-json" | "install"; reason: string };

const MCP_SERVER_ENTRY = {
  command: "npx",
  args: ["-y", "@motionworks/mcp"],
} as const;

/** Command that installs a runtime dependency, per package manager. */
export function detectInstallCommand(lockfiles: string[]): {
  packageManager: string;
  argv: string[];
} {
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) {
    return {
      packageManager: "bun",
      argv: ["bun", "add", "@motionworks/react"],
    };
  }
  if (lockfiles.includes("pnpm-lock.yaml")) {
    return {
      packageManager: "pnpm",
      argv: ["pnpm", "add", "@motionworks/react"],
    };
  }
  if (lockfiles.includes("yarn.lock")) {
    return {
      packageManager: "yarn",
      argv: ["yarn", "add", "@motionworks/react"],
    };
  }
  return {
    packageManager: "npm",
    argv: ["npm", "install", "@motionworks/react"],
  };
}

async function readJsonFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(raw); // malformed JSON should surface loudly
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export async function ensureMcpJson(options: {
  cwd: string;
  yes: boolean;
  input: Readable;
  output: Writable;
  log: (msg: string) => void;
}): Promise<SetupOutcome> {
  const { cwd, yes, input, output, log } = options;
  const path = join(cwd, ".mcp.json");
  const existing = await readJsonFile(path);

  const servers =
    existing !== null &&
    typeof existing["mcpServers"] === "object" &&
    existing["mcpServers"] !== null
      ? (existing["mcpServers"] as Record<string, unknown>)
      : {};
  if ("motionworks" in servers) {
    return { kind: "mcp-json-already-configured", path };
  }

  const creating = existing === null;
  if (!yes) {
    const ok = await confirm(
      creating
        ? `Create ${path} with the MotionWorks MCP server entry? [y/N]`
        : `Add the MotionWorks MCP server entry to ${path}? [y/N]`,
      input,
      output,
    );
    if (!ok)
      return { kind: "cancelled", step: "mcp-json", reason: "user declined" };
  }

  const next = existing ?? {};
  next["mcpServers"] = { ...servers, motionworks: MCP_SERVER_ENTRY };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  log(
    `${creating ? "Created" : "Updated"} ${path} with the motionworks MCP server`,
  );
  return { kind: creating ? "mcp-json-created" : "mcp-json-updated", path };
}

export async function ensureReactInstalled(options: {
  cwd: string;
  yes: boolean;
  input: Readable;
  output: Writable;
  log: (msg: string) => void;
  /** Lockfile names present in cwd; injected for tests. */
  lockfiles: string[];
  /** Runs an install command, resolves with its exit code; injected for tests. */
  run?: (argv: string[], cwd: string) => Promise<number>;
}): Promise<SetupOutcome> {
  const {
    cwd,
    yes,
    input,
    output,
    log,
    lockfiles,
    run = spawnAndWait,
  } = options;

  const pkg = await readJsonFile(join(cwd, "package.json"));
  if (pkg === null) {
    return {
      kind: "react-skipped",
      reason: `no package.json in ${cwd} — run init from your app's root to install @motionworks/react`,
    };
  }

  const deps = {
    ...(pkg["dependencies"] as Record<string, string> | undefined),
    ...(pkg["devDependencies"] as Record<string, string> | undefined),
  };
  if ("@motionworks/react" in deps) {
    return { kind: "react-already-installed" };
  }
  if (!("react" in deps)) {
    return {
      kind: "react-skipped",
      reason:
        "project does not depend on react — install a MotionWorks framework package manually",
    };
  }

  const { packageManager, argv } = detectInstallCommand(lockfiles);
  if (!yes) {
    const ok = await confirm(
      `Install @motionworks/react with ${packageManager}? [y/N]`,
      input,
      output,
    );
    if (!ok)
      return { kind: "cancelled", step: "install", reason: "user declined" };
  }

  log(`Installing @motionworks/react with ${packageManager}...`);
  const exitCode = await run(argv, cwd);
  if (exitCode !== 0) {
    return { kind: "react-install-failed", packageManager, exitCode };
  }
  log("Installed @motionworks/react");
  return { kind: "react-installed", packageManager };
}

function spawnAndWait(argv: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const PROVIDER_SNIPPET = `  import { MotionWorksProvider } from '@motionworks/react';

  <MotionWorksProvider />`;

export interface SetupResult {
  setupOutcomes: SetupOutcome[];
  initOutcomes: InitOutcome[];
}

/**
 * Full project setup: .mcp.json entry, @motionworks/react install, instruction
 * stanza (via runInit), then next-step guidance. Each step is confirmation-
 * gated unless `yes`; each is independently skippable and idempotent, so
 * rerunning `init` after a partial setup completes only what is missing.
 */
export async function runSetup(
  options: InitOptions & { stanzaOnly?: boolean; lockfiles?: string[] },
): Promise<SetupResult> {
  const {
    cwd,
    yes = false,
    stanzaOnly = false,
    input = process.stdin,
    output = process.stdout,
    log = (msg: string) => process.stdout.write(`${msg}\n`),
    lockfiles,
  } = options;

  const setupOutcomes: SetupOutcome[] = [];
  if (!stanzaOnly) {
    setupOutcomes.push(await ensureMcpJson({ cwd, yes, input, output, log }));
    setupOutcomes.push(
      await ensureReactInstalled({
        cwd,
        yes,
        input,
        output,
        log,
        lockfiles: lockfiles ?? (await presentLockfiles(cwd)),
      }),
    );
  }

  const initOutcomes = await runInit(options);

  if (!stanzaOnly) {
    const mountNeeded = setupOutcomes.some(
      (o) =>
        o.kind === "react-installed" || o.kind === "react-already-installed",
    );
    log("");
    log("Next steps:");
    if (mountNeeded) {
      log(
        "  1. Mount the overlay once in your app (it renders nothing in production):",
      );
      log("");
      log(PROVIDER_SNIPPET);
      log("");
      log("  2. Restart your agent session so it picks up .mcp.json.");
    } else {
      log("  1. Restart your agent session so it picks up .mcp.json.");
    }
  }

  return { setupOutcomes, initOutcomes };
}

async function presentLockfiles(cwd: string): Promise<string[]> {
  const candidates = [
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
  ];
  const present: string[] = [];
  for (const name of candidates) {
    try {
      await readFile(join(cwd, name));
      present.push(name);
    } catch {
      // absent
    }
  }
  return present;
}
