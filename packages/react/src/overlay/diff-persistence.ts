import type { DiffStoreData } from "./diff-store.js";

const KEY_PREFIX = "motionworks:diffs:";
const DEBOUNCE_MS = 100;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function keyFor(origin: string): string {
  return `${KEY_PREFIX}${origin}`;
}

// Uncommitted manipulations survive a page reload via localStorage, keyed by
// origin so two dev servers on different ports don't read each other's
// tweaks. localStorage can throw (private mode, quota, sandboxed iframes) —
// persistence is a convenience, never a failure.
export function loadPersistedDiffs(origin: string): DiffStoreData | null {
  try {
    const raw = localStorage.getItem(keyFor(origin));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as DiffStoreData;
  } catch {
    return null;
  }
}

export function persistDiffs(origin: string, data: DiffStoreData): void {
  const existing = timers.get(origin);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    origin,
    setTimeout(() => {
      timers.delete(origin);
      try {
        if (Object.keys(data.diffs).length === 0)
          localStorage.removeItem(keyFor(origin));
        else localStorage.setItem(keyFor(origin), JSON.stringify(data));
      } catch {
        // Ignore — see above.
      }
    }, DEBOUNCE_MS),
  );
}
