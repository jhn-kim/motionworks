import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAllowedOrigin, MotionWorksServer } from "./server.js";
import { MotionWorksStateManager } from "./state.js";

describe("isAllowedOrigin", () => {
  it("allows absent origins (non-browser clients)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("")).toBe(true);
  });

  it("allows loopback origins regardless of port or scheme", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:8080")).toBe(true);
  });

  it("rejects non-loopback and malformed origins", () => {
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.20:3000")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });
});

describe("MotionWorksServer connection policy", () => {
  let server: MotionWorksServer;
  let port: number;

  beforeEach(async () => {
    server = new MotionWorksServer(new MotionWorksStateManager(), 0);
    await server.start();
    port = server.address!.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  function tryConnect(origin?: string): Promise<"open" | "rejected"> {
    return new Promise((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${String(port)}`,
        origin === undefined ? {} : { origin },
      );
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("error", () => resolve("rejected"));
    });
  }

  it("accepts clients without an Origin header", async () => {
    await expect(tryConnect()).resolves.toBe("open");
  });

  it("accepts browser clients from localhost origins", async () => {
    await expect(tryConnect("http://localhost:5173")).resolves.toBe("open");
  });

  it("rejects browser clients from non-local origins", async () => {
    await expect(tryConnect("https://evil.example")).resolves.toBe("rejected");
  });
});
