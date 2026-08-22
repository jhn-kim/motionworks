import {
  MotionWorksStateManager,
  type CommitRequest,
  type JournalEntry,
  type MotionWorksEffect,
  type MotionWorksStateSnapshot,
  type ParameterType,
  type TypeCorrection,
} from "../../shared/index.js";

import { getBridge, type Bridge } from "../bridge.js";
import { deepEqual } from "../deep-equal.js";
import { describeNode, findInteractiveNode } from "../dom-selector.js";
import { DaemonClient } from "./daemon-client.js";
import { loadPersistedDiffs, persistDiffs } from "./diff-persistence.js";
import { DiffStore, type ReconcileResult } from "./diff-store.js";
import { TypeOverrideStore } from "./type-overrides.js";

const SELECTION_STORAGE_KEY = "motionworks:selectedEffectId";
const SIMULATED_PRESS_HOLD_MS = 140;

export interface OverlaySessionOptions {
  daemonUrl: string;
  debug?: boolean;
}

export class OverlaySession {
  readonly state = new MotionWorksStateManager();
  readonly diffs = new DiffStore();
  readonly typeOverrides = new TypeOverrideStore();
  readonly daemon: DaemonClient;
  private readonly bridge: Bridge;
  private readonly origin: string;
  private stateUnsub: (() => void) | null = null;
  private snapshotUnsub: (() => void) | null = null;
  private diffUnsub: (() => void) | null = null;
  private statusUnsub: (() => void) | null = null;
  private pendingUnsub: (() => void) | null = null;
  private knownEffectIds = new Set<string>();
  private connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  private cachedSnapshot: MotionWorksStateSnapshot | null = null;
  private entries: JournalEntry[] = [];
  private pendingCorrections = new Map<string, Map<string, TypeCorrection>>();
  private pendingListeners = new Set<() => void>();
  private pendingVersion = 0;
  private applyingOwnChange = false;

  constructor({ daemonUrl, debug = false }: OverlaySessionOptions) {
    this.bridge = getBridge();
    this.origin = typeof location === "undefined" ? "" : location.origin;
    this.daemon = new DaemonClient(
      daemonUrl,
      debug ? (message) => console.info(`[MotionWorks] ${message}`) : undefined,
    );
  }

  start(): void {
    this.diffs.hydrate(loadPersistedDiffs(this.origin));
    this.snapshotUnsub = this.state.subscribe(() => {
      this.cachedSnapshot = null;
    });
    this.stateUnsub = this.state.subscribe(() => this.onStateChange());
    this.diffUnsub = this.diffs.subscribe(() =>
      persistDiffs(this.origin, this.diffs.toJSON()),
    );
    this.statusUnsub = this.daemon.onStatus((status) =>
      this.handleConnectionChange(status !== null),
    );
    this.pendingUnsub = this.daemon.onPending((entries) => {
      this.entries = entries;
      this.notifyPending();
      for (const effectId of new Set(entries.map((entry) => entry.effectId))) {
        this.reconcileEffect(effectId);
      }
    });
    // Attach after subscriptions are ready: queued hook registrations are
    // the first chance to reconcile and re-apply a hydrated local diff.
    this.bridge.attach(this.state);
    this.daemon.start();
  }

  stop(): void {
    this.daemon.stop();
    this.bridge.detach();
    this.stateUnsub?.();
    this.snapshotUnsub?.();
    this.diffUnsub?.();
    this.statusUnsub?.();
    this.pendingUnsub?.();
    this.stateUnsub = null;
    this.snapshotUnsub = null;
    this.diffUnsub = null;
    this.statusUnsub = null;
    this.pendingUnsub = null;
    this.knownEffectIds.clear();
    this.connectionListeners.clear();
    this.cachedSnapshot = null;
  }

  getStateSnapshot(): MotionWorksStateSnapshot {
    if (this.cachedSnapshot === null)
      this.cachedSnapshot = this.state.getSnapshot();
    return this.cachedSnapshot;
  }

