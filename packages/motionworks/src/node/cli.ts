#!/usr/bin/env node
import { flagValue, serveDir } from "./cli-args.js";
import { isProjectRoot, runSetup } from "./setup.js";
import { checkDrift } from "./drift.js";
import {
  formatAdoptions,
  formatChanges,
  formatDiscover,
  formatStatus,
  pendingAdoptions,
  pendingChanges,
  runAck,
  runAdoptAck,
  runRevert,
  scanDiscoveries,
} from "./commands.js";
import {
  ensureToken,
  loadConfig,
  parsePort,
  type AgentSetting,
} from "./config.js";
import { startDaemon } from "./daemon.js";
import { detectAgent } from "./agent.js";
import { PACKAGE_VERSION } from "./version.js";
import { agentHint, banner, dim } from "./ui.js";

const HELP = `Usage:
  npx motionworks [--port N] [--agent=auto|claude|codex|off]  Start the daemon.
  npx motionworks serve <dir> [--port N]                      Serve a static site and overlay.
  npx motionworks changes [--json|--brief]                    Show pending changes.
  npx motionworks ack <id>|--all                              Acknowledge changes.
  npx motionworks discover                                    Inventory JS-driven animations (static scan).
  npx motionworks adoptions                                   Show JS animations awaiting adoption.
  npx motionworks adopt-ack <id>                              Mark an adoption done.
  npx motionworks status                                      Show daemon and selection.
  npx motionworks revert <id>                                 Revert an applied change.
  npx motionworks init [--yes] [--stanza-only] [--force]      Set up MotionWorks.
  npx motionworks help | --version
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0]?.startsWith("-") ? undefined : args[0];
  if (args.includes("--version") || args.includes("-v"))
    return void process.stdout.write(`${PACKAGE_VERSION}\n`);
  if (command === "help" || args.includes("--help") || args.includes("-h"))
    return void process.stdout.write(HELP);
  // Self-identify on stderr for every real command. An agent that runs the CLI
  // (the only reliable mid-session channel) then learns what MotionWorks is even
  // when its session predates the install; stderr keeps stdout parseable.
  process.stderr.write(`${agentHint(PACKAGE_VERSION)}\n`);
  if (command === "init") {
    const cwd = process.cwd();
    if (!args.includes("--force") && !(await isProjectRoot(cwd))) {
      process.stderr.write(
        `[motionworks] ${cwd} doesn't look like a project root (no package.json or .git).\n` +
          `Run \`motionworks init\` from your app's root, or pass --force to set up here anyway.\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${banner(PACKAGE_VERSION)}\n  ${dim(`Setting up in ${cwd}`)}\n\n`,
    );
    const result = await runSetup({
      cwd,
      packageVersion: PACKAGE_VERSION,
      yes: args.includes("--yes") || args.includes("-y"),
      stanzaOnly: args.includes("--stanza-only"),
      claude: args.includes("--claude"),
      agents: args.includes("--agents"),
    });
    if (
      result.initOutcomes.some((item) => item.kind === "cancelled") ||
      result.setupOutcomes.some(
        (item) =>
          item.kind === "cancelled" || item.kind === "react-install-failed",
      )
    )
      process.exitCode = 1;
    return;
  }
  const portFlag = flagValue(args, "--port");
  if (portFlag !== undefined && parsePort(portFlag) === undefined)
    throw new Error(`Invalid port: ${portFlag}`);
  const agentFlag = args.includes("--no-agent")
    ? "off"
    : (flagValue(args, "--agent") as AgentSetting | undefined);
  if (
    agentFlag !== undefined &&
    !["auto", "claude", "codex", "off"].includes(agentFlag)
  )
    throw new Error(`Invalid agent: ${agentFlag}`);
  const config = await loadConfig(process.cwd(), {
    port: parsePort(portFlag),
    agent: agentFlag,
  });
  if (command === "changes")
    return void process.stdout.write(
      `${formatChanges(await pendingChanges(process.cwd()), args.includes("--json") ? "json" : args.includes("--brief") ? "brief" : "agent")}\n`,
    );
  if (command === "ack") {
    const id = args.includes("--all") ? "all" : args[1];
    if (id === undefined) throw new Error("Usage: motionworks ack <id>|--all");
    const acknowledged = await runAck(
      process.cwd(),
      id,
      config.port,
      config.token,
    );
    process.stdout.write(
      `Acknowledged ${acknowledged.length} change${acknowledged.length === 1 ? "" : "s"}.\n`,
    );
    return;
  }
  if (command === "discover")
    return void process.stdout.write(
      `${formatDiscover(await scanDiscoveries(process.cwd()))}\n`,
    );
  if (command === "adoptions")
    return void process.stdout.write(
      `${formatAdoptions(await pendingAdoptions(process.cwd()), process.cwd())}\n`,
    );
  if (command === "adopt-ack") {
    const id = args[1];
    if (id === undefined) throw new Error("Usage: motionworks adopt-ack <id>");
    const acked = await runAdoptAck(process.cwd(), id);
    process.stdout.write(`Adopted ${acked.effectName} (${acked.id}).\n`);
    return;
  }
  if (command === "status")
    return void process.stdout.write(
      `${await formatStatus(process.cwd(), config.port, config.token)}\n`,
    );
  if (command === "revert") {
    const id = args[1];
    if (id === undefined) throw new Error("Usage: motionworks revert <id>");
    const files = await runRevert(process.cwd(), id);
    process.stdout.write(`Reverted ${id} in ${files.join(", ")}.\n`);
    return;
  }
  if (command !== undefined && command !== "serve") {
    process.stderr.write(
      `[motionworks] Unknown command: "${command}"\n\n${HELP}`,
    );
    process.exitCode = 2;
    return;
  }

  const warning = await checkDrift({
    cwd: process.cwd(),
    packageVersion: PACKAGE_VERSION,
  });
  if (warning !== null) process.stderr.write(`${warning}\n`);
  // Authenticated by default: mint and persist a machine-local token when the
  // project has none, so the daemon is never left open to other loopback pages.
  const freshToken = config.token === undefined;
  const token = config.token ?? (await ensureToken(process.cwd()));
  try {
    const detectedAgent =
      config.agent === "off"
        ? null
        : config.agent === "auto"
          ? detectAgent(process.env)
          : config.agent;
    const daemon = await startDaemon({
      projectRoot: process.cwd(),
      port: config.port,
      agentSetting: config.agent,
      agentTimeoutMs: config.agentTimeoutMs,
      token,
      log: (message) => process.stderr.write(`MotionWorks: ${message}\n`),
      staticDir: command === "serve" ? serveDir(args) : undefined,
    });
    if (freshToken)
      process.stderr.write(
        `MotionWorks generated a daemon token in .motionworks/token. ` +
          `React mounts must pass it: daemonUrl="http://127.0.0.1:${daemon.port}?token=${token}"\n`,
      );
    process.stderr.write(
      `MotionWorks daemon listening on 127.0.0.1:${daemon.port}\n`,
    );
    process.stderr.write(
      `MotionWorks agent: ${detectedAgent === null ? "disabled (manual hand-off)" : `${detectedAgent} will be spawned for ambiguous changes`}\n`,
    );
    const shutdown = (): void => {
      void daemon.stop().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      try {
        // /status is token-gated; send the project token so an already-running
        // daemon is recognized (401 would otherwise look like "not ours").
        const response = await fetch(
          `http://127.0.0.1:${config.port}/status?token=${encodeURIComponent(token)}`,
        );
        if (response.ok)
          throw new Error(
            `already running on 127.0.0.1:${config.port}, use that one or set MOTIONWORKS_PORT`,
          );
      } catch (probeError) {
        if (
          probeError instanceof Error &&
          probeError.message.startsWith("already running")
        )
          throw probeError;
      }
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[motionworks] ${String(error)}\n`);
  process.exit(1);
});
