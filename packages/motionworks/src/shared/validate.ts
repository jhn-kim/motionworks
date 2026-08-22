import type { MotionWorksParam, MotionWorksRegistration, ParameterType } from './types.js';

export interface ValidationResult {
  nameValid: boolean;
  readOnly: boolean;
  params: Record<string, MotionWorksParam>;
  // Param keys removed because their value didn't match the declared type (rule 3).
  skippedParams: string[];
  // Param keys whose declared type was unknown and was corrected to 'scalar' (rule 2).
  correctedTypes: string[];
}

const VALID_TYPES = new Set<string>([
  'spatial-radius',
  'spatial-strength',
  'temporal-decay',
  'temporal-response',
  'spring-response',
  'gradient',
  'path',
  'stagger',
  'duration',
  'easing-curve',
  'scalar',
]);

function isValidValue(type: ParameterType, value: unknown): boolean {
  switch (type) {
    case 'spatial-radius':
    case 'spatial-strength':
    case 'temporal-decay':
    case 'temporal-response':
    case 'stagger':
    case 'duration':
    case 'scalar':
      return typeof value === 'number';

    case 'easing-curve': {
      if (typeof value !== 'object' || value === null) return false;
      const v = value as Record<string, unknown>;
      return (
        typeof v['x1'] === 'number' &&
        typeof v['y1'] === 'number' &&
        typeof v['x2'] === 'number' &&
        typeof v['y2'] === 'number'
      );
    }

    case 'spring-response': {
      if (typeof value === 'number') return true;
      if (typeof value !== 'object' || value === null) return false;
      const v = value as Record<string, unknown>;
      return typeof v['stiffness'] === 'number' && typeof v['damping'] === 'number';
    }

    case 'gradient': {
      if (!Array.isArray(value)) return false;
      return (value as unknown[]).every((s) => {
        if (typeof s !== 'object' || s === null) return false;
        const stop = s as Record<string, unknown>;
        return typeof stop['stop'] === 'number' && typeof stop['color'] === 'string';
      });
    }

    case 'path': {
      if (!Array.isArray(value)) return false;
      return (value as unknown[]).every((p) => {
        if (typeof p !== 'object' || p === null) return false;
        const pt = p as Record<string, unknown>;
        return typeof pt['x'] === 'number' && typeof pt['y'] === 'number';
      });
    }
  }
}

export function validateRegistration(registration: MotionWorksRegistration): ValidationResult {
  // Rule 1: name must be a non-empty string.
  const nameValid = typeof registration.name === 'string' && registration.name.length > 0;

  // Rule 4: update must be a function; absence or wrong type → read-only.
  const readOnly = typeof registration.update !== 'function';

  const params: Record<string, MotionWorksParam> = {};
  const skippedParams: string[] = [];
  const correctedTypes: string[] = [];

  for (const [key, param] of Object.entries(registration.params)) {
    // Rule 2: unknown type → fallback to 'scalar'.
    let resolvedType: ParameterType;
    if (VALID_TYPES.has(param.type)) {
      resolvedType = param.type as ParameterType;
    } else {
      resolvedType = 'scalar';
      correctedTypes.push(key);
    }

    // Rule 3: value/type mismatch → skip param with a warning.
    if (!isValidValue(resolvedType, param.value)) {
      console.warn(
        `[MotionWorks] Skipping param "${key}": value does not match type "${resolvedType}".`,
      );
      skippedParams.push(key);
      continue;
    }

    // Rule 5: min and max, if both provided, must satisfy min < max; violation → both ignored.
    const bothProvided = param.min !== undefined && param.max !== undefined;
    const minMaxValid = bothProvided && param.min! < param.max!;
    const keepBounds = !bothProvided || minMaxValid;

    const cleanParam: MotionWorksParam = {
      type: resolvedType,
      value: param.value,
      ...(param.label !== undefined && { label: param.label }),
      ...(param.unit !== undefined && { unit: param.unit }),
      ...(keepBounds && param.min !== undefined && { min: param.min }),
      ...(keepBounds && param.max !== undefined && { max: param.max }),
    };

    params[key] = cleanParam;
  }

  return { nameValid, readOnly, params, skippedParams, correctedTypes };
}
