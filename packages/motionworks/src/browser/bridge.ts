import { MotionWorksStateManager, type MotionWorksRegistration, type MotionWorksRuntimeParam } from '../shared/index.js';
import { readBaseline, type CssBinding } from './overlay/css-apply.js';

type PendingOp = { op: 'register'; id: string; node: HTMLElement | null; registration: MotionWorksRegistration } | { op: 'unregister'; id: string; node: HTMLElement | null };
interface EffectInstance { node: HTMLElement; bindings: Record<string, CssBinding> }

class Bridge {
  private state: MotionWorksStateManager | null = null;
  private instances = new Map<string, EffectInstance[]>();
  private registrations = new Map<string, MotionWorksRegistration>();
  private activeNodes = new Map<string, HTMLElement>();
  private pendingOps: PendingOp[] = [];
  private nodeListeners = new Set<() => void>();
  attach(state: MotionWorksStateManager): void { this.state = state; const pending = this.pendingOps.splice(0); for (const item of pending) item.op === 'register' ? this.register(item.id, item.node, item.registration) : this.unregister(item.id, item.node); }
  detach(): void { this.state = null; this.instances.clear(); this.registrations.clear(); this.activeNodes.clear(); this.notify(); }
  register(id: string, node: HTMLElement | null, registration: MotionWorksRegistration): void {
    if (this.state === null) { this.pendingOps.push({ op: 'register', id, node, registration }); return; }
    if (node === null) return;
    const bindings: Record<string, CssBinding> = {};
    const baseline: Record<string, MotionWorksRuntimeParam> = {};
    for (const [key, spec] of Object.entries(registration.params)) { const read = readBaseline(node, key, spec); bindings[key] = read.binding; baseline[key] = { ...spec, value: read.value, var: read.binding.var, cssUnit: read.binding.unit, bound: read.binding.bound }; }
    const list = this.instances.get(id) ?? []; const existing = list.findIndex((item) => item.node === node); if (existing >= 0) list.splice(existing, 1); list.push({ node, bindings });
    this.instances.set(id, list); this.registrations.set(id, registration); this.state.registerEffect(id, registration, baseline); this.notify();
  }
  unregister(id: string, node: HTMLElement | null = null): void { if (this.state === null) { this.pendingOps.push({ op: 'unregister', id, node }); return; } const list = this.instances.get(id); if (list !== undefined) { const index = list.findIndex((item) => item.node === node); if (index >= 0) list.splice(index, 1); if (list.length > 0) { this.notify(); return; } } this.instances.delete(id); this.registrations.delete(id); this.activeNodes.delete(id); this.state.unregisterEffect(id); this.notify(); }
  refresh(): void { if (this.state === null) return; for (const [id, list] of [...this.instances]) { const registration = this.registrations.get(id); if (registration === undefined) continue; for (const item of [...list]) this.register(id, item.node, registration); } }
  getState(): MotionWorksStateManager | null { return this.state; }
  getNode(id: string): HTMLElement | undefined { return this.activeNodes.get(id) ?? this.instances.get(id)?.[0]?.node; }
  getInstance(id: string, node: HTMLElement): EffectInstance | undefined { return this.instances.get(id)?.find((item) => item.node === node); }
  getInstances(id: string): readonly EffectInstance[] { return this.instances.get(id) ?? []; }
  setActiveNode(id: string, node: HTMLElement): void { if (!this.instances.get(id)?.some((item) => item.node === node)) return; this.activeNodes.set(id, node); this.notify(); }
  getAllNodes(): ReadonlyMap<string, readonly HTMLElement[]> { return new Map([...this.instances].map(([id, list]) => [id, list.map((item) => item.node)])); }
  subscribeToNodes(listener: () => void): () => void { this.nodeListeners.add(listener); return () => this.nodeListeners.delete(listener); }
  private notify(): void { for (const listener of this.nodeListeners) listener(); }
}

const BRIDGE_SHAPE_VERSION = 5;
interface BridgeGlobalSlot { version: number; bridge: Bridge }
export function getBridge(): Bridge { const global = globalThis as typeof globalThis & { __motionworksBridge?: BridgeGlobalSlot }; if (global.__motionworksBridge?.version !== BRIDGE_SHAPE_VERSION) global.__motionworksBridge = { version: BRIDGE_SHAPE_VERSION, bridge: new Bridge() }; return global.__motionworksBridge.bridge; }
export type { Bridge, EffectInstance };
