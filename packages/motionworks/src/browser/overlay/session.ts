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
import { EVENTS } from "../css-bindings.js";
import {
  applyLive,
  findDeclaringRule,
  restoreLive,
  watchStylesheets,
} from "./css-apply.js";
import { encodeCssValue } from "../../shared/css-values.js";
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
  private committing = new Set<string>();
  private applyingOwnChange = false;
  private stylesUnsub: (() => void) | null = null;
  private startedAt = 0;

  constructor({ daemonUrl, debug = false }: OverlaySessionOptions) {
    this.bridge = getBridge();
    this.origin = typeof location === "undefined" ? "" : location.origin;
    this.daemon = new DaemonClient(
      daemonUrl,
      debug ? (message) => console.info(`[MotionWorks] ${message}`) : undefined,
    );
  }

  start(): void {
    this.startedAt = Date.now();
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
      const previousStatuses = new Map(
        this.entries.map((entry) => [entry.id, entry.status]),
      );
      this.entries = entries;
      this.notifyPending();
      for (const entry of entries) {
        if (
          entry.status === "applied" &&
          previousStatuses.get(entry.id) !== "applied"
        )
          this.bumpStylesheetLinks(entry);
      }
      for (const effectId of new Set(entries.map((entry) => entry.effectId))) {
        this.reconcileEffect(effectId);
      }
    });
    // Attach after subscriptions are ready: queued hook registrations are
    // the first chance to reconcile and re-apply a hydrated local diff.
    this.bridge.attach(this.state);
    this.stylesUnsub = watchStylesheets(() => this.refreshBaselines());
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
    this.stylesUnsub?.();
    this.stylesUnsub = null;
    this.knownEffectIds.clear();
    this.committing.clear();
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
    if (effect === undefined || effect.params[param]?.bound !== true) return;
    this.diffs.recordChange(
      effectId,
      param,
      effect.params[param]?.value,
      value,
    );
    for (const target of this.matchingTargets(effectId, param)) {
      applyLive(target.node, target.spec, target.binding, value);
    }
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

  sendReserved(
    effectId: string | null,
    key: "replay" | "scrub",
    value: unknown,
  ): void {
    const targets =
      effectId === null
        ? this.state.getAllEffects().map((effect) => effect.id)
        : [effectId];
    for (const id of targets) {
      const node = this.bridge.getNode(id);
      if (node !== undefined)
        node.dispatchEvent(
          new CustomEvent(EVENTS[key], { bubbles: true, detail: value }),
        );
    }
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
      for (const target of this.matchingTargets(effectId, param)) {
        applyLive(
          target.node,
          target.spec,
          target.binding,
          hold ? diff.from : diff.to,
        );
      }
      this.applyOwnChange(effectId, param, hold ? diff.from : diff.to);
    }
  }

  commit(effectId: string): boolean {
    if (this.committing.has(effectId)) return false;
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return false;
    const corrections = [
      ...(this.pendingCorrections.get(effectId)?.values() ?? []),
    ];
    const node = this.bridge.getNode(effectId);
    const changes = Object.entries(this.diffs.getDiff(effectId)).flatMap(
      ([param, diff]) => {
        const spec = effect.params[param];
        if (spec === undefined || !spec.bound) return [];
        const queued = this.latestJournalChange(effectId, param, diff.from);
        if (queued !== undefined && deepEqual(queued.to, diff.to)) return [];
        const from = queued?.to ?? diff.from;
        const type = this.resolvedType(effectId, param) ?? spec.type;
        return [
          {
            param,
            type,
            from,
            to: diff.to,
            var: spec.var,
            fromCss: encodeCssValue(type, from, spec.cssUnit),
            toCss: encodeCssValue(type, diff.to, spec.cssUnit),
            ...(node !== undefined &&
              findDeclaringRule(node, spec.var) !== undefined && {
                rule: findDeclaringRule(node, spec.var),
              }),
          },
        ];
      },
    );
    if (changes.length === 0 && corrections.length === 0) return false;
    const request: CommitRequest = {
      page: typeof location === "undefined" ? "" : location.href,
      effectId,
      effectName: effect.name,
      elementSelector: node === undefined ? effect.name : describeNode(node),
      changes,
      ...(corrections.length > 0 && { typeCorrections: corrections }),
    };
    this.committing.add(effectId);
    this.notifyPending();
    void this.daemon.commit(request).then((result) => {
      this.committing.delete(effectId);
      if (result !== null) this.pendingCorrections.delete(effectId);
      this.notifyPending();
    });
    return true;
  }

  private latestJournalChange(
    effectId: string,
    param: string,
    baseline: unknown,
  ): JournalEntry["changes"][number] | undefined {
    let cursor = baseline;
    let latest: JournalEntry["changes"][number] | undefined;
    for (const entry of this.entries) {
      if (entry.effectId !== effectId) continue;
      // An applied entry from an earlier browser session is history, not an
      // active continuation. The fresh registration baseline already tells
      // us what actually exists in source after a reload.
      if (entry.status === "applied" && entry.createdAt < this.startedAt)
        continue;
      // Agent-applied entries created before source verification did not
      // record files and may represent a clean agent exit with no write.
      // Do not let one of those stale claims become the `from` value for a
      // later save. New verified agent writes always include `files`.
      if (
        entry.status === "applied" &&
        entry.appliedBy === "agent" &&
        entry.files === undefined
      )
        continue;
      for (const change of entry.changes) {
        if (change.param !== param || !deepEqual(change.from, cursor)) continue;
        latest = change;
        cursor = change.to;
      }
    }
    return latest;
  }

  hasCommitDelta(effectId: string): boolean {
    for (const [param, diff] of Object.entries(this.diffs.getDiff(effectId))) {
      const queued = this.latestJournalChange(effectId, param, diff.from);
      if (queued === undefined || !deepEqual(queued.to, diff.to)) return true;
    }
    return this.hasPendingCorrections(effectId);
  }

  isCommitPending(effectId: string | null): boolean {
    return (
      effectId !== null &&
      (this.committing.has(effectId) ||
        this.entries.some(
          (entry) =>
            entry.effectId === effectId &&
            (entry.status === "pending" || entry.status === "agent-working"),
        ))
    );
  }

  hasPendingCorrections(effectId: string): boolean {
    return (this.pendingCorrections.get(effectId)?.size ?? 0) > 0;
  }

  getAgentQueue(): {
    id: string;
    effectId: string;
    effectName: string;
    changeCount: number;
    signature: string;
  }[] {
    // A fresh commit is `pending` on disk for the ms between
    // upsertPendingEntry and the daemon's path decision; its `error` is
    // still undefined during that window. Only after the daemon has
    // exhausted direct-write and (optionally) the auto-agent does it set
    // `error`, so treat that as the "definitely needs manual review"
    // signal and avoid a spurious yellow-icon flash mid-commit.
    return this.entries
      .filter(
        (entry) => entry.status === "pending" && entry.error !== undefined,
      )
      .map(({ id, effectId, effectName, changes, typeCorrections }) => ({
        id,
        effectId,
        effectName,
        changeCount: changes.length + (typeCorrections?.length ?? 0),
        signature: JSON.stringify([id, changes, typeCorrections ?? []]),
      }));
  }

  isAgentWorking(): boolean {
    return this.entries.some((entry) => entry.status === "agent-working");
  }

  getEntryStatus(effectId: string | null): JournalEntry["status"] | null {
    if (effectId === null) return null;
    return (
      [...this.entries].reverse().find((entry) => entry.effectId === effectId)
        ?.status ?? null
    );
  }

  buildAgentPrompt(): string {
    const queue = this.getAgentQueue();
    if (queue.length === 0) return "";
    const count = queue.reduce((total, entry) => total + entry.changeCount, 0);
    return `Run \`npx motionworks changes\`. The queue contains ${String(count)} ${count === 1 ? "change" : "changes"} across ${String(queue.length)} ${queue.length === 1 ? "entry" : "entries"}; apply them oldest first, then ${queue.map((entry) => `\`npx motionworks ack ${entry.id}\``).join(", ")}.`;
  }

  async copyAgentPrompt(): Promise<boolean> {
    const text = this.buildAgentPrompt();
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
      } catch {
        return false;
      }
    }
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
        for (const target of this.matchingTargets(effectId, param)) {
          restoreLive(target.node, target.binding);
        }
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
      if (reconciliation.status !== "clean") {
        for (const target of this.matchingTargets(effectId, param)) {
          applyLive(
            target.node,
            target.spec,
            target.binding,
            reconciliation.to,
          );
        }
        this.applyOwnChange(effectId, param, reconciliation.to);
      }
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

  refreshBaselines(): void {
    for (const [id, nodes] of this.bridge.getAllNodes())
      for (const node of nodes) {
        const instance = this.bridge.getInstance(id, node);
        if (instance !== undefined)
          for (const binding of Object.values(instance.bindings))
            restoreLive(node, binding);
      }
    this.bridge.refresh();
  }

  private matchingTargets(
    effectId: string,
    param: string,
  ): Array<{
    node: HTMLElement;
    spec: MotionWorksEffect["params"][string];
    binding: ReturnType<Bridge["getInstances"]>[number]["bindings"][string];
  }> {
    const selectedEffect = this.state.getEffect(effectId);
    const baseline = selectedEffect?.params[param];
    if (baseline === undefined || !baseline.bound) return [];
    const slug = effectId.replace(/#\d+$/, "");
    return this.bridge.getInstancesBySlug(slug).flatMap((instance) => {
      const effect = this.state.getEffect(instance.id);
      const spec = effect?.params[param];
      const binding = instance.bindings[param];
      return spec !== undefined &&
        spec.bound &&
        binding !== undefined &&
        binding.bound &&
        deepEqual(spec.value, baseline.value)
        ? [{ node: instance.node, spec, binding }]
        : [];
    });
  }

  private bumpStylesheetLinks(entry: JournalEntry): void {
    if (typeof document === "undefined") return;
    const sourcePaths = new Set([
      ...(entry.files ?? []),
      ...entry.changes.flatMap((change) =>
        change.rule?.sheetHref ? [change.rule.sheetHref] : [],
      ),
    ]);
    if (sourcePaths.size === 0) return;
    const matches = (href: string): boolean => {
      const url = new URL(href, location.href);
      return [...sourcePaths].some((source) => {
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
          const sourceUrl = new URL(source, location.href);
          return (
            sourceUrl.origin === url.origin &&
            sourceUrl.pathname === url.pathname
          );
        }
        const sourcePath = source
          .split(/[?#]/, 1)[0]!
          .replace(/\\/g, "/")
          .replace(/^\.\//, "");
        const normalized = sourcePath.replace(/^\//, "");
        return (
          url.pathname === `/${normalized}` ||
          url.pathname.endsWith(`/${normalized}`) ||
          sourcePath.endsWith(url.pathname)
        );
      });
    };
    for (const link of Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    )) {
      if (!matches(link.href)) continue;
      const url = new URL(link.href, location.href);
      url.searchParams.set("mw", String(Date.now()));
      link.href = url.href;
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
