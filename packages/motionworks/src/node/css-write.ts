import { randomUUID } from "node:crypto";
import {
  chmod,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { cssValuesEqual } from "../shared/css-values.js";
import type { JournalEntry, ParameterType } from "../shared/index.js";
import { withJournalLock } from "./journal.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".motionworks",
]);
const CSS_FILE = /(?:\.module)?\.(?:css|scss|less)$/i;

async function listCssFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(resolve(dir, entry.name));
      } else if (entry.isFile() && CSS_FILE.test(entry.name))
        files.push(resolve(dir, entry.name));
    }
  };
  await walk(resolve(root));
  return files.sort();
}

export interface DeclarationMatch {
  start: number;
  end: number;
  value: string;
  selectorText: string;
}
type CssFileWriter = (
  file: string,
  source: string,
  encoding: "utf8",
) => Promise<void>;
export interface CssFileIo {
  writeFile?: CssFileWriter;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (file: string) => Promise<void>;
}

type JournalChange = JournalEntry["changes"][number];
type Candidate = { file: string; decl: DeclarationMatch };

function candidatesForValue(
  root: string,
  files: string[],
  sources: Map<string, string>,
  change: JournalChange,
  css: string,
):
  | { kind: "found"; candidates: Candidate[] }
  | { kind: "invalid"; reason: string } {
  if (change.var === undefined)
    return {
      kind: "invalid",
      reason: `Change ${change.param} is not bound to a CSS declaration.`,
    };
  let candidates = files.flatMap((file) =>
    findDeclarations(sources.get(file)!, change.var!)
      .filter((decl) =>
        cssValuesEqual(change.type as ParameterType, decl.value, css),
      )
      .map((decl) => ({ file, decl })),
  );
  if (change.rule?.sourceFile !== undefined) {
    const target = resolve(
      root,
      change.rule.sourceFile.replace(/^\/@fs\//, "/"),
    );
    if (!insideRoot(root, target))
      return {
        kind: "invalid",
        reason: `Source file for ${change.param} is outside the project root.`,
      };
    candidates = candidates.filter(
      ({ file }) =>
        resolve(file) === target ||
        endsWithPathSuffix(file, change.rule!.sourceFile!),
    );
  }
  if (change.rule?.selectorText !== undefined)
    candidates = candidates.filter(
      ({ decl }) => decl.selectorText === change.rule!.selectorText,
    );
  return { kind: "found", candidates };
}

function maskCommentsAndStrings(source: string): string {
  let out = "";
  let quote = "";
  let comment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (comment) {
      if (char === "*" && next === "/") {
        out += "  ";
        index++;
        comment = false;
      } else out += char === "\n" ? "\n" : " ";
      continue;
    }
    if (quote !== "") {
      if (char === "\\") {
        out += "  ";
        index++;
      } else if (char === quote) {
        out += " ";
        quote = "";
      } else out += char === "\n" ? "\n" : " ";
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  ";
      index++;
      comment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

function selectorAt(masked: string, position: number): string {
  const stack: number[] = [];
  for (let index = 0; index < position; index++) {
    if (masked[index] === "{") stack.push(index);
    else if (masked[index] === "}") stack.pop();
  }
  for (let index = stack.length - 1; index >= 0; index--) {
    const brace = stack[index]!;
    const previous = Math.max(
      masked.lastIndexOf("}", brace - 1),
      masked.lastIndexOf("{", brace - 1),
      masked.lastIndexOf(";", brace - 1),
    );
    const selector = masked.slice(previous + 1, brace).trim();
    if (!selector.startsWith("@")) return selector;
  }
  return "";
}

function rawDeclarations(
  source: string,
  masked: string,
  propName: string,
): DeclarationMatch[] {
  const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[;{])\\s*${escaped}\\s*:\\s*`, "gm");
  const matches: DeclarationMatch[] = [];
  while (pattern.exec(masked) !== null) {
    const start = pattern.lastIndex;
    let end = start;
    let depth = 0;
    while (end < masked.length) {
      const char = masked[end];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if ((char === ";" || char === "}") && depth === 0) break;
      end++;
    }
    let valueEnd = end;
    while (valueEnd > start && /\s/.test(source[valueEnd - 1] ?? ""))
      valueEnd--;
    matches.push({
      start,
      end: valueEnd,
      value: source.slice(start, valueEnd),
      selectorText: selectorAt(masked, start),
    });
  }
  return matches;
}

// Which shorthand carries each editable timing longhand, and which token role to
// find inside it: `animation`/`transition` put duration as the first <time>,
// delay as the second, and the easing as the timing-function token.
const SHORTHAND_TIMING: Record<
  string,
  { shorthand: string; role: "duration" | "delay" | "easing" }
> = {
  "animation-duration": { shorthand: "animation", role: "duration" },
  "animation-delay": { shorthand: "animation", role: "delay" },
  "animation-timing-function": { shorthand: "animation", role: "easing" },
  "transition-duration": { shorthand: "transition", role: "duration" },
  "transition-delay": { shorthand: "transition", role: "delay" },
  "transition-timing-function": { shorthand: "transition", role: "easing" },
};
const TIME_TOKEN = /^-?(?:\d+\.?\d*|\.\d+)m?s$/i;
const EASING_KEYWORD = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);

// Split a shorthand value into whitespace-separated top-level tokens (keeping
// their absolute source offsets), respecting parens so cubic-bezier(...)/steps()
// stay whole. A top-level comma means a multi-value shorthand (several
// animations/properties) whose sub-values can't be disambiguated safely, so that
// is reported as no match and left to agent handoff.
function topLevelTokens(
  value: string,
  base: number,
): { text: string; start: number; end: number }[] | null {
  const tokens: { text: string; start: number; end: number }[] = [];
  let depth = 0;
  let tokenStart = -1;
  for (let i = 0; i <= value.length; i++) {
    const ch = i < value.length ? value[i] : undefined;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return null;
    const isBoundary = ch === undefined || (depth === 0 && /\s/.test(ch));
    if (isBoundary) {
      if (tokenStart !== -1) {
        tokens.push({
          text: value.slice(tokenStart, i),
          start: base + tokenStart,
          end: base + i,
        });
        tokenStart = -1;
      }
    } else if (tokenStart === -1) tokenStart = i;
  }
  return tokens;
}

function shorthandTokenMatch(
  decl: DeclarationMatch,
  role: "duration" | "delay" | "easing",
): DeclarationMatch | null {
  const tokens = topLevelTokens(decl.value, decl.start);
  if (tokens === null) return null;
  let target: { text: string; start: number; end: number } | undefined;
  if (role === "easing") {
    target = tokens.find(
      (t) =>
        EASING_KEYWORD.has(t.text.toLowerCase()) ||
        /^(?:cubic-bezier|steps|linear)\(/i.test(t.text),
    );
  } else {
    const times = tokens.filter((t) => TIME_TOKEN.test(t.text));
    target = role === "duration" ? times[0] : times[1];
  }
  if (target === undefined) return null;
  return {
    start: target.start,
    end: target.end,
    value: target.text,
    selectorText: decl.selectorText,
  };
}

export function findDeclarations(
  source: string,
  varName: string,
): DeclarationMatch[] {
  if (varName === "animation") return [];
  const masked = maskCommentsAndStrings(source);
  const matches = rawDeclarations(source, masked, varName);
  // A timing longhand may live inside the `animation`/`transition` shorthand
  // (the common way developers write it). Also target the matching sub-token so
  // MotionWorks can auto-apply without a longhand refactor.
  const shorthand = SHORTHAND_TIMING[varName];
  if (shorthand !== undefined)
    for (const decl of rawDeclarations(source, masked, shorthand.shorthand)) {
      const token = shorthandTokenMatch(decl, shorthand.role);
      if (token !== null) matches.push(token);
    }
  return matches;
}

/**
 * Path-segment-aware suffix match. `motion.css` matches `.../motion.css` but
 * not `.../evil-motion.css`, so a `sourceFile` hint can't latch onto an
 * unrelated file that merely shares a trailing substring (P2-12d).
 */
function endsWithPathSuffix(file: string, suffix: string): boolean {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedSuffix = suffix
    .replace(/\\/g, "/")
    .replace(/^(?:\.?\/)+/, "");
  return (
    normalizedFile === normalizedSuffix ||
    normalizedFile.endsWith(`/${normalizedSuffix}`)
  );
}

function insideRoot(root: string, file: string): boolean {
  const path = relative(resolve(root), resolve(file));
  return (
    path !== ".." &&
    !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(path)
  );
}

export async function applyCssChanges(
  projectRoot: string,
  entry: JournalEntry,
  io: CssFileIo = {},
): Promise<
  { kind: "applied"; files: string[] } | { kind: "skipped"; reason: string }
> {
  // Serialize CSS writes through the project lock so `runRevert` and the
  // daemon's writer can't stage/rename the same files concurrently (P2-12i).
  return withJournalLock(resolve(projectRoot), () =>
    applyCssChangesLocked(projectRoot, entry, io),
  );
}

async function applyCssChangesLocked(
  projectRoot: string,
  entry: JournalEntry,
  io: CssFileIo,
): Promise<
  { kind: "applied"; files: string[] } | { kind: "skipped"; reason: string }
> {
  if (entry.changes.length === 0)
    return { kind: "skipped", reason: "No CSS value changes to apply." };
  const root = resolve(projectRoot);
  const files = await listCssFiles(root);
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, "utf8"));
  const replacements = new Map<
    string,
    Array<{ start: number; end: number; value: string }>
  >();

  for (const change of entry.changes) {
    if (
      change.var === undefined ||
      change.fromCss === undefined ||
      change.toCss === undefined
    )
      return {
        kind: "skipped",
        reason: `Change ${change.param} is not bound to a CSS declaration.`,
      };
    if (change.var === "animation")
      return {
        kind: "skipped",
        reason: "The animation shorthand is not directly writable.",
      };
    const found = candidatesForValue(
      root,
      files,
      sources,
      change,
      change.fromCss,
    );
    if (found.kind === "invalid")
      return { kind: "skipped", reason: found.reason };
    const candidates = found.candidates;
    if (candidates.length !== 1)
      return {
        kind: "skipped",
        reason: `Expected one declaration for ${change.var} with value ${change.fromCss}; found ${String(candidates.length)}.`,
      };
    const candidate = candidates[0]!;
    const list = replacements.get(candidate.file) ?? [];
    if (
      list.some(
        (edit) =>
          edit.start < candidate.decl.end && candidate.decl.start < edit.end,
      )
    ) {
      return {
        kind: "skipped",
        reason: `Multiple changes target the same CSS declaration for ${change.var}.`,
      };
    }
    list.push({
      start: candidate.decl.start,
      end: candidate.decl.end,
      value: change.toCss,
    });
    replacements.set(candidate.file, list);
  }

  const nextSources = new Map<string, string>();
  for (const [file, edits] of replacements) {
    let source = sources.get(file)!;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      source =
        source.slice(0, edit.start) + edit.value + source.slice(edit.end);
    nextSources.set(file, source);
  }

  const write: CssFileWriter = io.writeFile ?? writeFile;
  const move = io.rename ?? rename;
  const remove = io.unlink ?? unlink;
  const transaction = randomUUID();
  const staged = await Promise.all(
    [...nextSources].map(async ([file, source]) => ({
      file,
      source,
      temp: `${file}.motionworks-${transaction}.tmp`,
      backup: `${file}.motionworks-${transaction}.bak`,
      // Capture the original file mode so the replacement keeps it rather than
      // silently reverting to the umask default (P2-12e). The temp is a fresh
      // inode, so inode identity necessarily changes with an atomic replace.
      mode: await stat(file)
        .then((stats) => stats.mode)
        .catch(() => undefined as number | undefined),
    })),
  );
  const removeIfPresent = async (file: string): Promise<void> => {
    try {
      await remove(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };

  try {
    for (const item of staged) {
      await write(item.temp, item.source, "utf8");
      if (item.mode !== undefined)
        await chmod(item.temp, item.mode).catch(() => undefined);
    }
  } catch (error) {
    await Promise.all(
      staged.map(async (item) => {
        try {
          await removeIfPresent(item.temp);
        } catch {
          // The write error is primary; a uniquely named temp can be removed later.
        }
      }),
    );
    return {
      kind: "skipped",
      reason: `Failed to stage CSS changes: ${String(error)}.`,
    };
  }

  const committed: typeof staged = [];
  try {
    for (const item of staged) {
      await move(item.file, item.backup);
      try {
        await move(item.temp, item.file);
      } catch (error) {
        await move(item.backup, item.file);
        throw error;
      }
      committed.push(item);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const item of committed.reverse()) {
      try {
        await move(item.file, item.temp);
        await move(item.backup, item.file);
        await removeIfPresent(item.temp);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    await Promise.all(
      staged.map(async (item) => {
        try {
          await removeIfPresent(item.temp);
        } catch (cleanupError) {
          rollbackErrors.push(cleanupError);
        }
      }),
    );
    const rollback =
      rollbackErrors.length === 0
        ? ""
        : ` Rollback also failed: ${rollbackErrors.map(String).join("; ")}`;
    return {
      kind: "skipped",
      reason: `Failed to replace CSS files: ${String(error)}.${rollback}`,
    };
  }

  await Promise.all(
    committed.map(async (item) => {
      try {
        await removeIfPresent(item.backup);
      } catch {
        // The replacement is already complete; a backup is safe to leave behind.
      }
    }),
  );
  return {
    kind: "applied",
    files: [...replacements.keys()].map((file) => relative(root, file)),
  };
}

/**
 * Confirms an agent actually persisted every requested CSS value. Agent CLIs
 * can exit successfully after declining a stale or ambiguous edit, so their
 * process result alone is not a writeback acknowledgement.
 */
export async function verifyCssChanges(
  projectRoot: string,
  entry: JournalEntry,
): Promise<
  { kind: "verified"; files: string[] } | { kind: "failed"; reason: string }
> {
  // Correction-only entries have no CSS postcondition available here.
  if (entry.changes.length === 0) return { kind: "verified", files: [] };
  const root = resolve(projectRoot);
  const files = await listCssFiles(root);
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, "utf8"));
  const verifiedFiles = new Set<string>();

  for (const change of entry.changes) {
    if (change.var === undefined || change.toCss === undefined)
      return {
        kind: "failed",
        reason: `Agent result could not be verified because ${change.param} has no CSS target.`,
      };
    const found = candidatesForValue(
      root,
      files,
      sources,
      change,
      change.toCss,
    );
    if (found.kind === "invalid")
      return { kind: "failed", reason: found.reason };
    if (found.candidates.length !== 1)
      return {
        kind: "failed",
        reason: `Agent reported success, but expected one declaration for ${change.var} with value ${change.toCss}; found ${String(found.candidates.length)}.`,
      };
    verifiedFiles.add(found.candidates[0]!.file);
  }

  return {
    kind: "verified",
    files: [...verifiedFiles].map((file) => relative(root, file)),
  };
}
