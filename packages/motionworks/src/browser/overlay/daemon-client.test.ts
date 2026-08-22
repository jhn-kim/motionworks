import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DaemonClient,
  PENDING_POLL_MS,
  STATUS_POLL_MS,
} from "./daemon-client.js";

const status = {
  ok: true,
  port: 52340,
  projectRoot: "/tmp/project",
  pending: 0,
  agent: { configured: "off" as const, enabled: false, running: false },
};
const response = (value: unknown): Response =>
  new Response(JSON.stringify(value), { status: 200 });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DaemonClient", () => {
  it("polls status and pending at their configured cadences", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/status") ? response(status) : response([]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new DaemonClient("http://127.0.0.1:52340");
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PENDING_POLL_MS);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/pending")),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS - PENDING_POLL_MS);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/status"))
        .length,
    ).toBeGreaterThan(1);
    client.stop();
  });

  it("backs status polling off from one second up to ten seconds while offline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const statuses: unknown[] = [];
    const client = new DaemonClient("http://127.0.0.1:52340");
    client.onStatus((value) => statuses.push(value));
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(statuses).toEqual([]);
    client.stop();
  });

  it("reports status flips and sends commit and ack JSON payloads", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/status")) return response(status);
        if (url.endsWith("/pending")) return response([]);
        if (url.endsWith("/commit")) return response({ id: "change-1" });
        return response({ acknowledged: ["change-1"] });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const statuses: unknown[] = [];
    const client = new DaemonClient("http://127.0.0.1:52340");
    client.onStatus((value) => statuses.push(value));
    client.start();
    await vi.waitFor(() => expect(client.isConnected()).toBe(true));
    expect(
      await client.commit({
        page: "http://localhost",
        effectId: "x",
        effectName: "X",
        elementSelector: ".x",
        changes: [],
      }),
    ).toEqual({ id: "change-1" });
    expect(await client.ack("change-1")).toBe(true);
    expect(statuses.at(-1)).toEqual(status);
    const commit = calls.find((call) => call.url.endsWith("/commit"))!;
    const ack = calls.find((call) => call.url.endsWith("/ack"))!;
    expect(JSON.parse(String(commit.init?.body))).toMatchObject({
      effectId: "x",
    });
    expect(JSON.parse(String(ack.init?.body))).toEqual({ id: "change-1" });
    expect(commit.init).toMatchObject({
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    client.stop();
  });
});
