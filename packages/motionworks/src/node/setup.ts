import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { GUIDE_FILE } from "./claude-md.js";
import {
  confirm,
  runInit,
  type InitOptions,
  type InitOutcome,
} from "./init.js";
import { cyan, dim, heading, step, symbols } from "./ui.js";

export type SetupOutcome =
  | { kind: "gitignore-updated" | "gitignore-already-configured"; path: string }
  | { kind: "stale-mcp-entry-removed" | "stale-mcp-entry-absent"; path: string }
  | { kind: "react-installed"; packageManager: string }
  | { kind: "react-already-installed" }
  | { kind: "react-skipped"; reason: string }
  | { kind: "react-install-failed"; packageManager: string; exitCode: number }
  | { kind: "cancelled"; step: "gitignore" | "install"; reason: string };

/** Command that installs a runtime dependency, per package manager. */
export function detectInstallCommand(lockfiles: string[]): {
  packageManager: string;
  argv: string[];
} {
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) {
    return {
      packageManager: "bun",
      argv: ["bun", "add", "motionworks"],
    };
  }
  if (lockfiles.includes("pnpm-lock.yaml")) {
    return {
      packageManager: "pnpm",
      argv: ["pnpm", "add", "motionworks"],
    };
  }
  if (lockfiles.includes("yarn.lock")) {
    return {
      packageManager: "yarn",
      argv: ["yarn", "add", "motionworks"],
    };
  }
  return {
    packageManager: "npm",
    argv: ["npm", "install", "motionworks"],
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

export async function ensureGitignore(options: {
  cwd: string;
  yes: boolean;
  input: Readable;
  output: Writable;
  log: (msg: string) => void;
}): Promise<SetupOutcome> {
  const { cwd, yes, input, output, log } = options;
  const path = join(cwd, ".gitignore");
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch { /* absent */ }
  if (existing.split(/\r?\n/).includes('.motionworks/')) {
    log(step(symbols.skipped, `${dim(path)} already ignores .motionworks/`));
    return { kind: 'gitignore-already-configured', path };
  }
  if (!yes) {
    const ok = await confirm(`Add .motionworks/ to ${path}?`, input, output);
    if (!ok) return { kind: 'cancelled', step: 'gitignore', reason: 'user declined' };
  }
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await writeFile(path, `${existing}${separator}.motionworks/\n`, 'utf8');
  log(step(symbols.done, `Updated ${dim(path)} — ignored .motionworks/`));
  return { kind: 'gitignore-updated', path };
}

export async function removeStaleMcpEntry(cwd: string): Promise<SetupOutcome> {
  const path = join(cwd, '.mcp.json');
  const existing = await readJsonFile(path);
  const servers = existing?.mcpServers;
  if (existing === null || typeof servers !== 'object' || servers === null || !("motionworks" in servers)) {
    return { kind: 'stale-mcp-entry-absent', path };
  }
  const nextServers = { ...(servers as Record<string, unknown>) };
  delete nextServers.motionworks;
  const next = { ...existing, mcpServers: nextServers };
  if (Object.keys(nextServers).length === 0 && Object.keys(existing).length === 1) await unlink(path);
  else await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { kind: 'stale-mcp-entry-removed', path };
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
    const reason = `no package.json in ${cwd} — run init from your app's root to install motionworks`;
    log(step(symbols.skipped, `Skipped motionworks — ${dim(reason)}`));
    return { kind: "react-skipped", reason };
  }

  const deps = {
    ...(pkg["dependencies"] as Record<string, string> | undefined),
    ...(pkg["devDependencies"] as Record<string, string> | undefined),
  };
  if ("motionworks" in deps) {
    log(step(symbols.skipped, "motionworks already installed"));
    return { kind: "react-already-installed" };
  }
  if (!("react" in deps)) {
    const reason =
      "project does not depend on react — install a MotionWorks framework package manually";
    log(step(symbols.skipped, `Skipped motionworks — ${dim(reason)}`));
    return { kind: "react-skipped", reason };
  }

  const { packageManager, argv } = detectInstallCommand(lockfiles);
  if (!yes) {
    const ok = await confirm(
      `Install motionworks with ${packageManager}?`,
      input,
      output,
    );
    if (!ok)
      return { kind: "cancelled", step: "install", reason: "user declined" };
  }

  log(step(symbols.updated, dim(`Installing motionworks with ${packageManager}…`)));
  const exitCode = await run(argv, cwd);
  if (exitCode !== 0) {
    log(
      step(
        symbols.failed,
        `motionworks install failed (${packageManager} exited ${exitCode})`,
      ),
    );
    return { kind: "react-install-failed", packageManager, exitCode };
  }
  log(step(symbols.done, `Installed motionworks ${dim(`with ${packageManager}`)}`));
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

export interface SetupResult {
  setupOutcomes: SetupOutcome[];
  initOutcomes: InitOutcome[];
}

/**
 * Full project setup: journal ignore, stale MCP cleanup, motionworks install, instruction
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
    setupOutcomes.push(await ensureGitignore({ cwd, yes, input, output, log }));
    setupOutcomes.push(await removeStaleMcpEntry(cwd));
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
    log(heading("Next steps"));
    if (mountNeeded) {
      log(
        `  ${cyan("1.")} Mount the overlay once in your app — follow "Mounting the overlay" in ${cyan(GUIDE_FILE)} ${dim("(dev-only; renders nothing in production)")}.`,
      );
      log(`  ${cyan("2.")} Start the daemon with ${cyan('npx motionworks')}.`);
    } else {
      log(`  ${cyan("1.")} Add ${cyan('<script src="http://127.0.0.1:52340/motionworks.js"></script>')} before </body>.`);
      log(`  ${cyan("2.")} Run ${cyan('npx motionworks serve .')}.`);
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
