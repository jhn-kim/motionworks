import { validateRegistration } from "./validate.js";
import type { MotionWorksEffect, MotionWorksRegistration } from "./types.js";

interface StoredEffect {
  effect: MotionWorksEffect;
  update?: (params: Record<string, unknown>) => void;
  // Current (possibly manipulated) values for each param.
  liveValues: Record<string, unknown>;
}

export interface MotionWorksStateSnapshot {
  effects: MotionWorksEffect[];
  selectedEffectId: string | null;
}

export class MotionWorksStateManager {
  private readonly effects = new Map<string, StoredEffect>();
  private selectedEffectId: string | null = null;
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
  registerEffect(
    id: string,
    registration: MotionWorksRegistration,
  ): MotionWorksEffect {
    const result = validateRegistration(registration);

    const effect: MotionWorksEffect = {
      id,
      name: registration.name,
      params: result.params,
      readOnly: result.readOnly,
      ...(registration.sourceHints !== undefined && {
        sourceHints: registration.sourceHints,
      }),
      ...(registration.capabilities !== undefined && {
        capabilities: registration.capabilities,
      }),
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

  /** Register an effect from its serialisable form (no update fn). */
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
    };
  }
}
