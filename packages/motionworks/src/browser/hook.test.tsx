// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { createRef, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionWorksStateManager } from "../shared/state.js";
import { getBridge } from "./bridge.js";
import { useMotionVar, useMotionWorks } from "./hook.js";

function VarFixture(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const duration = useMotionVar(ref, "--mw-duration", 0.6, { seconds: true });
  return (
    <div
      ref={ref}
      data-testid="dur"
      style={{ "--mw-duration": "600ms" } as React.CSSProperties}
    >
      {duration}
    </div>
  );
}

function Fixture(): React.JSX.Element {
  const ref = createRef<HTMLDivElement>();
  useMotionWorks(ref, {
    name: "Card",
    params: { radius: { type: "spatial-radius" } },
  });
  return (
    <div ref={ref} style={{ "--mw-radius": "100px" } as React.CSSProperties} />
  );
}
function NamedFixture({ name }: { name: string }): React.JSX.Element {
  const ref = createRef<HTMLDivElement>();
  useMotionWorks(ref, { name, params: { radius: { type: "spatial-radius" } } });
  return (
    <div ref={ref} style={{ "--mw-radius": "100px" } as React.CSSProperties} />
  );
}
function InvalidFixture(): React.JSX.Element {
  const ref = createRef<HTMLDivElement>();
  useMotionWorks(ref, {
    name: "Invalid",
    params: {
      radius: { type: "unknown" as never, var: "width", min: 4, max: 2 },
    },
  });
  return (
    <div ref={ref} style={{ "--mw-radius": "100" } as React.CSSProperties} />
  );
}
function ConditionalFixture({ show }: { show: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useMotionWorks(ref, {
    name: "Card",
    params: { radius: { type: "spatial-radius" } },
  });
  return show ? (
    <div ref={ref} style={{ "--mw-radius": "100px" } as React.CSSProperties} />
  ) : (
    <span />
  );
}
function BoundedFixture({ max }: { max: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useMotionWorks(ref, {
    name: "Card",
    params: { radius: { type: "spatial-radius", min: 0, max } },
  });
  return (
    <div ref={ref} style={{ "--mw-radius": "100px" } as React.CSSProperties} />
  );
}
afterEach(() => getBridge().detach());
describe("useMotionWorks", () => {
  it("registers a ref that was null at mount once its element attaches (P2-5)", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const view = render(<ConditionalFixture show={false} />);
    expect(state.getAllEffects()).toHaveLength(0);
    view.rerender(<ConditionalFixture show={true} />);
    expect(state.getAllEffects()[0]?.id).toBe("card#1");
    view.unmount();
  });

  it("re-registers when only a bound changes (fingerprint covers min/max) (P2-5)", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const view = render(<BoundedFixture max={200} />);
    expect(state.getAllEffects()[0]?.params.radius?.max).toBe(200);
    view.rerender(<BoundedFixture max={400} />);
    expect(state.getAllEffects()[0]?.params.radius?.max).toBe(400);
    view.unmount();
  });

  it("registers a CSS baseline and unregisters on unmount", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const view = render(<Fixture />);
    expect(state.getAllEffects()[0]?.params.radius?.value).toBe(100);
    view.unmount();
    expect(state.getAllEffects()).toHaveLength(0);
  });

  it("allocates a new slug id when the schema name changes", () => {
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const view = render(<NamedFixture name="Card" />);
    expect(state.getAllEffects()[0]?.id).toBe("card#1");
    view.rerender(<NamedFixture name="Hero" />);
    expect(state.getAllEffects().map((effect) => effect.id)).toEqual([
      "hero#1",
    ]);
    view.unmount();
  });

  it("binds and stores the validated schema rather than invalid runtime fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = new MotionWorksStateManager();
    getBridge().attach(state);
    const view = render(<InvalidFixture />);
    expect(state.getAllEffects()[0]?.params.radius).toMatchObject({
      type: "scalar",
      var: "--mw-radius",
      value: 100,
    });
    expect(state.getAllEffects()[0]?.params.radius).not.toHaveProperty("min");
    view.unmount();
    warn.mockRestore();
  });

  it("useMotionVar reads the var in seconds and re-renders on change", () => {
    const { getByTestId } = render(<VarFixture />);
    const el = getByTestId("dur");
    // 600ms → 0.6s (fallback and var agree, so behavior is unchanged at rest).
    expect(el.textContent).toBe("0.6");
    // A MotionWorks edit sets the inline var and dispatches the change event.
    el.style.setProperty("--mw-duration", "300ms");
    act(() => {
      el.dispatchEvent(
        new CustomEvent("motionworks:change", {
          bubbles: true,
          detail: { param: "duration", value: 300 },
        }),
      );
    });
    expect(el.textContent).toBe("0.3");
  });
});
