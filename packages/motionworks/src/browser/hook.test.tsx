// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionWorksStateManager } from "../shared/state.js";
import { getBridge } from "./bridge.js";
import { useMotionWorks } from "./hook.js";

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
afterEach(() => getBridge().detach());
describe("useMotionWorks", () => {
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
});
