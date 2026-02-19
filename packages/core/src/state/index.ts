/**
 * State management module
 *
 * Provides utilities for managing herdctl state files including:
 * - State directory initialization and management
 * - Atomic file writes to prevent corruption
 * - YAML and JSONL file operations
 * - Safe reads with validation
 * - Fleet state (state.yaml) management
 * - Job metadata (job-<id>.yaml) management
 */

// Re-export directory functions
export {
  getStateDirectory,
  initStateDirectory,
  validateStateDirectory,
} from "./directory.js";

// Re-export errors
export * from "./errors.js";
// Re-export fleet state functions
export {
  type AgentStateUpdates,
  initializeFleetState,
  type ReadFleetStateOptions,
  readFleetState,
  removeAgentState,
  type StateLogger,
  updateAgentState,
  type WriteFleetStateOptions,
  writeFleetState,
} from "./fleet-state.js";
// Re-export job metadata functions
export {
  createJob,
  deleteJob,
  getJob,
  type JobLogger,
  type JobMetadataOptions,
  type JobMetadataUpdates,
  type ListJobsFilter,
  type ListJobsResult,
  listJobs,
  updateJob,
} from "./job-metadata.js";
// Re-export job output functions
export {
  appendJobOutput,
  appendJobOutputBatch,
  getJobOutputPath,
  type JobOutputLogger,
  type JobOutputOptions,
  type ReadJobOutputOptions,
  readJobOutput,
  readJobOutputAll,
} from "./job-output.js";
// Re-export schemas
export * from "./schemas/index.js";
// Re-export session functions
export {
  clearSession,
  getSessionInfo,
  listSessions,
  type SessionInfoUpdates,
  type SessionLogger,
  type SessionOptions,
  updateSessionInfo,
} from "./session.js";
// Re-export session validation functions
export {
  cliSessionFileExists,
  dockerSessionFileExists,
  isSessionExpiredError,
  isTokenExpiredError,
  type SessionFileCheckOptions,
  validateRuntimeContext,
  validateSession,
  validateSessionWithFileCheck,
} from "./session-validation.js";
// Re-export types
export * from "./types.js";
// Re-export file utilities
export * from "./utils/index.js";

// Re-export working directory validation functions
export {
  validateWorkingDirectory,
  type WorkingDirectoryValidation,
} from "./working-directory-validation.js";
