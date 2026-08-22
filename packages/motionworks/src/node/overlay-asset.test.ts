import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveOverlayBundle } from './overlay-asset.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'motionworks-asset-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('resolveOverlayBundle', () => {
  it('prefers the project-local package export', async () => {
    const pkg = join(root, 'node_modules', 'motionworks');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'motionworks', exports: { './motionworks.global.js': './motionworks.global.js' } }));
    await writeFile(join(pkg, 'motionworks.global.js'), 'window.local = true;');
    const resolved = await resolveOverlayBundle(root);
    expect(resolved).not.toBeNull();
    expect(await readFile(resolved!, 'utf8')).toBe('window.local = true;');
  });
});
