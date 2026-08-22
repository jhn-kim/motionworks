import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function createStaticHandler(dir: string): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const root = resolve(dir);
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    let pathname: string;
    try { pathname = decodeURIComponent(rawPath); } catch { res.statusCode = 400; res.end('Bad request'); return true; }
    if (pathname.split('/').includes('..')) { res.statusCode = 403; res.end('Forbidden'); return true; }
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) { res.statusCode = 403; res.end('Forbidden'); return true; }
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      let content = await readFile(path);
      const extension = extname(path).toLowerCase();
      res.setHeader('Content-Type', MIME[extension] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      if (extension === '.html') {
        const html = content.toString('utf8');
        content = Buffer.from(html.replace(/<\/body>/i, '<script src="/motionworks.js"></script></body>'));
      }
      res.statusCode = 200;
      if (req.method === 'HEAD') res.end(); else res.end(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      res.statusCode = 404;
      res.end('Not found');
    }
    return true;
  };
}
