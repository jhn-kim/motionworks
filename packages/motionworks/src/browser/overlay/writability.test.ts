// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { writeProvenance } from "./writability.js";

function mount(html: string, styles = ""): HTMLElement {
  if (styles !== "") document.head.innerHTML = `<style>${styles}</style>`;
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("writeProvenance", () => {
  it("classifies an inline-styled value (the stranded bounce-dot case)", () => {
    const host = mount(
      '<span class="dot" style="animation-delay:0.16s"></span>',
    );
    const dot = host.querySelector<HTMLElement>(".dot")!;
    expect(writeProvenance(dot, "animation-delay")).toEqual({ kind: "inline" });
  });

  it("classifies a single authored declaration", () => {
    const host = mount('<div class="card"></div>', ".card{--mw-x:1}");
    const card = host.querySelector<HTMLElement>(".card")!;
    const result = writeProvenance(card, "--mw-x");
    expect(result.kind).toBe("authored");
    if (result.kind === "authored") expect(result.rule.scope).toBe("single");
  });

  it("flags an authored declaration shared across instances as global", () => {
    const host = mount(
      '<span class="dot"></span><span class="dot"></span><span class="dot"></span>',
      ".dot{--mw-x:1}",
    );
    const second = host.querySelectorAll<HTMLElement>(".dot")[1]!;
    const result = writeProvenance(second, "--mw-x");
    expect(result.kind).toBe("authored");
    if (result.kind === "authored") {
      expect(result.rule.scope).toBe("shared");
      expect(result.rule.matchedCount).toBe(3);
    }
  });

  it("detects a Tailwind motion utility class", () => {
    const host = mount(
      '<div class="duration-700"></div>',
      ".duration-700{animation-duration:.7s}",
    );
    const node = host.querySelector<HTMLElement>(".duration-700")!;
    expect(writeProvenance(node, "animation-duration")).toEqual({
      kind: "tailwind",
      utility: "duration-700",
    });
  });

  it("returns none for a computed-only value with no writable home", () => {
    const host = mount('<div class="card"></div>', ".other{--mw-x:1}");
    const card = host.querySelector<HTMLElement>(".card")!;
    expect(writeProvenance(card, "--mw-x")).toEqual({ kind: "none" });
  });
});
