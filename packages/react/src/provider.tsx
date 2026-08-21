import { useEffect, useState, type ComponentType } from 'react';

import type { OverlayRendererProps } from './overlay/renderer.js';

const IS_DEV = process.env.NODE_ENV === 'development';

export interface MotionWorksProviderProps {
  port?: number;
  debug?: boolean;
}

// Thin wrapper: renders nothing in production, and in development lazily
// loads the overlay renderer chunk. Consumers should still gate the mount
// site itself with a NODE_ENV check + dynamic import (see OVERLAY.md) so
// the provider module itself is dead code in production bundles — but if
// someone forgets, the render path here still short-circuits.
export function MotionWorksProvider(props: MotionWorksProviderProps): React.JSX.Element | null {
  const [Renderer, setRenderer] = useState<ComponentType<OverlayRendererProps> | null>(null);

  useEffect(() => {
    if (!IS_DEV) return;
    let cancelled = false;
    void import('./overlay/renderer.js')
      .then((mod) => {
        if (cancelled) return;
        setRenderer(() => mod.OverlayRenderer);
      })
      .catch((err: unknown) => {
        console.error('[MotionWorks] overlay renderer failed to load:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!IS_DEV || Renderer === null) return null;
  return <Renderer {...props} />;
}
