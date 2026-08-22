import { useSyncExternalStore } from "react";

import { useOverlaySession } from "./context.js";
import type {
  JournalStatus,
  MotionWorksStateSnapshot,
} from "@motionworks/core";

// Subscribes to the state manager and returns a live snapshot. Uses the
// session's cached snapshot so useSyncExternalStore sees the same
// reference across renders when state has not changed.
export function useSessionState(): MotionWorksStateSnapshot {
  const session = useOverlaySession();
  return useSyncExternalStore(
    (l) => session.state.subscribe(l),
    () => session.getStateSnapshot(),
    () => session.getStateSnapshot(),
  );
}

export function useHasDiff(effectId: string | null): boolean {
  const session = useOverlaySession();
  return useSyncExternalStore(
    (l) => session.diffs.subscribe(l),
    () => (effectId === null ? false : session.diffs.hasDiff(effectId)),
    () => false,
  );
}

export function useUnexpectedFlags(
  effectId: string | null,
): ReadonlySet<string> {
  const session = useOverlaySession();
  return useSyncExternalStore(
    (l) => session.diffs.subscribe(l),
    () => (effectId === null ? EMPTY_SET : session.diffs.getFlags(effectId)),
    () => EMPTY_SET,
  );
}

export function useConnection(): boolean {
  const session = useOverlaySession();
  return useSyncExternalStore(
    (l) => session.subscribeConnection(l),
    () => session.isConnected(),
    () => false,
  );
}

export function usePendingCommit(effectId: string | null): boolean {
  const session = useOverlaySession();
  useSyncExternalStore(
    (l) => session.subscribePending(l),
    () => session.getPendingVersion(),
    () => 0,
  );
  return session.isCommitPending(effectId);
}

/** Journal entries still waiting for the agent (status `pending`). */
export function useAgentQueue(): {
  id: string;
  effectId: string;
  effectName: string;
}[] {
  const session = useOverlaySession();
  useSyncExternalStore(
    (l) => session.subscribePending(l),
    () => session.getPendingVersion(),
    () => 0,
  );
  return session.getAgentQueue();
}

/** Status of the newest journal entry for an effect, or null when none. */
export function useEntryStatus(effectId: string | null): JournalStatus | null {
  const session = useOverlaySession();
  useSyncExternalStore(
    (l) => session.subscribePending(l),
    () => session.getPendingVersion(),
    () => 0,
  );
  return session.getEntryStatus(effectId);
}

const EMPTY_SET: ReadonlySet<string> = new Set();
