// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getBridge } from "../bridge.js";
import { OverlaySessionContext } from "./context.js";
import {
  AgentReviewQuip,
  DynamicToolbox,
  resolveVerbAvailability,
} from "./renderer.js";
import { OverlaySession } from "./session.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentReviewQuip", () => {
  it("renders the transient copy-feedback message", () => {
    render(<AgentReviewQuip text="Prompt copied" />);
    expect(screen.getByText("Prompt copied")).toBeTruthy();
  });
});

describe("editing verb availability", () => {
  it("hides all decision verbs when the current diff is already queued", () => {
    expect(
      resolveVerbAvailability({
        hasSelection: true,
        hasDiff: true,
        hasPendingCorrections: false,
        hasCommitDelta: false,
        editing: false,
        appliedMarker: false,
        committedDiff: false,
        pendingApply: true,
        entryApplied: false,
      }),
    ).toEqual({ visible: false, localLive: false, applyLive: false });
  });

  it("ghosts decision verbs while a tool panel is open on a queued diff", () => {
    expect(
      resolveVerbAvailability({
        hasSelection: true,
        hasDiff: true,
        hasPendingCorrections: false,
        hasCommitDelta: false,
        editing: true,
        appliedMarker: false,
        committedDiff: false,
        pendingApply: true,
        entryApplied: false,
      }),
    ).toEqual({ visible: true, localLive: false, applyLive: false });
  });

  it("reactivates all decision verbs for a new revision of a queued change", () => {
    expect(
      resolveVerbAvailability({
        hasSelection: true,
        hasDiff: true,
        hasPendingCorrections: false,
        hasCommitDelta: true,
        editing: false,
        appliedMarker: false,
        committedDiff: false,
        pendingApply: true,
        entryApplied: false,
      }),
    ).toEqual({ visible: true, localLive: true, applyLive: true });
  });

  it("keeps discard and apply live across editor and selection changes", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
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
        if (url.endsWith("/pending")) return new Response(JSON.stringify([]));
        if (url.endsWith("/select")) return new Response(JSON.stringify({}));
        return new Response(JSON.stringify({ id: "unexpected-commit" }), {
          status: 201,
        });
      }),
    );

    document.head.innerHTML =
      "<style>.card{--mw-gradient:#665cff 0%,#00e5ff 100%}.child{--mw-duration:1000ms}</style>";
    const node = document.createElement("div");
    node.className = "card";
    const child = document.createElement("div");
    child.className = "child";
    node.appendChild(child);
    document.body.appendChild(node);
    const effectId = "card#1";
    const childEffectId = "child#1";
    const session = new OverlaySession({
      daemonUrl: "http://127.0.0.1:59999",
    });
    session.start();
    getBridge().register(effectId, node, {
      name: "Card",
      params: {
        gradient: { type: "gradient", var: "--mw-gradient" },
      },
    });
    getBridge().register(childEffectId, child, {
      name: "Child",
      params: {
        duration: { type: "duration", var: "--mw-duration" },
      },
    });
    const effect = session.state.getEffect(effectId)!;

    const view = render(
      <div data-motionworks-overlay="">
        <OverlaySessionContext.Provider value={session}>
          <DynamicToolbox
            selectedEffect={effect}
            dock="bottom"
            onDockChange={() => undefined}
            onClose={() => undefined}
          />
        </OverlaySessionContext.Provider>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Time/ }));
    fireEvent.input(screen.getByRole("slider", { name: "Duration slider" }), {
      target: { value: "8" },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Discard changes",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Style/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gradient" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Discard changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    view.rerender(
      <div data-motionworks-overlay="">
        <OverlaySessionContext.Provider value={session}>
          <DynamicToolbox
            selectedEffect={null}
            dock="bottom"
            onDockChange={() => undefined}
            onClose={() => undefined}
          />
        </OverlaySessionContext.Provider>
      </div>,
    );
    view.rerender(
      <div data-motionworks-overlay="">
        <OverlaySessionContext.Provider value={session}>
          <DynamicToolbox
            selectedEffect={effect}
            dock="bottom"
            onDockChange={() => undefined}
            onClose={() => undefined}
          />
        </OverlaySessionContext.Provider>
      </div>,
    );

    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Discard changes",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(session.diffs.hasDiff(effectId)).toBe(false);
    expect(session.diffs.hasDiff(childEffectId)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([input, init]) =>
              String(input).endsWith("/commit") && init?.method === "POST",
          ),
      ).toHaveLength(1),
    );
    const commitCall = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => String(input).endsWith("/commit"));
    expect(JSON.parse(String(commitCall?.[1]?.body))).toMatchObject({
      effectId: childEffectId,
      changes: [expect.objectContaining({ param: "duration" })],
    });

    getBridge().unregister(childEffectId, child);
    getBridge().unregister(effectId, node);
    session.stop();
    node.remove();
  });
});
