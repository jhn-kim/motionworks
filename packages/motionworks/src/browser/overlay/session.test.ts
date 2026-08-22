import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBridge } from '../bridge.js';
import { OverlaySession } from './session.js';

let session: OverlaySession;
let node: HTMLDivElement;
let requests: Array<{ url: string; init?: RequestInit }>;
const effectId = 'Card::CardEntrance';

beforeEach(async () => {
  document.head.innerHTML = '<style data-vite-dev-id="src/motion.css">.card { --mw-radius: 100px; }</style>';
  node = document.createElement('div'); node.className = 'card'; document.body.appendChild(node);
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => { const url = String(input); requests.push({ url, init }); if (url.endsWith('/status')) return new Response(JSON.stringify({ ok: true, port: 59999, projectRoot: '/tmp', pending: 0, agent: { configured: 'off', enabled: false, running: false } })); if (url.endsWith('/pending')) return new Response('[]'); if (url.endsWith('/commit')) return new Response(JSON.stringify({ id: 'entry-1' }), { status: 201 }); return new Response(JSON.stringify({ acknowledged: [] })); }));
  session = new OverlaySession({ daemonUrl: 'http://127.0.0.1:59999' }); session.start();
  getBridge().register(effectId, node, { name: 'CardEntrance', params: { radius: { type: 'spatial-radius' } }, capabilities: { replay: true } });
  await vi.waitFor(() => expect(session.isConnected()).toBe(true));
});
afterEach(() => { getBridge().unregister(effectId, node); session.stop(); node.remove(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('OverlaySession', () => {
  it('writes an inline variable, records a diff, and restores on discard', () => {
    session.manipulate(effectId, 'radius', 160);
    expect(node.style.getPropertyValue('--mw-radius')).toBe('160px');
    expect(session.diffs.getDiff(effectId)).toEqual({ radius: { from: 100, to: 160 } });
    session.discard(effectId);
    expect(node.style.getPropertyValue('--mw-radius')).toBe('');
  });

  it('commits CSS binding and declaring-rule metadata', async () => {
    session.manipulate(effectId, 'radius', 160); expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() => expect(requests.some((request) => request.url.endsWith('/commit'))).toBe(true));
    const request = requests.find((candidate) => candidate.url.endsWith('/commit'))!;
    const body = JSON.parse(String(request.init?.body));
    expect(body.changes[0]).toMatchObject({ param: 'radius', var: '--mw-radius', fromCss: '100px', toCss: '160px', rule: { selectorText: '.card', sourceFile: 'src/motion.css' } });
  });

  it('dispatches replay as a custom event', () => {
    const listener = vi.fn(); node.addEventListener('motionworks:replay', listener);
    session.sendReserved(effectId, 'replay', 1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('commits a type correction without a value change', async () => {
    session.correctType(effectId, 'radius', 'scalar'); expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() => expect(requests.some((request) => request.url.endsWith('/commit'))).toBe(true));
    const body = JSON.parse(String(requests.find((candidate) => candidate.url.endsWith('/commit'))!.init?.body));
    expect(body.changes).toEqual([]); expect(body.typeCorrections).toHaveLength(1);
  });
});
