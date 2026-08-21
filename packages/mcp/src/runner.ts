import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MotionWorksServer, MotionWorksStateManager } from '@motionworks/core/server';

import { checkDrift } from './drift.js';
import { createMotionWorksMcpServer } from './mcp-server.js';
import { createStateFileWriter, type StateFileWriter } from './state-file.js';
import { PACKAGE_VERSION } from './version.js';

export interface StartOptions {
  cwd: string;
  port?: number;
  /** Set to false to skip the drift warning (used in tests). */
  emitDriftWarning?: boolean;
  /** Called for user-visible status/warning output; defaults to console.error. */
  log?: (msg: string) => void;
}

export interface RunningMotionWorks {
  state: MotionWorksStateManager;
  wsServer: MotionWorksServer;
  mcpServer: McpServer;
  stateFileWriter: StateFileWriter;
  stop(): Promise<void>;
}

/**
 * Boots the MotionWorks runtime: WS bridge on `port`, MCP server over stdio,
 * and the file-based fallback writer (active until an MCP client connects).
 */
export async function start(options: StartOptions): Promise<RunningMotionWorks> {
  const {
    cwd,
    port,
    emitDriftWarning = true,
    log = (msg: string) => process.stderr.write(`${msg}\n`),
  } = options;

  const state = new MotionWorksStateManager();
  const wsServer = new MotionWorksServer(state, port);
  await wsServer.start();

  const stateFileWriter = createStateFileWriter(state, {
    projectRoot: cwd,
    getSelector: (id) => wsServer.getSelector(id),
  });
  stateFileWriter.start();

  const mcpServer = createMotionWorksMcpServer({ state, wsServer });

  // Stop the file-based fallback the moment an MCP client finishes handshake.
  mcpServer.server.oninitialized = (): void => {
    stateFileWriter.stop();
  };

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  if (emitDriftWarning) {
    const warning = await checkDrift({ cwd, packageVersion: PACKAGE_VERSION });
    if (warning !== null) log(warning);
  }

  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    stateFileWriter.stop();
    await mcpServer.close();
    await wsServer.stop();
  }

  return { state, wsServer, mcpServer, stateFileWriter, stop };
}
