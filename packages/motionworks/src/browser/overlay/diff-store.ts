import { deepEqual } from "../deep-equal.js";

export interface Diff {
  from: unknown;
  to: unknown;
}

type ReconcileStatus = "clean" | "preserved" | "unexpected";

// Per-param outcome of reconciliation against a fresh registration baseline.
// See SOURCE_SYNC.md: the three-way matrix (baseline == to → clean;
// baseline == from → preserved + warn; anything else → unexpected).
interface ReconcileParamResult {
  status: ReconcileStatus;
  from: unknown;
  to: unknown;
  newBaseline: unknown;
}

export interface ReconcileResult {
  effectId: string;
  params: Record<string, ReconcileParamResult>;
}

// Serialisable form for localStorage persistence (see diff-persistence.ts).
// Unexpected flags are deliberately not persisted: they are recomputed by
// the first reconciliation after hydration.
export interface DiffStoreData {
  diffs: Record<string, Record<string, Diff>>;
  // The last revision of each retained diff that already crossed the Apply
  // boundary. It remains separate from `diffs`: the latter is still needed to
  // keep the chosen value live until source catches up, while `submitted`
  // prevents that committed value from masquerading as a new local decision.
  submitted?: Record<string, Record<string, unknown>>;
}

// Stable empty set for the "no flags" branch — a fresh Set per call would
// break useSyncExternalStore's snapshot equality.
const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

// Tracks uncommitted manipulations separately from the core state manager so
// the designer's intent (from → to) survives HMR and page reloads.
export class DiffStore {
  private diffs = new Map<string, Map<string, Diff>>();
  private submitted = new Map<string, Map<string, unknown>>();
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
  recordChange(
    effectId: string,
    param: string,
    baseline: unknown,
    value: unknown,
  ): void {
    let paramMap = this.diffs.get(effectId);
    const existing = paramMap?.get(param);
    if (existing !== undefined) {
      if (deepEqual(existing.to, value)) return;
      // Once a revision was submitted, its chosen value—not the stylesheet's
      // still-stale baseline—is the start of the next editable revision. Going
      // back to the source value is therefore a real new change, while going
      // back to the submitted value merely cancels the follow-up edit.
      const hasSubmitted = this.submitted.get(effectId)?.has(param) === true;
      if (!hasSubmitted && deepEqual(existing.from, value)) {
        this.clearParam(effectId, param);
        return;
      }
      paramMap ??= new Map();
      paramMap.set(param, { from: existing.from, to: value });
    } else {
      if (deepEqual(baseline, value)) return;
      if (paramMap === undefined) {
        paramMap = new Map();
        this.diffs.set(effectId, paramMap);
      }
      paramMap.set(param, { from: baseline, to: value });
    }
    this.notify();
  }

