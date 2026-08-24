// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  applyLive,
  findDeclaringRule,
  readBaseline,
  retimeCurrentTime,
  restoreLive,
  watchStylesheets,
} from "./css-apply.js";
describe("CSS apply", () => {
  it("keeps the same animation phase when duration changes", () => {
    expect(
      retimeCurrentTime(
        750,
        { delay: 250, duration: 1000 },
        { delay: 250, duration: 2000 },
      ),
    ).toBe(1250);
    expect(
      retimeCurrentTime(
        100,
        { delay: 250, duration: 1000 },
        { delay: 250, duration: 2000 },
      ),
    ).toBe(100);
  });

  it("reads stylesheet, inline, and absent baselines; applies events and restores", () => {
    document.head.innerHTML = "<style>.card{--mw-radius:100px}</style>";
    const node = document.createElement("div");
    node.className = "card";
    document.body.append(node);
    const read = readBaseline(node, "radius", { type: "spatial-radius" });
    expect(read.value).toBe(100);
    const listener = vi.fn();
    node.addEventListener("motionworks:change", listener);
    applyLive(node, { type: "spatial-radius" }, read.binding, 120);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("120px");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { param: "radius", value: 120, css: "120px" },
      }),
    );
    restoreLive(node, read.binding);
    expect(node.style.getPropertyValue("--mw-radius")).toBe("");
    node.style.setProperty("--mw-radius", "80px");
    expect(readBaseline(node, "radius", { type: "spatial-radius" }).value).toBe(
      80,
    );
    expect(
      readBaseline(node, "missing", { type: "scalar" }).binding.bound,
    ).toBe(false);
    node.remove();
  });
  it("finds the last matching rule including :root and nested media", () => {
    document.head.innerHTML =
      '<style data-vite-dev-id="src/a.css">:root{--mw-radius:50px}.card{--mw-radius:80px}@media all{.card{--mw-radius:100px}}</style>';
    const node = document.createElement("div");
    node.className = "card";
    document.body.append(node);
    expect(findDeclaringRule(node, "--mw-radius")).toMatchObject({
      selectorText: ".card",
      sourceFile: "src/a.css",
      matchedCount: 1,
      scope: "single",
    });
    node.remove();
  });

  it("resolves the cascade winner by specificity, not document order", () => {
    // .card is declared first but is more specific than the later `div` rule;
    // the old last-rule-wins scan would have written the wrong (`div`) rule.
    document.head.innerHTML = "<style>.card{--mw-x:2}div{--mw-x:1}</style>";
    const node = document.createElement("div");
    node.className = "card";
    document.body.append(node);
    expect(findDeclaringRule(node, "--mw-x")).toMatchObject({
      selectorText: ".card",
      scope: "single",
    });
    node.remove();
  });

  it("flags a shared rule that governs several instances (staggered loader)", () => {
    document.head.innerHTML = "<style>.dot{--mw-delay:0.16s}</style>";
    const dots = [0, 1, 2].map(() => {
      const dot = document.createElement("span");
      dot.className = "dot";
      document.body.append(dot);
      return dot;
    });
    const resolved = findDeclaringRule(dots[1]!, "--mw-delay");
    expect(resolved).toMatchObject({
      selectorText: ".dot",
      matchedCount: 3,
      scope: "shared",
    });
    for (const dot of dots) dot.remove();
  });

  it("does not misattribute a container's non-inheriting rule to a child", () => {
    // animation-duration does not inherit: a rule that only matches the ancestor
    // is not the child's declaring rule. A custom property, which inherits, is.
    document.head.innerHTML =
      "<style>.wrap{animation-duration:1s;--mw-speed:1}</style>";
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const child = document.createElement("span");
    wrap.append(child);
    document.body.append(wrap);
    expect(findDeclaringRule(child, "animation-duration")).toBeUndefined();
    expect(findDeclaringRule(child, "--mw-speed")).toMatchObject({
      selectorText: ".wrap",
      scope: "single",
    });
    wrap.remove();
  });

  it("locates a pseudo-element rule by its originating element", () => {
    document.head.innerHTML =
      '<style data-vite-dev-id="src/b.css">.spin::after{animation-duration:1s}</style>';
    const node = document.createElement("div");
    node.className = "spin";
    document.body.append(node);
    // ::after is invalid in closest(); the base selector must still match the
    // host, and the full pseudo selector is reported for writeback.
    expect(findDeclaringRule(node, "animation-duration")).toMatchObject({
      selectorText: ".spin::after",
      sourceFile: "src/b.css",
    });
    node.remove();
  });

  it("refreshes only for stylesheet mutations, not overlay UI changes", async () => {
    const refresh = vi.fn();
    const stop = watchStylesheets(refresh);

    const hoverChip = document.createElement("div");
    hoverChip.setAttribute("data-motionworks-overlay", "");
    document.body.appendChild(hoverChip);
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();

    const drawerStyle = document.createElement("style");
    drawerStyle.setAttribute("data-motionworks-overlay-style", "");
    drawerStyle.textContent = ".ms-slider { color: white; }";
    hoverChip.appendChild(drawerStyle);
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();

    drawerStyle.remove();
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();

    const frameworkRoot = document.createElement("div");
    const nestedOverlay = document.createElement("div");
    nestedOverlay.setAttribute("data-motionworks-overlay", "");
    const nestedOverlayStyle = document.createElement("style");
    nestedOverlayStyle.setAttribute("data-motionworks-overlay-style", "");
    nestedOverlay.appendChild(nestedOverlayStyle);
    frameworkRoot.appendChild(nestedOverlay);
    document.body.appendChild(frameworkRoot);
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();

    const style = document.createElement("style");
    style.textContent = ".card { --mw-radius: 120px; }";
    document.head.appendChild(style);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    stop();
    hoverChip.remove();
    frameworkRoot.remove();
    style.remove();
  });
});
