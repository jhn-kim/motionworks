export { SCHEMA_EMISSION_GUIDE, TOOL_NUDGE } from './instructions.js';
export {
  START_SENTINEL,
  END_SENTINEL,
  INSTRUCTION_FILES,
  claudeMdPath,
  compareVersions,
  instructionFilePath,
  readClaudeMd,
  readInstructionFile,
  renderStanza,
  scanClaudeMd,
  writeClaudeMd,
  writeInstructionFile,
  type InstructionFile,
  type StanzaScan,
} from './claude-md.js';
export { checkDrift, formatDriftWarning, type FileDriftStatus } from './drift.js';
export { runInit, diffStanzas, type InitOptions, type InitOutcome } from './init.js';
export { createMotionWorksMcpServer, type McpServerBridge } from './mcp-server.js';
export {
  createStateFileWriter,
  type StateFileWriter,
  type StateFileWriterOptions,
} from './state-file.js';
export { start, type StartOptions, type RunningMotionWorks } from './runner.js';
export { PACKAGE_VERSION } from './version.js';
