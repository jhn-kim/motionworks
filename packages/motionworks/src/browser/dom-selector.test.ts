import { describe, expect, it, vi } from "vitest";

import {
  ensureStableId,
  findInteractiveNode,
  watchStableId,
} from "./dom-selector.js";

function build(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("findInteractiveNode", () => {
  it("returns the node itself when it is a button", () => {
    const host = build('<button id="b">Add</button>');
    const button = host.querySelector("button")!;
    expect(findInteractiveNode(button)).toBe(button);
  });

  it("walks up from a decorative child to the enclosing interactive element", () => {
    const host = build('<a href="#"><span id="underline">Tabletop</span></a>');
    const span = host.querySelector<HTMLElement>("#underline")!;
    expect(findInteractiveNode(span)).toBe(host.querySelector("a"));
  });

  it('matches role="button" elements', () => {
    const host = build('<div role="button"><span id="inner">Go</span></div>');
    const span = host.querySelector<HTMLElement>("#inner")!;
    expect(findInteractiveNode(span)).toBe(
      host.querySelector('[role="button"]'),
    );
  });

  it("returns null for nodes with no interactive ancestor", () => {
    const host = build('<div><span id="plain">Just text</span></div>');
    expect(
      findInteractiveNode(host.querySelector<HTMLElement>("#plain")!),
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(findInteractiveNode(null)).toBeNull();
  });

  it("ignores anchors without href", () => {
    const host = build('<a><span id="s">Not a link</span></a>');
    expect(
      findInteractiveNode(host.querySelector<HTMLElement>("#s")!),
    ).toBeNull();
  });
});

describe("ensureStableId", () => {
  it("is idempotent and stable for the same element across calls", () => {
    const host = build('<div class="row"><span class="dot"></span></div>');
    const dot = host.querySelector<HTMLElement>(".dot")!;
    const id = ensureStableId(dot);
    expect(id).toMatch(/^mw-/);
    expect(dot.dataset.mwId).toBe(id);
    expect(ensureStableId(dot)).toBe(id);
  });

  it("gives class-sharing siblings distinct ids (the loader dots)", () => {
    const host = build(
      '<div class="row"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>',
    );
    const ids = Array.from(host.querySelectorAll<HTMLElement>(".dot")).map(
      ensureStableId,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("respects an id a build-time plugin already stamped", () => {
    const host = build('<span data-mw-id="from-build"></span>');
    const node = host.querySelector<HTMLElement>("span")!;
    expect(ensureStableId(node)).toBe("from-build");
  });
});

describe("watchStableId", () => {
  it("re-applies the id when a reload strips the attribute", async () => {
    const host = build('<span class="dot"></span>');
    const node = host.querySelector<HTMLElement>("span")!;
    const stop = watchStableId(node);
    const id = node.dataset.mwId;
    expect(id).toBeDefined();
    node.removeAttribute("data-mw-id");
    await vi.waitFor(() => expect(node.dataset.mwId).toBe(id));
    stop();
  });
});
