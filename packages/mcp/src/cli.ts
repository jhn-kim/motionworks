#!/usr/bin/env node
import { runInit } from './init.js';
import { start } from './runner.js';
import { PACKAGE_VERSION } from './version.js';

const HELP = `Usage:
  npx motionworks              Start the MotionWorks WebSocket bridge (port 52340)
                              and the MCP server over stdio.
  npx motionworks init         Append/update the MotionWorks instructions stanza
                              in every agent instruction file that exists
                              (./CLAUDE.md for Claude Code, ./AGENTS.md for
                              Codex and other AGENTS.md agents). Creates
                              ./CLAUDE.md when neither exists.
    --yes, -y                  Skip confirmation prompts (CI-friendly).
    --claude                   Target ./CLAUDE.md explicitly (create if missing).
    --agents                   Target ./AGENTS.md explicitly (create if missing).
  npx motionworks help         Show this help.
  npx motionworks --version    Print the installed version.

Env:
  MOTIONWORKS_PORT   Override the WebSocket bridge port (default: 52340).
`;

function parsePort(): number | undefined {
  const raw = process.env['MOTIONWORKS_PORT'];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    process.stderr.write(
      `[motionworks] Ignoring invalid MOTIONWORKS_PORT="${raw}"; using default.\n`,
    );
    return undefined;
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const first = args[0];

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  if (first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(HELP);
    return;
  }

  if (first === 'init') {
    const yes = args.includes('--yes') || args.includes('-y');
    const outcomes = await runInit({
      cwd: process.cwd(),
      packageVersion: PACKAGE_VERSION,
      yes,
      claude: args.includes('--claude'),
      agents: args.includes('--agents'),
    });
    if (outcomes.some((o) => o.kind === 'cancelled')) process.exitCode = 1;
    return;
  }

  if (first !== undefined) {
    process.stderr.write(`[motionworks] Unknown command: "${first}"\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  // Default: start the server.
  const runtime = await start({ cwd: process.cwd(), port: parsePort() });

  const shutdown = async (): Promise<void> => {
    try {
      await runtime.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  process.stderr.write(`[motionworks] ${String(err)}\n`);
  process.exit(1);
});
