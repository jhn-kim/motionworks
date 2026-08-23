import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  DEFAULT_PORT,
  derivePort,
  readConfigPort,
  writeConfigPort,
} from "./config.js";

import {
  compareVersions,
  GUIDE_FILE,
  guideFilePath,
  INSTRUCTION_FILES,
  readGuideFile,
  readInstructionFile,
  renderGuideDoc,
  renderStanza,
  scanClaudeMd,
  writeGuideFile,
  writeInstructionFile,
  type InstructionFile,
} from "./claude-md.js";
import {
  brand,
  dim,
  gray,
  green,
  mutedRed,
  step,
  symbols,
  yellow,
} from "./ui.js";

/**
 * Cap on how many diff lines `init` prints when replacing an older stanza.
 * A change larger than this means the file still holds the pre-split guide
 * inline (a one-time migration to the reference stanza), so we summarize
 * instead of dumping ~100 removed lines into the terminal.
 */
const DIFF_PREVIEW_LINE_CAP = 16;

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
  /** Explicit daemon port override; otherwise derived per project on a fresh
   * install and preserved from an existing config afterward. */
  port?: number;
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
    const prompt = `${brand("◆")} ${question} (${green("y")}${gray("/")}${mutedRed("n")}) `;
    const answer = (await rl.question(prompt)).trim().toLowerCase();
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

/** Tint a diff produced by diffStanzas: added lines green, removed lines amber. */
function colorizeDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+ ")) return green(line);
      if (line.startsWith("- ")) return yellow(line);
      return dim(line);
    })
    .join("\n");
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
 * exists (CLAUDE.md, AGENTS.md) is updated; if neither exists, both are
 * created so Claude (CLAUDE.md) and Codex (AGENTS.md) are covered without
 * detecting which agent the user runs.
 */
export async function runInit(options: InitOptions): Promise<InitOutcome[]> {
  const {
    cwd,
    packageVersion,
    yes = false,
    claude = false,
    agents = false,
    port: portOverride,
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
    // A project that already has an instruction file only gets that one
    // updated — we never add a second file over a stated preference. A fresh
    // project with neither gets both, so a Codex user (reads AGENTS.md) and a
    // Claude user (reads CLAUDE.md) are each covered without guessing which.
    targets = existing.length > 0 ? existing : ["CLAUDE.md", "AGENTS.md"];
  }

  const outcomes: InitOutcome[] = [];
  for (const file of targets) {
    outcomes.push(
      await initFile({ cwd, file, packageVersion, yes, input, output, log }),
    );
  }

  // Whenever we actually wrote or advanced a reference stanza, (re)generate the
  // companion guide file it points at. We never touch it when every target was
  // skipped (already current, or an existing stanza newer than this package) so
  // we can't downgrade a newer guide or re-litter a declined install.
  const advanced = outcomes.some(
    (o) =>
      o.kind === "created" || o.kind === "appended" || o.kind === "replaced",
  );
  if (advanced) {
    const current = await readGuideFile(cwd);
    const existingPort = await readConfigPort(cwd);
    // Fresh installs (no guide yet) get a stable per-project port so several
    // projects can run at once without colliding on 52340; an existing setup
    // keeps its pinned or default port so an already-copied mount snippet
    // never breaks.
    const port =
      portOverride ??
      existingPort ??
      (current === null ? derivePort(cwd) : DEFAULT_PORT);
    if (
      existingPort === undefined &&
      (portOverride !== undefined || port !== DEFAULT_PORT)
    ) {
      await writeConfigPort(cwd, port);
      log(
        step(
          symbols.done,
          `Pinned daemon port ${String(port)} → ${dim(join(cwd, "motionworks.config.json"))}`,
        ),
      );
    }
    const desired = renderGuideDoc(packageVersion, port);
    if (current !== desired) {
      await writeGuideFile(cwd, desired);
      log(
        step(
          symbols.done,
          `${current === null ? "Wrote" : "Updated"} the MotionWorks guide → ${dim(guideFilePath(cwd))}`,
        ),
      );
    }
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
        `${file} does not exist in ${cwd}. Create it with the MotionWorks instructions stanza?`,
        input,
        output,
      );
      if (!ok) {
        return { kind: "cancelled", file, path, reason: "user declined" };
      }
    }
    await writeInstructionFile(cwd, file, `${newStanza}\n`);
    log(step(symbols.done, `Wrote instructions stanza to ${dim(path)}`));
    return { kind: "created", file, path };
  }

  const scan = scanClaudeMd(existing);

  if (!scan.present) {
    if (!yes) {
      const ok = await confirm(
        `Append MotionWorks instructions stanza to ${path}?`,
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
    log(step(symbols.done, `Appended instructions stanza to ${dim(path)}`));
    return { kind: "appended", file, path };
  }

  const existingVersion = scan.version ?? "0.0.0";
  const cmp = compareVersions(existingVersion, packageVersion);

  if (cmp === 0) {
    log(
      step(
        symbols.skipped,
        `${dim(path)} stanza already at v${packageVersion}`,
      ),
    );
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
      step(
        symbols.skipped,
        `${dim(path)} stanza (v${existingVersion}) is newer than motionworks@${packageVersion} — not overwriting`,
      ),
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
  const rawDiff = diffStanzas(oldStanza, newStanza);
  const diffLineCount = rawDiff.split("\n").length;
  log(
    step(
      symbols.updated,
      `${dim(path)} MotionWorks stanza ${dim(`v${existingVersion} → v${packageVersion}`)}`,
    ),
  );
  // Show the line diff only when it is small. A large diff means the file
  // still holds the pre-split guide inline; dumping ~100 removed lines into the
  // terminal is noise, so summarize instead — the full guide lives in the
  // standalone guide file now.
  if (diffLineCount <= DIFF_PREVIEW_LINE_CAP) {
    log(colorizeDiff(rawDiff));
  } else {
    log(
      dim(
        `  ${diffLineCount} lines change — the full guide now lives in ${GUIDE_FILE}; only a short reference stays in ${file}.`,
      ),
    );
  }

  if (!yes) {
    const ok = await confirm("Replace the existing stanza?", input, output);
    if (!ok) {
      return { kind: "cancelled", file, path, reason: "user declined" };
    }
  }

  const before = existing.slice(0, scan.startIndex!);
  const after = existing.slice(scan.endIndex!);
  const nextContents = `${before}${newStanza}${after}`;
  await writeInstructionFile(cwd, file, nextContents);
  log(
    step(
      symbols.done,
      `Replaced stanza in ${dim(file)} ${dim(`(v${existingVersion} → v${packageVersion})`)}`,
    ),
  );
  return {
    kind: "replaced",
    file,
    path,
    from: existingVersion,
    to: packageVersion,
  };
}
