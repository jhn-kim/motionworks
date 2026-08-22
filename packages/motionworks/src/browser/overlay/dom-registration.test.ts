import { afterEach, describe, expect, it, vi } from "vitest";

import { MotionWorksStateManager } from "../../shared/index.js";
import { getBridge } from "../bridge.js";
import {
  parseDomSchema,
  parseScriptSchemas,
  startDomRegistration,
} from "./dom-registration.js";

afterEach(() => {
  document.body.innerHTML = "";
  getBridge().detach();
});

describe("DOM registration", () => {
  it("parses element and script schemas", () => {
    document.body.innerHTML =
      '<div class="card" data-motionworks=\'{"name":"Card","params":{"radius":{"type":"spatial-radius"}}}\'></div><script type="application/motionworks+json">{".card":{"name":"Script","params":{}}}</script>';
    expect(parseDomSchema(document.querySelector(".card")!)).toMatchObject({
      name: "Card",
    });
    expect(parseScriptSchemas(document)).toHaveLength(1);
  });

  it("returns null for malformed JSON", () => {
    const el = document.createElement("div");
    el.setAttribute("data-motionworks", "{");
    expect(parseDomSchema(el)).toBeNull();
    el.setAttribute("data-motionworks", '{"name":"Card","params":null}');
    expect(parseDomSchema(el)).toBeNull();
  });

  it("keeps sibling ids stable when an earlier registration is removed", async () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    document.body.innerHTML = `
      <div id="first" data-motionworks='{"name":"Card","params":{"radius":{"type":"spatial-radius"}}}' style="--mw-radius:100px"></div>
      <div id="second" data-motionworks='{"name":"Card","params":{"radius":{"type":"spatial-radius"}}}' style="--mw-radius:100px"></div>
    `;
    const stop = startDomRegistration();
    expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
      "card#1",
      "card#2",
    ]);

    document.querySelector("#first")?.removeAttribute("data-motionworks");
    await vi.waitFor(() => {
      expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
        "card#2",
      ]);
    });
    stop();
  });

  it("re-registers schema edits and allocates a new slug for a renamed effect", async () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    document.body.innerHTML = `<div id="effect" data-motionworks='{"name":"Card","params":{"radius":{"type":"spatial-radius"}}}' style="--mw-radius:100px;--mw-strength:1"></div>`;
    const node = document.querySelector<HTMLElement>("#effect")!;
    const stop = startDomRegistration();
    expect(state.getAllEffects()[0]?.id).toBe("card#1");

    node.setAttribute(
      "data-motionworks",
      '{"name":"Hero","params":{"strength":{"type":"scalar"}}}',
    );
    await vi.waitFor(() => {
      expect(state.getAllEffects()).toMatchObject([
        {
          id: "hero#1",
          name: "Hero",
          params: { strength: { value: 1, bound: true } },
        },
      ]);
    });
    stop();
  });
});
