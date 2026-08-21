import { validateRegistration } from './validate.js';
import type {
  MotionWorksChangeset,
  MotionWorksEffect,
  MotionWorksRegistration,
  ParamDiff,
  SourceHint,
  TypeCorrection,
} from './types.js';

interface StoredEffect {
  effect: MotionWorksEffect;
  update?: (params: Record<string, unknown>) => void;
  // Current (possibly manipulated) values for each param.
  liveValues: Record<string, unknown>;
}

export interface MotionWorksStateSnapshot {
  effects: MotionWorksEffect[];
  selectedEffectId: string | null;
  changesets: MotionWorksChangeset[];
  typeCorrections: TypeCorrection[];
}

// Works in browsers and Node 19+. Node-only crypto imports would break
// the shared browser entry when this module is loaded from @motionworks/react.
function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export class MotionWorksStateManager {
  private readonly effects = new Map<string, StoredEffect>();
  private selectedEffectId: string | null = null;
  private changesets: MotionWorksChangeset[] = [];
  private typeCorrections: TypeCorrection[] = [];
  private readonly listeners = new Set<() => void>();

  // ── Subscription ─────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /** Register an effect from a local MotionWorksRegistration (includes update fn). */
  registerEffect(id: string, registration: MotionWorksRegistration): MotionWorksEffect {
    const result = validateRegistration(registration);

    const effect: MotionWorksEffect = {
      id,
      name: registration.name,
      params: result.params,
      readOnly: result.readOnly,
      ...(registration.sourceHints !== undefined && { sourceHints: registration.sourceHints }),
      ...(registration.capabilities !== undefined && { capabilities: registration.capabilities }),
    };

    const liveValues: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(result.params)) {
      liveValues[key] = param.value;
    }

    this.effects.set(id, {
      effect,
      update: result.readOnly ? undefined : registration.update,
      liveValues,
    });

    this.notify();
    return effect;
  }

  /** Register an effect received over the WebSocket (no update fn). */
  registerEffectFromWire(effect: MotionWorksEffect): void {
    const liveValues: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(effect.params)) {
      liveValues[key] = param.value;
    }
    this.effects.set(effect.id, { effect, liveValues });
    this.notify();
  }

  unregisterEffect(id: string): void {
    if (!this.effects.has(id)) return;
    this.effects.delete(id);
    if (this.selectedEffectId === id) this.selectedEffectId = null;
    this.notify();
  }

  // ── Selection ────────────────────────────────────────────────────────────

  selectEffect(id: string | null): void {
    if (id !== null && !this.effects.has(id)) return;
    this.selectedEffectId = id;
    this.notify();
  }

  // ── Live manipulation ─────────────────────────────────────────────────────

  applyParamChange(effectId: string, param: string, value: unknown): void {
    const stored = this.effects.get(effectId);
    if (!stored) return;
    stored.liveValues[param] = value;
    stored.update?.({ [param]: value });
    this.notify();
  }

  // ── Diff computation ──────────────────────────────────────────────────────

  /**
   * Computes which params have been manipulated since registration.
   * Returns null if the effect doesn't exist; returns {} if nothing changed.
   */
  computeUncommittedDiff(
    effectId: string,
  ): Record<string, { from: unknown; to: unknown }> | null {
    const stored = this.effects.get(effectId);
    if (!stored) return null;

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, param] of Object.entries(stored.effect.params)) {
      const live = stored.liveValues[key];
      if (live !== param.value) {
        diff[key] = { from: param.value, to: live };
      }
    }
    return diff;
  }

  // ── Commit queue ──────────────────────────────────────────────────────────

  commitEffect(
    effectId: string,
    elementSelector: string,
    diffs: ParamDiff[],
  ): MotionWorksChangeset | null {
    const stored = this.effects.get(effectId);
    if (!stored || diffs.length === 0) return null;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const diff of diffs) {
      changes[diff.param] = { from: diff.from, to: diff.to };
    }

    // Include only the source hints relevant to the changed params.
    let filteredHints: Record<string, SourceHint> | undefined;
    if (stored.effect.sourceHints !== undefined) {
      const hints: Record<string, SourceHint> = {};
      for (const diff of diffs) {
        const hint = stored.effect.sourceHints[diff.param];
        if (hint !== undefined) hints[diff.param] = hint;
      }
      if (Object.keys(hints).length > 0) filteredHints = hints;
    }

    const changeset: MotionWorksChangeset = {
      id: randomUUID(),
      timestamp: Date.now(),
      effectId,
      effectName: stored.effect.name,
      elementSelector,
      changes,
      ...(filteredHints !== undefined && { sourceHints: filteredHints }),
    };

    this.changesets.push(changeset);
    this.notify();
    return changeset;
  }

  /** Remove a single changeset from the queue by id; preserves order of the rest. */
  clearChangeset(id: string): boolean {
    const idx = this.changesets.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.changesets.splice(idx, 1);
    this.notify();
    return true;
  }

  // ── Type corrections ──────────────────────────────────────────────────────

  addTypeCorrection(correction: TypeCorrection): void {
    this.typeCorrections.push(correction);
    this.notify();
  }

  clearTypeCorrections(): void {
    this.typeCorrections = [];
    this.notify();
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  getEffect(id: string): MotionWorksEffect | undefined {
    return this.effects.get(id)?.effect;
  }

  getSelectedEffect(): MotionWorksEffect | null {
    if (this.selectedEffectId === null) return null;
    return this.effects.get(this.selectedEffectId)?.effect ?? null;
  }

  getAllEffects(): MotionWorksEffect[] {
    return Array.from(this.effects.values()).map((s) => s.effect);
  }

  getSnapshot(): MotionWorksStateSnapshot {
    return {
      effects: this.getAllEffects(),
      selectedEffectId: this.selectedEffectId,
      changesets: [...this.changesets],
      typeCorrections: [...this.typeCorrections],
    };
  }
}
