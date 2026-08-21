import * as React from 'react';

interface OwnerLike {
  type?: unknown;
  elementType?: unknown;
}

interface DispatcherLike {
  getOwner: () => OwnerLike | null;
}

interface SharedInternals {
  A?: DispatcherLike | null;
}

function readOwner(): OwnerLike | null {
  const internals =
    (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: SharedInternals })
      .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const dispatcher = internals?.A;
  if (dispatcher == null || typeof dispatcher.getOwner !== 'function') return null;
  return dispatcher.getOwner();
}

function readNameFromType(type: unknown): string | null {
  if (type == null || (typeof type !== 'function' && typeof type !== 'object')) return null;
  const named = type as { displayName?: unknown; name?: unknown };
  if (typeof named.displayName === 'string' && named.displayName.length > 0) {
    return named.displayName;
  }
  if (typeof named.name === 'string' && named.name.length > 0) return named.name;
  return null;
}

// Best-effort component-name lookup. React 19 uses a dispatcher-based owner
// stack accessed via ReactSharedInternals.A. If the internal shape changes,
// falls back to 'Anonymous' — the effect still registers, but IDs become
// less stable across HMR remounts of similarly-named components.
export function getCallerComponentName(): string {
  const owner = readOwner();
  if (owner === null) return 'Anonymous';
  return readNameFromType(owner.type) ?? readNameFromType(owner.elementType) ?? 'Anonymous';
}

// Combines component name + schema name into a single stable id.
// Stable across HMR because both inputs are compile-time strings.
export function makeEffectId(componentName: string, schemaName: string): string {
  return `${componentName}::${schemaName}`;
}