  selectEffect(id: string | null, node?: HTMLElement): void {
    if (id !== null && node !== undefined) this.bridge.setActiveNode(id, node);
    if (typeof sessionStorage !== "undefined") {
      if (id === null) sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      else sessionStorage.setItem(SELECTION_STORAGE_KEY, id);
    }
    this.state.selectEffect(id);
    if (id === null) return;
    const effect = this.state.getEffect(id);
    if (effect === undefined) return;
    const selectedNode = this.bridge.getNode(id);
    void this.daemon.select({
      effectId: id,
      effectName: effect.name,
      elementSelector:
        selectedNode === undefined ? effect.name : describeNode(selectedNode),
      values: Object.fromEntries(
        Object.entries(effect.params).map(([key, param]) => [key, param.value]),
      ),
      page: typeof location === "undefined" ? undefined : location.href,
    });
  }

  private restoreSelection(effect: MotionWorksEffect): void {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(SELECTION_STORAGE_KEY) !== effect.id) return;
    if (this.state.getSelectedEffect()?.id !== effect.id)
      this.state.selectEffect(effect.id);
  }

  manipulate(effectId: string, param: string, value: unknown): void {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return;
    this.diffs.recordChange(
      effectId,
      param,
      effect.params[param]?.value,
      value,
    );
    this.applyOwnChange(effectId, param, value);
  }

  private applyOwnChange(
    effectId: string,
    param: string,
    value: unknown,
  ): void {
    const previous = this.applyingOwnChange;
    this.applyingOwnChange = true;
    try {
      this.state.applyParamChange(effectId, param, value);
    } finally {
      this.applyingOwnChange = previous;
    }
  }

  sendReserved(effectId: string | null, key: string, value: unknown): void {
    const targets =
      effectId === null
        ? this.state.getAllEffects().map((effect) => effect.id)
        : [effectId];
    for (const id of targets) this.applyOwnChange(id, key, value);
  }

  replayInteraction(effectId: string): void {
    const target = findInteractiveNode(this.bridge.getNode(effectId) ?? null);
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const pointerOptions = { ...options, pointerId: 1, isPrimary: true };
    target.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
    target.dispatchEvent(new MouseEvent("mousedown", options));
    window.setTimeout(() => {
      target.dispatchEvent(new PointerEvent("pointerup", pointerOptions));
      target.dispatchEvent(new MouseEvent("mouseup", options));
    }, SIMULATED_PRESS_HOLD_MS);
  }

  holdBaseline(effectId: string, hold: boolean): void {
    for (const [param, diff] of Object.entries(this.diffs.getDiff(effectId))) {
      this.applyOwnChange(effectId, param, hold ? diff.from : diff.to);
    }
  }

  commit(effectId: string): boolean {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return false;
    const corrections = [
      ...(this.pendingCorrections.get(effectId)?.values() ?? []),
    ];
    const changes = Object.entries(this.diffs.getDiff(effectId)).flatMap(
      ([param, diff]) => {
        const spec = effect.params[param];
        if (spec === undefined) return [];
        return [
          {
            param,
            type: this.resolvedType(effectId, param) ?? spec.type,
            from: diff.from,
            to: diff.to,
            ...(effect.sourceHints?.[param] !== undefined && {
              sourceHint: effect.sourceHints[param],
            }),
          },
        ];
      },
    );
    if (changes.length === 0 && corrections.length === 0) return false;
    const node = this.bridge.getNode(effectId);
    const request: CommitRequest = {
      page: typeof location === "undefined" ? "" : location.href,
      effectId,
      effectName: effect.name,
      elementSelector: node === undefined ? effect.name : describeNode(node),
      changes,
      ...(corrections.length > 0 && { typeCorrections: corrections }),
    };
    void this.daemon.commit(request).then((result) => {
      if (result !== null) this.pendingCorrections.delete(effectId);
    });
    return true;
  }

  isCommitPending(effectId: string | null): boolean {
    return (
      effectId !== null &&
      this.entries.some(
        (entry) =>
          entry.effectId === effectId &&
          (entry.status === "pending" || entry.status === "agent-working"),
      )
    );
  }

  hasPendingCorrections(effectId: string): boolean {
    return (this.pendingCorrections.get(effectId)?.size ?? 0) > 0;
  }

  getAgentQueue(): { id: string; effectId: string; effectName: string }[] {
    return this.entries
      .filter((entry) => entry.status === "pending")
      .map(({ id, effectId, effectName }) => ({ id, effectId, effectName }));
  }

  getEntryStatus(effectId: string | null): JournalEntry["status"] | null {
    if (effectId === null) return null;
    return (
      [...this.entries].reverse().find((entry) => entry.effectId === effectId)
        ?.status ?? null
    );
  }

  buildAgentPrompt(): string {
    const ids = this.getAgentQueue().map((entry) => entry.id);
    if (ids.length === 0) return "";
    return `Run \`npx motionworks changes\` and apply them, then ${ids.map((id) => `\`npx motionworks ack ${id}\``).join(", ")}.`;
  }

  getPendingVersion(): number {
    return this.pendingVersion;
  }

  subscribePending(listener: () => void): () => void {
    this.pendingListeners.add(listener);
    return () => {
      this.pendingListeners.delete(listener);
    };
  }

  private notifyPending(): void {
    this.pendingVersion++;
    for (const listener of this.pendingListeners) listener();
  }

  discard(effectId: string): void {
    const effect = this.state.getEffect(effectId);
    if (effect !== undefined) {
      for (const [param, diff] of Object.entries(
        this.diffs.getDiff(effectId),
      )) {
        this.applyOwnChange(effectId, param, diff.from);
      }
    }
    this.diffs.clearEffect(effectId);
  }

  correctType(
    effectId: string,
    paramKey: string,
    correctedType: ParameterType,
  ): void {
    const effect = this.state.getEffect(effectId);
    const param = effect?.params[paramKey];
    if (
      effect === undefined ||
      param === undefined ||
      this.resolvedType(effectId, paramKey) === correctedType
    )
      return;
    this.typeOverrides.set(effectId, paramKey, correctedType);
    let corrections = this.pendingCorrections.get(effectId);
    if (corrections === undefined) {
      corrections = new Map();
      this.pendingCorrections.set(effectId, corrections);
    }
    corrections.set(paramKey, {
      effectName: effect.name,
      paramKey,
      previousType: param.type,
      correctedType,
      correctedAt: Date.now(),
    });
  }

  resolvedType(effectId: string, paramKey: string): ParameterType | null {
    return (
      this.typeOverrides.get(effectId, paramKey) ??
      this.state.getEffect(effectId)?.params[paramKey]?.type ??
      null
    );
  }

  private reconcileEffect(effectId: string): ReconcileResult | null {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return null;
    const baselines = Object.fromEntries(
      Object.entries(effect.params).map(([key, param]) => [key, param.value]),
    );
    const result = this.diffs.reconcile(effectId, baselines);
    for (const [param, reconciliation] of Object.entries(result.params)) {
      if (reconciliation.status !== "clean")
        this.applyOwnChange(effectId, param, reconciliation.to);
    }
    for (const entry of this.entries.filter(
      (candidate) => candidate.effectId === effectId,
    )) {
      const changesClean = entry.changes.every((change) =>
        deepEqual(change.to, effect.params[change.param]?.value),
      );
      const correctionsClean = (entry.typeCorrections ?? []).every(
        (correction) =>
          effect.params[correction.paramKey]?.type === correction.correctedType,
      );
      if (changesClean && correctionsClean) void this.daemon.ack(entry.id);
    }
    return result;
  }

  private onStateChange(): void {
    if (this.applyingOwnChange) return;
    const current = this.state.getAllEffects();
    const currentIds = new Set(current.map((effect) => effect.id));
    for (const effect of current) {
      this.restoreSelection(effect);
      if (
        this.diffs.hasDiff(effect.id) ||
        this.entries.some((entry) => entry.effectId === effect.id)
      ) {
        this.reconcileEffect(effect.id);
      }
      this.typeOverrides.reconcile(effect);
      this.knownEffectIds.add(effect.id);
    }
    for (const id of this.knownEffectIds) {
      if (!currentIds.has(id)) this.knownEffectIds.delete(id);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeConnection(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private handleConnectionChange(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }
}
