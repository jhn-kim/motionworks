import {
  MotionWorksStateManager,
  type MotionWorksRegistration,
} from "@motionworks/core";

// Both the app-side hook and the overlay provider talk to the same object
// via this module. Because the provider mounts in its own React root, React
// context can't cross — so we use a module-scoped singleton instead.
//
// The provider "attaches" a state manager when it mounts. Hook calls that
// arrive before attachment are queued and replayed once the provider is
// ready. This tolerates dynamic-import ordering: the app's
// components (statically importing `useMotionWorks`) may render before the
// provider's lazy chunk has loaded.

// Pending ops must replay in the order they happened: StrictMode mounts
// produce register → unregister → register per instance, and replaying all
// registers before all unregisters would net out to a registered effect
// with no tracked node.
type PendingOp =
  | {
      op: "register";
      id: string;
      node: HTMLElement | null;
      registration: MotionWorksRegistration;
    }
  | { op: "unregister"; id: string; node: HTMLElement | null };

// One live component instance registered under an effect id: its DOM node
// (for hit-testing) and its own update() closure (for live manipulation).
interface EffectInstance {
  node: HTMLElement | null;
  update: MotionWorksRegistration["update"] | undefined;
}

class Bridge {
  private state: MotionWorksStateManager | null = null;
  // Several live component instances can register under the same effect id
  // (a list rendering the same card component registers one effect, many
  // instances). Every instance's node must stay hit-testable and every
  // instance's update() must run on manipulation — the state manager keeps
  // only one update per id, so we hand it a fan-out that dispatches to all
  // instances. `activeNodes` remembers which instance the designer selected
  // so surfaces render on the element they actually clicked. Instance lists
  // are multisets: one entry per live registration so register/unregister
  // pairs stay symmetric.
  private instances = new Map<string, EffectInstance[]>();
  private fanOuts = new Map<
    string,
    (params: Record<string, unknown>) => void
  >();
  private activeNodes = new Map<string, HTMLElement>();
  private pendingOps: PendingOp[] = [];
  private nodeListeners = new Set<() => void>();

  attach(state: MotionWorksStateManager): void {
    this.state = state;
    const pending = this.pendingOps;
    this.pendingOps = [];
    for (const p of pending) {
      if (p.op === "register") this.register(p.id, p.node, p.registration);
      else this.unregister(p.id, p.node);
    }
  }

  detach(): void {
    this.state = null;
    this.instances.clear();
    this.fanOuts.clear();
    this.activeNodes.clear();
    this.notifyNodeListeners();
  }

  register(
    id: string,
    node: HTMLElement | null,
    registration: MotionWorksRegistration,
  ): void {
    if (this.state === null) {
      this.pendingOps.push({ op: "register", id, node, registration });
      return;
    }
    const list = this.instances.get(id) ?? [];
    list.push({ node, update: registration.update });
    this.instances.set(id, list);

    // Register with the fan-out update in place of the instance's own, so a
    // manipulation reaches every mounted instance — not just whichever one
    // happened to register last. Omit it entirely when no instance provides
    // an update, preserving the read-only validation path (rule 4).
    const hasAnyUpdate = list.some((inst) => typeof inst.update === "function");
    const stateRegistration: MotionWorksRegistration = hasAnyUpdate
      ? { ...registration, update: this.fanOutFor(id) }
      : { ...registration };
    if (!hasAnyUpdate)
      delete (stateRegistration as { update?: unknown }).update;
    this.state.registerEffect(id, stateRegistration);

    if (node !== null) this.notifyNodeListeners();
  }

  // The effect only truly unregisters from the state when the last live
  // instance goes away — one card unmounting must not tear down the effect
  // for its siblings.
  unregister(id: string, node: HTMLElement | null = null): void {
    if (this.state === null) {
      this.pendingOps.push({ op: "unregister", id, node });
      return;
    }
    const list = this.instances.get(id);
    if (list !== undefined) {
      let idx = list.findIndex((inst) => inst.node === node);
      if (idx === -1) idx = list.length - 1;
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.instances.delete(id);
    }
    if (node !== null && this.activeNodes.get(id) === node) {
      this.activeNodes.delete(id);
    }
    if (this.instances.has(id)) {
      this.notifyNodeListeners();
      return;
    }
    this.fanOuts.delete(id);
    this.activeNodes.delete(id);
    this.state.unregisterEffect(id);
    this.notifyNodeListeners();
  }

  // Stable per-id dispatcher reading the live instance list, so the state
  // manager can hold one update reference while instances come and go.
  private fanOutFor(id: string): (params: Record<string, unknown>) => void {
    let fn = this.fanOuts.get(id);
    if (fn === undefined) {
      fn = (params) => {
        const list = this.instances.get(id);
        if (list === undefined) return;
        for (const inst of list) inst.update?.(params);
      };
      this.fanOuts.set(id, fn);
    }
    return fn;
  }

  getState(): MotionWorksStateManager | null {
    return this.state;
  }

  // The node manipulation surfaces should attach to: the instance the
  // designer selected if one is set (and still mounted), else the first
  // registered instance.
  getNode(id: string): HTMLElement | undefined {
    const active = this.activeNodes.get(id);
    if (active !== undefined) return active;
    return (
      this.instances.get(id)?.find((inst) => inst.node !== null)?.node ??
      undefined
    );
  }

  // Called by the selection engine so getNode() tracks the instance that
  // was actually clicked, not an arbitrary sibling.
  setActiveNode(id: string, node: HTMLElement): void {
    const list = this.instances.get(id);
    if (list === undefined || !list.some((inst) => inst.node === node)) return;
    if (this.activeNodes.get(id) === node) return;
    this.activeNodes.set(id, node);
    this.notifyNodeListeners();
  }

  getAllNodes(): ReadonlyMap<string, readonly HTMLElement[]> {
    const out = new Map<string, HTMLElement[]>();
    for (const [id, list] of this.instances.entries()) {
      const nodes = list
        .filter(
          (inst): inst is EffectInstance & { node: HTMLElement } =>
            inst.node !== null,
        )
        .map((inst) => inst.node);
      if (nodes.length > 0) out.set(id, nodes);
    }
    return out;
  }

  subscribeToNodes(listener: () => void): () => void {
    this.nodeListeners.add(listener);
    return () => {
      this.nodeListeners.delete(listener);
    };
  }

  private notifyNodeListeners(): void {
    for (const l of this.nodeListeners) l();
  }
}

// The bridge must survive HMR of this module: app components register into
// the singleton, and if a hot swap re-instantiated it the overlay would see
// an empty node map (nothing selectable) until a full reload. Stash it on
// globalThis, keyed by a shape version — bump the version whenever the
// Bridge's internal data layout changes so a stale instance from an older
// module version is discarded instead of corrupting the new code.
const BRIDGE_SHAPE_VERSION = 4;

interface BridgeGlobalSlot {
  version: number;
  bridge: Bridge;
}

export function getBridge(): Bridge {
  const g = globalThis as unknown as { __motionworksBridge?: BridgeGlobalSlot };
  if (
    g.__motionworksBridge === undefined ||
    g.__motionworksBridge.version !== BRIDGE_SHAPE_VERSION
  ) {
    g.__motionworksBridge = {
      version: BRIDGE_SHAPE_VERSION,
      bridge: new Bridge(),
    };
  }
  return g.__motionworksBridge.bridge;
}

export type { Bridge };
