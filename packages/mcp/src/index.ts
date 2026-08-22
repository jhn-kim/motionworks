export { SCHEMA_EMISSION_GUIDE } from './instructions.js';
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
export { startDaemon, type DaemonOptions, type RunningDaemon } from './daemon.js';
export { loadConfig, parsePort, type AgentSetting, type MotionWorksConfig } from './config.js';
export { formatChanges, formatStatus, runAck } from './commands.js';
export {
  ackEntries,
  appendEntry,
  readJournal,
  readSelected,
  updateEntry,
  withJournalLock,
  writeSelected,
} from './journal.js';
export { PACKAGE_VERSION } from './version.js';
