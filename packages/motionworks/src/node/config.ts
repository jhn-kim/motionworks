import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_PORT = 52340;
const CONFIG_FILE = "motionworks.config.json";

export type AgentSetting = "auto" | "claude" | "codex" | "off";
export interface MotionWorksConfig {
  port: number;
  agent: AgentSetting;
  agentTimeoutMs: number;
  token?: string;
}
export type ConfigOverrides = Partial<MotionWorksConfig>;

export function parsePort(
  raw: string | number | undefined,
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

/**
 * A stable per-project daemon port derived from the project path. Two different
 * folders get two different ports, so their daemons can run at once without
 * colliding, and re-running `init` in the same folder always lands on the same
 * number. Spread across 52340–53339 (FNV-1a over the path).
 */
export function derivePort(projectRoot: string): number {
  let hash = 2166136261;
  for (let i = 0; i < projectRoot.length; i++) {
    hash ^= projectRoot.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return DEFAULT_PORT + ((hash >>> 0) % 1000);
}

/** The port pinned in motionworks.config.json, or undefined when unset. */
export async function readConfigPort(
  root: string,
): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(join(root, CONFIG_FILE), "utf8"),
    ) as ConfigOverrides;
    return parsePort(parsed.port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Pin `port` in motionworks.config.json, merging into any existing config
 * object so other settings (agent, token) survive. Written pretty so it stays
 * hand-editable.
 */
export async function writeConfigPort(
  root: string,
  port: number,
): Promise<void> {
  const path = join(root, CONFIG_FILE);
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      existing = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(
    path,
    `${JSON.stringify({ ...existing, port }, null, 2)}\n`,
    "utf8",
  );
}

function parseAgent(raw: unknown): AgentSetting | undefined {
  return raw === "auto" || raw === "claude" || raw === "codex" || raw === "off"
    ? raw
    : undefined;
}

function parseTimeout(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : undefined;
}

export async function loadConfig(
  root: string,
  overrides: ConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<MotionWorksConfig> {
  let file: ConfigOverrides = {};
  try {
    file = JSON.parse(
      await readFile(join(root, CONFIG_FILE), "utf8"),
    ) as ConfigOverrides;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = overrides.token ?? file.token;
  return {
    port:
      overrides.port ??
      parsePort(env.MOTIONWORKS_PORT) ??
      parsePort(file.port) ??
      DEFAULT_PORT,
    agent: parseAgent(overrides.agent) ?? parseAgent(file.agent) ?? "auto",
    agentTimeoutMs:
      parseTimeout(overrides.agentTimeoutMs) ??
      parseTimeout(file.agentTimeoutMs) ??
      120_000,
    ...(typeof token === "string" && token !== "" && { token }),
  };
}
