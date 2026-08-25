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
  isScrollDriven,
  restoreLive,
  watchStylesheets,
} from "./css-apply.js";
import { encodeCssValue } from "../../shared/css-values.js";
import { deepEqual } from "../deep-equal.js";
import {
  describeNode,
  ensureStableId,
  findInteractiveNode,
} from "../dom-selector.js";
import { DaemonClient } from "./daemon-client.js";
import {
  flushPersistedDiffs,
  loadPersistedDiffs,
  persistDiffs,
} from "./diff-persistence.js";
import { DiffStore, type Diff, type ReconcileResult } from "./diff-store.js";
import { TypeOverrideStore } from "./type-overrides.js";

const SELECTION_STORAGE_KEY = "motionworks:selectedEffectId";
const APPLIED_STORAGE_KEY = "motionworks:appliedEntryIds";
const SIMULATED_PRESS_HOLD_MS = 140;

export interface OverlaySessionOptions {
  daemonUrl: string;
  debug?: boolean;
}

type CommitOutcome = "in-flight" | "prompt" | "applied";

interface CommitAttempt {
  diff: Record<string, Diff>;
  corrections: TypeCorrection[];
  signature: string;
}

interface OwnCommit {
  id: string;
  status?: JournalEntry["status"];
  error?: string;
}

export class OverlaySession {
  readonly state = new MotionWorksStateManager();
  readonly diffs = new DiffStore();
  readonly typeOverrides = new TypeOverrideStore();
  readonly daemon: DaemonClient;
  private readonly bridge: Bridge;
  // localStorage scope for uncommitted diffs: origin + pathname, so per-page
  // effect ids don't collide across routes (P2-7).
  private readonly diffScope: string;
  private onPageHide: (() => void) | null = null;
  private stateUnsub: (() => void) | null = null;
  private snapshotUnsub: (() => void) | null = null;
  private diffUnsub: (() => void) | null = null;
  private statusUnsub: (() => void) | null = null;
  private pendingUnsub: (() => void) | null = null;
  private knownEffectIds = new Set<string>();
  private connected = false;
  // Whether we've completed at least one connection this session. The first
  // connect loads a fresh CSSOM already; only later reconnects need a resync.
  private hasConnectedBefore = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  private cachedSnapshot: MotionWorksStateSnapshot | null = null;
  private entries: JournalEntry[] = [];
  private pendingCorrections = new Map<string, Map<string, TypeCorrection>>();
  private pendingListeners = new Set<() => void>();
  private pendingVersion = 0;
  // The exact local revision crossing the HTTP boundary. Keeping the snapshot
  // explicit prevents a journal poll (especially an old entry with a reused
  // effect id) from deciding whether toolbar verbs are live.
  private committing = new Map<string, CommitAttempt>();
  private ownCommits = new Map<string, OwnCommit>();
  private submittedCorrections = new Map<string, Map<string, ParameterType>>();
  // Effects currently held at their original value by compare mode (P2-3).
  private held = new Set<string>();
  private compareListeners = new Set<() => void>();
  private applyingOwnChange = false;
  private stylesUnsub: (() => void) | null = null;
  private startedAt = 0;
  // Ids of entries this tab applied (source writes). Persisted to sessionStorage
  // so they survive an HMR remount / page reload: a just-applied entry then
  // still counts as *this workflow's* history and keeps chaining a follow-up
  // edit from the applied value, instead of looking like an unrelated
  // earlier-session entry that the `startedAt` guard would drop (stale-baseline
  // bug). Genuinely-old sessions (tab closed) clear sessionStorage, so their
  // applied entries are still treated as history.
  private readonly appliedIds = new Set<string>();

  constructor({ daemonUrl, debug = false }: OverlaySessionOptions) {
    this.bridge = getBridge();
    this.diffScope =
      typeof location === "undefined"
        ? ""
        : `${location.origin}${location.pathname}`;
    this.daemon = new DaemonClient(
      daemonUrl,
      debug ? (message) => console.info(`[MotionWorks] ${message}`) : undefined,
    );
  }

