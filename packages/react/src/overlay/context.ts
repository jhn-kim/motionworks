import { createContext, useContext } from 'react';

import type { OverlaySession } from './session.js';

export const OverlaySessionContext = createContext<OverlaySession | null>(null);

export function useOverlaySession(): OverlaySession {
  const session = useContext(OverlaySessionContext);
  if (session === null) {
    throw new Error('useOverlaySession must be used within OverlayRenderer');
  }
  return session;
}
