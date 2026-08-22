import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JournalEntry } from "@motionworks/core";
import { getBridge } from "../bridge.js";
import { OverlaySession } from "./session.js";

const effectId = "Card::CardEntrance";
const registration = {
  name: "CardEntrance",
  params: {
    radius: { type: "spatial-radius" as const, value: 100, min: 20, max: 400 },
  },
  update: () => {},
  sourceHints: { radius: { file: "src/motion.ts", variable: "RADIUS" } },
};

let pending: JournalEntry[];
let requests: { url: string; init?: RequestInit }[];
let session: OverlaySession;
let storage: Map<string, string>;

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  pending = [];
  requests = [];
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/status")) {
        return response({
          ok: true,
          port: 59999,
          projectRoot: "/tmp/project",
          pending: pending.length,
          agent: { configured: "off", enabled: false, running: false },
        });
      }
      if (url.endsWith("/pending")) return response(pending);
      if (url.endsWith("/commit")) return response({ id: "entry-1" }, 201);
      if (url.endsWith("/ack")) return response({ acknowledged: ["entry-1"] });
      return response({});
    }),
  );
  session = new OverlaySession({ daemonUrl: "http://127.0.0.1:59999" });
  session.start();
  getBridge().register(effectId, null, registration);
  await vi.waitFor(() => expect(session.isConnected()).toBe(true));
});

afterEach(() => {
  getBridge().unregister(effectId);
  session.stop();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("OverlaySession", () => {
  it("records live changes without network traffic and discard restores baseline", () => {
    const applied: unknown[] = [];
    getBridge().unregister(effectId);
    getBridge().register(effectId, null, {
      ...registration,
      update: (params: Record<string, unknown>) =>
        applied.push(params["radius"]),
    });
    const before = requests.length;
    session.manipulate(effectId, "radius", 160);
    expect(session.diffs.getDiff(effectId)).toEqual({
      radius: { from: 100, to: 160 },
    });
    expect(requests).toHaveLength(before);
    session.discard(effectId);
    expect(session.diffs.getDiff(effectId)).toEqual({});
    expect(applied.at(-1)).toBe(100);
  });

  it("commits journal changes with filtered source hints", async () => {
    session.manipulate(effectId, "radius", 160);
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/commit"))).toBe(
        true,
      ),
    );
    const request = requests.find((candidate) =>
      candidate.url.endsWith("/commit"),
    )!;
    const body = JSON.parse(String(request.init?.body)) as {
      changes: unknown[];
    };
    expect(body.changes).toEqual([
      {
        param: "radius",
        type: "spatial-radius",
        from: 100,
        to: 160,
        sourceHint: { file: "src/motion.ts", variable: "RADIUS" },
      },
    ]);
  });

  it("derives pending state from polled journal entries", async () => {
    pending = [
      {
        id: "entry-1",
        createdAt: Date.now(),
        origin: location.origin,
        page: location.href,
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        status: "pending",
        changes: [
          { param: "radius", type: "spatial-radius", from: 100, to: 160 },
        ],
      },
    ];
    await session.daemon.refresh();
    expect(session.isCommitPending(effectId)).toBe(true);
    expect(session.getAgentQueue()).toEqual([
      { id: "entry-1", effectId, effectName: "CardEntrance" },
    ]);
  });

  it("acks when an HMR baseline equals every journal change target", async () => {
    pending = [
      {
        id: "entry-1",
        createdAt: Date.now(),
        origin: location.origin,
        page: location.href,
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        status: "pending",
        changes: [
          { param: "radius", type: "spatial-radius", from: 100, to: 160 },
        ],
      },
    ];
    session.manipulate(effectId, "radius", 160);
    await session.daemon.refresh();
    getBridge().register(effectId, null, {
      ...registration,
      params: { radius: { ...registration.params.radius, value: 160 } },
    });
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/ack"))).toBe(
        true,
      ),
    );
  });

  it("acks a matching entry delivered after startup reconciliation but leaves a mismatched entry pending", async () => {
    session.stop();
    getBridge().unregister(effectId);
    storage.set(
      `motionworks:diffs:${location.origin}`,
      JSON.stringify({
        diffs: { [effectId]: { radius: { from: 100, to: 160 } } },
      }),
    );
    vi.useFakeTimers();
    requests = [];
    pending = [];

    session = new OverlaySession({ daemonUrl: "http://127.0.0.1:59999" });
    session.start();
    getBridge().register(effectId, null, {
      ...registration,
      params: { radius: { ...registration.params.radius, value: 160 } },
    });

    // Registration consumes the hydrated clean diff before the daemon's
    // first pending response has supplied any journal entries.
    expect(session.diffs.getDiff(effectId)).toEqual({});
    await vi.advanceTimersByTimeAsync(0);
    pending = [
      {
        id: "matching-entry",
        createdAt: Date.now(),
        origin: location.origin,
        page: location.href,
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        status: "pending",
        changes: [
          { param: "radius", type: "spatial-radius", from: 100, to: 160 },
        ],
      },
      {
        id: "mismatched-entry",
        createdAt: Date.now(),
        origin: location.origin,
        page: location.href,
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        status: "pending",
        changes: [
          { param: "radius", type: "spatial-radius", from: 100, to: 175 },
        ],
      },
    ];

    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(0);
    const acknowledged = requests
      .filter((request) => request.url.endsWith("/ack"))
      .map(
        (request) => JSON.parse(String(request.init?.body)) as { id: string },
      );
    expect(acknowledged).toContainEqual({ id: "matching-entry" });
    expect(acknowledged).not.toContainEqual({ id: "mismatched-entry" });
  });

  it("persists and hydrates diffs across sessions", async () => {
    vi.useFakeTimers();
    session.manipulate(effectId, "radius", 175);
    await vi.advanceTimersByTimeAsync(100);
    session.stop();
    const hydrated = new OverlaySession({
      daemonUrl: "http://127.0.0.1:59999",
    });
    hydrated.start();
    getBridge().register(effectId, null, registration);
    expect(hydrated.diffs.getDiff(effectId)).toEqual({
      radius: { from: 100, to: 175 },
    });
    hydrated.stop();
  });

  it("commits a type correction without a value change", async () => {
    session.correctType(effectId, "radius", "scalar");
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/commit"))).toBe(
        true,
      ),
    );
    const request = requests.find((candidate) =>
      candidate.url.endsWith("/commit"),
    )!;
    const body = JSON.parse(String(request.init?.body)) as {
      changes: unknown[];
      typeCorrections: unknown[];
    };
    expect(body.changes).toEqual([]);
    expect(body.typeCorrections).toHaveLength(1);
  });
});
