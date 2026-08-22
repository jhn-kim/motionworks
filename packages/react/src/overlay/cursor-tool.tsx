import { createContext, useContext } from 'react';

import type { ParameterType } from '@motionworks/core';

import type { ScaleSpec } from './scale.js';

export interface ArmedTool {
  effectId: string;
  paramKey: string;
  axis?: 'stiffness' | 'damping' | 'mass';
  label: string;
  unit?: string | undefined;
  spec: ScaleSpec;
  type: ParameterType;
}

export function sameTool(a: ArmedTool | null, b: ArmedTool): boolean {
  return (
    a !== null &&
    a.effectId === b.effectId &&
    a.paramKey === b.paramKey &&
    (a.axis ?? null) === (b.axis ?? null)
  );
}

interface CursorToolState {
  armed: ArmedTool | null;
  arm: (tool: ArmedTool) => void;
  disarm: () => void;
}

const CursorToolContext = createContext<CursorToolState>({
  armed: null,
  arm: () => {},
  disarm: () => {},
});

export function useCursorTool(): CursorToolState {
  return useContext(CursorToolContext);
}
