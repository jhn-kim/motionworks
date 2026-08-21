import {
  MotionWorksStateManager,
  type MotionWorksEffect,
  type MotionWorksStateSnapshot,
  type ParamDiff,
  type ParameterType,
} from '@motionworks/core';

import { getBridge, type Bridge } from '../bridge.js';
import { describeNode, findInteractiveNode } from '../dom-selector.js';
import { DiffStore, type ReconcileResult } from './diff-store.js';
import { TypeOverrideStore } from './type-overrides.js';
import { WsClient } from './ws-client.js';

const SELECTION_STORAGE_KEY = 'motionworks:selectedEffectId';

// How long a simulated press stays down — long enough that press springs
// visibly compress before the release swing.
const SIMULATED_PRESS_HOLD_MS = 140;

// The single object that the overlay UI reads from and writes through.
// Owns the state manager (registry + live values), the diff store (designer
// intent), and the WS client (mirror + agent sync). Also drives selection
// persistence and reconciliation.
export class OverlaySession {
  readonly state: MotionWorksStateManager;
  readonly diffs: DiffStore;
  readonly typeOverrides: TypeOverrideStore;
  readonly ws: WsClient;
  private readonly bridge: Bridge;
  private stateUnsub: (() => void) | null = null;
  private snapshotUnsub: (() => void) | null = null;
  private wsUnsub: (() => void) | null = null;
  private knownEffectIds = new Set<string>();
  private connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  // Referentially stable state snapshot for useSyncExternalStore consumers.
  // React requires getSnapshot to return the same value when nothing has
  // changed; the core state manager's getSnapshot returns a fresh object
  // each call, which would send React into an infinite loop.
  private cachedSnapshot: MotionWorksStateSnapshot | null = null;
  // Effects whose Apply has been sent but not yet reconciled by an incoming
  // re-registration or source-synced event. Lets the panel show a "sent,
  // waiting for agent" state instead of leaving Apply looking inert.
  private pendingCommits = new Set<string>();
  private pendingListeners = new Set<() => void>();
  private pendingVersion = 0;
  // Re-entrancy guard: onStateChange reacts to state-manager notifies so it
  // can reconcile after a *re-registration*. But the session's own
  // applyParamChange calls (manipulate / discard / reconcile re-apply) also
  // notify — reacting to those turns every value write into an unbounded
  // reconcile → applyParamChange → notify recursion.
  private applyingOwnChange = false;

  constructor(port: number, private readonly debug: boolean) {
    this.state = new MotionWorksStateManager();
    this.diffs = new DiffStore();
    this.typeOverrides = new TypeOverrideStore();
    this.bridge = getBridge();
    this.ws = new WsClient(
      `ws://localhost:${String(port)}`,
      (open) => this.handleConnectionChange(open),
      debug ? (msg) => console.info(`[MotionWorks] ${msg}`) : undefined,
    );
  }

  start(): void {
    // Attach first so registrations from already-mounted app components flush
    // through immediately once we're up.
    this.bridge.attach(this.state, (msg) => this.ws.send(msg));

    // Snapshot invalidation must be the FIRST subscriber so that later
    // subscribers (onStateChange, React's useSyncExternalStore) reading the
    // cache during the same notify cycle get the fresh value.
    this.snapshotUnsub = this.state.subscribe(() => {
      this.cachedSnapshot = null;
    });
    // Watch for new registrations to run the selection-restore + reconciliation
    // dance. We track known IDs because the state manager doesn't tell us
    // whether a given notify is a fresh registration or a re-registration.
    this.stateUnsub = this.state.subscribe(() => this.onStateChange());

    this.wsUnsub = this.ws.onDownstream((msg) => {
      if (msg.type === 'source-synced') {
        this.reconcileEffect(msg.payload.effectId);
      }
    });

    this.ws.start();
  }

  stop(): void {
    this.ws.stop();
    this.bridge.detach();
    this.stateUnsub?.();
    this.snapshotUnsub?.();
    this.wsUnsub?.();
    this.stateUnsub = null;
    this.snapshotUnsub = null;
    this.wsUnsub = null;
    this.knownEffectIds.clear();
    this.connectionListeners.clear();
    this.cachedSnapshot = null;
  }

  // Cached wrapper around the core state manager's getSnapshot so that
  // consecutive calls return the same reference until the state changes.
  getStateSnapshot(): MotionWorksStateSnapshot {
    if (this.cachedSnapshot === null) {
      this.cachedSnapshot = this.state.getSnapshot();
    }
    return this.cachedSnapshot;
  }

  // ── Selection ─────────────────────────────────────────────────────────

