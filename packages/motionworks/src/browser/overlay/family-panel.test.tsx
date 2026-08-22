// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FamilySliderPanel } from "./family-panel.js";

const harness = vi.hoisted(() => ({
  manipulate: vi.fn(),
}));

vi.mock("./context.js", () => ({
  useOverlaySession: () => ({
    state: {
      getEffect: () => ({
        params: {
          radius: { value: 100 },
        },
      }),
    },
    diffs: {
      getDiff: () => ({}),
    },
    manipulate: harness.manipulate,
  }),
}));

function pointerEvent(type: string, pointerId: number, clientX: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
  });
  return event;
}

describe("FamilySliderPanel", () => {
  beforeEach(() => {
    harness.manipulate.mockClear();
  });

  afterEach(cleanup);

  it("tracks an explicitly captured pointer across the slider", () => {
    render(
      <FamilySliderPanel
        items={[
          {
            kind: "slider",
            tool: {
              effectId: "hero#1",
              paramKey: "radius",
              label: "Spatial radius",
              spec: { min: 0, max: 400, curve: "linear" },
              type: "spatial-radius",
            },
            icon: <span />,
            hint: "How far the effect reaches",
          },
        ]}
        onEditor={() => undefined}
      />,
    );

    const slider = screen.getByRole("slider", {
      name: "Spatial radius slider",
    });
    Object.defineProperties(slider, {
      getBoundingClientRect: {
        value: () => ({
          left: 100,
          right: 300,
          width: 200,
          top: 0,
          bottom: 18,
          height: 18,
        }),
      },
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent(slider, pointerEvent("pointerdown", 7, 100));
    fireEvent(slider, pointerEvent("pointermove", 7, 250));
    fireEvent(slider, pointerEvent("pointerup", 7, 250));

    expect(harness.manipulate).toHaveBeenLastCalledWith(
      "hero#1",
      "radius",
      300,
    );
  });

  it("keeps native input and keyboard changes working", () => {
    render(
      <FamilySliderPanel
        items={[
          {
            kind: "slider",
            tool: {
              effectId: "hero#1",
              paramKey: "radius",
              label: "Spatial radius",
              spec: { min: 0, max: 400, curve: "linear" },
              type: "spatial-radius",
            },
            icon: <span />,
            hint: "How far the effect reaches",
          },
        ]}
        onEditor={() => undefined}
      />,
    );

    const slider = screen.getByRole("slider", {
      name: "Spatial radius slider",
    });
    fireEvent.input(slider, { target: { value: "5" } });

    expect(harness.manipulate).toHaveBeenLastCalledWith(
      "hero#1",
      "radius",
      200,
    );
  });
});
