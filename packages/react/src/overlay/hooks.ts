import { useSyncExternalStore } from "react";

import { useOverlaySession } from "./context.js";
import type { MotionWorksStateSnapshot } from "@motionworks/core";

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
