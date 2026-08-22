import type {
  EasingCurveValue,
  GradientStop,
  ParameterType,
  PathPoint,
  SpringValue,
} from "./types.js";

export const KEYWORD_CURVES: Record<string, EasingCurveValue> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

export function parseEasing(css: string): EasingCurveValue | null {
  const keyword = KEYWORD_CURVES[css.trim().toLowerCase()];
  if (keyword !== undefined) return { ...keyword };
  const match =
    /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i.exec(
      css.trim(),
    );
  if (match === null) return null;
  return {
    x1: Number(match[1]),
    y1: Number(match[2]),
    x2: Number(match[3]),
    y2: Number(match[4]),
  };
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const NUMERIC_TYPES = new Set<ParameterType>([
  "spatial-radius",
  "spatial-strength",
  "temporal-decay",
  "temporal-response",
  "stagger",
  "duration",
  "scalar",
]);
const UNSUPPORTED_UNITS = new Set([
  "rem",
  "em",
  "vw",
  "vh",
  "vmin",
  "vmax",
  "%",
]);

export function defaultUnitFor(
  type: ParameterType,
  schemaUnit?: string,
): string {
  if (schemaUnit !== undefined) return schemaUnit;
  if (type === "spatial-radius") return "px";
  if (type === "stagger" || type === "duration") return "ms";
  return "";
}

function splitTopLevel(value: string, separator = ","): string[] {
  const result: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index] ?? "";
    if (quote !== "") {
      if (char === quote && value[index - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === separator && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

export function decodeCssValue(
  type: ParameterType,
  css: string,
): { value: unknown; unit: string } | null {
  const trimmed = css.trim();
  if (NUMERIC_TYPES.has(type)) {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(trimmed);
    if (match === null) return null;
    const unit = (match[2] ?? "").toLowerCase();
    if (UNSUPPORTED_UNITS.has(unit)) return null;
    let value = Number(match[1]);
    let normalizedUnit = unit;
    if ((type === "duration" || type === "stagger") && unit === "s") {
      value *= 1000;
      normalizedUnit = "s";
    }
    return { value, unit: normalizedUnit };
  }
  if (type === "easing-curve") {
    const value = parseEasing(trimmed);
    return value === null ? null : { value, unit: "" };
  }
  if (type === "spring-response") {
    const parts = trimmed.split(/\s+/).map(Number);
    if (
      parts.some((part) => !Number.isFinite(part)) ||
      (parts.length !== 1 && parts.length !== 2 && parts.length !== 3)
    )
      return null;
    if (parts.length === 1) return { value: parts[0], unit: "" };
    return {
      value: {
        stiffness: parts[0],
        damping: parts[1],
        ...(parts[2] !== undefined && { mass: parts[2] }),
      },
      unit: "",
    };
  }
  if (type === "gradient") {
    const stops: GradientStop[] = [];
    for (const part of splitTopLevel(trimmed)) {
      const match = /^(.*\S)\s+(-?(?:\d+\.?\d*|\.\d+))%$/.exec(part);
      if (match === null) return null;
      stops.push({ color: match[1] ?? "", stop: Number(match[2]) / 100 });
    }
    return stops.length === 0 ? null : { value: stops, unit: "" };
  }
  if (type === "path") {
    const match = /^path\(\s*(["'])(.*)\1\s*\)$/i.exec(trimmed);
    if (match === null) return null;
    const tokens = (match[2] ?? "")
      .trim()
      .match(/[MLC]|-?(?:\d+\.?\d*|\.\d+)/gi);
    if (
      tokens === null ||
      tokens.join(" ").replace(/\s+/g, "") !==
        (match[2] ?? "").replace(/[ ,]+/g, "")
    )
      return null;
    const points: PathPoint[] = [];
    let index = 0;
    while (index < tokens.length) {
      const command = tokens[index++]?.toUpperCase();
      if (command !== "M" && command !== "L" && command !== "C") return null;
      const count = command === "C" ? 6 : 2;
      const nums = tokens.slice(index, index + count).map(Number);
      if (nums.length !== count || nums.some((n) => !Number.isFinite(n)))
        return null;
      index += count;
      if (command === "C")
        points.push({
          x: nums[4]!,
          y: nums[5]!,
          cp1: { x: nums[0]!, y: nums[1]! },
          cp2: { x: nums[2]!, y: nums[3]! },
        });
      else points.push({ x: nums[0]!, y: nums[1]! });
    }
    return points.length === 0 ? null : { value: points, unit: "" };
  }
  return null;
}

export function encodeCssValue(
  type: ParameterType,
  value: unknown,
  unit: string,
): string {
  if (NUMERIC_TYPES.has(type)) {
    let number = value as number;
    if ((type === "duration" || type === "stagger") && unit === "s")
      number /= 1000;
    return `${formatNumber(number)}${unit}`;
  }
  if (type === "easing-curve") {
    const curve = value as EasingCurveValue;
    return `cubic-bezier(${formatNumber(curve.x1)}, ${formatNumber(curve.y1)}, ${formatNumber(curve.x2)}, ${formatNumber(curve.y2)})`;
  }
  if (type === "spring-response") {
    if (typeof value === "number") return formatNumber(value);
    const spring = value as SpringValue;
    return [spring.stiffness, spring.damping, spring.mass]
      .filter((part) => part !== undefined)
      .map((part) => formatNumber(part!))
      .join(" ");
  }
  if (type === "gradient")
    return (value as GradientStop[])
      .map((stop) => `${stop.color} ${formatNumber(stop.stop * 100)}%`)
      .join(", ");
  if (type === "path") {
    return `path("${(value as PathPoint[]).map((point, index) => (point.cp1 !== undefined && point.cp2 !== undefined ? `C ${formatNumber(point.cp1.x)} ${formatNumber(point.cp1.y)} ${formatNumber(point.cp2.x)} ${formatNumber(point.cp2.y)} ${formatNumber(point.x)} ${formatNumber(point.y)}` : `${index === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`)).join(" ")}")`;
  }
  return String(value);
}

export function cssValuesEqual(
  type: ParameterType,
  a: string,
  b: string,
): boolean {
  const left = decodeCssValue(type, a);
  const right = decodeCssValue(type, b);
  if (left === null || right === null) return false;
  if (NUMERIC_TYPES.has(type)) {
    const timeUnit = (unit: string): string =>
      unit === "s" || unit === "ms" ? "time" : unit;
    const leftUnit =
      type === "duration" || type === "stagger"
        ? timeUnit(left.unit)
        : left.unit;
    const rightUnit =
      type === "duration" || type === "stagger"
        ? timeUnit(right.unit)
        : right.unit;
    return leftUnit === rightUnit && left.value === right.value;
  }
  return JSON.stringify(left.value) === JSON.stringify(right.value);
}
