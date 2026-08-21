export type {
  DownstreamMessage,
  EasingCurveValue,
  GradientStop,
  MotionWorksCapabilities,
  MotionWorksChangeset,
  MotionWorksEffect,
  MotionWorksParam,
  MotionWorksRegistration,
  ParameterType,
  ParamDiff,
  PathPoint,
  SourceHint,
  SpringValue,
  TypeCorrection,
  UpstreamMessage,
} from './types.js';

export { validateRegistration } from './validate.js';
export type { ValidationResult } from './validate.js';

export { MotionWorksStateManager } from './state.js';
export type { MotionWorksStateSnapshot } from './state.js';
