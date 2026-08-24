import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGsapAdoptionRequest,
  detectGsapCandidates,
  detectLibraries,
} from "./js-detect.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "gsap");
});

function stubGsap(tweens: unknown[]): void {
  (window as unknown as Record<string, unknown>)["gsap"] = {
    globalTimeline: { getChildren: () => tweens },
  };
}

describe("detectGsapCandidates", () => {
  it("returns [] when GSAP is absent", () => {
    expect(detectGsapCandidates()).toEqual([]);
  });

  it("maps GSAP tweens to candidates, converting seconds to ms and dedup'ing", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    stubGsap([
      {
        targets: () => [a],
        duration: () => 2,
        vars: { ease: "power1.inOut", delay: 0.5 },
      },
      { targets: () => [a, b], duration: () => 1, vars: {} }, // `a` already seen
    ]);

    const candidates = detectGsapCandidates();
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      library: "gsap",
      node: a,
      duration: 2000,
      delay: 500,
      ease: "power1.inOut",
    });
    expect(candidates[1]).toMatchObject({
      library: "gsap",
      node: b,
      duration: 1000,
    });
  });

  it("skips non-element targets and overlay nodes, and survives throwing tweens", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-motionworks-overlay", "");
    const real = document.createElement("div");
    document.body.append(overlay, real);
    stubGsap([
      { targets: () => ["#selector-string"], duration: () => 1, vars: {} },
      {
        targets: () => {
          throw new Error("detached");
        },
      },
      { targets: () => [overlay], duration: () => 1, vars: {} },
      { targets: () => [real], duration: () => 1, vars: {} },
    ]);
    const candidates = detectGsapCandidates();
    expect(candidates.map((c) => c.node)).toEqual([real]);
  });
});

describe("buildGsapAdoptionRequest", () => {
  it("maps a candidate to duration/delay params bound to --mw-* vars", () => {
    const node = document.createElement("div");
    node.className = "hero";
    document.body.append(node);
    const req = buildGsapAdoptionRequest(
      {
        library: "gsap",
        node,
        duration: 2000,
        delay: 500,
        ease: "power1.inOut",
      },
      "/",
    );
    expect(req.library).toBe("gsap");
    expect(req.elementSelector).toContain("hero");
    expect(req.params.map((p) => [p.key, p.var, p.value])).toEqual([
      ["duration", "--mw-duration", 2000],
      ["delay", "--mw-delay", 500],
    ]);
  });

  it("omits params GSAP didn't report", () => {
    const node = document.createElement("div");
    document.body.append(node);
    const req = buildGsapAdoptionRequest({ library: "gsap", node }, "/");
    expect(req.params).toEqual([]);
  });
});

describe("detectLibraries", () => {
  it("reports GSAP presence via its global timeline", () => {
    expect(detectLibraries().gsap).toBe(false);
    stubGsap([]);
    expect(detectLibraries().gsap).toBe(true);
  });
});
