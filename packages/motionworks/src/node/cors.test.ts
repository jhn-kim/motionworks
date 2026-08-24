import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isLoopbackHost } from "./cors.js";

describe("isAllowedOrigin", () => {
  it("allows absent origins", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("")).toBe(true);
  });
  it("allows loopback origins", () => {
    for (const value of [
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "https://localhost",
      "http://[::1]:8080",
    ])
      expect(isAllowedOrigin(value)).toBe(true);
  });
  it("rejects remote and malformed origins", () => {
    for (const value of [
      "https://evil.example",
      "http://localhost.evil.example",
      "http://192.168.1.20:3000",
      "not a url",
      "null",
    ])
      expect(isAllowedOrigin(value)).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("accepts loopback Host headers with or without a port", () => {
    for (const value of [
      "localhost",
      "localhost:3000",
      "127.0.0.1:52340",
      "[::1]:8080",
      "app.localhost:3000",
    ])
      expect(isLoopbackHost(value)).toBe(true);
  });
  it("rejects non-loopback or absent Host headers", () => {
    for (const value of [
      undefined,
      "",
      "attacker.example",
      "attacker.example:52340",
      "192.168.1.20:3000",
      "localhost.evil.example",
    ])
      expect(isLoopbackHost(value)).toBe(false);
  });
});
