import type { DownstreamMessage, UpstreamMessage } from '@motionworks/core';

export type DownstreamHandler = (msg: DownstreamMessage) => void;

interface QueuedChange {
  effectId: string;
  param: string;
  value: unknown;
}

const RECONNECT_INITIAL_MS = 250;
const RECONNECT_MAX_MS = 5000;

// Thin wrapper around a native WebSocket that:
//   • reconnects with exponential backoff so a dead MCP process doesn't
//     kill the overlay (starting the CLI later "just works")
//   • queues non-change upstream messages while disconnected so registrations
//     that happen during the initial window still land
//   • coalesces 'change' messages to one per (effectId, param) per animation
//     frame — the local update() is called synchronously by the surfaces on
//     every pointermove, but the WS mirror only needs the most recent value
export class WsClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queued: UpstreamMessage[] = [];
  private pendingChanges = new Map<string, QueuedChange>();
  private rafHandle: number | null = null;
  private downstreamHandlers = new Set<DownstreamHandler>();

  constructor(
    private readonly url: string,
    private readonly onOpenChange?: (open: boolean) => void,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
    this.queued = [];
    this.pendingChanges.clear();
  }

  onDownstream(handler: DownstreamHandler): () => void {
    this.downstreamHandlers.add(handler);
    return () => {
      this.downstreamHandlers.delete(handler);
    };
  }

  send(msg: UpstreamMessage): void {
    if (msg.type === 'change') {
      this.queueChange(msg.payload);
      return;
    }
    this.sendImmediate(msg);
  }

  private queueChange(payload: { effectId: string; param: string; value: unknown }): void {
    const key = `${payload.effectId}::${payload.param}`;
    this.pendingChanges.set(key, payload);
    if (this.rafHandle !== null) return;
    // Fall back to a microtask-ish timeout when rAF is unavailable
    // (e.g. jsdom without a mock).
    const raf: (cb: () => void) => number =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16) as unknown as number;
    this.rafHandle = raf(() => {
      this.rafHandle = null;
      this.flushChanges();
    });
  }

  private flushChanges(): void {
    const pending = this.pendingChanges;
    this.pendingChanges = new Map();
    for (const change of pending.values()) {
      this.sendImmediate({ type: 'change', payload: change });
    }
  }

  private sendImmediate(msg: UpstreamMessage): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        this.log(`WsClient: send failed: ${String(err)}`);
      }
      return;
    }
    this.queued.push(msg);
  }

  private open(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.log(`WsClient: constructor threw: ${String(err)}`);
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => this.handleOpen();
    this.ws.onclose = () => this.handleClose();
    this.ws.onerror = () => {
      // Native WS emits opaque 'error' then 'close' — dedupe here and rely
      // on onclose to schedule the reconnect.
    };
    this.ws.onmessage = (event) => this.handleMessage(event);
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.onOpenChange?.(true);
    const flush = this.queued;
    this.queued = [];
    for (const msg of flush) this.sendImmediate(msg);
  }

  private handleClose(): void {
    this.ws = null;
    this.onOpenChange?.(false);
    this.scheduleReconnect();
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    let msg: DownstreamMessage;
    try {
      msg = JSON.parse(event.data) as DownstreamMessage;
    } catch {
      return;
    }
    for (const h of this.downstreamHandlers) h(msg);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_INITIAL_MS * 2 ** this.reconnectAttempts,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
