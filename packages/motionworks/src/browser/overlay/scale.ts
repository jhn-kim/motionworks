import type { ParameterType } from "../../shared/index.js";

// The designer-facing 0–10 scale. Every scalar tool is adjusted on this
// normalized scale; the mapping to real units is per-type so that equal
// scroll increments produce equal *perceived* change:
//   linear — spatial distances, 0–1 fractions, generic scalars
//   log    — spring physics (the low end is where feel character lives)
//   quad   — durations/staggers (resolution where motion actually happens,
//            100–400ms, instead of cramming it into the first tick)
// Real values remain the source of truth everywhere (writeback, wire, and
// the agent never see 0–10).

export type ScaleCurve = "linear" | "log" | "quad";

export interface ScaleSpec {
  min: number;
  max: number;
  curve: ScaleCurve;
}

export function curveForType(type: ParameterType): ScaleCurve {
  switch (type) {
    case "duration":
    case "stagger":
      return "quad";
    case "spring-response":
      return "log";
    default:
      return "linear";
  }
}

export function clampScale(scale: number): number {
  return Math.min(10, Math.max(0, scale));
}

// A log curve needs a positive floor; schemas with min = 0 get a floor two
// decades under max so 0 on the dial still means "almost nothing".
function logFloor(spec: ScaleSpec): number {
  return spec.min > 0 ? spec.min : Math.max(spec.max / 100, 1e-3);
}

export function scaleToValue(scale: number, spec: ScaleSpec): number {
  const t = clampScale(scale) / 10;
  switch (spec.curve) {
    case "linear":
      return spec.min + (spec.max - spec.min) * t;
    case "quad":
      return spec.min + (spec.max - spec.min) * t * t;
    case "log": {
      const min = logFloor(spec);
      return min * Math.pow(spec.max / min, t);
    }
  }
}

export function valueToScale(value: number, spec: ScaleSpec): number {
  if (!(spec.max > spec.min)) return 0;
  let t: number;
  switch (spec.curve) {
    case "linear":
      t = (value - spec.min) / (spec.max - spec.min);
      break;
    case "quad":
      t = Math.sqrt(Math.max(0, value - spec.min) / (spec.max - spec.min));
      break;
    case "log": {
      const min = logFloor(spec);
      t = value <= min ? 0 : Math.log(value / min) / Math.log(spec.max / min);
      break;
    }
  }
  // Tenths are the finest step the dial exposes.
  return clampScale(Math.round(t * 100) / 10);
}

// "7", "6.4" — integers display clean, everything else one decimal.
export function formatScale(scale: number): string {
  const rounded = Math.round(scale * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Real-unit readout beside the dial number: enough digits to trust, few
// enough to stay small.
export function formatReal(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit ?? ""}`;
}
