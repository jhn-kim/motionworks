import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  derivePort,
  loadConfig,
  parsePort,
  readConfigPort,
  writeConfigPort,
} from "./config.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionworks-config-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("uses defaults", async () => {
    expect(await loadConfig(root, {}, {})).toEqual({
      port: 52340,
      agent: "auto",
      agentTimeoutMs: 120000,
    });
  });
  it("applies file, environment, then override precedence", async () => {
    await writeFile(
      join(root, "motionworks.config.json"),
      JSON.stringify({ port: 4000, agent: "codex", agentTimeoutMs: 99 }),
    );
    expect(await loadConfig(root, {}, { MOTIONWORKS_PORT: "4001" })).toEqual({
      port: 4001,
      agent: "codex",
      agentTimeoutMs: 99,
    });
    expect(
      await loadConfig(
        root,
        { port: 4002, agent: "off" },
        { MOTIONWORKS_PORT: "4001" },
      ),
    ).toEqual({ port: 4002, agent: "off", agentTimeoutMs: 99 });
  });
  it("loads an optional token", async () => {
    await writeFile(
      join(root, "motionworks.config.json"),
      JSON.stringify({ token: "secret" }),
    );
    expect(await loadConfig(root, {}, {})).toMatchObject({ token: "secret" });
  });
  it("ignores invalid agent and timeout values from the config file", async () => {
    await writeFile(
      join(root, "motionworks.config.json"),
      JSON.stringify({ agent: "shell", agentTimeoutMs: -1 }),
    );
    expect(await loadConfig(root, {}, {})).toEqual({
      port: 52340,
      agent: "auto",
      agentTimeoutMs: 120000,
    });
  });
  it("parses valid ports and rejects invalid ones", () => {
    expect(parsePort("52340")).toBe(52340);
    expect(parsePort("bad")).toBeUndefined();
    expect(parsePort("65536")).toBeUndefined();
  });
});

describe("derivePort", () => {
  it("is deterministic per path and within the range", () => {
    const a = derivePort("/Users/x/projects/app-a");
    expect(a).toBe(derivePort("/Users/x/projects/app-a"));
    expect(a).toBeGreaterThanOrEqual(DEFAULT_PORT);
    expect(a).toBeLessThan(DEFAULT_PORT + 1000);
  });
  it("gives different folders different ports", () => {
    expect(derivePort("/Users/x/projects/app-a")).not.toBe(
      derivePort("/Users/x/projects/app-b"),
    );
  });
});

describe("readConfigPort / writeConfigPort", () => {
  it("returns undefined when no config file exists", async () => {
    expect(await readConfigPort(root)).toBeUndefined();
  });
  it("round-trips a pinned port", async () => {
    await writeConfigPort(root, 52351);
    expect(await readConfigPort(root)).toBe(52351);
  });
  it("merges into an existing config without dropping other fields", async () => {
    await writeFile(
      join(root, "motionworks.config.json"),
      JSON.stringify({ agent: "codex", token: "secret" }),
    );
    await writeConfigPort(root, 52352);
    const parsed = JSON.parse(
      await readFile(join(root, "motionworks.config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed).toEqual({ agent: "codex", token: "secret", port: 52352 });
  });
});
