import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flushPersistedDiffs,
  loadPersistedDiffs,
  persistDiffs,
} from "./diff-persistence.js";
import type { DiffStoreData } from "./diff-store.js";

const data = (radius: number): DiffStoreData => ({
  diffs: { "card#1": { radius } as never },
});

describe("diff persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom in this project doesn't expose localStorage; back it with a Map.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("scopes diffs by origin+pathname so routes don't collide (P2-7)", () => {
    persistDiffs("http://localhost:3000/a", data(1));
    persistDiffs("http://localhost:3000/b", data(2));
    vi.runAllTimers();
    expect(loadPersistedDiffs("http://localhost:3000/a")).toEqual(data(1));
    expect(loadPersistedDiffs("http://localhost:3000/b")).toEqual(data(2));
    // A different route's key never leaks the other route's tweak.
    expect(loadPersistedDiffs("http://localhost:3000/c")).toBeNull();
  });

  it("flush writes the debounced diff immediately (P2-7)", () => {
    persistDiffs("http://localhost:3000/a", data(9));
    // Before the debounce elapses, nothing is written…
    expect(loadPersistedDiffs("http://localhost:3000/a")).toBeNull();
    // …until an explicit flush (as pagehide does).
    flushPersistedDiffs();
    expect(loadPersistedDiffs("http://localhost:3000/a")).toEqual(data(9));
  });
});
