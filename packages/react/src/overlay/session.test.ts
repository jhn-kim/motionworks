import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBridge } from '../bridge.js';
import { OverlaySession } from './session.js';

// The session opens a real WebSocket on start(); tests only need the state
// side, so stub the constructor with an inert socket.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const registration = {
  name: 'CardEntrance',
  params: { radius: { type: 'spatial-radius' as const, value: 100, min: 20, max: 400 } },
  update: () => {},
};

let session: OverlaySession;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  session = new OverlaySession(59999, false);
  session.start();
  getBridge().register('Card::CardEntrance', null, registration);
});

afterEach(() => {
  getBridge().unregister('Card::CardEntrance');
  session.stop();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('OverlaySession — manipulate / discard cycle', () => {
  it('manipulate records a diff and applies the live value without recursing', () => {
    // Before the applyingOwnChange guard, this call recursed through
    // onStateChange → reconcileEffect → applyParamChange until the stack
    // overflowed.
    session.manipulate('Card::CardEntrance', 'radius', 160);
    expect(session.diffs.getDiff('Card::CardEntrance')).toEqual({
      radius: { from: 100, to: 160 },
    });
  });

  it('discard clears the diff and resets the live value to baseline', () => {
    const applied: unknown[] = [];
    getBridge().unregister('Card::CardEntrance');
    getBridge().register('Card::CardEntrance', null, {
      ...registration,
      update: (params) => applied.push(params['radius']),
    });

    session.manipulate('Card::CardEntrance', 'radius', 160);
    session.discard('Card::CardEntrance');

    expect(session.diffs.getDiff('Card::CardEntrance')).toEqual({});
    // The last update() call must be the baseline reset — not a reconcile
    // re-applying the discarded value on top of it.
    expect(applied[applied.length - 1]).toBe(100);
  });

  it('reconciliation still runs on re-registration (guard only blocks own writes)', () => {
    session.manipulate('Card::CardEntrance', 'radius', 160);
    // Simulate an HMR re-registration with an unchanged source baseline: the
    // designer's uncommitted diff must survive (SOURCE_SYNC "preserved").
    getBridge().register('Card::CardEntrance', null, registration);
    expect(session.diffs.getDiff('Card::CardEntrance')).toEqual({
      radius: { from: 100, to: 160 },
    });
  });
});
