import { validateRegistration } from "./validate.js";
import type {
  MotionWorksEffect,
  MotionWorksRegistration,
  MotionWorksRuntimeParam,
} from "./types.js";

export interface MotionWorksStateSnapshot {
  effects: MotionWorksEffect[];
  selectedEffectId: string | null;
}

export class MotionWorksStateManager {
  private readonly effects = new Map<string, MotionWorksEffect>();
  private readonly liveValues = new Map<string, Record<string, unknown>>();
  private selectedEffectId: string | null = null;
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  registerEffect(
    id: string,
    registration: MotionWorksRegistration,
    baseline: Record<string, MotionWorksRuntimeParam>,
  ): MotionWorksEffect {
    const validated = validateRegistration(registration);
    const params = Object.fromEntries(
      Object.entries(validated.params).flatMap(([key, spec]) => {
        const runtime = baseline[key];
        return runtime === undefined
          ? []
          : [
              [
                key,
                {
                  ...spec,
                  value: runtime.value,
                  var: runtime.var,
                  cssUnit: runtime.cssUnit,
                  bound: runtime.bound,
                },
              ],
            ];
      }),
    );
    const effect: MotionWorksEffect = {
      id,
      name: registration.name,
      params,
      ...(registration.capabilities !== undefined && {
        capabilities: registration.capabilities,
      }),
    };
    this.effects.set(id, effect);
    this.liveValues.set(
      id,
      Object.fromEntries(
        Object.entries(params).map(([key, param]) => [key, param.value]),
      ),
    );
    this.notify();
    return effect;
  }
  registerEffectFromWire(effect: MotionWorksEffect): void {
    this.effects.set(effect.id, effect);
    this.notify();
  }
  unregisterEffect(id: string): void {
    if (!this.effects.delete(id)) return;
    this.liveValues.delete(id);
    if (this.selectedEffectId === id) this.selectedEffectId = null;
    this.notify();
  }
  selectEffect(id: string | null): void {
    if (id !== null && !this.effects.has(id)) return;
    this.selectedEffectId = id;
    this.notify();
  }
  applyParamChange(effectId: string, param: string, value: unknown): void {
    const values = this.liveValues.get(effectId);
    if (values === undefined) return;
    values[param] = value;
    this.notify();
  }
  getEffect(id: string): MotionWorksEffect | undefined {
    return this.effects.get(id);
  }
  getSelectedEffect(): MotionWorksEffect | null {
    return this.selectedEffectId === null
      ? null
      : (this.effects.get(this.selectedEffectId) ?? null);
  }
  getAllEffects(): MotionWorksEffect[] {
    return [...this.effects.values()];
  }
  getSnapshot(): MotionWorksStateSnapshot {
    return {
      effects: this.getAllEffects(),
      selectedEffectId: this.selectedEffectId,
    };
  }
}
