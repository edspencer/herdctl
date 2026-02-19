/**
 * State directory management
 *
 * Provides functions to initialize and access the .herdctl/ state directory
 */

import { mkdir, stat, access, constants } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type StateDirectory,
  type InitStateDirectoryOptions,
  type StateDirectoryValidation,
  STATE_SUBDIRECTORIES,
  DEFAULT_STATE_DIR_NAME,
  STATE_FILE_NAME,
} from "./types.js";
import {
  StateDirectoryCreateError,
  StateDirectoryValidationError,
  StateFileError,
  getPermissionErrorMessage,
} from "./errors.js";
import { createInitialFleetState, FleetStateSchema } from "./schemas/index.js";
import { atomicWriteYaml } from "./utils/index.js";
import { safeReadYaml } from "./utils/reads.js";

/**
 * Get the paths for all state directory components
 *
 * @param rootPath - Root path to the state directory (e.g., /path/to/.herdctl)
 * @returns StateDirectory object with paths to all subdirectories and files
 */
export function getStateDirectory(rootPath?: string): StateDirectory {
  const root = rootPath ? resolve(rootPath) : resolve(process.cwd(), DEFAULT_STATE_DIR_NAME);

  return {
    root,
    jobs: join(root, "jobs"),
    sessions: join(root, "sessions"),
    logs: join(root, "logs"),
    stateFile: join(root, STATE_FILE_NAME),
  };
}

/**
 * Check if a path exists and is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path exists (file or directory)
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that the state directory structure exists and is accessible
 *
 * @param stateDir - StateDirectory object to validate
 * @returns Validation result with any missing paths or errors
 */
export async function validateStateDirectory(
  stateDir: StateDirectory,
): Promise<StateDirectoryValidation> {
  const missing: string[] = [];
  const errors: string[] = [];

  // Check root directory
  if (!(await isDirectory(stateDir.root))) {
    const exists = await pathExists(stateDir.root);
    if (exists) {
      errors.push(`'${stateDir.root}' exists but is not a directory`);
    } else {
      missing.push(stateDir.root);
    }
  }

  // Check subdirectories
  for (const subdir of STATE_SUBDIRECTORIES) {
    const subdirPath = stateDir[subdir];
    if (!(await isDirectory(subdirPath))) {
      const exists = await pathExists(subdirPath);
      if (exists) {
        errors.push(`'${subdirPath}' exists but is not a directory`);
      } else {
        missing.push(subdirPath);
      }
    }
  }

  // Check state file (should exist, can be file)
  if (!(await pathExists(stateDir.stateFile))) {
    missing.push(stateDir.stateFile);
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}

/**
 * Create a single directory with descriptive error handling
 */
async function createDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new StateDirectoryCreateError(
      getPermissionErrorMessage(code, path),
      path,
      error as Error,
    );
  }
}

/**
 * Initialize the state directory structure
 *
 * Creates the .herdctl/ directory and its subdirectories (jobs/, sessions/, logs/)
 * if they don't exist. Also creates an initial state.yaml file with empty fleet state.
 *
 * @param options - Options for initialization
 * @returns StateDirectory object with paths to all subdirectories
 * @throws {StateDirectoryCreateError} If directories cannot be created
 * @throws {StateFileError} If state.yaml cannot be created
 *
 * @example
 * ```typescript
 * // Initialize in current directory
 * const stateDir = await initStateDirectory();
 *
 * // Initialize in custom location
 * const stateDir = await initStateDirectory({ path: '/custom/path/.herdctl' });
 * ```
 */
export async function initStateDirectory(
  options: InitStateDirectoryOptions = {},
): Promise<StateDirectory> {
  const stateDir = getStateDirectory(options.path);

  // Create root directory
  await createDirectory(stateDir.root);

  // Create subdirectories
  for (const subdir of STATE_SUBDIRECTORIES) {
    await createDirectory(stateDir[subdir]);
  }

  // Create state.yaml if it doesn't exist
  if (!(await pathExists(stateDir.stateFile))) {
    try {
      const initialState = createInitialFleetState();
      await atomicWriteYaml(stateDir.stateFile, initialState);
    } catch (error) {
      throw new StateFileError(
        `Failed to create initial state file: ${(error as Error).message}`,
        stateDir.stateFile,
        "write",
        error as Error,
      );
    }
  } else {
    // Validate existing state.yaml is readable and valid
    const result = await safeReadYaml(stateDir.stateFile);
    if (!result.success) {
      throw new StateFileError(
        `Existing state file is corrupted or unreadable: ${result.error.message}`,
        stateDir.stateFile,
        "read",
        result.error,
      );
    }

    // Validate against schema
    const parseResult = FleetStateSchema.safeParse(result.data);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new StateFileError(
        `Existing state file has invalid schema: ${issues}`,
        stateDir.stateFile,
        "read",
      );
    }
  }

  // Final validation
  const validation = await validateStateDirectory(stateDir);
  if (!validation.valid) {
    const allIssues = [...validation.missing, ...validation.errors];
    throw new StateDirectoryValidationError(
      `State directory validation failed: ${allIssues.join(", ")}`,
      validation.missing,
    );
  }

  return stateDir;
}
