import { useSyncExternalStore } from "react";

import { useOverlaySession } from "./context.js";
import type { MotionWorksStateSnapshot } from "../../shared/index.js";

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

export function useConnection(): boolean {
  const session = useOverlaySession();
  return useSyncExternalStore(
    (l) => session.subscribeConnection(l),
    () => session.isConnected(),
    () => false,
  );
}

export function useAgentQueue(): {
  id: string;
  effectId: string;
  effectName: string;
  changeCount: number;
  signature: string;
}[] {
  const session = useOverlaySession();
  useSyncExternalStore(
    (listener) => session.subscribePending(listener),
    () => session.getPendingVersion(),
    () => 0,
  );
  return session.getAgentQueue();
}

export function useCommitOutcome(
  effectId: string | null,
): "in-flight" | "prompt" | "applied" | null {
  const session = useOverlaySession();
  useSyncExternalStore(
    (listener) => session.subscribePending(listener),
    () => session.getPendingVersion(),
    () => 0,
  );
  return session.getCommitOutcome(effectId);
}
