import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { flagValue, serveDir } from "./cli-args.js";

describe("flagValue", () => {
  it("reads inline and space forms", () => {
    expect(flagValue(["--port=5000"], "--port")).toBe("5000");
    expect(flagValue(["--port", "5000"], "--port")).toBe("5000");
    expect(flagValue([], "--port")).toBeUndefined();
  });
  it("does not swallow a following flag as the value (P2-12c)", () => {
    // `--agent --no-agent` must leave --agent value-less rather than reading
    // "--no-agent" as the agent name.
    expect(flagValue(["--agent", "--no-agent"], "--agent")).toBeUndefined();
    expect(flagValue(["--agent", "claude"], "--agent")).toBe("claude");
  });
});

describe("serveDir", () => {
  it("returns the first positional, skipping value flags (P2-12b)", () => {
    expect(serveDir(["serve", "--port", "5000"])).toBe(resolve("."));
    expect(serveDir(["serve", "--port", "5000", "./dist"])).toBe(
      resolve("./dist"),
    );
    expect(serveDir(["serve", "public"])).toBe(resolve("public"));
    expect(serveDir(["serve"])).toBe(resolve("."));
    expect(serveDir(["serve", "--port=5000", "build"])).toBe(resolve("build"));
  });
});
