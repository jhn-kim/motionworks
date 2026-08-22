import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBridge } from "../bridge.js";
import { OverlaySession } from "./session.js";
import type { JournalEntry } from "../../shared/index.js";

let session: OverlaySession;
let node: HTMLDivElement;
let requests: Array<{ url: string; init?: RequestInit }>;
let pendingEntries: JournalEntry[];
let extraNodes: Array<{ id: string; node: HTMLElement }>;
const effectId = "card-entrance#1";

beforeEach(async () => {
  document.head.innerHTML =
    '<style data-vite-dev-id="src/motion.css">.card { --mw-radius: 100px; }</style>';
  node = document.createElement("div");
  node.className = "card";
  document.body.appendChild(node);
  requests = [];
  pendingEntries = [];
  extraNodes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/status"))
        return new Response(
          JSON.stringify({
            ok: true,
            port: 59999,
            projectRoot: "/tmp",
            pending: 0,
            agent: { enabled: false, command: null, running: false },
          }),
        );
      if (url.endsWith("/pending"))
        return new Response(JSON.stringify(pendingEntries));
      if (url.endsWith("/commit"))
        return new Response(JSON.stringify({ id: "entry-1" }), { status: 201 });
      return new Response(JSON.stringify({ acknowledged: [] }));
    }),
  );
  session = new OverlaySession({ daemonUrl: "http://127.0.0.1:59999" });
  session.start();
  getBridge().register(effectId, node, {
    name: "CardEntrance",
    params: { radius: { type: "spatial-radius" } },
    capabilities: { replay: true },
  });
  await vi.waitFor(() => expect(session.isConnected()).toBe(true));
});
afterEach(() => {
  getBridge().unregister(effectId, node);
  for (const extra of extraNodes) {
    getBridge().unregister(extra.id, extra.node);
    extra.node.remove();
  }
  session.stop();
  node.remove();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("OverlaySession", () => {
  it("writes an inline variable, records a diff, and restores on discard", () => {
    session.manipulate(effectId, "radius", 160);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("160px");
    expect(session.diffs.getDiff(effectId)).toEqual({
      radius: { from: 100, to: 160 },
    });
    session.discard(effectId);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");
  });

  it("does not restore the edited value after discarding during comparison", () => {
    session.manipulate(effectId, "radius", 160);
    session.holdBaseline(effectId, true);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("100px");

    session.discard(effectId);
    // The Compare effect cleanup runs after discard in React. With no diff
    // left, releasing the baseline must be a no-op rather than resurrecting
    // the discarded value.
    session.holdBaseline(effectId, false);

    expect(session.diffs.hasDiff(effectId)).toBe(false);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");
  });

  it("re-applies a local diff after baseline refresh and clears it when CSS lands", () => {
    session.manipulate(effectId, "radius", 160);
    session.refreshBaselines();
    expect(node.style.getPropertyValue("--mw-radius")).toBe("160px");
    expect(session.diffs.hasDiff(effectId)).toBe(true);

    document.head.innerHTML =
      '<style data-vite-dev-id="src/motion.css">.card { --mw-radius: 160px; }</style>';
    session.refreshBaselines();
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");
    expect(session.diffs.hasDiff(effectId)).toBe(false);
  });

  it("applies and restores live values on equal-baseline siblings", () => {
    const sibling = document.createElement("div");
    sibling.className = "card";
    document.body.appendChild(sibling);
    const siblingId = "card-entrance#2";
    extraNodes.push({ id: siblingId, node: sibling });
    getBridge().register(siblingId, sibling, {
      name: "CardEntrance",
      params: { radius: { type: "spatial-radius" } },
    });

    session.manipulate(effectId, "radius", 160);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("160px");
    expect(sibling.style.getPropertyValue("--mw-radius")).toBe("160px");
    session.discard(effectId);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");
    expect(sibling.style.getPropertyValue("--mw-radius")).toBe("");
  });

  it("does not manipulate or commit an unbound parameter", () => {
    const unbound = document.createElement("div");
    document.body.appendChild(unbound);
    const unboundId = "unbound#1";
    extraNodes.push({ id: unboundId, node: unbound });
    getBridge().register(unboundId, unbound, {
      name: "Unbound",
      params: { missing: { type: "scalar" } },
    });

    session.manipulate(unboundId, "missing", 2);
    expect(session.diffs.hasDiff(unboundId)).toBe(false);
    expect(session.commit(unboundId)).toBe(false);
    expect(unbound.style.getPropertyValue("--mw-missing")).toBe("");
  });

  it("commits CSS binding and declaring-rule metadata", async () => {
    session.manipulate(effectId, "radius", 160);
    expect(session.commit(effectId)).toBe(true);
    expect(session.commit(effectId)).toBe(false);
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/commit"))).toBe(
        true,
      ),
    );
    const request = requests.find((candidate) =>
      candidate.url.endsWith("/commit"),
    )!;
    const body = JSON.parse(String(request.init?.body));
    expect(body.changes[0]).toMatchObject({
      param: "radius",
      var: "--mw-radius",
      fromCss: "100px",
      toCss: "160px",
      rule: { selectorText: ".card", sourceFile: "src/motion.css" },
    });
    expect(
      requests.filter((candidate) => candidate.url.endsWith("/commit")),
    ).toHaveLength(1);
  });

  it("chains repeated applies from the latest queued value", async () => {
    session.manipulate(effectId, "radius", 160);
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(session.isCommitPending(effectId)).toBe(false),
    );

    pendingEntries = [
      {
        id: "entry-1",
        createdAt: 1,
        origin: "",
        page: "/",
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        changes: [
          {
            param: "radius",
            type: "spatial-radius",
            from: 100,
            to: 160,
            var: "--mw-radius",
            fromCss: "100px",
            toCss: "160px",
          },
        ],
        status: "pending",
      },
    ];
    await session.daemon.refresh();

    expect(session.hasCommitDelta(effectId)).toBe(false);
    expect(session.commit(effectId)).toBe(false);

    session.manipulate(effectId, "radius", 180);
    expect(session.hasCommitDelta(effectId)).toBe(true);
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(
        requests.filter((request) => request.url.endsWith("/commit")),
      ).toHaveLength(2),
    );

    const commitRequests = requests.filter((request) =>
      request.url.endsWith("/commit"),
    );
    const body = JSON.parse(String(commitRequests[1]!.init?.body));
    expect(body.changes[0]).toMatchObject({
      from: 160,
      to: 180,
      fromCss: "160px",
      toCss: "180px",
    });
  });

  it("does not chain from a legacy unverified agent success", async () => {
    pendingEntries = [
      {
        id: "legacy-agent-entry",
        createdAt: 1,
        origin: "",
        page: "/",
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        changes: [
          {
            param: "radius",
            type: "spatial-radius",
            from: 100,
            to: 160,
            var: "--mw-radius",
            fromCss: "100px",
            toCss: "160px",
          },
        ],
        status: "applied",
        appliedBy: "agent",
        appliedAt: 2,
      },
    ];
    await session.daemon.refresh();

    session.manipulate(effectId, "radius", 180);
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(
        requests.filter((request) => request.url.endsWith("/commit")),
      ).toHaveLength(1),
    );

    const request = requests.find((candidate) =>
      candidate.url.endsWith("/commit"),
    )!;
    const body = JSON.parse(String(request.init?.body));
    expect(body.changes[0]).toMatchObject({
      from: 100,
      to: 180,
      fromCss: "100px",
      toCss: "180px",
    });
  });

  it("preserves an uncommitted diff across deselect and reselect", () => {
    session.selectEffect(effectId, node);
    session.manipulate(effectId, "radius", 180);

    session.selectEffect(null);
    session.selectEffect(effectId, node);

    expect(session.diffs.getDiff(effectId)).toEqual({
      radius: { from: 100, to: 180 },
    });
    expect(session.hasCommitDelta(effectId)).toBe(true);
    expect(
      requests.filter((request) => request.url.endsWith("/commit")),
    ).toHaveLength(0);
  });

  it("dispatches replay as a custom event", () => {
    const listener = vi.fn();
    node.addEventListener("motionworks:replay", listener);
    session.sendReserved(effectId, "replay", 1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("commits a type correction without a value change", async () => {
    session.correctType(effectId, "radius", "scalar");
    expect(session.commit(effectId)).toBe(true);
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url.endsWith("/commit"))).toBe(
        true,
      ),
    );
    const body = JSON.parse(
      String(
        requests.find((candidate) => candidate.url.endsWith("/commit"))!.init
          ?.body,
      ),
    );
    expect(body.changes).toEqual([]);
    expect(body.typeCorrections).toHaveLength(1);
  });

  it("encodes a changed value with its corrected type", async () => {
    session.manipulate(effectId, "radius", 160);
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
    const body = JSON.parse(String(request.init?.body));
    expect(body.changes[0]).toMatchObject({
      param: "radius",
      type: "scalar",
      fromCss: "100px",
      toCss: "160px",
    });
  });

  it("maps pending, agent-working, and applied journal statuses", async () => {
    const base: JournalEntry = {
      id: "entry-1",
      createdAt: 1,
      origin: "",
      page: "/",
      effectId,
      effectName: "CardEntrance",
      elementSelector: ".card",
      changes: [],
      status: "pending",
    };
    for (const status of ["pending", "agent-working", "applied"] as const) {
      pendingEntries = [{ ...base, status }];
      await vi.waitFor(async () => {
        await session.daemon.refresh();
        expect(session.getEntryStatus(effectId)).toBe(status);
      });
      expect(session.isAgentWorking()).toBe(status === "agent-working");
      expect(session.isCommitPending(effectId)).toBe(status !== "applied");
    }
    pendingEntries = [];
    await vi.waitFor(async () => {
      await session.daemon.refresh();
      expect(session.getEntryStatus(effectId)).toBeNull();
    });
    expect(session.isCommitPending(effectId)).toBe(false);
  });

  it("reports actual queued changes rather than journal entry count", async () => {
    pendingEntries = [
      {
        id: "entry-many",
        createdAt: 1,
        origin: "",
        page: "/",
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        changes: [
          {
            param: "radius",
            type: "spatial-radius",
            from: 100,
            to: 140,
            var: "--mw-radius",
            fromCss: "100px",
            toCss: "140px",
          },
          {
            param: "duration",
            type: "duration",
            from: 200,
            to: 300,
            var: "--mw-duration",
            fromCss: "200ms",
            toCss: "300ms",
          },
        ],
        typeCorrections: [
          {
            effectName: "CardEntrance",
            paramKey: "radius",
            previousType: "scalar",
            correctedType: "spatial-radius",
            correctedAt: 1,
          },
        ],
        status: "pending",
        error: "Direct CSS write skipped",
      },
    ];
    await session.daemon.refresh();

    expect(session.getAgentQueue()).toEqual([
      expect.objectContaining({ id: "entry-many", changeCount: 3 }),
    ]);
    expect(session.buildAgentPrompt()).toContain("3 changes across 1 entry");
  });

  it("excludes pending entries the daemon has not yet decided on", async () => {
    pendingEntries = [
      {
        id: "entry-fresh",
        createdAt: 1,
        origin: "",
        page: "/",
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        changes: [
          {
            param: "radius",
            type: "spatial-radius",
            from: 100,
            to: 140,
            var: "--mw-radius",
            fromCss: "100px",
            toCss: "140px",
          },
        ],
        status: "pending",
      },
    ];
    await session.daemon.refresh();

    expect(session.getAgentQueue()).toEqual([]);
  });

  it("cache-busts a matching stylesheet when an entry becomes applied", async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/motion.css";
    document.head.appendChild(link);
    pendingEntries = [
      {
        id: "entry-applied",
        createdAt: 1,
        origin: "",
        page: "/",
        effectId,
        effectName: "CardEntrance",
        elementSelector: ".card",
        changes: [
          {
            param: "radius",
            type: "spatial-radius",
            from: 100,
            to: 160,
            var: "--mw-radius",
            fromCss: "100px",
            toCss: "160px",
          },
        ],
        status: "applied",
        files: ["src/motion.css"],
      },
    ];

    await session.daemon.refresh();
    expect(new URL(link.href).searchParams.has("mw")).toBe(true);
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const execCommand = vi.fn(() => {
      expect(document.querySelector("textarea")?.value).toBe(
        session.buildAgentPrompt(),
      );
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    await expect(session.copyAgentPrompt()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
