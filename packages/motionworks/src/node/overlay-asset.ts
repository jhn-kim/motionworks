import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export async function resolveOverlayBundle(projectRoot: string): Promise<string | null> {
  try {
    const require = createRequire(join(projectRoot, 'package.json'));
    const resolved = require.resolve('motionworks/motionworks.global.js');
    await access(resolved);
    return resolved;
  } catch {
    const candidates = [
      fileURLToPath(new URL('./motionworks.global.js', import.meta.url)),
      fileURLToPath(new URL('../../dist/motionworks.global.js', import.meta.url)),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the source-tree path after the built-package sibling.
      }
    }
    return null;
  }
}
