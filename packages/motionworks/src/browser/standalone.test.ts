import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

afterEach(() => {
  document.body.replaceChildren();
  vi.resetModules();
});

describe("standalone", () => {
  it("mounts the overlay and exposes browser helpers globally", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const script = document.createElement("script");
    script.dataset.autoMount = "false";
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: script,
    });
    const standalone = await import("./standalone.js");
    let root: ReturnType<typeof standalone.mount> | undefined;
    await act(async () => {
      root = standalone.mount({ daemonUrl: "http://127.0.0.1:52340" });
    });
    expect(document.querySelector("[data-motionworks-root]")).not.toBeNull();
    const global = window as typeof window & {
      MotionWorks?: { DEFAULT_VAR_PREFIX?: unknown; readParams?: unknown };
    };
    expect(global.MotionWorks?.DEFAULT_VAR_PREFIX).toBe("--mw-");
    expect(global.MotionWorks?.readParams).toBeTypeOf("function");
    await act(async () => {
      root?.unmount();
    });
    delete (document as unknown as { currentScript?: HTMLScriptElement })
      .currentScript;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });
});
