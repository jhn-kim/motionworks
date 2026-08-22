import { describe, expect, it } from "vitest";

import { banner } from "./ui.js";

describe("terminal UI", () => {
  it("renders the approved init banner exactly", () => {
    expect(banner("0.5.0")).toBe(String.raw`
  __ _  ___  / /_(_)__  ___ _    _____  ____/ /__ ___
 /  ' \/ _ \/ __/ / _ \/ _ \ |/|/ / _ \/ __/  '_/(_-<
/_/_/_/\___/\__/_/\___/_//_/__,__/\___/_/ /_/\_\/___/

  v0.5.0
  Direct-manipulation motion design layer for AI coding agents
`);
  });
});
