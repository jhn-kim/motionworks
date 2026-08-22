export type {
  EasingCurveValue,
  GradientStop,
  MotionWorksCapabilities,
  MotionWorksEffect,
  MotionWorksParam,
  MotionWorksRegistration,
  ParameterType,
  ParamDiff,
  PathPoint,
  SourceHint,
  SpringValue,
  TypeCorrection,
} from "./types.js";
export type {
  CommitRequest,
  JournalChange,
  JournalEntry,
  JournalStatus,
  SelectRequest,
  StatusResponse,
} from "./journal-types.js";

export { validateRegistration } from "./validate.js";
export type { ValidationResult } from "./validate.js";

export { MotionWorksStateManager } from "./state.js";
export type { MotionWorksStateSnapshot } from "./state.js";
