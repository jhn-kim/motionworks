import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

/** A URL-safe random daemon token (144 bits of entropy). */
export function generateToken(): string {
  return randomBytes(18).toString("base64url");
}

// The token is a machine-local secret, so it lives in the already-gitignored
// `.motionworks/` directory rather than the shared, committable config file —
// keeping it out of version control without breaking the shareable pinned port.
const TOKEN_FILE = join(".motionworks", "token");

/** Reads the persisted daemon token, or undefined when none exists. */
export async function readToken(root: string): Promise<string | undefined> {
  try {
    const token = (await readFile(join(root, TOKEN_FILE), "utf8")).trim();
    return token === "" ? undefined : token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Ensures a daemon token exists, generating and persisting one when absent.
 * Returns the effective token. This is what makes the daemon authenticated by
 * default — without it any loopback page could drive it (security finding S1).
 */
export async function ensureToken(root: string): Promise<string> {
  const existing = await readToken(root);
  if (existing !== undefined) return existing;
  const token = generateToken();
  const path = join(root, TOKEN_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, "utf8");
  return token;
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
  const token = overrides.token ?? file.token ?? (await readToken(root));
  return {
    port:
      overrides.port ??
      parsePort(env.MOTIONWORKS_PORT) ??
      parsePort(file.port) ??
      DEFAULT_PORT,
    // Off by default: the auto-agent can edit the workspace, so enabling it is
    // an explicit per-project opt-in (`--agent` or config), not the default
    // posture (security finding S2).
    agent: parseAgent(overrides.agent) ?? parseAgent(file.agent) ?? "off",
    agentTimeoutMs:
      parseTimeout(overrides.agentTimeoutMs) ??
      parseTimeout(file.agentTimeoutMs) ??
      120_000,
    ...(typeof token === "string" && token !== "" && { token }),
  };
}
