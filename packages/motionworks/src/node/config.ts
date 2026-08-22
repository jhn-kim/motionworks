import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentSetting = 'auto' | 'claude' | 'codex' | 'off';
export interface MotionWorksConfig { port: number; agent: AgentSetting; agentTimeoutMs: number }
export type ConfigOverrides = Partial<MotionWorksConfig>;

export function parsePort(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

export async function loadConfig(
  root: string,
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<MotionWorksConfig> {
  let file: ConfigOverrides = {};
  try {
    file = JSON.parse(await readFile(join(root, 'motionworks.config.json'), 'utf8')) as ConfigOverrides;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    port: overrides.port ?? parsePort(env.MOTIONWORKS_PORT) ?? parsePort(file.port) ?? 52340,
    agent: overrides.agent ?? file.agent ?? 'auto',
    agentTimeoutMs: overrides.agentTimeoutMs ?? file.agentTimeoutMs ?? 120_000,
  };
}
