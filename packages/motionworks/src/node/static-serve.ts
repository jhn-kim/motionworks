import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function createStaticHandler(
  dir: string,
  token?: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const root = resolve(dir);
  // The served root may itself live behind a symlink (e.g. macOS /var →
  // /private/var), so canonicalize it once and compare real paths against the
  // real root — otherwise every request would look like an escape.
  let realRoot: string | null = null;
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      res.statusCode = 400;
      res.end("Bad request");
      return true;
    }
    if (pathname.split("/").includes("..")) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      // Resolve symlinks and re-check containment so a link inside the served
      // directory cannot hand out a file from outside the root (S5).
      realRoot ??= await realpath(root).catch(() => root);
      const real = await realpath(path);
      if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return true;
      }
      const extension = extname(path).toLowerCase();
      res.setHeader(
        "Content-Type",
        MIME[extension] ?? "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      let content = await readFile(real);
      if (extension === ".html") {
        const html = content.toString("utf8");
        // Hand the token to the overlay through a same-origin inline global
        // rather than the script URL, so it never lands in request logs or
        // browser history (S6). A cross-origin page cannot read this markup.
        const tokenScript =
          token === undefined
            ? ""
            : `<script>window.__motionworksToken=${JSON.stringify(token)}</script>`;
        content = Buffer.from(
          html.replace(
            /<\/body>/i,
            `${tokenScript}<script src="/motionworks.js"></script></body>`,
          ),
        );
      }
      res.statusCode = 200;
      res.setHeader("Content-Length", String(content.length));
      if (req.method === "HEAD") res.end();
      else res.end(content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        res.statusCode = 404;
        res.end("Not found");
        return true;
      }
      // Never surface the underlying error (it embeds the absolute path); log
      // it for the operator instead (S5).
      res.statusCode = 500;
      res.end("Internal server error");
    }
    return true;
  };
}
