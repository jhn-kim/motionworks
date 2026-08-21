import { deepEqual } from '../deep-equal.js';

export interface Diff {
  from: unknown;
  to: unknown;
}

export type ReconcileStatus = 'clean' | 'preserved' | 'unexpected';

// Per-param outcome of reconciliation against a fresh registration baseline.
// See SOURCE_SYNC.md: the three-way matrix (baseline == to → clean;
// baseline == from → preserved + warn; anything else → unexpected).
export interface ReconcileParamResult {
  status: ReconcileStatus;
  from: unknown;
  to: unknown;
  newBaseline: unknown;
}

export interface ReconcileResult {
  effectId: string;
  params: Record<string, ReconcileParamResult>;
}

// Stable empty set for the "no flags" branch — a fresh Set per call would
// break useSyncExternalStore's snapshot equality.
const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

// Tracks uncommitted manipulations separately from the core state manager.
// The state manager wipes its liveValues on every re-registration, but the
// designer's intent (from → to) must survive HMR so we own that here.
export class DiffStore {
  private diffs = new Map<string, Map<string, Diff>>();
  private unexpectedFlags = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();
  // Monotonic counter so useSyncExternalStore consumers can subscribe with a
  // stable, primitive snapshot value that changes on every notify.
  private version = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // Record a live manipulation. First call for a param captures `from` as the
  // baseline at the moment the designer began manipulating; subsequent calls
  // only update `to` so intent is preserved even after dozens of pointer moves.
  recordChange(effectId: string, param: string, baseline: unknown, value: unknown): void {
    let paramMap = this.diffs.get(effectId);
    if (paramMap === undefined) {
      paramMap = new Map();
      this.diffs.set(effectId, paramMap);
    }
    const existing = paramMap.get(param);
    if (existing !== undefined) {
      if (deepEqual(existing.to, value)) return;
      paramMap.set(param, { from: existing.from, to: value });
    } else {
      if (deepEqual(baseline, value)) return;
      paramMap.set(param, { from: baseline, to: value });
    }
    this.notify();
  }

  clearParam(effectId: string, param: string): boolean {
    const paramMap = this.diffs.get(effectId);
    if (paramMap === undefined) return false;
    const removed = paramMap.delete(param);
    if (paramMap.size === 0) this.diffs.delete(effectId);
    const flags = this.unexpectedFlags.get(effectId);
    if (flags !== undefined) {
      flags.delete(param);
      if (flags.size === 0) this.unexpectedFlags.delete(effectId);
    }
    if (removed) this.notify();
    return removed;
  }

  clearEffect(effectId: string): boolean {
    const hadDiff = this.diffs.delete(effectId);
    const hadFlags = this.unexpectedFlags.delete(effectId);
    if (hadDiff || hadFlags) this.notify();
    return hadDiff;
  }

  getDiff(effectId: string): Record<string, Diff> {
    const paramMap = this.diffs.get(effectId);
    if (paramMap === undefined) return {};
    const out: Record<string, Diff> = {};
    for (const [k, v] of paramMap.entries()) out[k] = v;
    return out;
  }

  hasDiff(effectId: string): boolean {
    const paramMap = this.diffs.get(effectId);
    return paramMap !== undefined && paramMap.size > 0;
  }

  getFlags(effectId: string): ReadonlySet<string> {
    return this.unexpectedFlags.get(effectId) ?? EMPTY_STRING_SET;
  }

  // Applies the SOURCE_SYNC matrix per param and mutates the store to match:
  //   • clean      → param's diff cleared (agent write landed)
  //   • preserved  → param's diff kept intact (write didn't take)
  //   • unexpected → diff kept; a warning flag is recorded so the panel can
  //                   surface it separately (rare — usually a partial write
  //                   or an unrelated edit hitting the same file)
  reconcile(effectId: string, newBaselines: Record<string, unknown>): ReconcileResult {
    const paramMap = this.diffs.get(effectId);
    const result: ReconcileResult = { effectId, params: {} };
    if (paramMap === undefined) return result;

    let changed = false;
    let flagsForEffect = this.unexpectedFlags.get(effectId);

    for (const [param, diff] of Array.from(paramMap.entries())) {
      if (!Object.prototype.hasOwnProperty.call(newBaselines, param)) continue;
      const newBaseline = newBaselines[param];
      if (deepEqual(newBaseline, diff.to)) {
        paramMap.delete(param);
        if (flagsForEffect !== undefined) flagsForEffect.delete(param);
        changed = true;
        result.params[param] = { status: 'clean', from: diff.from, to: diff.to, newBaseline };
      } else if (deepEqual(newBaseline, diff.from)) {
        if (flagsForEffect !== undefined) flagsForEffect.delete(param);
        result.params[param] = { status: 'preserved', from: diff.from, to: diff.to, newBaseline };
      } else {
        if (flagsForEffect === undefined) {
          flagsForEffect = new Set();
          this.unexpectedFlags.set(effectId, flagsForEffect);
        }
        if (!flagsForEffect.has(param)) {
          flagsForEffect.add(param);
          changed = true;
        }
        result.params[param] = { status: 'unexpected', from: diff.from, to: diff.to, newBaseline };
      }
    }

    if (paramMap.size === 0) this.diffs.delete(effectId);
    if (flagsForEffect !== undefined && flagsForEffect.size === 0) {
      this.unexpectedFlags.delete(effectId);
    }
    if (changed) this.notify();
    return result;
  }
}
