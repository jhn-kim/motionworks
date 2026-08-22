import type { MotionWorksParam } from "../../../../shared/index.js";

// Every surface receives the same shape. Individual surfaces narrow
// `liveValue` (and sometimes `param.value`) to what their type contract
// promises.
export interface SurfaceProps<T = unknown> {
  effectId: string;
  paramKey: string;
  param: MotionWorksParam;
  liveValue: T;
  node: HTMLElement;
}
