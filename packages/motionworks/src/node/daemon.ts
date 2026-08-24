import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type {
  AdoptionEntry,
  AdoptionRequest,
  CommitRequest,
  JournalChange,
  SelectRequest,
  StatusResponse,
} from "../shared/index.js";

import type { AgentSetting } from "./config.js";
import {
  createAgentRunner,
  detectAgent,
  type AgentCommand,
  type AgentRunner,
} from "./agent.js";
import { applyCors, isLoopbackHost } from "./cors.js";
import {
  ackEntries,
  coalescePendingEntries,
  pruneAppliedEntries,
  readJournal,
  upsertPendingEntry,
  writeSelected,
} from "./journal.js";
import { updateEntry } from "./journal.js";
import { appendAdoption, readAdoptions } from "./adoptions.js";
import { applyCssChanges, verifyCssChanges } from "./css-write.js";
import { resolveOverlayBundle } from "./overlay-asset.js";
import { createStaticHandler } from "./static-serve.js";
import { decodeCssValue } from "../shared/css-values.js";
import type { ParameterType } from "../shared/index.js";

const MAX_BODY = 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface DaemonOptions {
  projectRoot: string;
  port: number;
  staticDir?: string;
  agent?: AgentRunner;
  agentSetting?: AgentSetting;
  agentTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  token?: string;
  log?: (message: string) => void;
  overlayBundlePath?: string;
}
export interface RunningDaemon {
  server: Server;
  port: number;
  stop(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY) {
      const error = new Error("Request body too large");
      (error as NodeJS.ErrnoException).code = "ETOOBIG";
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const PARAMETER_TYPES = new Set([
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
const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";
function isRule(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.selectorText === "string" &&
    typeof value.sheetHref === "string" &&
    optionalString(value.sourceFile)
  );
}
function isChange(value: unknown): value is JournalChange {
  return (
    object(value) &&
    typeof value.param === "string" &&
    PARAMETER_TYPES.has(String(value.type)) &&
    "from" in value &&
    "to" in value &&
    optionalString(value.var) &&
    optionalString(value.fromCss) &&
    optionalString(value.toCss) &&
    (value.rule === undefined || isRule(value.rule))
  );
}

// Structural CSS characters can never appear in a single decodable value, so
// rejecting them blocks declaration/rule injection through `toCss` regardless
// of the parameter type (e.g. `1; } body { background: url(...) } .x { --mw-x:1`).
const CSS_STRUCTURE = /[;{}\n\r]/;
function unsafeToCss(change: JournalChange): boolean {
  if (change.toCss === undefined) return false;
  return (
    CSS_STRUCTURE.test(change.toCss) ||
    decodeCssValue(change.type as ParameterType, change.toCss) === null
  );
}
function isTypeCorrection(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.effectName === "string" &&
    typeof value.paramKey === "string" &&
    PARAMETER_TYPES.has(String(value.previousType)) &&
    PARAMETER_TYPES.has(String(value.correctedType)) &&
    typeof value.correctedAt === "number" &&
    Number.isFinite(value.correctedAt)
  );
}
function isCommit(value: unknown): value is CommitRequest {
  return (
    object(value) &&
    typeof value.page === "string" &&
    typeof value.effectId === "string" &&
    typeof value.effectName === "string" &&
    typeof value.elementSelector === "string" &&
    (value.mwId === undefined || typeof value.mwId === "string") &&
    Array.isArray(value.changes) &&
    value.changes.every(isChange) &&
    (value.typeCorrections === undefined ||
      (Array.isArray(value.typeCorrections) &&
        value.typeCorrections.every(isTypeCorrection)))
  );
}
const ALLOWED_VARS = new Set([
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
]);
function isSelect(value: unknown): value is SelectRequest {
  return (
    object(value) &&
    typeof value.effectId === "string" &&
    typeof value.effectName === "string" &&
    typeof value.elementSelector === "string"
  );
}
const ADOPTION_LIBRARIES = new Set([
  "gsap",
  "framer-motion",
  "react-spring",
  "custom",
]);
function isAdoptionRequest(value: unknown): value is AdoptionRequest {
  return (
    object(value) &&
    typeof value.library === "string" &&
    ADOPTION_LIBRARIES.has(value.library) &&
    typeof value.effectName === "string" &&
    typeof value.elementSelector === "string" &&
    typeof value.page === "string" &&
    Array.isArray(value.params) &&
    value.params.every(
      (param) =>
        object(param) &&
        typeof param.key === "string" &&
        typeof param.var === "string" &&
        typeof param.label === "string",
    )
  );
}

export async function startDaemon(
  options: DaemonOptions,
): Promise<RunningDaemon> {
  await pruneAppliedEntries(options.projectRoot, Date.now() - RETENTION_MS);
  for (const entry of await readJournal(options.projectRoot)) {
    if (entry.status === "agent-working")
      await updateEntry(options.projectRoot, entry.id, {
        status: "pending",
        error: "Agent interrupted by daemon restart",
      });
  }
  await coalescePendingEntries(options.projectRoot);
  const configuredCommand: AgentCommand | null =
    options.agentSetting === "off"
      ? null
      : options.agentSetting === "claude" || options.agentSetting === "codex"
        ? options.agentSetting
        : detectAgent(options.env);
  const agent =
    options.agent ??
    (configuredCommand === null
      ? null
      : createAgentRunner({
          command: configuredCommand,
          projectRoot: options.projectRoot,
          timeoutMs: options.agentTimeoutMs ?? 120_000,
          env: options.env,
        }));
  const staticHandler =
    options.staticDir === undefined
      ? null
      : createStaticHandler(options.staticDir, options.token);
  // Routes that expose journal/selection data or mutate the project. Asset
  // routes (the overlay bundle, static files) stay token-free so a same-origin
  // page can bootstrap; they carry no secret a cross-origin page could read.
  const DATA_ROUTES = new Set([
    "/status",
    "/pending",
    "/commit",
    "/select",
    "/ack",
    "/adopt",
    "/adoptions",
  ]);
  const server = createServer(async (req, res) => {
    if (!applyCors(req, res)) return;
    if (!isLoopbackHost(req.headers.host)) {
      res.statusCode = 403;
      res.end("Forbidden host");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (options.token !== undefined && DATA_ROUTES.has(url.pathname)) {
        const header = req.headers["x-motionworks-token"];
        const provided = Array.isArray(header)
          ? header[0]
          : (header ?? url.searchParams.get("token") ?? undefined);
        if (provided !== options.token) {
          sendJson(res, 401, { error: "Invalid MotionWorks token" });
          return;
        }
      }
      if (req.method === "GET" && url.pathname === "/status") {
        const entries = await readJournal(options.projectRoot);
        const address = server.address();
        const status: StatusResponse = {
          ok: true,
          port:
            typeof address === "object" && address !== null
              ? address.port
              : options.port,
          projectRoot: options.projectRoot,
          pending: entries.filter((entry) => entry.status !== "applied").length,
          agent: {
            enabled: agent !== null,
            command: agent?.command ?? configuredCommand,
            running: agent?.running ?? false,
          },
        };
        sendJson(res, 200, status);
        return;
      }
      if (req.method === "GET" && url.pathname === "/pending") {
        const entries = await readJournal(options.projectRoot);
        const origin = req.headers.origin;
        sendJson(
          res,
          200,
          entries.filter(
            (entry) =>
              url.searchParams.get("all") === "1" ||
              origin === undefined ||
              entry.origin === origin,
          ),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/motionworks.js") {
        const path =
          options.overlayBundlePath ??
          (await resolveOverlayBundle(options.projectRoot));
        if (path === null) {
          res.statusCode = 404;
          res.end(
            "Overlay bundle not found. Run npm run build in the motionworks package.",
          );
          return;
        }
        const { createReadStream } = await import("node:fs");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(path).pipe(res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/commit") {
        const value = await body(req);
        if (!isCommit(value))
          return sendJson(res, 400, { error: "Invalid commit request" });
        if (
          value.changes.some(
            (change) =>
              change.var === undefined ||
              (!change.var.startsWith("--mw-") &&
                !ALLOWED_VARS.has(change.var)),
          )
        )
          return sendJson(res, 400, {
            error: "Commit contains an unsupported CSS property",
          });
        if (value.changes.some(unsafeToCss))
          return sendJson(res, 400, {
            error: "Commit contains an invalid or unsafe CSS value",
          });
        const entry = await upsertPendingEntry(options.projectRoot, {
          ...value,
          id: randomUUID(),
          createdAt: Date.now(),
          origin: req.headers.origin ?? "",
          status: "pending",
        });
        const result =
          (entry.typeCorrections?.length ?? 0) > 0
            ? {
                kind: "skipped" as const,
                reason:
                  "Entry includes schema type corrections that require an agent.",
              }
            : await applyCssChanges(options.projectRoot, entry);
        if (result.kind === "applied") {
          const applied = await updateEntry(options.projectRoot, entry.id, {
            status: "applied",
            appliedAt: Date.now(),
            appliedBy: "css",
            files: result.files,
            error: undefined,
          });
          sendJson(res, 201, applied);
        } else {
          if (agent === null) {
            const pending = await updateEntry(options.projectRoot, entry.id, {
              error: result.reason,
            });
            sendJson(res, 201, pending);
          } else {
            options.log?.(
              `direct write skipped (${result.reason}) → ${agent.command} ${agent.command === "claude" ? "-p" : "exec"}`,
            );
            const working = await updateEntry(options.projectRoot, entry.id, {
              status: "agent-working",
              error: result.reason,
            });
            if (working === null)
              throw new Error(`Journal entry disappeared: ${entry.id}`);
            sendJson(res, 201, working);
            void agent
              .run(working)
              .then(async (agentResult) => {
                if (agentResult.ok) {
                  const verification = await verifyCssChanges(
                    options.projectRoot,
                    working,
                  );
                  if (verification.kind === "verified") {
                    await updateEntry(options.projectRoot, entry.id, {
                      status: "applied",
                      appliedAt: Date.now(),
                      appliedBy: "agent",
                      files: verification.files,
                      error: undefined,
                    });
                  } else {
                    options.log?.(verification.reason);
                    await updateEntry(options.projectRoot, entry.id, {
                      status: "pending",
                      error: verification.reason,
                    });
                  }
                } else {
                  options.log?.(
                    `${agent.command} failed: ${agentResult.error ?? "unknown error"}`,
                  );
                  await updateEntry(options.projectRoot, entry.id, {
                    status: "pending",
                    error: agentResult.error ?? "Agent failed",
                  });
                }
              })
              .catch(async (error: unknown) => {
                // Best-effort recovery; must not itself reject or the `void`
                // above becomes an unhandled rejection that crashes the daemon
                // on Node ≥15 (finding P1-6).
                try {
                  await updateEntry(options.projectRoot, entry.id, {
                    status: "pending",
                    error: String(error),
                  });
                } catch (updateError) {
                  options.log?.(
                    `failed to record agent error for ${entry.id}: ${String(updateError)}`,
                  );
                }
              })
              // Terminal guard: swallow anything the handlers above still throw
              // (e.g. an updateEntry rejection inside the success path).
              .catch((error: unknown) => {
                options.log?.(
                  `agent completion handler failed for ${entry.id}: ${String(error)}`,
                );
              });
          }
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/adoptions") {
        sendJson(res, 200, {
          adoptions: (await readAdoptions(options.projectRoot)).filter(
            (entry) => entry.status !== "applied",
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/adopt") {
        const value = await body(req);
        if (!isAdoptionRequest(value))
          return sendJson(res, 400, { error: "Invalid adoption request" });
        // Dedup: re-clicking Adopt (or re-detecting the same element before the
        // agent has lifted it) must not pile up duplicate entries for the same
        // element/page. Return the existing pending one instead.
        const existing = (await readAdoptions(options.projectRoot)).find(
          (candidate) =>
            candidate.status !== "applied" &&
            candidate.elementSelector === value.elementSelector &&
            candidate.page === value.page,
        );
        if (existing !== undefined) return sendJson(res, 200, existing);
        const entry: AdoptionEntry = {
          ...value,
          id: randomUUID(),
          createdAt: Date.now(),
          origin: req.headers.origin ?? "",
          status: "pending",
        };
        await appendAdoption(options.projectRoot, entry);
        sendJson(res, 201, entry);
        return;
      }
      if (req.method === "POST" && url.pathname === "/select") {
        const value = await body(req);
        if (!isSelect(value))
          return sendJson(res, 400, { error: "Invalid select request" });
        await writeSelected(options.projectRoot, value);
        sendJson(res, 200, value);
        return;
      }
      if (req.method === "POST" && url.pathname === "/ack") {
        const value = await body(req);
        if (!object(value))
          return sendJson(res, 400, { error: "Invalid ack request" });
        const ids =
          value.ids === "all"
            ? "all"
            : Array.isArray(value.ids) &&
                value.ids.every((id) => typeof id === "string")
              ? value.ids
              : typeof value.id === "string"
                ? [value.id]
                : null;
        if (ids === null)
          return sendJson(res, 400, { error: "Invalid ack request" });
        sendJson(res, 200, {
          acknowledged: (await ackEntries(options.projectRoot, ids)).map(
            (entry) => entry.id,
          ),
        });
        return;
      }
      if (staticHandler !== null && (await staticHandler(req, res))) return;
      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ETOOBIG")
        return sendJson(res, 413, { error: "Request body too large" });
      if (error instanceof SyntaxError)
        return sendJson(res, 400, { error: "Invalid JSON" });
      sendJson(res, 500, { error: String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : options.port;
  return {
    server,
    port,
    stop: () => {
      agent?.stop?.();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
