import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpstreamMessage } from '@motionworks/core';

import { WsClient } from './ws-client.js';

interface MockSocket {
  url: string;
  readyState: number;
  sent: string[];
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send: (data: string) => void;
  close: () => void;
  triggerOpen: () => void;
  triggerClose: () => void;
  triggerMessage: (data: unknown) => void;
}

const sockets: MockSocket[] = [];

class MockWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    const self = this;
    const mock: MockSocket = {
      url,
      get readyState() {
        return self.readyState;
      },
      set readyState(v: number) {
        self.readyState = v;
      },
      sent: self.sent,
      get onopen() {
        return self.onopen;
      },
      set onopen(v: (() => void) | null) {
        self.onopen = v;
      },
      get onclose() {
        return self.onclose;
      },
      set onclose(v: (() => void) | null) {
        self.onclose = v;
      },
      get onerror() {
        return self.onerror;
      },
      set onerror(v: (() => void) | null) {
        self.onerror = v;
      },
      get onmessage() {
        return self.onmessage;
      },
      set onmessage(v: ((event: MessageEvent) => void) | null) {
        self.onmessage = v;
      },
      send: (data: string) => self.send(data),
      close: () => self.close(),
      triggerOpen: () => self.triggerOpen(),
      triggerClose: () => self.triggerClose(),
      triggerMessage: (data: unknown) => self.triggerMessage(data),
    };
    sockets.push(mock);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerMessage(data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: payload } as MessageEvent);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

function currentSocket(): MockSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('no mock socket');
  return socket;
}

function parseSent(client: MockSocket): UpstreamMessage[] {
  return client.sent.map((s) => JSON.parse(s) as UpstreamMessage);
}

describe('WsClient', () => {
  it('sends register with the wire-form effect payload', () => {
    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    currentSocket().triggerOpen();
    ws.send({
      type: 'register',
      payload: {
        id: 'A::B',
        name: 'B',
        params: { radius: { type: 'spatial-radius', value: 100 } },
        readOnly: false,
      },
    });
    const [msg] = parseSent(currentSocket());
    expect(msg?.type).toBe('register');
    if (msg?.type === 'register') {
      expect(msg.payload.id).toBe('A::B');
      expect(msg.payload.readOnly).toBe(false);
      // No update fn on the wire.
      expect((msg.payload as { update?: unknown }).update).toBeUndefined();
    }
  });

  it('queues messages sent while disconnected and flushes on open', () => {
    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    ws.send({ type: 'select', payload: { effectId: 'A::B' } });
    expect(currentSocket().sent).toHaveLength(0);
    currentSocket().triggerOpen();
    const msgs = parseSent(currentSocket());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.type).toBe('select');
  });

  it('coalesces multiple changes for the same (effect,param) into one WS send per frame', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const scheduled: { current: (() => void) | null } = { current: null };
    raf.mockImplementation((cb) => {
      scheduled.current = cb as () => void;
      return 1;
    });

    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    currentSocket().triggerOpen();

    ws.send({ type: 'change', payload: { effectId: 'A', param: 'radius', value: 120 } });
    ws.send({ type: 'change', payload: { effectId: 'A', param: 'radius', value: 145 } });
    ws.send({ type: 'change', payload: { effectId: 'A', param: 'radius', value: 165 } });
    expect(currentSocket().sent).toHaveLength(0);
    scheduled.current?.();

    const msgs = parseSent(currentSocket());
    expect(msgs).toHaveLength(1);
    if (msgs[0]?.type === 'change') expect(msgs[0].payload.value).toBe(165);
    raf.mockRestore();
  });

  it('does not coalesce changes for different params', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const scheduled: { current: (() => void) | null } = { current: null };
    raf.mockImplementation((cb) => {
      scheduled.current = cb as () => void;
      return 1;
    });

    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    currentSocket().triggerOpen();

    ws.send({ type: 'change', payload: { effectId: 'A', param: 'radius', value: 165 } });
    ws.send({ type: 'change', payload: { effectId: 'A', param: 'strength', value: 0.7 } });
    scheduled.current?.();

    const msgs = parseSent(currentSocket()).filter((m) => m.type === 'change');
    expect(msgs).toHaveLength(2);
    raf.mockRestore();
  });

  it('reconnects with backoff after close', () => {
    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    const first = currentSocket();
    first.triggerOpen();
    first.triggerClose();

    vi.advanceTimersByTime(250);
    // Reconnect attempts a fresh socket.
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('routes downstream messages to registered handlers', () => {
    const ws = new WsClient('ws://localhost:52340');
    const handler = vi.fn();
    ws.onDownstream(handler);
    ws.start();
    currentSocket().triggerOpen();
    currentSocket().triggerMessage({ type: 'source-synced', payload: { effectId: 'A::B' } });
    expect(handler).toHaveBeenCalledWith({
      type: 'source-synced',
      payload: { effectId: 'A::B' },
    });
  });

  it('sends commit with elementSelector and diffs (matches UpstreamMessage shape)', () => {
    const ws = new WsClient('ws://localhost:52340');
    ws.start();
    currentSocket().triggerOpen();
    ws.send({
      type: 'commit',
      payload: {
        effectId: 'A::B',
        elementSelector: '#hero > div.card',
        diffs: [{ param: 'radius', from: 100, to: 165 }],
      },
    });
    const [msg] = parseSent(currentSocket());
    if (msg?.type === 'commit') {
      expect(msg.payload.elementSelector).toBe('#hero > div.card');
      expect(msg.payload.diffs).toEqual([{ param: 'radius', from: 100, to: 165 }]);
    } else {
      throw new Error('expected commit message');
    }
  });
});
