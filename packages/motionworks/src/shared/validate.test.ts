import { describe, expect, it, vi } from "vitest";
import { validateRegistration } from "./validate.js";

describe("validateRegistration", () => {
  it("falls unknown types back to scalar and validates bounds", () => {
    const result = validateRegistration({
      name: "Card",
      params: { radius: { type: "unknown" as never, min: 4, max: 2 } },
    });
    expect(result.params.radius).toEqual({ type: "scalar" });
    expect(result.correctedTypes).toEqual(["radius"]);
  });

  it("keeps CSS custom properties and animation longhands", () => {
    expect(
      validateRegistration({
        name: "Card",
        params: {
          radius: { type: "spatial-radius", var: "--card-radius" },
          duration: { type: "duration", var: "animation-duration" },
        },
      }).params,
    ).toMatchObject({
      radius: { var: "--card-radius" },
      duration: { var: "animation-duration" },
    });
  });

  it("warns and drops an invalid var so the default is used", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = validateRegistration({
      name: "Card",
      params: { radius: { type: "spatial-radius", var: "width" } },
    });
    expect(result.params.radius?.var).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid var"));
    warn.mockRestore();
  });

  it("warns once for a legacy value/update registration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const legacy = {
      name: "Legacy",
      params: { radius: { type: "spatial-radius", value: 12 } },
      update: () => undefined,
    } as never;
    validateRegistration(legacy);
    validateRegistration(legacy);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "MotionWorks 0.5 reads values from CSS custom properties; see MOTIONWORKS.md",
    );
    warn.mockRestore();
  });

  it("sanitizes malformed fields received from untyped JavaScript", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = validateRegistration({
      name: "Card",
      params: {
        skipped: null,
        radius: {
          type: 42,
          var: 12,
          label: false,
          min: "low",
          max: Number.POSITIVE_INFINITY,
        },
      },
    } as never);
    expect(result.params).toEqual({ radius: { type: "scalar" } });
    expect(result.skippedParams).toEqual(["skipped"]);
    expect(result.correctedTypes).toEqual(["radius"]);
    warn.mockRestore();
  });
});
