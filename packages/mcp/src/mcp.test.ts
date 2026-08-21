import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { MotionWorksServer, MotionWorksStateManager } from '@motionworks/core/server';
import type {
  MotionWorksEffect,
  ParamDiff,
  UpstreamMessage,
  DownstreamMessage,
} from '@motionworks/core';

import { createMotionWorksMcpServer } from './mcp-server.js';
import { SCHEMA_EMISSION_GUIDE, TOOL_NUDGE } from './instructions.js';

type ToolContent = { type: string; text?: string }[];

function extractJson(content: ToolContent): unknown {
  const first = content[0];
  if (first === undefined || first.type !== 'text' || first.text === undefined) {
    throw new Error(`Expected a text content block, got: ${JSON.stringify(content)}`);
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

async function openWsClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

async function collectDownstream(
  ws: WebSocket,
  match: (msg: DownstreamMessage) => boolean,
  timeoutMs = 1000,
): Promise<DownstreamMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for downstream message after ${timeoutMs}ms`));
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

describe('@motionworks/mcp integration', () => {
  let state: MotionWorksStateManager;
  let wsServer: MotionWorksServer;
  let wsUrl: string;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    state = new MotionWorksStateManager();
    wsServer = new MotionWorksServer(state, 0);
    await wsServer.start();
    const port = wsServer.address?.port;
    if (port === undefined) throw new Error('WS server did not bind to a port');
    wsUrl = `ws://127.0.0.1:${port}`;

    const mcpServer = createMotionWorksMcpServer({ state, wsServer });
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close().catch(() => {});
    await wsServer.stop().catch(() => {});
  });

  it('registers exactly the seven tools listed in AGENT_INTEGRATION.md, each ending with the nudge', async () => {
    const listing = await client.listTools();
    const names = listing.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'motionworks_clear_changes',
        'motionworks_clear_type_corrections',
        'motionworks_get_changes',
        'motionworks_get_instructions',
        'motionworks_get_selected',
        'motionworks_get_state',
        'motionworks_list_effects',
      ].sort(),
    );
    for (const tool of listing.tools) {
      expect(tool.description, `tool ${tool.name} description`).toBeDefined();
      expect(tool.description ?? '').toContain(TOOL_NUDGE);
      expect((tool.description ?? '').endsWith(TOOL_NUDGE)).toBe(true);
    }
  });

  it('motionworks_get_instructions returns the schema emission guide verbatim', async () => {
    const res = await client.callTool({ name: 'motionworks_get_instructions', arguments: {} });
    const content = res.content as ToolContent;
    expect(content[0]?.text).toBe(SCHEMA_EMISSION_GUIDE);
  });

  it('drives the overlay flow (register → select → change → commit×2), then MCP surfaces both changesets oldest-first and clear_changes pops only the first', async () => {
    const ws = await openWsClient(wsUrl);

    const effect: MotionWorksEffect = {
      id: 'effect-liquid',
      name: 'LiquidCursor',
      readOnly: false,
      params: {
        radius: { type: 'spatial-radius', value: 120 },
        trail: { type: 'temporal-decay', value: 0.6 },
      },
      sourceHints: {
        radius: { file: 'src/effects/liquid.ts', variable: 'INFLUENCE_RADIUS' },
        trail: { file: 'src/effects/liquid.ts', variable: 'TRAIL_PERSISTENCE' },
      },
    };
    send(ws, { type: 'register', payload: effect });
    send(ws, { type: 'select', payload: { effectId: effect.id } });
    send(ws, { type: 'change', payload: { effectId: effect.id, param: 'radius', value: 165 } });
    send(ws, { type: 'change', payload: { effectId: effect.id, param: 'trail', value: 0.4 } });

    await waitFor(() =>
      state.getSnapshot().effects.length === 1 &&
      state.getSelectedEffect()?.id === effect.id
        ? true
        : null,
    );

    const diffs1: ParamDiff[] = [{ param: 'radius', from: 120, to: 165 }];
    const ack1Promise = collectDownstream(ws, (m) => m.type === 'ack');
    send(ws, {
      type: 'commit',
      payload: { effectId: effect.id, elementSelector: '#hero > div.liquid-wrapper', diffs: diffs1 },
    });
    const ack1 = await ack1Promise;
    if (ack1.type !== 'ack') throw new Error('expected ack');
    const changesetIdA = ack1.payload.changeId;

    const diffs2: ParamDiff[] = [{ param: 'trail', from: 0.6, to: 0.4 }];
    const ack2Promise = collectDownstream(ws, (m) => m.type === 'ack');
    send(ws, {
      type: 'commit',
      payload: { effectId: effect.id, elementSelector: '#hero > div.liquid-wrapper', diffs: diffs2 },
    });
    const ack2 = await ack2Promise;
    if (ack2.type !== 'ack') throw new Error('expected ack');
    const changesetIdB = ack2.payload.changeId;

    expect(changesetIdA).not.toBe(changesetIdB);

    // motionworks_get_changes returns both, oldest first.
    const getChangesRes = await client.callTool({
      name: 'motionworks_get_changes',
      arguments: {},
    });
    const changes = extractJson(getChangesRes.content as ToolContent) as {
      changesets: { id: string; effectName: string; changes: Record<string, unknown> }[];
      typeCorrections: unknown[];
    };
    expect(changes.changesets.map((c) => c.id)).toEqual([changesetIdA, changesetIdB]);
    expect(changes.changesets[0]?.effectName).toBe('LiquidCursor');
    expect(changes.typeCorrections).toEqual([]);

    // motionworks_list_effects returns the registered effect with its schema.
    const listRes = await client.callTool({ name: 'motionworks_list_effects', arguments: {} });
    const effects = (extractJson(listRes.content as ToolContent) as { effects: MotionWorksEffect[] })
      .effects;
    expect(effects).toHaveLength(1);
    expect(effects[0]?.name).toBe('LiquidCursor');

    // motionworks_get_selected returns the selected effect only.
    const selectedRes = await client.callTool({
      name: 'motionworks_get_selected',
      arguments: {},
    });
    const selected = extractJson(selectedRes.content as ToolContent) as {
      selected: { id: string; name: string } | null;
    };
    expect(selected.selected?.id).toBe(effect.id);
    expect(selected.selected?.name).toBe('LiquidCursor');

    // motionworks_get_state contains all four slots.
    const stateRes = await client.callTool({ name: 'motionworks_get_state', arguments: {} });
    const stateJson = extractJson(stateRes.content as ToolContent) as {
      effects: unknown[];
      selectedEffectId: string | null;
      changesets: unknown[];
      typeCorrections: unknown[];
    };
    expect(stateJson.effects).toHaveLength(1);
    expect(stateJson.selectedEffectId).toBe(effect.id);
    expect(stateJson.changesets).toHaveLength(2);
    expect(stateJson.typeCorrections).toEqual([]);

    // clear_changes on the first id: WS receives source-synced, second changeset survives.
    const syncedPromise = collectDownstream(ws, (m) => m.type === 'source-synced');
    const clearRes = await client.callTool({
      name: 'motionworks_clear_changes',
      arguments: { id: changesetIdA },
    });
    const clearJson = extractJson(clearRes.content as ToolContent) as {
      cleared: boolean;
      remaining: number;
    };
    expect(clearJson).toEqual({ cleared: true, id: changesetIdA, remaining: 1 });

    const synced = await syncedPromise;
    if (synced.type !== 'source-synced') throw new Error('expected source-synced');
    expect(synced.payload.effectId).toBe(effect.id);

    const afterRes = await client.callTool({
      name: 'motionworks_get_changes',
      arguments: {},
    });
    const after = extractJson(afterRes.content as ToolContent) as {
      changesets: { id: string }[];
    };
    expect(after.changesets.map((c) => c.id)).toEqual([changesetIdB]);

    // clear_changes on an unknown id returns an isError result.
    const badRes = await client.callTool({
      name: 'motionworks_clear_changes',
      arguments: { id: 'nope-nope-nope' },
    });
    expect(badRes.isError).toBe(true);

    ws.close();
  });

  it('clear_type_corrections returns the count and empties the queue', async () => {
    state.addTypeCorrection({
      effectName: 'LiquidCursor',
      paramKey: 'trail',
      previousType: 'scalar',
      correctedType: 'temporal-decay',
      correctedAt: Date.now(),
    });
    const res = await client.callTool({
      name: 'motionworks_clear_type_corrections',
      arguments: {},
    });
    expect(extractJson(res.content as ToolContent)).toEqual({ cleared: 1 });
    expect(state.getSnapshot().typeCorrections).toHaveLength(0);
  });
});
