import type { MotionWorksEffect, ParameterType } from '@motionworks/core';

// Tracks designer-chosen parameter type overrides. Lives on the overlay
// (like DiffStore) rather than in the core state manager because the
// registered `params[k].type` should stay in sync with source. When the
// agent writes the corrected type back to source, HMR re-registers and
// `reconcile` drops the override.
export class TypeOverrideStore {
  private overrides = new Map<string, Map<string, ParameterType>>();
  private listeners = new Set<() => void>();
  // Monotonic counter — useSyncExternalStore snapshot primitive.
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

  set(effectId: string, paramKey: string, type: ParameterType): void {
    let effectMap = this.overrides.get(effectId);
    if (effectMap === undefined) {
      effectMap = new Map();
      this.overrides.set(effectId, effectMap);
    }
    if (effectMap.get(paramKey) === type) return;
    effectMap.set(paramKey, type);
    this.notify();
  }

  get(effectId: string, paramKey: string): ParameterType | null {
    return this.overrides.get(effectId)?.get(paramKey) ?? null;
  }

  clearParam(effectId: string, paramKey: string): boolean {
    const effectMap = this.overrides.get(effectId);
    if (effectMap === undefined) return false;
    const removed = effectMap.delete(paramKey);
    if (effectMap.size === 0) this.overrides.delete(effectId);
    if (removed) this.notify();
    return removed;
  }

  // After re-registration, drop any override whose type matches what source
  // now declares — the agent wrote the correction, no reason to keep the
  // local override alive.
  reconcile(effect: MotionWorksEffect): void {
    const effectMap = this.overrides.get(effect.id);
    if (effectMap === undefined) return;
    let changed = false;
    for (const [paramKey, overrideType] of Array.from(effectMap.entries())) {
      const registered = effect.params[paramKey]?.type;
      if (registered === overrideType) {
        effectMap.delete(paramKey);
        changed = true;
      }
    }
    if (effectMap.size === 0) this.overrides.delete(effect.id);
    if (changed) this.notify();
  }
}
