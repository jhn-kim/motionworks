import {
  compareVersions,
  INSTRUCTION_FILES,
  readInstructionFile,
  scanClaudeMd,
  type InstructionFile,
} from './claude-md.js';

export interface DriftCheck {
  cwd: string;
  packageVersion: string;
}

export interface FileDriftStatus {
  file: InstructionFile;
  /** null = file exists but has no stanza. */
  stanzaVersion: string | null;
}

/**
 * Returns the exact drift warning to log at startup, or null when every
 * instruction file that exists carries a current (or newer) stanza. A file
 * that doesn't exist is not demanded — a Claude-only project without
 * AGENTS.md is fine — but if NO instruction file exists at all, that warns.
 * Never writes to disk.
 */
export async function checkDrift({
  cwd,
  packageVersion,
}: DriftCheck): Promise<string | null> {
  const stale: FileDriftStatus[] = [];
  let anyFileExists = false;

  for (const file of INSTRUCTION_FILES) {
    const contents = await readInstructionFile(cwd, file);
    if (contents === null) continue;
    anyFileExists = true;
    const scan = scanClaudeMd(contents);
    if (!scan.present) {
      stale.push({ file, stanzaVersion: null });
      continue;
    }
    const stanzaVersion = scan.version ?? '0.0.0';
    if (compareVersions(stanzaVersion, packageVersion) < 0) {
      stale.push({ file, stanzaVersion });
    }
  }

  if (!anyFileExists) {
    return formatDriftWarning(packageVersion, null);
  }
  if (stale.length === 0) return null;
  return formatDriftWarning(packageVersion, stale);
}

/**
 * `stale` is the list of existing files with a missing/outdated stanza, or
 * null when no instruction file exists at all.
 */
export function formatDriftWarning(
  packageVersion: string,
  stale: FileDriftStatus[] | null,
): string {
  const statusLine =
    stale === null
      ? 'no CLAUDE.md or AGENTS.md found'
      : stale
          .map((s) =>
            s.stanzaVersion === null
              ? `${s.file}: no stanza`
              : `${s.file}: v${s.stanzaVersion}`,
          )
          .join('  |  ');
  return [
    'MotionWorks: agent instructions may be outdated.',
    `  Installed: @motionworks/mcp@${packageVersion}  |  ${statusLine}`,
    '  Run "npx motionworks init" to refresh.',
  ].join('\n');
}