  // `node` is the specific DOM instance the designer clicked — an effect can
  // have several live instances (same component rendered in a list), and the
  // surfaces + selector must follow the clicked one.
  selectEffect(id: string | null, node?: HTMLElement): void {
    if (id !== null && node !== undefined) this.bridge.setActiveNode(id, node);
    // Persist BEFORE mutating the state manager: selectEffect notifies
    // synchronously, and onStateChange → restoreSelection reads this key.
    // Writing after would make the restore see the stale previous id and
    // instantly revert every selection change (and undo every deselect).
    if (typeof sessionStorage !== 'undefined') {
      if (id === null) sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      else sessionStorage.setItem(SELECTION_STORAGE_KEY, id);
    }
    this.state.selectEffect(id);
    if (id !== null) {
      // The wire protocol has no explicit deselect, so we only broadcast on
      // positive selection. The bridge's own state clears when the effect
      // unregisters, which covers the other side of the reset.
      const node = this.bridge.getNode(id);
      const selector = node !== undefined ? describeNode(node) : undefined;
      this.ws.send({
        type: 'select',
        payload: { effectId: id, ...(selector !== undefined && { selector }) },
      });
    }
  }

  private restoreSelection(effect: MotionWorksEffect): void {
    if (typeof sessionStorage === 'undefined') return;
    const stored = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (stored !== effect.id) return;
    // Avoid re-entering state.selectEffect (and its notify) if we're already
    // selected — this would recurse through onStateChange forever.
    if (this.state.getSelectedEffect()?.id === effect.id) return;
    this.state.selectEffect(effect.id);
  }

  // ── Manipulation ──────────────────────────────────────────────────────

  // Called by surfaces on every pointermove. Local update() runs
  // synchronously here; the WS mirror is throttled by the WsClient.
  manipulate(effectId: string, param: string, value: unknown): void {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return;
    const baseline = effect.params[param]?.value;
    this.diffs.recordChange(effectId, param, baseline, value);
    this.applyOwnChange(effectId, param, value);
    this.ws.send({ type: 'change', payload: { effectId, param, value } });
  }

  // state.applyParamChange wrapped in the re-entrancy guard — every value
  // write the session itself initiates must go through here.
  private applyOwnChange(effectId: string, param: string, value: unknown): void {
    const prev = this.applyingOwnChange;
    this.applyingOwnChange = true;
    try {
      this.state.applyParamChange(effectId, param, value);
    } finally {
      this.applyingOwnChange = prev;
    }
  }

  // Dispatch a reserved (double-underscore) key straight to an effect's
  // update() without recording a diff — replay, time scale, reduced motion.
  // Pass a null effectId to broadcast to every registered effect.
  sendReserved(effectId: string | null, key: string, value: unknown): void {
    const targets =
      effectId === null
        ? this.state.getAllEffects().map((e) => e.id)
        : [effectId];
    for (const id of targets) {
      this.applyOwnChange(id, key, value);
    }
  }

  // Replay for interaction-triggered animations (press springs, hover
  // pulses) on effects that don't declare the replay capability: dispatch a
  // synthetic press on the element so its pointer handlers animate it. The
  // SelectionEngine ignores untrusted events, so these reach the app instead
  // of being swallowed as a selection click. Deliberately no `click`: click
  // is the element's real activation (add to cart, open drawer, navigate) —
  // replay must show the animation without running the behavior. Effects
  // whose animation lives in the click handler itself should declare
  // capabilities.replay and re-run it from update() instead.
  replayInteraction(effectId: string): void {
    const target = findInteractiveNode(this.bridge.getNode(effectId) ?? null);
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const pointerOpts = { ...opts, pointerId: 1, isPrimary: true };
    target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    window.setTimeout(() => {
      target.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
    }, SIMULATED_PRESS_HOLD_MS);
  }

  // Hold-to-compare: temporarily re-apply the pre-manipulation baselines so
  // the designer can A/B their uncommitted changes. `hold: false` restores
  // the manipulated values. Diffs are untouched either way.
  holdBaseline(effectId: string, hold: boolean): void {
    const diff = this.diffs.getDiff(effectId);
    for (const [param, d] of Object.entries(diff)) {
      this.applyOwnChange(effectId, param, hold ? d.from : d.to);
      this.ws.send({
        type: 'change',
        payload: { effectId, param, value: hold ? d.from : d.to },
      });
    }
  }

  // ── Commit / discard ──────────────────────────────────────────────────

  // Sends the current diff for the effect to the bridge. The changeset id
  // is minted server-side (see @motionworks/core/server); we just describe
  // the DOM node so the agent has context.
  commit(effectId: string): boolean {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return false;
    const diff = this.diffs.getDiff(effectId);
    const paramDiffs: ParamDiff[] = Object.entries(diff).map(([param, d]) => ({
      param,
      from: d.from,
      to: d.to,
    }));
    if (paramDiffs.length === 0) return false;
    const node = this.bridge.getNode(effectId);
    const selector = node !== undefined ? describeNode(node) : effect.name;
    this.ws.send({
      type: 'commit',
      payload: { effectId, elementSelector: selector, diffs: paramDiffs },
    });
    this.pendingCommits.add(effectId);
    this.notifyPending();
    return true;
  }

