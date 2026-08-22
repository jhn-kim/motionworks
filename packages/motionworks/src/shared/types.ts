export type ParameterType =
  | "spatial-radius"
  | "spatial-strength"
  | "temporal-decay"
  | "temporal-response"
  | "spring-response"
  | "gradient"
  | "path"
  | "stagger"
  | "duration"
  | "easing-curve"
  | "scalar";

// Cubic bezier control points for `easing-curve`, matching CSS
// cubic-bezier(x1, y1, x2, y2). x values are clamped to [0, 1]; y values may
// exceed the range (overshoot / anticipation).
export interface EasingCurveValue {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpringValue {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface GradientStop {
  stop: number;
  color: string;
}

export interface PathPoint {
  x: number;
  y: number;
  cp1?: { x: number; y: number };
  cp2?: { x: number; y: number };
}

export interface MotionWorksParam {
  type: ParameterType;
  label?: string;
  min?: number;
  max?: number;
  unit?: string;
  var?: string;
}

// Optional per-effect capability flags. Opt-in signals for global overlay
// surfaces (currently only the scrubber). Kept off the params map so it
// doesn't accidentally participate in schema validation or diff tracking.
// Choice: the scrubber opts in via `capabilities.scrub === true` rather than
// implicit detection of the reserved `__motionworksScrub` key. Rationale:
// implicit detection would false-positive on any update() that reads
// `params.__motionworksScrub` conditionally, and false-negative on effects
// whose update() eventually pipes reserved keys through a merge step. An
// explicit flag makes the contract legible in the agent-generated code.
export interface MotionWorksCapabilities {
  scrub?: boolean;
  // One-shot effects (entrances) opt in to the toolkit's Replay button.
  // When pressed, update() receives the reserved `__motionworksReplay` key
  // and should re-run the animation from its initial state.
  replay?: boolean;
}

export interface MotionWorksRegistration {
  name: string;
  params: Record<string, MotionWorksParam>;
  capabilities?: MotionWorksCapabilities;
}

export interface MotionWorksRuntimeParam extends MotionWorksParam {
  value: unknown;
  var: string;
  cssUnit: string;
  bound: boolean;
}

export interface MotionWorksEffect {
  id: string;
  name: string;
  params: Record<string, MotionWorksRuntimeParam>;
  capabilities?: MotionWorksCapabilities;
}

// A single parameter change within a commit.
// A designer-initiated correction to a param's declared type.
export interface TypeCorrection {
  effectName: string;
  paramKey: string;
  previousType: ParameterType;
  correctedType: ParameterType;
  correctedAt: number;
}
