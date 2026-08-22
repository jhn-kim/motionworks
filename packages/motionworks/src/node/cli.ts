#!/usr/bin/env node
import { resolve } from "node:path";

import { runSetup } from "./setup.js";
import { checkDrift } from "./drift.js";
import {
  formatChanges,
  formatStatus,
  pendingChanges,
  runAck,
  runRevert,
} from "./commands.js";
import { loadConfig, parsePort, type AgentSetting } from "./config.js";
import { startDaemon } from "./daemon.js";
import { detectAgent } from "./agent.js";
import { PACKAGE_VERSION } from "./version.js";
import { banner, dim } from "./ui.js";

const HELP = `Usage:
  npx motionworks [--port N] [--agent=auto|claude|codex|off]  Start the daemon.
  npx motionworks serve <dir> [--port N]                      Serve a static site and overlay.
  npx motionworks changes [--json|--brief]                    Show pending changes.
  npx motionworks ack <id>|--all                              Acknowledge changes.
  npx motionworks status                                      Show daemon and selection.
  npx motionworks revert <id>                                 Revert an applied change.
  npx motionworks init [--yes] [--stanza-only]                Set up MotionWorks.
  npx motionworks help | --version
`;

function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0]?.startsWith("-") ? undefined : args[0];
  if (args.includes("--version") || args.includes("-v"))
    return void process.stdout.write(`${PACKAGE_VERSION}\n`);
  if (command === "help" || args.includes("--help") || args.includes("-h"))
    return void process.stdout.write(HELP);
  if (command === "init") {
    process.stdout.write(
      `${banner(PACKAGE_VERSION)}\n  ${dim(`Setting up in ${process.cwd()}`)}\n\n`,
    );
    const result = await runSetup({
      cwd: process.cwd(),
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
  if (command === "status")
    return void process.stdout.write(
      `${await formatStatus(process.cwd(), config.port)}\n`,
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
      token: config.token,
      log: (message) => process.stderr.write(`MotionWorks: ${message}\n`),
      staticDir: command === "serve" ? resolve(args[1] ?? ".") : undefined,
    });
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
        const response = await fetch(`http://127.0.0.1:${config.port}/status`);
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
