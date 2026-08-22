import type {
  MotionWorksParam,
  MotionWorksRegistration,
  ParameterType,
} from "./types.js";

export interface ValidationResult {
  nameValid: boolean;
  params: Record<string, MotionWorksParam>;
  skippedParams: string[];
  correctedTypes: string[];
}

const VALID_TYPES = new Set<string>([
  "spatial-radius",
  "spatial-strength",
  "temporal-decay",
  "temporal-response",
  "spring-response",
  "gradient",
  "path",
  "stagger",
  "duration",
  "easing-curve",
  "scalar",
]);
const SPECIAL_VARS = new Set([
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
]);
const warned = new WeakSet<object>();
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validateRegistration(
  registration: MotionWorksRegistration,
): ValidationResult {
  const raw = registration as unknown;
  const record = object(raw) ? raw : {};
  const rawParams = object(record.params) ? record.params : {};
  if (
    !warned.has(record) &&
    (record.update !== undefined ||
      Object.values(rawParams).some(
        (param) => object(param) && "value" in param,
      ))
  ) {
    warned.add(record);
    console.warn(
      "MotionWorks 0.5 reads values from CSS custom properties; see MOTIONWORKS.md",
    );
  }
  const params: Record<string, MotionWorksParam> = {};
  const skippedParams: string[] = [];
  const correctedTypes: string[] = [];
  for (const [key, value] of Object.entries(rawParams)) {
    if (!object(value)) {
      skippedParams.push(key);
      continue;
    }
    const type =
      typeof value.type === "string" && VALID_TYPES.has(value.type)
        ? (value.type as ParameterType)
        : (correctedTypes.push(key), "scalar" as const);
    const rawVar = typeof value.var === "string" ? value.var : undefined;
    const variable =
      rawVar === undefined ||
      rawVar.startsWith("--") ||
      SPECIAL_VARS.has(rawVar)
        ? rawVar
        : undefined;
    if (value.var !== undefined && variable === undefined)
      console.warn(
        `[MotionWorks] Param "${key}" has invalid var "${String(value.var)}"; using --mw-${key}.`,
      );
    const min =
      typeof value.min === "number" && Number.isFinite(value.min)
        ? value.min
        : undefined;
    const max =
      typeof value.max === "number" && Number.isFinite(value.max)
        ? value.max
        : undefined;
    const bounds = min === undefined || max === undefined || min < max;
    params[key] = {
      type,
      ...(typeof value.label === "string" && { label: value.label }),
      ...(typeof value.unit === "string" && { unit: value.unit }),
      ...(variable !== undefined && { var: variable }),
      ...(bounds && min !== undefined && { min }),
      ...(bounds && max !== undefined && { max }),
    };
  }
  return {
    nameValid: typeof record.name === "string" && record.name.trim().length > 0,
    params,
    skippedParams,
    correctedTypes,
  };
}
