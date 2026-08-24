import type { DiffStoreData } from "./diff-store.js";

const KEY_PREFIX = "motionworks:diffs:";
const DEBOUNCE_MS = 100;

const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

function keyFor(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

// Uncommitted manipulations survive a page reload via localStorage, scoped by
// origin *and* pathname: effect ids are per-page, so a tweak to `card#1` on
// route A must not be re-applied to a different `card#1` on route B (P2-7).
// localStorage can throw (private mode, quota, sandboxed iframes) — persistence
// is a convenience, never a failure.
export function loadPersistedDiffs(scope: string): DiffStoreData | null {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DiffStoreData;
  } catch {
    return null;
  }
}

export function persistDiffs(scope: string, data: DiffStoreData): void {
  const existing = timers.get(scope);
  if (existing !== undefined) clearTimeout(existing.timer);
  const write = (): void => {
    timers.delete(scope);
    try {
      if (Object.keys(data.diffs).length === 0)
        localStorage.removeItem(keyFor(scope));
      else localStorage.setItem(keyFor(scope), JSON.stringify(data));
    } catch {
      // Ignore — see above.
    }
  };
  timers.set(scope, { timer: setTimeout(write, DEBOUNCE_MS), write });
}

/**
 * Writes any debounced diffs immediately. Called on `pagehide` so a tweak made
 * within the last 100 ms before navigation/close isn't lost with the timer
 * (P2-7).
 */
export function flushPersistedDiffs(): void {
  for (const { timer, write } of [...timers.values()]) {
    clearTimeout(timer);
    write();
  }
}
