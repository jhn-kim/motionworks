import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDaemon, type RunningDaemon } from "./daemon.js";
import type { AgentRunner } from "./agent.js";
import { appendEntry, readJournal } from "./journal.js";

let root: string;
let daemon: RunningDaemon | null;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionworks-daemon-"));
  daemon = await startDaemon({
    projectRoot: root,
    port: 0,
    agentSetting: "off",
  });
});
afterEach(async () => {
  await daemon?.stop();
  await rm(root, { recursive: true, force: true });
});

const commit = (page = "/demo") => ({
  page,
  effectId: "card#1",
  effectName: "Card",
  elementSelector: ".card",
  changes: [
    {
      param: "radius",
      type: "spatial-radius" as const,
      from: 100,
      to: 120,
      var: "--mw-radius",
      fromCss: "100px",
      toCss: "120px",
    },
  ],
});
const request = (path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${daemon!.port}${path}`, init);

describe("daemon", () => {
  it("commits with the header origin, filters pending, and acknowledges", async () => {
    const created = await request("/commit", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...commit(), origin: "https://evil.example" }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string; origin: string };
    expect(entry.origin).toBe("http://localhost:3000");
    expect(
      await (
        await request("/pending", {
          headers: { Origin: "http://localhost:3001" },
        })
      ).json(),
    ).toEqual([]);
    expect(
      await (
        await request("/pending?all=1", {
          headers: { Origin: "http://localhost:3001" },
        })
      ).json(),
    ).toHaveLength(1);
    const ack = await request("/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id }),
    });
    expect(ack.status).toBe(200);
    expect(await (await request("/pending")).json()).toEqual([]);
  });

  it("coalesces repeated pending commits for the same slider", async () => {
    const first = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit()),
    });
    const firstEntry = (await first.json()) as { id: string };
    const second = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...commit(),
        changes: [
          {
            ...commit().changes[0],
            from: 120,
            to: 160,
            fromCss: "120px",
            toCss: "160px",
          },
        ],
      }),
    });
    const secondEntry = (await second.json()) as { id: string };

    expect(secondEntry.id).toBe(firstEntry.id);
    expect(await readJournal(root)).toEqual([
      expect.objectContaining({
        id: firstEntry.id,
        changes: [
          expect.objectContaining({
            param: "radius",
            from: 100,
            to: 160,
            fromCss: "100px",
            toCss: "160px",
          }),
        ],
      }),
    ]);
  });

  it("directly applies an unambiguous CSS commit", async () => {
    await writeFile(
      join(root, "motion.css"),
      ".card { --mw-radius: 100px; }\n",
    );
    const created = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit()),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { status: string }).status).toBe(
      "applied",
    );
    expect(await readFile(join(root, "motion.css"), "utf8")).toContain(
      "--mw-radius: 120px",
    );
  });

  it("handles preflight and rejects remote origins", async () => {
    expect(
      (
        await request("/commit", {
          method: "OPTIONS",
          headers: { Origin: "http://localhost:3000" },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await request("/status", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("rejects bad JSON and oversized bodies", async () => {
    expect(
      (await request("/commit", { method: "POST", body: "{bad" })).status,
    ).toBe(400);
    expect(
      (
        await request("/commit", {
          method: "POST",
          body: "x".repeat(1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
  });

  it("rejects invalid parameter types and malformed type corrections", async () => {
    expect(
      (
        await request("/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...commit(),
            changes: [{ ...commit().changes[0], type: "unknown" }],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...commit(),
            typeCorrections: [{ effectName: "Card" }],
          }),
        })
      ).status,
    ).toBe(400);
  });

  it("leaves EADDRINUSE untouched", async () => {
    await expect(
      startDaemon({ projectRoot: root, port: daemon!.port }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("prunes applied entries older than seven days on startup", async () => {
    await daemon!.stop();
    daemon = null;
    const now = Date.now();
    await appendEntry(root, {
      id: "old",
      createdAt: now - 9 * 24 * 60 * 60 * 1000,
      appliedAt: now - 8 * 24 * 60 * 60 * 1000,
      origin: "",
      page: "/",
      effectId: "card#1",
      effectName: "Card",
      elementSelector: ".card",
      changes: [],
      status: "applied",
    });
    await appendEntry(root, {
      id: "recent",
      createdAt: now,
      appliedAt: now,
      origin: "",
      page: "/",
      effectId: "card#1",
      effectName: "Card",
      elementSelector: ".card",
      changes: [],
      status: "applied",
    });
    daemon = await startDaemon({
      projectRoot: root,
      port: 0,
      agentSetting: "off",
    });
    expect((await readJournal(root)).map((entry) => entry.id)).toEqual([
      "recent",
    ]);
  });

  it.each([
    [true, "applied"],
    [false, "pending"],
  ] as const)("records agent result %s as %s", async (ok, expected) => {
    await daemon!.stop();
    daemon = null;
    const agent: AgentRunner = {
      command: "claude",
      running: false,
      run: vi.fn(async () => {
        if (ok)
          await writeFile(
            join(root, "motion.css"),
            ".card { --mw-radius: 120px; }\n",
          );
        return ok ? { ok: true } : { ok: false, error: "agent failed" };
      }),
    };
    daemon = await startDaemon({ projectRoot: root, port: 0, agent });
    const created = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit()),
    });
    expect(((await created.json()) as { status: string }).status).toBe(
      "agent-working",
    );
    await vi.waitFor(async () =>
      expect((await readJournal(root))[0]?.status).toBe(expected),
    );
    const saved = (await readJournal(root))[0]!;
    if (ok)
      expect(saved).toMatchObject({ appliedBy: "agent", status: "applied" });
    else
      expect(saved).toMatchObject({ status: "pending", error: "agent failed" });
  });

  it("falls back to the prompt queue when an agent exits zero without writing", async () => {
    await daemon!.stop();
    daemon = null;
    const agent: AgentRunner = {
      command: "claude",
      running: false,
      run: vi.fn(async () => ({ ok: true })),
    };
    daemon = await startDaemon({ projectRoot: root, port: 0, agent });

    const created = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commit()),
    });
    expect(await created.json()).toMatchObject({ status: "agent-working" });

    await vi.waitFor(async () =>
      expect((await readJournal(root))[0]).toMatchObject({
        status: "pending",
        error: expect.stringContaining("reported success"),
      }),
    );
  });

  it("routes mixed value and type-correction commits through the agent", async () => {
    await daemon!.stop();
    daemon = null;
    await writeFile(
      join(root, "motion.css"),
      ".card { --mw-radius: 100px; }\n",
    );
    const stop = vi.fn();
    const run = vi.fn(async () => ({ ok: false, error: "agent failed" }));
    const agent: AgentRunner = {
      command: "claude",
      running: false,
      run,
      stop,
    };
    daemon = await startDaemon({ projectRoot: root, port: 0, agent });
    const created = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...commit(),
        typeCorrections: [
          {
            effectName: "Card",
            paramKey: "radius",
            previousType: "spatial-radius",
            correctedType: "scalar",
            correctedAt: 1,
          },
        ],
      }),
    });
    expect(await created.json()).toMatchObject({ status: "agent-working" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(await readFile(join(root, "motion.css"), "utf8")).toContain(
      "--mw-radius: 100px",
    );
    await vi.waitFor(async () =>
      expect((await readJournal(root))[0]).toMatchObject({
        status: "pending",
        error: "agent failed",
      }),
    );
    await daemon.stop();
    daemon = null;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("resets interrupted agent work on restart", async () => {
    await appendEntry(root, {
      ...commit(),
      id: "working",
      createdAt: Date.now(),
      origin: "",
      status: "agent-working",
    });
    await daemon!.stop();
    daemon = await startDaemon({
      projectRoot: root,
      port: 0,
      agentSetting: "off",
    });
    expect(
      (await readJournal(root)).find((entry) => entry.id === "working"),
    ).toMatchObject({ status: "pending" });
  });

  it("survives an agent whose run rejects without crashing (P1-6)", async () => {
    await daemon!.stop();
    daemon = null;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const agent: AgentRunner = {
        command: "claude",
        running: false,
        // Reject rather than resolve — the completion chain must absorb it.
        run: vi.fn(() => Promise.reject(new Error("boom"))),
      };
      daemon = await startDaemon({ projectRoot: root, port: 0, agent });
      const created = await request("/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commit()),
      });
      expect(await created.json()).toMatchObject({ status: "agent-working" });
      await vi.waitFor(async () =>
        expect((await readJournal(root))[0]).toMatchObject({
          status: "pending",
          error: expect.stringContaining("boom"),
        }),
      );
      // Give any stray rejection a tick to surface.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects a toCss that smuggles CSS structure or is undecodable (S3)", async () => {
    for (const toCss of [
      "1; } body { background: url(https://evil/) } .x { --mw-y:1",
      "120px; color: red",
      "not-a-length",
    ]) {
      const res = await request("/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...commit(),
          changes: [{ ...commit().changes[0], toCss }],
        }),
      });
      expect(res.status, `toCss ${JSON.stringify(toCss)}`).toBe(400);
    }
    expect(await readJournal(root)).toEqual([]);
  });

  it("rejects a non-string change.var with 400, not 500 (P2-12a)", async () => {
    const res = await request("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...commit(),
        changes: [{ ...commit().changes[0], var: 123 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("requires a configured token on POST requests", async () => {
    await daemon!.stop();
    daemon = await startDaemon({
      projectRoot: root,
      port: 0,
      agentSetting: "off",
      token: "secret",
    });
    expect(
      (
        await request("/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            effectId: "card#1",
            effectName: "Card",
            elementSelector: ".card",
          }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/select?token=secret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            effectId: "card#1",
            effectName: "Card",
            elementSelector: ".card",
          }),
        })
      ).status,
    ).toBe(200);
  });

  it("requires the token on GET data routes and accepts it as a header (S1/S6)", async () => {
    await daemon!.stop();
    await writeFile(join(root, "bundle.js"), "// overlay\n");
    daemon = await startDaemon({
      projectRoot: root,
      port: 0,
      agentSetting: "off",
      token: "secret",
      overlayBundlePath: join(root, "bundle.js"),
    });
    // Consume every body so undici doesn't hold connections open.
    const statusOf = async (
      path: string,
      init?: RequestInit,
    ): Promise<number> => {
      const res = await request(path, init);
      await res.text();
      return res.status;
    };
    const authed = { headers: { "X-MotionWorks-Token": "secret" } };
    // The information-disclosure routes are no longer readable without the
    // token, including the `?all=1` bypass the review flagged.
    expect(await statusOf("/status")).toBe(401);
    expect(await statusOf("/pending?all=1")).toBe(401);
    expect(await statusOf("/status", authed)).toBe(200);
    expect(await statusOf("/pending?all=1", authed)).toBe(200);
    // The overlay asset stays reachable without a token so a page can bootstrap.
    expect(await statusOf("/motionworks.js")).not.toBe(401);
  });

  it("rejects a non-loopback Host header to block DNS rebinding (S4)", async () => {
    // `fetch`/undici forbids overriding the Host header, so drive a raw
    // request that carries the attacker's rebound hostname.
    const statusWithHost = (host: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port: daemon!.port,
            path: "/status",
            method: "GET",
            headers: { Host: host },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
    expect(await statusWithHost("attacker.example")).toBe(403);
    expect(await statusWithHost("localhost:1234")).toBe(200);
  });
});
