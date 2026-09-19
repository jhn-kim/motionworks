// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getBridge } from "../bridge.js";
import { OverlaySessionContext } from "./context.js";
import { SelectionEngine } from "./selection.js";
import { OverlaySession } from "./session.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("SelectionEngine hover", () => {
  it("does not outline the parent while the pointer sits inside a drilled-into child", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}))),
    );
    const card = document.createElement("div");
    card.className = "card";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    card.appendChild(avatar);
    document.body.appendChild(card);
    const cardId = "card#1";
    const avatarId = "avatar#1";
    const session = new OverlaySession({ daemonUrl: "http://127.0.0.1:59999" });
    session.start();
    getBridge().register(cardId, card, {
      name: "Card",
      params: { duration: { type: "duration", var: "--mw-card" } },
    });
    getBridge().register(avatarId, avatar, {
      name: "Avatar",
      params: { duration: { type: "duration", var: "--mw-avatar" } },
    });
    // jsdom has no layout; emulate the hit-test stack deepest-first, the way
    // the browser returns it: avatar sits inside card.
    document.elementsFromPoint = () => [avatar, card, document.body];

    render(
      <OverlaySessionContext.Provider value={session}>
        <SelectionEngine active selectMode selectedEffectId={avatarId} />
      </OverlaySessionContext.Provider>,
    );

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 10,
          clientY: 10,
          bubbles: true,
        }),
      );
    });

    expect(screen.getByText("Avatar")).toBeTruthy();
    expect(screen.queryByText("Card")).toBeNull();

    getBridge().unregister(avatarId, avatar);
    getBridge().unregister(cardId, card);
  });

  it("still outlines a sibling effect the pointer moves onto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}))),
    );
    const card = document.createElement("div");
    const avatar = document.createElement("span");
    card.appendChild(avatar);
    const other = document.createElement("div");
    document.body.append(card, other);
    const session = new OverlaySession({ daemonUrl: "http://127.0.0.1:59999" });
    session.start();
    getBridge().register("card#1", card, {
      name: "Card",
      params: { duration: { type: "duration", var: "--mw-card" } },
    });
    getBridge().register("avatar#1", avatar, {
      name: "Avatar",
      params: { duration: { type: "duration", var: "--mw-avatar" } },
    });
    getBridge().register("other#1", other, {
      name: "Other",
      params: { duration: { type: "duration", var: "--mw-other" } },
    });
    document.elementsFromPoint = () => [other, document.body];

    render(
      <OverlaySessionContext.Provider value={session}>
        <SelectionEngine active selectMode selectedEffectId="avatar#1" />
      </OverlaySessionContext.Provider>,
    );

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("pointermove", {
          clientX: 500,
          clientY: 10,
          bubbles: true,
        }),
      );
    });

    expect(screen.getByText("Avatar")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();

    getBridge().unregister("other#1", other);
    getBridge().unregister("avatar#1", avatar);
    getBridge().unregister("card#1", card);
  });
});
