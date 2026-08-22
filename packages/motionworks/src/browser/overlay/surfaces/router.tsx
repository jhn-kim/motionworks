import type { MotionWorksEffect, ParameterType } from '../../../shared/index.js';

import { GradientSurface } from './gradient.js';
import { PathSurface } from './path.js';
import { ScalarSurface } from './scalar.js';
import { SpatialRadiusSurface } from './spatial-radius.js';
import { SpatialStrengthSurface } from './spatial-strength.js';
import { SpringResponseSurface } from './spring-response.js';
import { StaggerSurface } from './stagger.js';
import { TemporalDecaySurface } from './temporal-decay.js';
import { TemporalResponseSurface } from './temporal-response.js';

interface Props {
  effect: MotionWorksEffect;
  node: HTMLElement;
  liveValue: unknown;
  paramKey: string;
  effectiveType: ParameterType;
}

// Dispatches a single param to its surface component. Split from svg-layer
// so a re-registration + type-override change is a pure per-param prop
// update rather than a full re-mount of the layer.
export function SurfaceForParam({
  effect,
  node,
  liveValue,
  paramKey,
  effectiveType,
}: Props): React.JSX.Element | null {
  const param = effect.params[paramKey];
  if (param === undefined) return null;

  // Every surface receives the same shape so the router stays uniform. The
  // surface itself decides what to do with the live value (guard on type).
  const common = {
    effectId: effect.id,
    paramKey,
    param: { ...param, type: effectiveType },
    liveValue,
    node,
  };

  switch (effectiveType) {
    case 'spatial-radius':
      return typeof liveValue === 'number' ? (
        <SpatialRadiusSurface {...common} liveValue={liveValue} />
      ) : null;
    case 'spatial-strength':
      return typeof liveValue === 'number' ? (
        <SpatialStrengthSurface {...common} liveValue={liveValue} />
      ) : null;
    case 'temporal-decay':
      return typeof liveValue === 'number' ? (
        <TemporalDecaySurface {...common} liveValue={liveValue} />
      ) : null;
    case 'temporal-response':
      return typeof liveValue === 'number' ? (
        <TemporalResponseSurface {...common} liveValue={liveValue} />
      ) : null;
    case 'spring-response':
      return <SpringResponseSurface {...common} liveValue={liveValue} />;
    case 'gradient':
      return Array.isArray(liveValue) ? (
        <GradientSurface {...common} liveValue={liveValue as { stop: number; color: string }[]} />
      ) : null;
    case 'path':
      return Array.isArray(liveValue) ? (
        <PathSurface {...common} liveValue={liveValue as { x: number; y: number }[]} />
      ) : null;
    case 'stagger':
      return typeof liveValue === 'number' ? (
        <StaggerSurface {...common} liveValue={liveValue} effectName={effect.name} />
      ) : null;
    case 'scalar':
      return typeof liveValue === 'number' ? (
        <ScalarSurface {...common} liveValue={liveValue} />
      ) : null;
    // duration / easing-curve have no on-element surface — they are edited
    // exclusively in the toolkit panels.
    default:
      return null;
  }
}