  isCommitPending(effectId: string | null): boolean {
    return effectId !== null && this.pendingCommits.has(effectId);
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
    for (const l of this.pendingListeners) l();
  }

  discard(effectId: string): void {
    const effect = this.state.getEffect(effectId);
    const diff = this.diffs.getDiff(effectId);
    if (effect !== undefined) {
      for (const [param, d] of Object.entries(diff)) {
        // Force the live value back to baseline via the state manager so the
        // registered update() runs and the on-screen effect visibly resets.
        this.applyOwnChange(effectId, param, d.from);
        this.ws.send({ type: 'change', payload: { effectId, param, value: d.from } });
      }
    }
    this.diffs.clearEffect(effectId);
    if (this.pendingCommits.delete(effectId)) this.notifyPending();
  }

  // ── Type corrections ──────────────────────────────────────────────────

  // Called from the surface context menu when the designer picks a new type
  // for a param. Stores locally so the correct surface renders immediately,
  // then mirrors to the bridge so the agent sees it in typeCorrections.
  correctType(
    effectId: string,
    paramKey: string,
    correctedType: ParameterType,
  ): void {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return;
    const currentType = this.resolvedType(effectId, paramKey);
    if (currentType === correctedType) return;
    const param = effect.params[paramKey];
    if (param === undefined) return;
    this.typeOverrides.set(effectId, paramKey, correctedType);
    this.ws.send({
      type: 'type-correction',
      payload: {
        effectName: effect.name,
        paramKey,
        previousType: param.type,
        correctedType,
        correctedAt: Date.now(),
      },
    });
  }

  /** Effective type for a param — override wins over the registered type. */
  resolvedType(effectId: string, paramKey: string): ParameterType | null {
    const override = this.typeOverrides.get(effectId, paramKey);
    if (override !== null) return override;
    return this.state.getEffect(effectId)?.params[paramKey]?.type ?? null;
  }

  // ── Reconciliation ────────────────────────────────────────────────────

  private reconcileEffect(effectId: string): ReconcileResult | null {
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return null;
    const baselines: Record<string, unknown> = {};
    for (const [k, param] of Object.entries(effect.params)) baselines[k] = param.value;
    const result = this.diffs.reconcile(effectId, baselines);

    // For any diff that survived (preserved or unexpected), re-apply the
    // designer's chosen `to` value so the on-screen effect matches the
    // intent — HMR just wiped the state manager's liveValues to the source
    // baseline.
    let anySurvived = false;
    for (const [param, r] of Object.entries(result.params)) {
      if (r.status === 'preserved' || r.status === 'unexpected') {
        anySurvived = true;
        this.applyOwnChange(effectId, param, r.to);
        this.ws.send({ type: 'change', payload: { effectId, param, value: r.to } });
      }
    }
    // If nothing survived, the write landed cleanly — clear the pending
    // commit marker so the panel can drop its "sent, waiting" state.
    if (!anySurvived && this.pendingCommits.delete(effectId)) {
      this.notifyPending();
    }
    return result;
  }

  private onStateChange(): void {
    // A notify caused by our own applyParamChange is not a registration —
    // running the restore/reconcile dance on it recurses (see guard above).
    if (this.applyingOwnChange) return;
    // Detect newly-registered effects (or re-registrations). For each,
    // restore selection if it matches sessionStorage, then reconcile
    // against any pending diff.
    const current = this.state.getAllEffects();
    const currentIds = new Set<string>();
    for (const effect of current) {
      currentIds.add(effect.id);
      const wasKnown = this.knownEffectIds.has(effect.id);
      // Always try to restore selection: covers first-mount as well as
      // re-registration after HMR (which triggers a fresh state notify).
      this.restoreSelection(effect);
      // Only run reconciliation when there is an outstanding diff — no
      // point walking the params for effects the designer hasn't touched.
      if (this.diffs.hasDiff(effect.id)) this.reconcileEffect(effect.id);
      // Type-override reconciliation: if the source now declares the
      // corrected type, the agent wrote the correction back and we can drop
      // the override so future rethinking flows through the source.
      this.typeOverrides.reconcile(effect);
      if (!wasKnown) this.knownEffectIds.add(effect.id);
    }
    // Prune known IDs whose effect has since unregistered.
    for (const id of Array.from(this.knownEffectIds)) {
      if (!currentIds.has(id)) this.knownEffectIds.delete(id);
    }
  }

  // ── Connection state ──────────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }

  subscribeConnection(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private handleConnectionChange(open: boolean): void {
    this.connected = open;
    for (const l of this.connectionListeners) l(open);
    if (open) {
      // Reannounce every registration so the bridge doesn't have to remember
      // what was sent — the server treats register as idempotent.
      for (const effect of this.state.getAllEffects()) {
        this.ws.send({ type: 'register', payload: effect });
      }
    }
  }
}
