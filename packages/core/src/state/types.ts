/**
 * Type definitions for state management
 *
 * Defines types for state directory structure and configuration
 */

/**
 * Paths to all state directory subdirectories and files
 */
export interface StateDirectory {
  /** Root state directory path (e.g., .herdctl/) */
  root: string;
  /** Path to jobs subdirectory */
  jobs: string;
  /** Path to sessions subdirectory */
  sessions: string;
  /** Path to logs subdirectory */
  logs: string;
  /** Path to state.yaml file */
  stateFile: string;
}

/**
 * Options for initializing the state directory
 */
export interface InitStateDirectoryOptions {
  /**
   * Custom path for the state directory.
   * Defaults to .herdctl/ in the current working directory.
   */
  path?: string;
}

/**
 * Result of state directory validation
 */
export interface StateDirectoryValidation {
  /** Whether the directory structure is valid */
  valid: boolean;
  /** List of missing directories or files */
  missing: string[];
  /** List of validation errors */
  errors: string[];
}

/**
 * Subdirectory names within the state directory
 */
export const STATE_SUBDIRECTORIES = ["jobs", "sessions", "logs"] as const;

/**
 * Default state directory name
 */
export const DEFAULT_STATE_DIR_NAME = ".herdctl";

/**
 * Default state file name
 */
export const STATE_FILE_NAME = "state.yaml";
