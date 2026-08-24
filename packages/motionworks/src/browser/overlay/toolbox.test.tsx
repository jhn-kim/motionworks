// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toolbox, type Tool } from "./toolbox.js";

function rect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

const tools: Tool[] = [
  {
    id: "logo",
    label: "Close MotionWorks",
    kind: "action",
    icon: <span />,
  },
];

describe("Toolbox sizing", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        // The icon row is 400px wide. Simulate a panel whose intrinsic width
        // would be much wider than the toolbar if it participated in sizing.
        if (this.style.width === "max-content") return rect(400, 34);
        if (this.style.position === "absolute") return rect(1000, 100);
        return rect(0, 0);
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("derives width from the icon row, never an expanded panel", () => {
    render(
      <Toolbox
        tools={tools}
        dock="bottom"
        onDockChange={() => undefined}
        panels={<div style={{ width: 1000 }}>Long copy prompt</div>}
      />,
    );

    // 400px icon row + 12px content padding + 2px shell border allowance.
    expect(screen.getByRole("toolbar").style.width).toBe("414px");
  });

  it("keeps the logo visible throughout the closing morph", () => {
    const logo = <span data-testid="logo-mark" />;
    render(
      <Toolbox
        tools={[{ ...tools[0]!, icon: logo }]}
        dock="bottom"
        onDockChange={() => undefined}
        closing
      />,
    );

    expect(
      document.querySelector("[data-motionworks-closing-logo]")?.textContent,
    ).toBe("");
    expect(screen.getAllByTestId("logo-mark")).toHaveLength(2);
  });

  it("animates compare as a coin flip and transient verbs as pulses", () => {
    render(
      <Toolbox
        tools={[
          ...tools,
          {
            id: "compare",
            label: "Compare",
            kind: "verb",
            icon: <span />,
          },
          {
            id: "garbage",
            label: "Discard",
            kind: "verb",
            icon: <span />,
          },
          {
            id: "apply",
            label: "Apply",
            kind: "verb",
            icon: <span />,
          },
          {
            id: "replay",
            label: "Play animation",
            kind: "verb",
            icon: <span />,
          },
          {
            id: "agent",
            label: "Copy prompt for agent",
            kind: "verb",
            icon: <span />,
          },
        ]}
        dock="bottom"
        onDockChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt for agent" }),
    );

    for (const name of [
      "Compare",
      "Discard",
      "Apply",
      "Play animation",
      "Copy prompt for agent",
    ]) {
      expect(
        screen
          .getByRole("button", { name })
          .querySelector(".ms-ico")
          ?.classList.contains("ms-ico-nudge"),
      ).toBe(true);
    }
    const animationCss = document.querySelector<HTMLStyleElement>(
      "style[data-motionworks-overlay-style]",
    )?.textContent;
    expect(animationCss).toContain("35% { transform: scale(0.92); }");
    expect(animationCss).toContain("70% { transform: scale(1.06); }");
  });

  it("paints transient click feedback before running the action", () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    render(
      <Toolbox
        tools={[
          ...tools,
          {
            id: "apply",
            label: "Apply",
            kind: "verb",
            icon: <span />,
            onClick: onApply,
          },
        ]}
        dock="bottom"
        onDockChange={() => undefined}
      />,
    );

    const apply = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(apply);

    expect(onApply).not.toHaveBeenCalled();
    expect(
      apply.querySelector(".ms-ico")?.classList.contains("ms-ico-nudge"),
    ).toBe(true);

    vi.advanceTimersByTime(155);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("drops the active background when Apply becomes inactive", () => {
    const apply: Tool = {
      id: "apply",
      label: "Apply",
      kind: "verb",
      icon: <span />,
      selected: true,
    };
    const view = render(
      <Toolbox
        tools={[...tools, apply]}
        dock="bottom"
        onDockChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Apply" }).style.background,
    ).not.toBe("transparent");

    view.rerender(
      <Toolbox
        tools={[...tools, { ...apply, disabled: true }]}
        dock="bottom"
        onDockChange={() => undefined}
      />,
    );

    const inactiveApply = screen.getByRole("button", { name: "Apply" });
    expect(inactiveApply.style.background).toBe("transparent");
    expect(inactiveApply.style.transition).not.toContain("background");
  });

  it("renders an inert verb dimmed, still hoverable, and unclickable", () => {
    const onClick = vi.fn();
    const inertPlay: Tool = {
      id: "replay",
      label: "Play animation",
      hint: "trigger it manually",
      kind: "verb",
      icon: <span />,
      inert: true,
      onClick,
    };
    render(
      <Toolbox
        tools={[...tools, inertPlay]}
        dock="bottom"
        onDockChange={() => undefined}
      />,
    );

    const button = screen.getByRole("button", { name: "Play animation" });
    // Not natively disabled — a disabled <button> stops emitting the hover
    // events the "trigger it manually" chip depends on.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.style.cursor).toBe("default");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
