import { describe, expect, it, vi } from "vitest";

import { restingNodeRect } from "./hooks.js";

describe("restingNodeRect", () => {
  it("uses layout coordinates instead of the node's animated transform", () => {
    const parent = document.createElement("div");
    const node = document.createElement("div");
    parent.appendChild(node);
    document.body.appendChild(parent);

    Object.defineProperties(parent, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 200 },
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 3 },
      scrollLeft: { configurable: true, value: 10 },
      scrollTop: { configurable: true, value: 5 },
    });
    Object.defineProperties(node, {
      offsetParent: { configurable: true, value: parent },
      offsetLeft: { configurable: true, value: 80 },
      offsetTop: { configurable: true, value: 40 },
      offsetWidth: { configurable: true, value: 60 },
      offsetHeight: { configurable: true, value: 30 },
    });
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 200, 800, 400),
    );
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
      new DOMRect(900, 900, 120, 60),
    );

    const rect = restingNodeRect(node);
    expect(rect.left).toBe(244);
    expect(rect.top).toBe(276);
    expect(rect.width).toBe(120);
    expect(rect.height).toBe(60);

    parent.remove();
  });
});
