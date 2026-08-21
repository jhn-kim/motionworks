import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  compareVersions,
  INSTRUCTION_FILES,
  readInstructionFile,
  renderStanza,
  scanClaudeMd,
  writeInstructionFile,
  type InstructionFile,
} from "./claude-md.js";

export type InitOutcome =
  | { kind: "created"; file: InstructionFile; path: string }
  | { kind: "appended"; file: InstructionFile; path: string }
  | {
      kind: "skipped-same-version";
      file: InstructionFile;
      path: string;
      version: string;
    }
  | {
      kind: "replaced";
      file: InstructionFile;
      path: string;
      from: string;
      to: string;
    }
  | { kind: "cancelled"; file: InstructionFile; path: string; reason: string };

export interface InitOptions {
  cwd: string;
  packageVersion: string;
  yes?: boolean;
  /** Force CLAUDE.md into the target set (created if missing). */
  claude?: boolean;
  /** Force AGENTS.md into the target set (created if missing). */
  agents?: boolean;
  input?: Readable;
  output?: Writable;
  log?: (msg: string) => void;
}

export async function confirm(
  question: string,
  input: Readable,
  output: Writable,
): Promise<boolean> {
  const rl = createInterface({ input, output, terminal: false });
  try {
    const answer = (await rl.question(`${question} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** Diff two stanzas as a simple line-by-line change list. */
export function diffStanzas(oldStanza: string, newStanza: string): string {
  const oldLines = oldStanza.split("\n");
  const newLines = newStanza.split("\n");
  const lines: string[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (o !== undefined) lines.push(`  ${o}`);
    } else {
      if (o !== undefined) lines.push(`- ${o}`);
      if (n !== undefined) lines.push(`+ ${n}`);
    }
  }
  return lines.join("\n");
}

/**
 * Behavior per AGENT_INTEGRATION.md, applied per instruction file:
 *   - no sentinel present → append with confirmation prompt (skippable with `--yes`)
 *   - present at current version → exit silently, no write
 *   - present at older version → print diff of the stanza and confirm before replacing (`--yes` skips)
 * Never touches anything outside the sentinels.
 *
 * Target selection: `--claude` / `--agents` flags pick targets explicitly
 * (creating them if missing). With no flags, every instruction file that
 * exists (CLAUDE.md, AGENTS.md) is updated; if neither exists, CLAUDE.md is
 * created.
 */
export async function runInit(options: InitOptions): Promise<InitOutcome[]> {
  const {
    cwd,
    packageVersion,
    yes = false,
    claude = false,
    agents = false,
    input = process.stdin,
    output = process.stdout,
    log = (msg: string) => process.stdout.write(`${msg}\n`),
  } = options;

  const flagged: InstructionFile[] = [
    ...(claude ? (["CLAUDE.md"] as const) : []),
    ...(agents ? (["AGENTS.md"] as const) : []),
  ];
  let targets: InstructionFile[];
  if (flagged.length > 0) {
    targets = flagged;
  } else {
    const existing: InstructionFile[] = [];
    for (const file of INSTRUCTION_FILES) {
      if ((await readInstructionFile(cwd, file)) !== null) existing.push(file);
    }
    targets = existing.length > 0 ? existing : ["CLAUDE.md"];
  }

  const outcomes: InitOutcome[] = [];
  for (const file of targets) {
    outcomes.push(
      await initFile({ cwd, file, packageVersion, yes, input, output, log }),
    );
  }
  return outcomes;
}

async function initFile({
  cwd,
  file,
  packageVersion,
  yes,
  input,
  output,
  log,
}: {
  cwd: string;
  file: InstructionFile;
  packageVersion: string;
  yes: boolean;
  input: Readable;
  output: Writable;
  log: (msg: string) => void;
}): Promise<InitOutcome> {
  const path = `${cwd}/${file}`;
  const existing = await readInstructionFile(cwd, file);
  const newStanza = renderStanza(packageVersion);

  if (existing === null) {
    if (!yes) {
      const ok = await confirm(
        `${file} does not exist in ${cwd}. Create it with the MotionWorks instructions stanza? [y/N]`,
        input,
        output,
      );
      if (!ok) {
        return { kind: "cancelled", file, path, reason: "user declined" };
      }
    }
    await writeInstructionFile(cwd, file, `${newStanza}\n`);
    log(`Wrote MotionWorks instructions stanza to ${path}`);
    return { kind: "created", file, path };
  }

  const scan = scanClaudeMd(existing);

  if (!scan.present) {
    if (!yes) {
      const ok = await confirm(
        `Append MotionWorks instructions stanza to ${path}? [y/N]`,
        input,
        output,
      );
      if (!ok) {
        return { kind: "cancelled", file, path, reason: "user declined" };
      }
    }
    const sep = existing.endsWith("\n") ? "" : "\n";
    const nextContents = `${existing}${sep}\n${newStanza}\n`;
    await writeInstructionFile(cwd, file, nextContents);
    log(`Appended MotionWorks instructions stanza to ${path}`);
    return { kind: "appended", file, path };
  }

  const existingVersion = scan.version ?? "0.0.0";
  const cmp = compareVersions(existingVersion, packageVersion);

  if (cmp === 0) {
    return {
      kind: "skipped-same-version",
      file,
      path,
      version: packageVersion,
    };
  }

  if (cmp > 0) {
    // Existing stanza is newer than the installed package — leave it alone.
    log(
      `${file} stanza (v${existingVersion}) is newer than installed @motionworks/mcp@${packageVersion}. Not overwriting.`,
    );
    return {
      kind: "skipped-same-version",
      file,
      path,
      version: existingVersion,
    };
  }

  // Older stanza → replace with confirmation.
  const oldStanza = existing.slice(scan.startIndex!, scan.endIndex!);
  const diff = diffStanzas(oldStanza, newStanza);
  log(
    `MotionWorks stanza in ${path} is v${existingVersion}; installed version is ${packageVersion}. Proposed change:`,
  );
  log(diff);

  if (!yes) {
    const ok = await confirm(
      "Replace the existing stanza? [y/N]",
      input,
      output,
    );
    if (!ok) {
      return { kind: "cancelled", file, path, reason: "user declined" };
    }
  }

  const before = existing.slice(0, scan.startIndex!);
  const after = existing.slice(scan.endIndex!);
  const nextContents = `${before}${newStanza}${after}`;
  await writeInstructionFile(cwd, file, nextContents);
  log(
    `Replaced MotionWorks stanza in ${file} (v${existingVersion} → v${packageVersion})`,
  );
  return {
    kind: "replaced",
    file,
    path,
    from: existingVersion,
    to: packageVersion,
  };
}
