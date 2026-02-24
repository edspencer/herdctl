/**
 * File Installation for Agent Distribution
 *
 * Copies agent files from a fetched/temp directory to `./agents/<name>/` in the
 * user's project. Creates the workspace directory and writes installation metadata.
 */

import { access, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";

import { FleetManagerError, type FleetManagerErrorCode } from "../fleet-manager/errors.js";
import { createLogger } from "../utils/logger.js";
import { AGENT_NAME_PATTERN } from "./agent-repo-metadata.js";
import type { InstallationMetadata, InstallationSource } from "./installation-metadata.js";

const logger = createLogger("distribution:installer");

// =============================================================================
// Types
// =============================================================================

/**
 * Options for installing agent files
 */
export interface InstallOptions {
  /** The directory containing the fetched agent repo files */
  sourceDir: string;
  /** The target base directory (where agents/ lives, usually project root) */
  targetBaseDir: string;
  /** The source specifier info for metadata tracking */
  source: InstallationSource;
  /** Optional: override the target path instead of using ./agents/<name>/ */
  targetPath?: string;
  /** If true, remove existing target directory before installing */
  force?: boolean;
}

/**
 * Result of a successful agent file installation
 */
export interface InstallResult {
  /** The agent name (from agent.yaml) */
  agentName: string;
  /** The full path to the installed agent directory */
  installPath: string;
  /** List of files that were copied (relative paths) */
  copiedFiles: string[];
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error codes for agent installation failures
 */
export const AGENT_ALREADY_EXISTS: FleetManagerErrorCode = "AGENT_ALREADY_EXISTS";
export const INVALID_AGENT_NAME: FleetManagerErrorCode = "INVALID_AGENT_NAME";
export const MISSING_AGENT_YAML: FleetManagerErrorCode = "MISSING_AGENT_YAML";
export const INVALID_AGENT_YAML: FleetManagerErrorCode = "INVALID_AGENT_YAML";

/**
 * Error thrown when agent file installation fails
 */
export class AgentInstallError extends FleetManagerError {
  constructor(message: string, code: FleetManagerErrorCode) {
    super(message, { code });
    this.name = "AgentInstallError";
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Directories to exclude when copying agent files
 */
const EXCLUDED_DIRS = new Set([".git", "node_modules"]);

/**
 * Metadata file name for installation tracking
 */
const METADATA_FILE = "metadata.json";

/**
 * Workspace directory name (created for agent runtime use)
 */
const WORKSPACE_DIR = "workspace";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse agent.yaml to extract the agent name
 */
async function readAgentName(sourceDir: string): Promise<string> {
  const agentYamlPath = join(sourceDir, "agent.yaml");

  // Check if agent.yaml exists
  if (!(await pathExists(agentYamlPath))) {
    throw new AgentInstallError(
      `agent.yaml not found in source directory: ${sourceDir}`,
      MISSING_AGENT_YAML,
    );
  }

  // Read and parse the file
  let content: string;
  try {
    content = await readFile(agentYamlPath, "utf-8");
  } catch (err) {
    const error = err as Error;
    throw new AgentInstallError(`Failed to read agent.yaml: ${error.message}`, MISSING_AGENT_YAML);
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const position = err.linePos?.[0];
      const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";
      throw new AgentInstallError(
        `Invalid YAML syntax in agent.yaml${locationInfo}: ${err.message}`,
        INVALID_AGENT_YAML,
      );
    }
    throw new AgentInstallError(
      `Failed to parse agent.yaml: ${(err as Error).message}`,
      INVALID_AGENT_YAML,
    );
  }

  // Extract and validate name
  if (!parsed || typeof parsed !== "object") {
    throw new AgentInstallError(
      "agent.yaml must contain a valid YAML object with a 'name' field",
      INVALID_AGENT_YAML,
    );
  }

  const data = parsed as Record<string, unknown>;
  const name = data.name;

  if (typeof name !== "string" || name.trim() === "") {
    throw new AgentInstallError(
      "agent.yaml must have a 'name' field with a non-empty string value",
      INVALID_AGENT_YAML,
    );
  }

  return name;
}

/**
 * Validate an agent name against the AGENT_NAME_PATTERN
 */
function validateAgentName(name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new AgentInstallError(
      `Invalid agent name "${name}". Agent names must start with a letter or number ` +
        `and contain only letters, numbers, underscores, and hyphens.`,
      INVALID_AGENT_NAME,
    );
  }
}

/**
 * Recursively copy directory contents, excluding specified directories.
 * Returns the list of copied files (relative paths).
 */
async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
  excludedDirs: Set<string>,
  relativePath: string = "",
): Promise<string[]> {
  const copiedFiles: string[] = [];

  // Create target directory if it doesn't exist
  await mkdir(targetDir, { recursive: true });

  // Read source directory contents
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const entryRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      // Skip excluded directories
      if (excludedDirs.has(entry.name)) {
        logger.debug("Skipping excluded directory", { path: entryRelativePath });
        continue;
      }

      // Recursively copy subdirectory
      const subFiles = await copyDirectoryRecursive(
        sourcePath,
        targetPath,
        excludedDirs,
        entryRelativePath,
      );
      copiedFiles.push(...subFiles);
    } else if (entry.isFile()) {
      // Copy file
      await cp(sourcePath, targetPath);
      copiedFiles.push(entryRelativePath);
    }
    // Skip symlinks and other special files
  }

  return copiedFiles;
}