  start(): void {
    this.startedAt = Date.now();
    if (typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(APPLIED_STORAGE_KEY);
        if (raw !== null)
          for (const id of JSON.parse(raw) as string[]) this.appliedIds.add(id);
      } catch {
        // Corrupt/unreadable storage is not worth failing startup over.
      }
    }
    this.diffs.hydrate(loadPersistedDiffs(this.diffScope));
    this.snapshotUnsub = this.state.subscribe(() => {
      this.cachedSnapshot = null;
    });
    this.stateUnsub = this.state.subscribe(() => this.onStateChange());
    this.diffUnsub = this.diffs.subscribe(() =>
      persistDiffs(this.diffScope, this.diffs.toJSON()),
    );
    // Flush the debounced write before the page goes away so a tweak made in
    // the last 100 ms isn't lost (P2-7).
    if (typeof window !== "undefined") {
      this.onPageHide = () => flushPersistedDiffs();
      window.addEventListener("pagehide", this.onPageHide);
    }
    this.statusUnsub = this.daemon.onStatus((status) =>
      this.handleConnectionChange(status !== null),
    );
    this.pendingUnsub = this.daemon.onPending((entries) => {
      const previousStatuses = new Map(
        this.entries.map((entry) => [entry.id, entry.status]),
      );
      this.entries = entries;
      this.adoptJournaledDiffs();
      this.notifyPending();
      for (const entry of entries) {
        if (
          entry.status === "applied" &&
          previousStatuses.get(entry.id) !== "applied"
        ) {
          this.bumpStylesheetLinks(entry);
          // Remember our own source writes (direct CSS, or a verified agent
          // write) so a follow-up edit still chains from the applied value after
          // an HMR remount / reload.
          if (
            entry.appliedBy === "css" ||
            (entry.appliedBy === "agent" && entry.files !== undefined)
          )
            this.rememberApplied(entry.id);
        }
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
    if (this.onPageHide !== null && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
      this.onPageHide = null;
    }
    // Persist any debounced diff immediately on teardown.
    flushPersistedDiffs();
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
    this.ownCommits.clear();
    this.submittedCorrections.clear();
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
    // A live edit supersedes any compare hold on this effect: the page is about
    // to show the new value, so release the hold and notify the overlay to drop
    // its "Showing original" state (P2-3).
    if (this.held.delete(effectId))
      for (const listener of this.compareListeners) listener();
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

  /**
   * Generic replay for effects that don't declare `capabilities.replay`:
   * restart the CSS animations on the effect's node and its subtree so a
   * one-shot entrance re-runs and a running loop starts over. Purely JS-driven
   * motion (no CSS animation) has nothing to restart and is left untouched —
   * those effects opt in via `replay`.
   *
   * We restart the *live* `Animation` objects with `cancel()`+`play()` rather
   * than toggling `style.animation = "none"`. The style toggle cancels the
   * running `CSSAnimation` and spawns a brand-new `Animation`; auto-detect keys
   * its registry by the `Animation` object, so that orphaned the effect's id,
   * broke the selection, and discarded the uncommitted duration edit stored on
   * the old `KeyframeEffect` (P0-3). Operating on the same object preserves all
   * of that. The none+reflow toggle stays as a fallback for elements whose
   * animation isn't a live object right now (e.g. a finished one-shot).
   */
  /**
   * Whether `replayCssAnimation` would actually restart something: the node or
   * its subtree has a non-scroll CSS animation (live, or a named animation the
   * none+reflow toggle can restart). Used to keep the Play button from looking
   * live on a JS-driven effect (react-spring/GSAP) that declared no
   * `capabilities.replay` — there is no CSS animation to restart, so Play would
   * silently do nothing; the toolkit shows the inert "trigger it" chip instead.
   */
  hasReplayableCssAnimation(effectId: string): boolean {
    const node = this.bridge.getNode(effectId);
    if (node === undefined) return false;
    const elements: HTMLElement[] = [
      node,
      ...node.querySelectorAll<HTMLElement>("*"),
    ];
    for (const el of elements) {
      if (
        typeof el.getAnimations === "function" &&
        typeof CSSAnimation !== "undefined" &&
        el
          .getAnimations()
          .some((a) => a instanceof CSSAnimation && !isScrollDriven(a))
      )
        return true;
      const name = getComputedStyle(el).animationName;
      if (name !== "" && name !== "none") return true;
    }
    return false;
  }

  replayCssAnimation(effectId: string): void {
    const node = this.bridge.getNode(effectId);
    if (node === undefined) return;
    const elements: HTMLElement[] = [
      node,
      ...node.querySelectorAll<HTMLElement>("*"),
    ];
    const cssAnimations = (el: HTMLElement): Animation[] =>
      typeof el.getAnimations !== "function" ||
      typeof CSSAnimation === "undefined"
        ? []
        : el
            .getAnimations()
            // Scroll/view-driven animations can't be restarted from script —
            // play() cannot advance a scroll-bound timeline — so a subtree
            // replay leaves them to the designer to trigger.
            .filter((a) => a instanceof CSSAnimation && !isScrollDriven(a));
    for (const el of elements) {
      const live = cssAnimations(el);
      if (live.length > 0) {
        for (const animation of live) {
          animation.cancel();
          animation.play();
        }
        continue;
      }
      const name = getComputedStyle(el).animationName;
      if (name === "" || name === "none") continue;
      const previous = el.style.animation;
      el.style.animation = "none";
      // Force a reflow so the browser commits the removal; without this the
      // two writes collapse and the animation never restarts.
      void el.offsetWidth;
      el.style.animation = previous;
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
    if (hold) this.held.add(effectId);
    else this.held.delete(effectId);
    for (const [param, diff] of Object.entries(
      this.diffs.getUnsubmittedDiff(effectId),
    )) {
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

  /**
   * Subscribes to compare-hold releases. The overlay uses this to drop its
   * "Showing original" state the instant a slider drag supersedes the compare
   * view, so the page and the button label never disagree (P2-3).
   */
  onCompareRelease(listener: () => void): () => void {
    this.compareListeners.add(listener);
    return () => this.compareListeners.delete(listener);
  }

  commit(effectId: string): boolean {
    if (this.committing.has(effectId)) return false;
    const effect = this.state.getEffect(effectId);
    if (effect === undefined) return false;
    const revision = this.diffs.getUnsubmittedDiff(effectId);
    const corrections = [
      ...(this.pendingCorrections.get(effectId)?.values() ?? []),
    ];
    const node = this.bridge.getNode(effectId);
    const changes = Object.entries(revision).flatMap(([param, diff]) => {
      const spec = effect.params[param];
      if (spec === undefined || !spec.bound) return [];
      const queued = this.latestJournalChange(effectId, param, diff.from, true);
      if (queued !== undefined && deepEqual(queued.to, diff.to)) return [];
      const from = queued?.to ?? diff.from;
      const type = this.resolvedType(effectId, param) ?? spec.type;
      // Resolve the declaring rule once, not twice per change (P2-13).
      const rule =
        node === undefined ? undefined : findDeclaringRule(node, spec.var);
      return [
        {
          param,
          type,
          from,
          to: diff.to,
          var: spec.var,
          fromCss: encodeCssValue(type, from, spec.cssUnit),
          toCss: encodeCssValue(type, diff.to, spec.cssUnit),
          ...(rule !== undefined && { rule }),
        },
      ];
    });
    if (changes.length === 0 && corrections.length === 0) return false;
    const request: CommitRequest = {
      page: typeof location === "undefined" ? "" : location.href,
      effectId,
      effectName: effect.name,
      elementSelector: node === undefined ? effect.name : describeNode(node),
      ...(node !== undefined && { mwId: ensureStableId(node) }),
      changes,
      ...(corrections.length > 0 && { typeCorrections: corrections }),
    };
    const attempt: CommitAttempt = {
      diff: revision,
      corrections,
      signature: this.revisionSignature(revision, corrections),
    };
    this.committing.set(effectId, attempt);
    this.notifyPending();
    void this.daemon.commit(request).then((result) => {
      if (result !== null) {
        this.diffs.markSubmitted(effectId, attempt.diff);
        this.markSubmittedCorrections(effectId, attempt.corrections);
        this.removeCommittedCorrections(effectId, attempt.corrections);
        this.ownCommits.set(effectId, {
          id: result.id,
          ...(result.status !== undefined && { status: result.status }),
          ...(result.error !== undefined && { error: result.error }),
        });
      }
      this.committing.delete(effectId);
      this.notifyPending();
    });
    return true;
  }

  private revisionSignature(
    diff: Record<string, Diff>,
    corrections: TypeCorrection[],
  ): string {
    return JSON.stringify([
      Object.entries(diff).sort(([a], [b]) => a.localeCompare(b)),
      corrections
        .map(({ paramKey, correctedType, correctedAt }) => [
          paramKey,
          correctedType,
          correctedAt,
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ]);
  }

  private currentRevisionSignature(effectId: string): string {
    return this.revisionSignature(this.diffs.getUnsubmittedDiff(effectId), [
      ...(this.pendingCorrections.get(effectId)?.values() ?? []),
    ]);
  }

  private markSubmittedCorrections(
    effectId: string,
    corrections: TypeCorrection[],
  ): void {
    if (corrections.length === 0) return;
    let submitted = this.submittedCorrections.get(effectId);
    if (submitted === undefined) {
      submitted = new Map();
      this.submittedCorrections.set(effectId, submitted);
    }
    for (const correction of corrections)
      submitted.set(correction.paramKey, correction.correctedType);
  }

  private removeCommittedCorrections(
    effectId: string,
    corrections: TypeCorrection[],
  ): void {
    const pending = this.pendingCorrections.get(effectId);
    if (pending === undefined) return;
    for (const correction of corrections) {
      if (
        pending.get(correction.paramKey)?.correctedAt === correction.correctedAt
      )
        pending.delete(correction.paramKey);
    }
    if (pending.size === 0) this.pendingCorrections.delete(effectId);
  }

  private rememberApplied(id: string): void {
    if (this.appliedIds.has(id)) return;
    this.appliedIds.add(id);
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem(
          APPLIED_STORAGE_KEY,
          JSON.stringify([...this.appliedIds]),
        );
      } catch {
        // Persistence is best-effort; the in-memory set still works this run.
      }
    }
  }

  private latestJournalChange(
    effectId: string,
    param: string,
    baseline: unknown,
    // When true, skip entries that ERRORED without reaching source — a failed
    // direct write / copy-prompt entry. Chaining such an entry's `to` as the
    // next `from` would make every later commit miss the declaration and cascade
    // into copy-prompts. A clean in-flight pending/agent-working entry (no error)
    // is still chained so rapid repeated applies coalesce from the latest queued
    // value. Used for a commit's `from`; hasCommitDelta leaves this false so a
    // queued-but-not-yet-written intent still counts as "already represented".
    skipUnwritten = false,
  ): JournalEntry["changes"][number] | undefined {
    let cursor = baseline;
    let latest: JournalEntry["changes"][number] | undefined;
    for (const entry of this.entries) {
      if (!this.entryBelongsToEffect(entry, effectId)) continue;
      if (
        skipUnwritten &&
        entry.status !== "applied" &&
        entry.error !== undefined
      )
        continue;
      // An applied entry from an earlier browser session is history, not an
      // active continuation — the fresh registration baseline already tells us
      // what source holds after a reload. But an entry THIS tab applied (in
      // appliedIds, persisted across an HMR remount) is our own recent work, so
      // keep chaining a follow-up edit from its applied value.
      if (
        entry.status === "applied" &&
        entry.createdAt < this.startedAt &&
        !this.appliedIds.has(entry.id)
      )
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

  private entryBelongsToEffect(entry: JournalEntry, effectId: string): boolean {
    if (entry.effectId !== effectId) return false;
    if (typeof location !== "undefined") {
      try {
        const page = new URL(entry.page, location.href);
        if (
          page.origin !== location.origin ||
          page.pathname !== location.pathname ||
          page.search !== location.search
        )
          return false;
      } catch {
        return false;
      }
    }
    const node = this.bridge.getNode(effectId);
    if (node === undefined) return false;
    if (entry.mwId !== undefined) return ensureStableId(node) === entry.mwId;
    // Legacy entries predate the durable mwId. Keep their compatibility narrow:
    // the human selector must still resolve to this exact node.
    if (entry.elementSelector === describeNode(node)) return true;
    try {
      return node.matches(entry.elementSelector);
    } catch {
      return false;
    }
  }

  // Migration/reload path: persisted diffs written before the submitted
  // boundary existed are classified only when this exact page+element's journal
  // forms a continuous chain to the retained `to`. Journal data can therefore
  // make a committed revision inert, but can never manufacture a fresh active
  // revision in the toolbar.
  private adoptJournaledDiffs(): void {
    for (const effect of this.state.getAllEffects()) {
      const diff = this.diffs.getDiff(effect.id);
      if (Object.keys(diff).length === 0) continue;
      const entries = this.entries.filter((entry) =>
        this.entryBelongsToEffect(entry, effect.id),
      );
      const covered: Record<string, Diff> = {};
      for (const [param, intent] of Object.entries(diff)) {
        let cursor = intent.from;
        for (const entry of entries) {
          for (const change of entry.changes) {
            if (change.param !== param || !deepEqual(change.from, cursor))
              continue;
            cursor = change.to;
          }
        }
        if (deepEqual(cursor, intent.to)) covered[param] = intent;
      }
      this.diffs.markSubmitted(effect.id, covered);
    }
  }

  hasCommitDelta(effectId: string): boolean {
    const hasLocalRevision =
      this.diffs.hasUnsubmittedDiff(effectId) ||
      this.hasPendingCorrections(effectId);
    if (!hasLocalRevision) return false;
    const inFlight = this.committing.get(effectId);
    return (
      inFlight === undefined ||
      inFlight.signature !== this.currentRevisionSignature(effectId)
    );
  }

  isCommitPending(effectId: string | null): boolean {
    return (
      effectId !== null &&
      (this.committing.has(effectId) ||
        this.entries.some(
          (entry) =>
            this.entryBelongsToEffect(entry, effectId) &&
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
      [...this.entries]
        .reverse()
        .find((entry) => this.entryBelongsToEffect(entry, effectId))?.status ??
      null
    );
  }

  getCommitOutcome(effectId: string | null): CommitOutcome | null {
    if (effectId === null) return null;
    if (this.committing.has(effectId)) return "in-flight";
    const own = this.ownCommits.get(effectId);
    if (own === undefined) return null;
    const entry = this.entries.find((candidate) => candidate.id === own.id);
    const status = entry?.status ?? own.status;
    const error = entry?.error ?? own.error;
    if (status === "applied") return "applied";
    if (status === "pending" && error !== undefined) return "prompt";
    return "in-flight";
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
        this.diffs.getUnsubmittedDiff(effectId),
      )) {
        if (this.diffs.hasSubmittedValue(effectId, param)) {
          const submitted = this.diffs.getSubmittedValue(effectId, param);
          for (const target of this.matchingTargets(effectId, param)) {
            applyLive(target.node, target.spec, target.binding, submitted);
          }
          this.applyOwnChange(effectId, param, submitted);
          this.diffs.recordChange(effectId, param, diff.to, submitted);
        } else {
          for (const target of this.matchingTargets(effectId, param)) {
            restoreLive(target.node, target.binding);
          }
          this.applyOwnChange(effectId, param, diff.from);
          this.diffs.clearParam(effectId, param);
        }
      }
    }
    const corrections = this.pendingCorrections.get(effectId);
    if (corrections !== undefined) {
      const submitted = this.submittedCorrections.get(effectId);
      for (const paramKey of corrections.keys()) {
        const submittedType = submitted?.get(paramKey);
        if (submittedType === undefined)
          this.typeOverrides.clearParam(effectId, paramKey);
        else this.typeOverrides.set(effectId, paramKey, submittedType);
      }
      this.pendingCorrections.delete(effectId);
      this.notifyPending();
    }
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
    for (const entry of this.entries.filter((candidate) =>
      this.entryBelongsToEffect(candidate, effectId),
    )) {
      const changesClean = entry.changes.every((change) =>
        deepEqual(change.to, baselines[change.param]),
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
    // The first /pending poll and the first registration can arrive in either
    // order. Re-run the one-way classification here so a hydrated, already
    // journaled diff never flashes as a fresh decision after registration.
    this.adoptJournaledDiffs();
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
      const submittedCorrections = this.submittedCorrections.get(effect.id);
      if (submittedCorrections !== undefined) {
        for (const [paramKey, submittedType] of submittedCorrections) {
          if (effect.params[paramKey]?.type === submittedType)
            submittedCorrections.delete(paramKey);
        }
        if (submittedCorrections.size === 0)
          this.submittedCorrections.delete(effect.id);
      }
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
    this.bumpStylesheetsByPaths(
      new Set([
        ...(entry.files ?? []),
        ...entry.changes.flatMap((change) =>
          change.rule?.sheetHref ? [change.rule.sheetHref] : [],
        ),
      ]),
    );
  }

  // Re-fetch every stylesheet that currently declares a registered param, so
  // the tab's CSSOM baseline matches disk again after a daemon restart or any
  // external source change. Without this, a reconnect leaves the baseline stale
  // and the next commit's `from` misses the (now different) declaration —
  // reverting direct writes to copy-prompts.
  private resyncSourceStylesheets(): void {
    if (typeof document === "undefined") return;
    const hrefs = new Set<string>();
    for (const effect of this.state.getAllEffects()) {
      const node = this.bridge.getNode(effect.id);
      if (node === undefined) continue;
      for (const spec of Object.values(effect.params)) {
        if (!spec.bound) continue;
        const rule = findDeclaringRule(node, spec.var);
        if (rule?.sheetHref) hrefs.add(rule.sheetHref);
      }
    }
    this.bumpStylesheetsByPaths(hrefs);
  }

  private bumpStylesheetsByPaths(sourcePaths: Set<string>): void {
    if (typeof document === "undefined") return;
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
    // On a reconnect (daemon restart / dropped socket) the source may have
    // changed while we were away; re-fetch the backing stylesheets so the
    // baseline matches disk and direct writes keep working.
    if (connected) {
      if (this.hasConnectedBefore) this.resyncSourceStylesheets();
      this.hasConnectedBefore = true;
    }
  }
}
