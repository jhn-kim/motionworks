import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startDaemon, type RunningDaemon } from './daemon.js';
import { createStaticHandler } from './static-serve.js';

let dir: string;
let daemon: RunningDaemon | null = null;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'motionworks-static-')); });
afterEach(async () => { await daemon?.stop(); await rm(dir, { recursive: true, force: true }); });

describe('createStaticHandler', () => {
  it('resolves index files, injects the overlay, and rejects traversal', async () => {
    await writeFile(join(dir, 'index.html'), '<html><body>Hello</body></html>');
    const handler = createStaticHandler(dir);
    const server = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain('<script src="/motionworks.js"></script>');
    expect((await fetch(`http://127.0.0.1:${port}/..%2fsecret`)).status).toBe(403);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('lets API routes win over same-named files', async () => {
    await writeFile(join(dir, 'status'), 'static');
    daemon = await startDaemon({ projectRoot: dir, staticDir: dir, port: 0 });
    const response = await fetch(`http://127.0.0.1:${daemon.port}/status`);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json() as { ok: boolean }).ok).toBe(true);
  });
});
