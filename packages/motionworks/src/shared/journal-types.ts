import type { ParameterType, SourceHint, TypeCorrection } from './types.js';

export type JournalStatus = 'pending' | 'agent-working' | 'applied';

export interface JournalChange {
  param: string;
  type: ParameterType;
  from: unknown;
  to: unknown;
  var?: string;
  fromCss?: string;
  toCss?: string;
  rule?: { selectorText: string; sheetHref: string; sourceFile?: string };
  sourceHint?: SourceHint;
}

export interface JournalEntry {
  id: string;
  createdAt: number;
  origin: string;
  page: string;
  effectId: string;
  effectName: string;
  elementSelector: string;
  changes: JournalChange[];
  typeCorrections?: TypeCorrection[];
  status: JournalStatus;
  appliedAt?: number;
  appliedBy?: 'css' | 'agent' | 'cli';
  files?: string[];
  error?: string;
}

export type CommitRequest = Omit<
  JournalEntry,
  'id' | 'createdAt' | 'origin' | 'status' | 'appliedAt' | 'appliedBy' | 'files' | 'error'
>;

export interface SelectRequest {
  effectId: string;
  effectName: string;
  elementSelector: string;
  values?: Record<string, unknown>;
  page?: string;
}

export interface StatusResponse {
  ok: true;
  port: number;
  projectRoot: string;
  pending: number;
  agent: { configured: 'auto' | 'claude' | 'codex' | 'off'; enabled: boolean; running: boolean };
}