/**
 * Write installation metadata to metadata.json
 */
async function writeMetadata(installPath: string, source: InstallationSource): Promise<void> {
  const metadata: InstallationMetadata = {
    source,
    installed_at: new Date().toISOString(),
    installed_by: `herdctl@${getHerdctlVersion()}`,
  };

  const metadataPath = join(installPath, METADATA_FILE);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  logger.debug("Wrote metadata.json", { path: metadataPath });
}

/**
 * Get herdctl version from package.json (simplified - returns unknown if not found)
 */
function getHerdctlVersion(): string {
  // In a real implementation, this would read from package.json
  // For now, we return a placeholder that will be replaced with actual version
  return "unknown";
}

// =============================================================================
// Main Installer
// =============================================================================

/**
 * Install agent files from a source directory to the target location
 *
 * This function:
 * 1. Reads the agent name from `agent.yaml` in the source directory
 * 2. Validates the agent name against AGENT_NAME_PATTERN
 * 3. Checks that the target directory doesn't already exist
 * 4. Copies all files from source to target, excluding `.git/` and `node_modules/`
 * 5. Creates an empty `workspace/` directory for agent runtime use
 * 6. Writes `metadata.json` with installation tracking information
 *
 * @param options - Installation options
 * @returns Installation result with agent name, install path, and copied files
 * @throws {AgentInstallError} When installation fails
 *
 * @example
 * ```typescript
 * const result = await installAgentFiles({
 *   sourceDir: "/tmp/herdctl-github-xxxxx",
 *   targetBaseDir: "/path/to/project",
 *   source: {
 *     type: "github",
 *     url: "https://github.com/user/agent-repo",
 *     ref: "v1.0.0"
 *   }
 * });
 *
 * console.log(`Installed ${result.agentName} to ${result.installPath}`);
 * console.log(`Copied ${result.copiedFiles.length} files`);
 * ```
 */
export async function installAgentFiles(options: InstallOptions): Promise<InstallResult> {
  const { sourceDir, targetBaseDir, source, targetPath, force } = options;

  logger.debug("Starting agent file installation", {
    sourceDir,
    targetBaseDir,
    sourceType: source.type,
    targetPath,
    force,
  });

  // ==========================================================================
  // 1. Read agent name from agent.yaml
  // ==========================================================================
  const agentName = await readAgentName(sourceDir);
  logger.debug("Read agent name from agent.yaml", { agentName });

  // ==========================================================================
  // 2. Validate agent name
  // ==========================================================================
  validateAgentName(agentName);
  logger.debug("Agent name validated", { agentName });

  // ==========================================================================
  // 3. Determine target path and check it doesn't exist (unless force)
  // ==========================================================================
  const installPath = targetPath ?? join(targetBaseDir, "agents", agentName);

  if (await pathExists(installPath)) {
    if (force) {
      // Remove existing directory when force is true
      logger.debug("Force mode: removing existing directory", { installPath });
      const { rm } = await import("node:fs/promises");
      await rm(installPath, { recursive: true, force: true });
    } else {
      throw new AgentInstallError(
        `Agent "${agentName}" already exists at ${installPath}. ` +
          `Remove the existing agent first or use a different name.`,
        AGENT_ALREADY_EXISTS,
      );
    }
  }

  logger.debug("Target path determined", { installPath });

  // ==========================================================================
  // 4. Copy files (excluding .git and node_modules)
  // ==========================================================================
  logger.info("Copying agent files", {
    source: sourceDir,
    destination: installPath,
  });

  const copiedFiles = await copyDirectoryRecursive(sourceDir, installPath, EXCLUDED_DIRS);
  logger.debug("Files copied", { count: copiedFiles.length });

  // ==========================================================================
  // 5. Create workspace directory
  // ==========================================================================
  const workspacePath = join(installPath, WORKSPACE_DIR);
  await mkdir(workspacePath, { recursive: true });
  logger.debug("Created workspace directory", { path: workspacePath });

  // ==========================================================================
  // 6. Write metadata.json
  // ==========================================================================
  await writeMetadata(installPath, source);

  logger.info("Agent installation complete", {
    agentName,
    installPath,
    copiedFiles: copiedFiles.length,
  });

  return {
    agentName,
    installPath,
    copiedFiles,
  };
}