  clearParam(effectId: string, param: string): boolean {
    const paramMap = this.diffs.get(effectId);
    if (paramMap === undefined) return false;
    const removed = paramMap.delete(param);
    if (paramMap.size === 0) this.diffs.delete(effectId);
    const submitted = this.submitted.get(effectId);
    if (submitted !== undefined) {
      submitted.delete(param);
      if (submitted.size === 0) this.submitted.delete(effectId);
    }
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
    const hadSubmitted = this.submitted.delete(effectId);
    const hadFlags = this.unexpectedFlags.delete(effectId);
    if (hadDiff || hadSubmitted || hadFlags) this.notify();
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

  // Returns only the revision the designer has not applied yet. A retained
  // diff may contain a journaled value solely so live preview and source
  // reconciliation survive HMR; that committed portion is deliberately hidden
  // from Apply / Discard / Compare.
  getUnsubmittedDiff(effectId: string): Record<string, Diff> {
    const paramMap = this.diffs.get(effectId);
    if (paramMap === undefined) return {};
    const submitted = this.submitted.get(effectId);
    const out: Record<string, Diff> = {};
    for (const [param, diff] of paramMap) {
      if (submitted?.has(param) !== true) {
        out[param] = diff;
        continue;
      }
      const from = submitted.get(param);
      if (!deepEqual(from, diff.to)) out[param] = { from, to: diff.to };
    }
    return out;
  }

  hasUnsubmittedDiff(effectId: string): boolean {
    return Object.keys(this.getUnsubmittedDiff(effectId)).length > 0;
  }

  hasSubmittedValue(effectId: string, param: string): boolean {
    return this.submitted.get(effectId)?.has(param) === true;
  }

  getSubmittedValue(effectId: string, param: string): unknown {
    return this.submitted.get(effectId)?.get(param);
  }

  // Advances the Apply boundary to the supplied revision. The current live
  // diff may already contain a newer edit made while the request was in flight;
  // in that case the submitted `to` becomes the new revision's `from`.
  markSubmitted(effectId: string, revision: Record<string, Diff>): boolean {
    const current = this.diffs.get(effectId);
    if (current === undefined) return false;
    let submitted = this.submitted.get(effectId);
    let changed = false;
    for (const [param, diff] of Object.entries(revision)) {
      if (!current.has(param)) continue;
      if (submitted === undefined) {
        submitted = new Map();
        this.submitted.set(effectId, submitted);
      }
      if (submitted.has(param) && deepEqual(submitted.get(param), diff.to))
        continue;
      submitted.set(param, diff.to);
      changed = true;
    }
    if (changed) this.notify();
    return changed;
  }

  getFlags(effectId: string): ReadonlySet<string> {
    return this.unexpectedFlags.get(effectId) ?? EMPTY_STRING_SET;
  }

  toJSON(): DiffStoreData {
    const diffs: DiffStoreData["diffs"] = {};
    for (const [effectId, paramMap] of this.diffs.entries()) {
      if (paramMap.size > 0) diffs[effectId] = Object.fromEntries(paramMap);
    }
    const submitted: NonNullable<DiffStoreData["submitted"]> = {};
    for (const [effectId, paramMap] of this.submitted.entries()) {
      if (paramMap.size > 0) submitted[effectId] = Object.fromEntries(paramMap);
    }
    return {
      diffs,
      ...(Object.keys(submitted).length > 0 && { submitted }),
    };
  }

  // Replace the store's contents with a persisted snapshot. Malformed input
  // (a hand-edited or stale localStorage value) is ignored rather than
  // thrown — the worst case is a lost uncommitted tweak.
  hydrate(data: DiffStoreData | null | undefined): void {
    if (
      data === null ||
      data === undefined ||
      typeof data.diffs !== "object" ||
      data.diffs === null
    )
      return;
    const next = new Map<string, Map<string, Diff>>();
    for (const [effectId, params] of Object.entries(data.diffs)) {
      if (typeof params !== "object" || params === null) continue;
      const paramMap = new Map<string, Diff>();
      for (const [param, diff] of Object.entries(params)) {
        if (
          typeof diff !== "object" ||
          diff === null ||
          !("from" in diff) ||
          !("to" in diff)
        )
          continue;
        paramMap.set(param, { from: diff.from, to: diff.to });
      }
      if (paramMap.size > 0) next.set(effectId, paramMap);
    }
    this.diffs = next;
    const nextSubmitted = new Map<string, Map<string, unknown>>();
    if (typeof data.submitted === "object" && data.submitted !== null) {
      for (const [effectId, params] of Object.entries(data.submitted)) {
        if (typeof params !== "object" || params === null) continue;
        const current = next.get(effectId);
        if (current === undefined) continue;
        const paramMap = new Map<string, unknown>();
        for (const [param, value] of Object.entries(params)) {
          if (current.has(param)) paramMap.set(param, value);
        }
        if (paramMap.size > 0) nextSubmitted.set(effectId, paramMap);
      }
    }
    this.submitted = nextSubmitted;
    this.unexpectedFlags.clear();
    this.notify();
  }

  // Applies the SOURCE_SYNC matrix per param and mutates the store to match:
  //   • clean      → param's diff cleared (agent write landed)
  //   • preserved  → param's diff kept intact (write didn't take)
  //   • unexpected → diff kept; a warning flag is recorded so the panel can
  //                   surface it separately (rare — usually a partial write
  //                   or an unrelated edit hitting the same file)
  reconcile(
    effectId: string,
    newBaselines: Record<string, unknown>,
  ): ReconcileResult {
    const paramMap = this.diffs.get(effectId);
    const result: ReconcileResult = { effectId, params: {} };
    if (paramMap === undefined) return result;

    let changed = false;
    let flagsForEffect = this.unexpectedFlags.get(effectId);
    const submittedForEffect = this.submitted.get(effectId);

    for (const [param, diff] of Array.from(paramMap.entries())) {
      if (!Object.prototype.hasOwnProperty.call(newBaselines, param)) continue;
      const newBaseline = newBaselines[param];
      if (deepEqual(newBaseline, diff.to)) {
        paramMap.delete(param);
        submittedForEffect?.delete(param);
        if (flagsForEffect !== undefined) flagsForEffect.delete(param);
        changed = true;
        result.params[param] = {
          status: "clean",
          from: diff.from,
          to: diff.to,
          newBaseline,
        };
      } else if (
        submittedForEffect?.has(param) === true &&
        deepEqual(newBaseline, submittedForEffect.get(param))
      ) {
        // Source caught up to the applied revision while the designer already
        // has a newer local revision. Advance the retained baseline and keep
        // only that newer edit active.
        const submittedValue = submittedForEffect.get(param);
        paramMap.set(param, { from: submittedValue, to: diff.to });
        submittedForEffect.delete(param);
        if (flagsForEffect !== undefined) flagsForEffect.delete(param);
        changed = true;
        result.params[param] = {
          status: "preserved",
          from: submittedValue,
          to: diff.to,
          newBaseline,
        };
      } else if (deepEqual(newBaseline, diff.from)) {
        if (flagsForEffect !== undefined) flagsForEffect.delete(param);
        result.params[param] = {
          status: "preserved",
          from: diff.from,
          to: diff.to,
          newBaseline,
        };
      } else {
        if (flagsForEffect === undefined) {
          flagsForEffect = new Set();
          this.unexpectedFlags.set(effectId, flagsForEffect);
        }
        if (!flagsForEffect.has(param)) {
          flagsForEffect.add(param);
          changed = true;
        }
        result.params[param] = {
          status: "unexpected",
          from: diff.from,
          to: diff.to,
          newBaseline,
        };
      }
    }

    if (paramMap.size === 0) this.diffs.delete(effectId);
    if (submittedForEffect !== undefined && submittedForEffect.size === 0)
      this.submitted.delete(effectId);
    if (flagsForEffect !== undefined && flagsForEffect.size === 0) {
      this.unexpectedFlags.delete(effectId);
    }
    if (changed) this.notify();
    return result;
  }
}
