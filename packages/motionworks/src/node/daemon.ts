import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { CommitRequest, JournalChange, JournalEntry, SelectRequest, StatusResponse } from '../shared/index.js';

import type { AgentSetting } from './config.js';
import { applyCors } from './cors.js';
import { ackEntries, appendEntry, pruneAppliedEntries, readJournal, writeSelected } from './journal.js';

const MAX_BODY = 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface DaemonOptions {
  projectRoot: string;
  port: number;
  staticDir?: string;
  agent?: { run(entry: JournalEntry): Promise<{ ok: boolean }> };
  agentSetting?: AgentSetting;
  overlayBundlePath?: string;
}
export interface RunningDaemon { server: Server; port: number; stop(): Promise<void> }

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY) {
      const error = new Error('Request body too large');
      (error as NodeJS.ErrnoException).code = 'ETOOBIG';
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function isChange(value: unknown): value is JournalChange {
  return object(value) && typeof value.param === 'string' && typeof value.type === 'string' && 'from' in value && 'to' in value;
}
function isCommit(value: unknown): value is CommitRequest {
  return object(value) && typeof value.page === 'string' && typeof value.effectId === 'string' &&
    typeof value.effectName === 'string' && typeof value.elementSelector === 'string' &&
    Array.isArray(value.changes) && value.changes.every(isChange);
}
function isSelect(value: unknown): value is SelectRequest {
  return object(value) && typeof value.effectId === 'string' && typeof value.effectName === 'string' && typeof value.elementSelector === 'string';
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  await pruneAppliedEntries(options.projectRoot, Date.now() - RETENTION_MS);
  const server = createServer(async (req, res) => {
    if (!applyCors(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        const entries = await readJournal(options.projectRoot);
        const address = server.address();
        const status: StatusResponse = {
          ok: true,
          port: typeof address === 'object' && address !== null ? address.port : options.port,
          projectRoot: options.projectRoot,
          pending: entries.filter((entry) => entry.status !== 'applied').length,
          agent: { configured: options.agentSetting ?? 'auto', enabled: false, running: false },
        };
        sendJson(res, 200, status);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/pending') {
        const entries = await readJournal(options.projectRoot);
        const origin = req.headers.origin;
        sendJson(res, 200, entries.filter((entry) => entry.status !== 'applied' && (url.searchParams.get('all') === '1' || origin === undefined || entry.origin === origin)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/motionworks.js') {
        res.statusCode = 404;
        res.end('Overlay bundle is unavailable until MotionWorks Slice 4 is built.');
        return;
      }
      if (req.method === 'POST' && url.pathname === '/commit') {
        const value = await body(req);
        if (!isCommit(value)) return sendJson(res, 400, { error: 'Invalid commit request' });
        const entry: JournalEntry = { ...value, id: randomUUID(), createdAt: Date.now(), origin: req.headers.origin ?? '', status: 'pending' };
        await appendEntry(options.projectRoot, entry);
        sendJson(res, 201, entry);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/select') {
        const value = await body(req);
        if (!isSelect(value)) return sendJson(res, 400, { error: 'Invalid select request' });
        await writeSelected(options.projectRoot, value);
        sendJson(res, 200, value);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/ack') {
        const value = await body(req);
        if (!object(value)) return sendJson(res, 400, { error: 'Invalid ack request' });
        const ids = value.ids === 'all' ? 'all' : Array.isArray(value.ids) && value.ids.every((id) => typeof id === 'string') ? value.ids : typeof value.id === 'string' ? [value.id] : null;
        if (ids === null) return sendJson(res, 400, { error: 'Invalid ack request' });
        sendJson(res, 200, { acknowledged: (await ackEntries(options.projectRoot, ids)).map((entry) => entry.id) });
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ETOOBIG') return sendJson(res, 413, { error: 'Request body too large' });
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'Invalid JSON' });
      sendJson(res, 500, { error: String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  return { server, port, stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
