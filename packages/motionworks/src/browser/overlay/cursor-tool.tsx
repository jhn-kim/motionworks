import type { ParameterType } from "../../shared/index.js";

import type { ScaleSpec } from "./scale.js";

// The shape of a numeric parameter binding as the slider panels describe it.
// The "cursor tool" arm-then-scroll interaction this once powered was never
// wired up (no provider, no wheel listener), so its context/hook were removed;
// only this descriptor type survives, consumed by the family slider panel and
// the renderer's panel-item builder (P0-2).
export interface ArmedTool {
  effectId: string;
  paramKey: string;
  axis?: "stiffness" | "damping" | "mass";
  label: string;
  unit?: string | undefined;
  spec: ScaleSpec;
  type: ParameterType;
}
