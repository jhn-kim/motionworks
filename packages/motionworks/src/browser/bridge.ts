import {
  MotionWorksStateManager,
  validateRegistration,
  type MotionWorksRegistration,
  type MotionWorksRuntimeParam,
} from "../shared/index.js";
import {
  readBaseline,
  type CssBinding,
  type KeyframeBinding,
} from "./overlay/css-apply.js";

interface EffectInstance {
  node: HTMLElement;
  bindings: Record<string, CssBinding>;
  keyframe?: KeyframeBinding;
}

class Bridge {
  private state: MotionWorksStateManager | null = null;
  private instances = new Map<string, EffectInstance[]>();
  private registrations = new Map<string, MotionWorksRegistration>();
  private activeNodes = new Map<string, HTMLElement>();
  private nodeListeners = new Set<() => void>();
  attach(state: MotionWorksStateManager): void {
    this.state = state;
    for (const [id, list] of [...this.instances]) {
      const registration = this.registrations.get(id);
      if (registration === undefined) continue;
      for (const item of [...list])
        this.register(id, item.node, registration, item.keyframe);
    }
  }
  detach(): void {
    this.state = null;
    this.activeNodes.clear();
    this.notify();
  }
  register(
    id: string,
    node: HTMLElement | null,
    registration: MotionWorksRegistration,
    keyframe?: KeyframeBinding,
  ): void {
    if (node === null) return;
    const validated = validateRegistration(registration);
    if (!validated.nameValid) {
      console.warn(
        "[MotionWorks] Registration name must be a non-empty string.",
      );
      return;
    }
    const capabilities =
      typeof registration.capabilities === "object" &&
      registration.capabilities !== null
        ? {
            ...(registration.capabilities.replay === true && { replay: true }),
            ...(registration.capabilities.scrub === true && { scrub: true }),
          }
        : undefined;
    const effectiveRegistration: MotionWorksRegistration = {
      name: registration.name,
      params: validated.params,
      ...(capabilities !== undefined && { capabilities }),
    };
    // Rebind: this exact node is already registered, so it may be carrying
    // live inline values that `applyLive` wrote. Undo them (restoring the true
    // original inline captured at first registration) BEFORE re-reading the
    // baseline, or `getComputedStyle` would decode the manipulated value as the
    // source baseline — reconcile would then drop the diff as "clean" and ack a
    // pending entry that was never written (P1-1). auto-detect already guarded
    // its keyframe path; this covers the React-hook and DOM-registration paths.
    const priorInstance = this.instances
      .get(id)
      ?.find((item) => item.node === node);
    if (priorInstance !== undefined)
      for (const binding of Object.values(priorInstance.bindings)) {
        if (!binding.var.startsWith("--")) continue;
        if (binding.inlineBefore === "") node.style.removeProperty(binding.var);
        else node.style.setProperty(binding.var, binding.inlineBefore);
      }

    const bindings: Record<string, CssBinding> = {};
    const baseline: Record<string, MotionWorksRuntimeParam> = {};
    for (const [key, spec] of Object.entries(effectiveRegistration.params)) {
      const read = readBaseline(node, key, spec, keyframe);
      bindings[key] = read.binding;
      baseline[key] = {
        ...spec,
        value: read.value,
        var: read.binding.var,
        cssUnit: read.binding.unit,
        bound: read.binding.bound,
      };
    }
    const list = this.instances.get(id) ?? [];
    const existing = list.findIndex((item) => item.node === node);
    if (existing >= 0) list.splice(existing, 1);
    list.push({ node, bindings, ...(keyframe !== undefined && { keyframe }) });
    this.instances.set(id, list);
    this.registrations.set(id, effectiveRegistration);
    this.state?.registerEffect(id, effectiveRegistration, baseline);
    this.notify();
  }
  unregister(id: string, node: HTMLElement | null = null): void {
    const list = this.instances.get(id);
    if (list !== undefined) {
      const index = list.findIndex((item) => item.node === node);
      if (index >= 0) list.splice(index, 1);
      if (list.length > 0) {
        // A same-id sibling unmounted but others remain. If the just-removed
        // node was the active one, retarget to a surviving sibling so getNode
        // never hands back a detached node for replay/commit/select (P1-7).
        if (node !== null && this.activeNodes.get(id) === node)
          this.activeNodes.set(id, list[0]!.node);
        this.notify();
        return;
      }
    }
    this.instances.delete(id);
    this.registrations.delete(id);
    this.activeNodes.delete(id);
    this.state?.unregisterEffect(id);
    this.notify();
  }
  refresh(): void {
    if (this.state === null) return;
    for (const [id, list] of [...this.instances]) {
      const registration = this.registrations.get(id);
      if (registration === undefined) continue;
      for (const item of [...list])
        this.register(id, item.node, registration, item.keyframe);
    }
  }
  getState(): MotionWorksStateManager | null {
    return this.state;
  }
  getNode(id: string): HTMLElement | undefined {
    return this.activeNodes.get(id) ?? this.instances.get(id)?.[0]?.node;
  }
  getInstance(id: string, node: HTMLElement): EffectInstance | undefined {
    return this.instances.get(id)?.find((item) => item.node === node);
  }
  getInstances(id: string): readonly EffectInstance[] {
    return this.instances.get(id) ?? [];
  }
  getInstancesBySlug(
    slug: string,
  ): ReadonlyArray<EffectInstance & { id: string }> {
    return [...this.instances].flatMap(([id, list]) =>
      id.startsWith(`${slug}#`) ? list.map((item) => ({ ...item, id })) : [],
    );
  }
  setActiveNode(id: string, node: HTMLElement): void {
    if (!this.instances.get(id)?.some((item) => item.node === node)) return;
    this.activeNodes.set(id, node);
    this.notify();
  }
  getAllNodes(): ReadonlyMap<string, readonly HTMLElement[]> {
    return new Map(
      [...this.instances].map(([id, list]) => [
        id,
        list.map((item) => item.node),
      ]),
    );
  }
  hasExplicitOwner(node: HTMLElement): boolean {
    for (const instances of this.instances.values()) {
      for (const instance of instances) {
        if (
          instance.keyframe === undefined &&
          (instance.node === node || instance.node.contains(node))
        )
          return true;
      }
    }
    return false;
  }
  subscribeToNodes(listener: () => void): () => void {
    this.nodeListeners.add(listener);
    return () => this.nodeListeners.delete(listener);
  }
  private notify(): void {
    for (const listener of this.nodeListeners) listener();
  }
}

const BRIDGE_SHAPE_VERSION = 6;
interface BridgeGlobalSlot {
  version: number;
  bridge: Bridge;
}
export function getBridge(): Bridge {
  const global = globalThis as typeof globalThis & {
    __motionworksBridge?: BridgeGlobalSlot;
  };
  if (global.__motionworksBridge?.version !== BRIDGE_SHAPE_VERSION)
    global.__motionworksBridge = {
      version: BRIDGE_SHAPE_VERSION,
      bridge: new Bridge(),
    };
  return global.__motionworksBridge.bridge;
}
export type { Bridge };
