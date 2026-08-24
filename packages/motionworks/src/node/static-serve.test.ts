import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startDaemon, type RunningDaemon } from "./daemon.js";
import { createStaticHandler } from "./static-serve.js";

let dir: string;
let daemon: RunningDaemon | null = null;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "motionworks-static-"));
});
afterEach(async () => {
  await daemon?.stop();
  daemon = null;
  await rm(dir, { recursive: true, force: true });
});

describe("createStaticHandler", () => {
  it("resolves index files, injects the overlay, and rejects traversal", async () => {
    await writeFile(join(dir, "index.html"), "<html><body>Hello</body></html>");
    const handler = createStaticHandler(dir);
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain(
      '<script src="/motionworks.js"></script>',
    );
    expect((await fetch(`http://127.0.0.1:${port}/..%2fsecret`)).status).toBe(
      403,
    );
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("lets API routes win over same-named files", async () => {
    await writeFile(join(dir, "status"), "static");
    daemon = await startDaemon({ projectRoot: dir, staticDir: dir, port: 0 });
    const response = await fetch(`http://127.0.0.1:${daemon.port}/status`);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("refuses to follow a symlink that escapes the served root (S5)", async () => {
    // A secret file outside the served directory, plus an in-root symlink to it.
    const secret = join(dirname(dir), "escape-secret.txt");
    await writeFile(secret, "TOP SECRET");
    await symlink(secret, join(dir, "link.txt"));
    const handler = createStaticHandler(dir);
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/link.txt`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("SECRET");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(secret, { force: true });
  });

  it("injects a configured token via a same-origin global, not the URL (S6)", async () => {
    await writeFile(join(dir, "index.html"), "<body>Hello</body>");
    const handler = createStaticHandler(dir, 'a"b');
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    // Token rides in an inline global (safely JSON-escaped), and the script
    // URL itself carries no token query.
    expect(html).toContain(
      'window.__motionworksToken="a\\"b"</script><script src="/motionworks.js">',
    );
    expect(html).not.toContain("motionworks.js?token");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});
