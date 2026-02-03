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

// Re-export types
export * from "./types.js";

// Re-export errors
export * from "./errors.js";

// Re-export schemas
export * from "./schemas/index.js";

// Re-export directory functions
export {
  initStateDirectory,
  getStateDirectory,
  validateStateDirectory,
} from "./directory.js";

// Re-export file utilities
export * from "./utils/index.js";

// Re-export fleet state functions
export {
  readFleetState,
  writeFleetState,
  updateAgentState,
  initializeFleetState,
  removeAgentState,
  type StateLogger,
  type ReadFleetStateOptions,
  type WriteFleetStateOptions,
  type AgentStateUpdates,
} from "./fleet-state.js";

// Re-export job metadata functions
export {
  createJob,
  updateJob,
  getJob,
  listJobs,
  deleteJob,
  type JobMetadataOptions,
  type JobLogger,
  type JobMetadataUpdates,
  type ListJobsFilter,
  type ListJobsResult,
} from "./job-metadata.js";

// Re-export job output functions
export {
  getJobOutputPath,
  appendJobOutput,
  appendJobOutputBatch,
  readJobOutput,
  readJobOutputAll,
  type JobOutputLogger,
  type JobOutputOptions,
  type ReadJobOutputOptions,
} from "./job-output.js";

// Re-export session functions
export {
  getSessionInfo,
  updateSessionInfo,
  clearSession,
  listSessions,
  type SessionOptions,
  type SessionLogger,
  type SessionInfoUpdates,
} from "./session.js";

// Re-export session validation functions
export {
  validateSession,
  validateSessionWithFileCheck,
  validateRuntimeContext,
  cliSessionFileExists,
  isSessionExpiredError,
} from "./session-validation.js";

// Re-export working directory validation functions
export {
  validateWorkingDirectory,
  type WorkingDirectoryValidation,
} from "./working-directory-validation.js";
