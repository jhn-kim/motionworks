import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the installed @motionworks/mcp package version. Works both when
 * running from `src/` (dev/tests) and from `dist/` (bin), since package.json
 * sits one directory above either.
 */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error(`[@motionworks/mcp] package.json at ${pkgPath} has no "version" field`);
  }
  return parsed.version;
}

export const PACKAGE_VERSION: string = readPackageVersion();
