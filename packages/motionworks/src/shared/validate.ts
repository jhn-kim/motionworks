import type { MotionWorksParam, MotionWorksRegistration, ParameterType } from './types.js';

export interface ValidationResult {
  nameValid: boolean;
  params: Record<string, MotionWorksParam>;
  skippedParams: string[];
  correctedTypes: string[];
}

const VALID_TYPES = new Set<string>(['spatial-radius', 'spatial-strength', 'temporal-decay', 'temporal-response', 'spring-response', 'gradient', 'path', 'stagger', 'duration', 'easing-curve', 'scalar']);
const SPECIAL_VARS = new Set(['animation-duration', 'animation-delay', 'animation-timing-function']);
const warned = new WeakSet<object>();

export function validateRegistration(registration: MotionWorksRegistration): ValidationResult {
  const legacy = registration as MotionWorksRegistration & { update?: unknown; value?: unknown };
  if (!warned.has(registration) && (legacy.update !== undefined || Object.values(registration.params).some((param) => 'value' in param))) {
    warned.add(registration);
    console.warn('MotionWorks 0.5 reads values from CSS custom properties; see MOTIONWORKS.md');
  }
  const params: Record<string, MotionWorksParam> = {};
  const correctedTypes: string[] = [];
  for (const [key, param] of Object.entries(registration.params)) {
    const type = VALID_TYPES.has(param.type) ? param.type as ParameterType : (correctedTypes.push(key), 'scalar' as const);
    const variable = param.var === undefined || param.var.startsWith('--') || SPECIAL_VARS.has(param.var) ? param.var : undefined;
    if (param.var !== undefined && variable === undefined) console.warn(`[MotionWorks] Param "${key}" has invalid var "${param.var}"; using --mw-${key}.`);
    const both = param.min !== undefined && param.max !== undefined;
    const bounds = !both || param.min! < param.max!;
    params[key] = { type, ...(param.label !== undefined && { label: param.label }), ...(param.unit !== undefined && { unit: param.unit }), ...(variable !== undefined && { var: variable }), ...(bounds && param.min !== undefined && { min: param.min }), ...(bounds && param.max !== undefined && { max: param.max }) };
  }
  return { nameValid: typeof registration.name === 'string' && registration.name.length > 0, params, skippedParams: [], correctedTypes };
}
