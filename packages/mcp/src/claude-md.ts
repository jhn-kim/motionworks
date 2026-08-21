import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SCHEMA_EMISSION_GUIDE } from './instructions.js';

export const START_SENTINEL = '<!-- motionworks-instructions-start -->';
export const END_SENTINEL = '<!-- motionworks-instructions-end -->';
const VERSION_LINE_PREFIX = '<!-- motionworks-version: ';
const VERSION_LINE_SUFFIX = ' -->';

export interface StanzaScan {
  present: boolean;
  version: string | null;
  /** Byte-index at which the start sentinel begins, or null if not present. */
  startIndex: number | null;
  /** Byte-index just after the end sentinel, or null if not present. */
  endIndex: number | null;
}

/** Scans a CLAUDE.md string for the MotionWorks stanza. */
export function scanClaudeMd(contents: string): StanzaScan {
  const startIdx = contents.indexOf(START_SENTINEL);
  if (startIdx === -1) {
    return { present: false, version: null, startIndex: null, endIndex: null };
  }
  const endIdxRaw = contents.indexOf(END_SENTINEL, startIdx + START_SENTINEL.length);
  if (endIdxRaw === -1) {
    return { present: false, version: null, startIndex: null, endIndex: null };
  }
  const inner = contents.slice(startIdx + START_SENTINEL.length, endIdxRaw);
  let version: string | null = null;
  for (const rawLine of inner.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith(VERSION_LINE_PREFIX) && line.endsWith(VERSION_LINE_SUFFIX)) {
      version = line.slice(VERSION_LINE_PREFIX.length, line.length - VERSION_LINE_SUFFIX.length).trim();
      break;
    }
  }
  return {
    present: true,
    version,
    startIndex: startIdx,
    endIndex: endIdxRaw + END_SENTINEL.length,
  };
}

/** Produces the full stanza block (including sentinels) for the given version. */
export function renderStanza(version: string): string {
  return [
    START_SENTINEL,
    `${VERSION_LINE_PREFIX}${version}${VERSION_LINE_SUFFIX}`,
    '',
    SCHEMA_EMISSION_GUIDE,
    END_SENTINEL,
  ].join('\n');
}

// The agent instruction files the stanza can live in. CLAUDE.md is read by
// Claude Code; AGENTS.md by Codex CLI and other AGENTS.md-convention agents.
export const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
export type InstructionFile = (typeof INSTRUCTION_FILES)[number];

export function instructionFilePath(cwd: string, file: InstructionFile): string {
  return join(cwd, file);
}

/** Reads an instruction file if present; returns null when it does not exist. */
export async function readInstructionFile(
  cwd: string,
  file: InstructionFile,
): Promise<string | null> {
  try {
    return await readFile(instructionFilePath(cwd, file), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeInstructionFile(
  cwd: string,
  file: InstructionFile,
  contents: string,
): Promise<void> {
  await writeFile(instructionFilePath(cwd, file), contents, 'utf8');
}

export function claudeMdPath(cwd: string): string {
  return instructionFilePath(cwd, 'CLAUDE.md');
}

/** Reads CLAUDE.md if present; returns null when the file does not exist. */
export async function readClaudeMd(cwd: string): Promise<string | null> {
  return readInstructionFile(cwd, 'CLAUDE.md');
}

export async function writeClaudeMd(cwd: string, contents: string): Promise<void> {
  await writeInstructionFile(cwd, 'CLAUDE.md', contents);
}

/**
 * Compares two semver-ish version strings (e.g. "1.2.0", "0.1.0-beta.1").
 * Returns -1 if a<b, 0 if a==b, 1 if a>b. Non-numeric segments compare lexically.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): (number | string)[] => {
    const [core, pre = ''] = v.split('-', 2) as [string, string?];
    const nums = core.split('.').map((n) => {
      const asNum = Number(n);
      return Number.isFinite(asNum) ? asNum : n;
    });
    const preParts = pre === '' ? [] : pre.split('.').map((n) => {
      const asNum = Number(n);
      return Number.isFinite(asNum) ? asNum : n;
    });
    return [...nums, ...(pre === '' ? [] : ['-', ...preParts])];
  };
  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const av = A[i];
    const bv = B[i];
    if (av === undefined && bv === undefined) return 0;
    // Absent > present when the shorter one has no prerelease boundary.
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av < bv ? -1 : 1;
    return String(av) < String(bv) ? -1 : 1;
  }
  return 0;
}
