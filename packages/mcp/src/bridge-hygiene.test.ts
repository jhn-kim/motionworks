import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type {
  DownstreamMessage,
  MotionWorksEffect,
  UpstreamMessage,
} from '@motionworks/core';
import { MotionWorksServer, MotionWorksStateManager } from '@motionworks/core/server';

async function openWsClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function send(ws: WebSocket, msg: UpstreamMessage): void {
  ws.send(JSON.stringify(msg));
}

async function waitFor<T>(check: () => T | null, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = check();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: condition not satisfied within timeout');
}

async function collectDownstream(
  ws: WebSocket,
  match: (msg: DownstreamMessage) => boolean,
  timeoutMs = 1000,
): Promise<DownstreamMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for downstream after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const onMessage = (raw: Buffer): void => {
      const parsed = JSON.parse(raw.toString()) as DownstreamMessage;
      if (match(parsed)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(parsed);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('bridge hygiene', () => {
  let state: MotionWorksStateManager;
  let server: MotionWorksServer;
  let url: string;

  beforeEach(async () => {
    state = new MotionWorksStateManager();
    server = new MotionWorksServer(state, 0);
    await server.start();
    const port = server.address?.port;
    if (port === undefined) throw new Error('server did not bind to a port');
    url = `ws://127.0.0.1:${String(port)}`;
  });

  afterEach(async () => {
    await server.stop().catch(() => {});
  });

  it('drops registrations owned by a connection when it disconnects', async () => {
    const ws = await openWsClient(url);
    const effect: MotionWorksEffect = {
      id: 'effect-x',
      name: 'X',
      readOnly: false,
      params: { r: { type: 'spatial-radius', value: 20 } },
    };
    send(ws, { type: 'register', payload: effect });
    await waitFor(() => (state.getAllEffects().length === 1 ? true : null));
    expect(state.getAllEffects()).toHaveLength(1);
    ws.close();
    await waitFor(() => (state.getAllEffects().length === 0 ? true : null));
    expect(state.getAllEffects()).toHaveLength(0);
  });

  it('does not affect effects owned by a different, still-open connection', async () => {
    const wsA = await openWsClient(url);
    const wsB = await openWsClient(url);
    send(wsA, {
      type: 'register',
      payload: { id: 'a', name: 'A', readOnly: false, params: {} },
    });
    send(wsB, {
      type: 'register',
      payload: { id: 'b', name: 'B', readOnly: false, params: {} },
    });
    await waitFor(() => (state.getAllEffects().length === 2 ? true : null));
    wsA.close();
    await waitFor(() =>
      state.getAllEffects().length === 1 && state.getEffect('b') !== undefined ? true : null,
    );
    expect(state.getEffect('a')).toBeUndefined();
    expect(state.getEffect('b')).toBeDefined();
    wsB.close();
  });

  it('carries the effectId through the commit → clear cycle so name collisions do not misroute source-synced', async () => {
    const wsA = await openWsClient(url);
    // Two effects with the same name but different ids — matches a stagger
    // list where every element registers as "StaggeredEntry".
    const effA: MotionWorksEffect = { id: 'entry-1', name: 'StaggeredEntry', readOnly: false, params: { delay: { type: 'stagger', value: 0 } } };
    const effB: MotionWorksEffect = { id: 'entry-2', name: 'StaggeredEntry', readOnly: false, params: { delay: { type: 'stagger', value: 80 } } };
    send(wsA, { type: 'register', payload: effA });
    send(wsA, { type: 'register', payload: effB });
    await waitFor(() => (state.getAllEffects().length === 2 ? true : null));

    const ack = await new Promise<string>((resolve) => {
      const onMsg = (raw: Buffer): void => {
        const parsed = JSON.parse(raw.toString()) as DownstreamMessage;
        if (parsed.type === 'ack') {
          wsA.off('message', onMsg);
          resolve(parsed.payload.changeId);
        }
      };
      wsA.on('message', onMsg);
      send(wsA, {
        type: 'commit',
        payload: {
          effectId: 'entry-2',
          elementSelector: '.entry:nth-child(2)',
          diffs: [{ param: 'delay', from: 80, to: 120 }],
        },
      });
    });

    const changesets = state.getSnapshot().changesets;
    expect(changesets).toHaveLength(1);
    expect(changesets[0]?.id).toBe(ack);
    // The changeset must carry the correct effectId so downstream code can
    // resolve which of the two "StaggeredEntry" effects it belongs to.
    expect(changesets[0]?.effectId).toBe('entry-2');

    // The bridge tracked a selector; getSelector returns it.
    expect(server.getSelector('entry-2')).toBe('.entry:nth-child(2)');
    wsA.close();
  });

  it('remembers the selector from a select message and exposes it via getSelector', async () => {
    const ws = await openWsClient(url);
    const effect: MotionWorksEffect = { id: 'a', name: 'A', readOnly: false, params: {} };
    send(ws, { type: 'register', payload: effect });
    send(ws, { type: 'select', payload: { effectId: 'a', selector: '#hero > .foo' } });
    await waitFor(() =>
      state.getSelectedEffect()?.id === 'a' ? true : null,
    );
    expect(server.getSelector('a')).toBe('#hero > .foo');
    ws.close();
  });

  it('propagates a type-correction upstream message into state.typeCorrections', async () => {
    const ws = await openWsClient(url);
    send(ws, {
      type: 'register',
      payload: { id: 'e', name: 'E', readOnly: false, params: { t: { type: 'scalar', value: 0.5 } } },
    });
    send(ws, {
      type: 'type-correction',
      payload: {
        effectName: 'E',
        paramKey: 't',
        previousType: 'scalar',
        correctedType: 'temporal-decay',
        correctedAt: Date.now(),
      },
    });
    await waitFor(() =>
      state.getSnapshot().typeCorrections.length === 1 ? true : null,
    );
    const [tc] = state.getSnapshot().typeCorrections;
    expect(tc?.correctedType).toBe('temporal-decay');
    expect(tc?.previousType).toBe('scalar');
    ws.close();
  });

  // Silences unused-import warning while still keeping the helper available.
  void collectDownstream;
});
