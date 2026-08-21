import { WebSocket, WebSocketServer } from 'ws';

import { MotionWorksStateManager } from './state.js';
import type { DownstreamMessage, UpstreamMessage } from './types.js';

export { MotionWorksStateManager } from './state.js';
export type { MotionWorksStateSnapshot } from './state.js';

const DEFAULT_PORT = 52340;

export class MotionWorksServer {
  private wss: WebSocketServer | null = null;
  private boundPort: number | null = null;
  // Effects grouped by the connection that registered them, so a disconnect
  // can drop only that peer's registrations rather than the whole registry.
  // Prevents zombie effects surviving a page reload / component unmount.
  private readonly effectsByConnection = new WeakMap<WebSocket, Set<string>>();
  // Selectors provided in `select` messages, keyed by effectId. Written into
  // the file-based fallback via `getSelector` so `selectedElement` is
  // populated instead of always being null.
  private readonly selectors = new Map<string, string>();

  constructor(
    private readonly state: MotionWorksStateManager,
    private readonly port: number = DEFAULT_PORT,
  ) {}

  /** CSS-style selector for an effect if the overlay sent one with `select`. */
  getSelector(effectId: string): string | undefined {
    return this.selectors.get(effectId);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.port });
      this.wss = wss;
      wss.on('error', reject);
      wss.on('listening', () => {
        const addr = wss.address();
        if (addr !== null && typeof addr === 'object') this.boundPort = addr.port;
        resolve();
      });
      wss.on('connection', (ws) => {
        this.handleConnection(ws);
      });
    });
  }

  /** Actual port the WS server is listening on (only valid after start()). */
  get address(): { port: number } | null {
    return this.boundPort === null ? null : { port: this.boundPort };
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss === null) {
        resolve();
        return;
      }
      this.wss.close((err) => (err !== undefined ? reject(err) : resolve()));
      this.wss = null;
    });
  }

  /** Send a source-synced notification to all connected overlay clients. */
  notifySourceSynced(effectId: string): void {
    this.broadcast({ type: 'source-synced', payload: { effectId } });
  }

  private broadcast(msg: DownstreamMessage): void {
    if (this.wss === null) return;
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private handleConnection(ws: WebSocket): void {
    this.effectsByConnection.set(ws, new Set());
    ws.on('message', (raw) => {
      let msg: UpstreamMessage;
      try {
        msg = JSON.parse(raw.toString()) as UpstreamMessage;
      } catch {
        return;
      }
      this.handleMessage(ws, msg);
    });
    ws.on('close', () => this.handleDisconnect(ws));
  }

  private handleDisconnect(ws: WebSocket): void {
    const ownedIds = this.effectsByConnection.get(ws);
    if (ownedIds === undefined) return;
    for (const id of ownedIds) {
      this.state.unregisterEffect(id);
      this.selectors.delete(id);
    }
    this.effectsByConnection.delete(ws);
  }

  private handleMessage(ws: WebSocket, msg: UpstreamMessage): void {
    switch (msg.type) {
      case 'register': {
        this.state.registerEffectFromWire(msg.payload);
        const owned = this.effectsByConnection.get(ws);
        if (owned !== undefined) owned.add(msg.payload.id);
        break;
      }

      case 'unregister': {
        this.state.unregisterEffect(msg.payload.effectId);
        const owned = this.effectsByConnection.get(ws);
        if (owned !== undefined) owned.delete(msg.payload.effectId);
        this.selectors.delete(msg.payload.effectId);
        break;
      }

      case 'select':
        this.state.selectEffect(msg.payload.effectId);
        if (msg.payload.selector !== undefined) {
          this.selectors.set(msg.payload.effectId, msg.payload.selector);
        }
        break;

      case 'change':
        this.state.applyParamChange(
          msg.payload.effectId,
          msg.payload.param,
          msg.payload.value,
        );
        break;

      case 'commit': {
        const changeset = this.state.commitEffect(
          msg.payload.effectId,
          msg.payload.elementSelector,
          msg.payload.diffs,
        );
        if (changeset === null) break;
        // Remember the selector from the commit too — commit fires without a
        // preceding `select` when the designer clicks Apply from the panel
        // while nothing is technically selected.
        if (msg.payload.elementSelector.length > 0) {
          this.selectors.set(msg.payload.effectId, msg.payload.elementSelector);
        }
        const ack: DownstreamMessage = {
          type: 'ack',
          payload: { changeId: changeset.id },
        };
        ws.send(JSON.stringify(ack));
        break;
      }

      case 'type-correction':
        this.state.addTypeCorrection(msg.payload);
        break;
    }
  }
}
