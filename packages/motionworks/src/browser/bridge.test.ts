import { afterEach, describe, expect, it } from "vitest";

import { getBridge } from "./bridge.js";
import { MotionWorksStateManager } from "../shared/index.js";
import type { MotionWorksRegistration } from "../shared/index.js";

const registration: MotionWorksRegistration = {
  name: "Card",
  params: { radius: { type: "spatial-radius" } },
};

describe("Bridge", () => {
  const bridge = getBridge();
  afterEach(() => {
    // Leave no registrations behind between tests.
    for (const [id, list] of bridge.getAllNodes())
      for (const node of list) bridge.unregister(id, node as HTMLElement);
  });

  it("retargets the active node when a same-id sibling unmounts (P1-7)", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    bridge.register("card#1", a, registration);
    bridge.register("card#1", b, registration);
    // Select the first instance, then unmount it while the sibling survives.
    bridge.setActiveNode("card#1", a);
    expect(bridge.getNode("card#1")).toBe(a);
    bridge.unregister("card#1", a);
    a.remove();
    // getNode must now return the surviving sibling, never the detached node.
    expect(bridge.getNode("card#1")).toBe(b);
    b.remove();
  });

  it("re-reads the stylesheet baseline, not a live inline value, on rebind (P1-1)", () => {
    const state = new MotionWorksStateManager();
    bridge.attach(state);
    const style = document.createElement("style");
    style.textContent = ".rebind { --mw-radius: 100px; }";
    document.head.appendChild(style);
    const node = document.createElement("div");
    node.className = "rebind";
    document.body.appendChild(node);

    bridge.register("card#1", node, registration);
    expect(state.getAllEffects()[0]?.params.radius?.value).toBe(100);

    // Simulate a live drag: applyLive writes the manipulated value inline.
    node.style.setProperty("--mw-radius", "180px");

    // Re-register the same node (Fast Refresh / schema refresh). The baseline
    // must come back as the stylesheet's 100px, not the inline 180px.
    bridge.register("card#1", node, registration);
    expect(state.getAllEffects()[0]?.params.radius?.value).toBe(100);
    // And the live inline write was cleared during the rebind.
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");

    bridge.unregister("card#1", node);
    node.remove();
    style.remove();
    bridge.detach();
  });
});
