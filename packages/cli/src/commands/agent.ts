/**
 * herdctl agent commands
 *
 * Commands for managing installed agents:
 * - herdctl agent add <source>  Install an agent from GitHub or local path
 * - herdctl agent list          List all discovered agents in the fleet
 * - herdctl agent info <name>   Show detailed information about an agent
 * - herdctl agent remove <name> Remove an installed agent
 *
 * The add command orchestrates the full agent installation flow:
 * 1. Parse source specifier (github:user/repo[@ref] or ./local/path)
 * 2. Fetch repository to temp directory
 * 3. Validate agent repository structure
 * 4. Install files to ./agents/<name>/
 * 5. Update herdctl.yaml with agent reference
 * 6. Scan and display required environment variables
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AGENT_ALREADY_EXISTS,
  // Agent removal
  AGENT_NOT_FOUND,
  type AgentDetailedInfo,
  AgentDiscoveryError,
  AgentInstallError,
  AgentRemoveError,
  // Fleet config update
  addAgentToFleetConfig,
  ConfigError,
  ConfigNotFoundError,
  createLogger,
  type DiscoveredAgent,
  // Agent discovery
  discoverAgents,
  type EnvScanResult,
  type FetchSource,
  FleetConfigError,
  // Repository fetching
  fetchRepository,
  GitHubCloneAuthError,
  GitHubRepoNotFoundError,
  // Agent info
  getAgentInfo,
  type InstallationSource,
  // File installation
  installAgentFiles,
  isGitHubSource,
  isLocalSource,
  LocalPathError,
  // Config loader for fleet-of-fleets support
  loadConfig,
  NetworkError,
  // Source parsing
  parseSourceSpecifier,
  RepositoryFetchError,
  type ResolvedAgent,
  removeAgent,
  SourceParseError,
  type SourceSpecifier,
  // Environment variable scanning
  scanEnvVariables,
  stringifySourceSpecifier,
  type ValidationResult,
  // Repository validation
  validateRepository,
} from "@herdctl/core";
import { parse as parseYaml } from "yaml";

const logger = createLogger("cli:agent");

// =============================================================================
// Types
// =============================================================================

export interface AgentAddOptions {
  /** Override the target installation directory */
  path?: string;
  /** Show what would happen without making changes */
  dryRun?: boolean;
  /** Overwrite existing agent directory */
  force?: boolean;
}

export interface AgentRemoveOptions {
  /** Skip confirmation (no-op for now, reserved for future interactive confirmation) */
  force?: boolean;
  /** Preserve workspace directory contents */
  keepWorkspace?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a parsed SourceSpecifier to a FetchSource for the repository fetcher
 */
function toFetchSource(specifier: SourceSpecifier): FetchSource {
  if (isGitHubSource(specifier)) {
    return {
      type: "github",
      owner: specifier.owner,
      repo: specifier.repo,
      ref: specifier.ref,
    };
  }

  if (isLocalSource(specifier)) {
    return {
      type: "local",
      path: specifier.path,
    };
  }

  // TypeScript exhaustiveness check
  const _exhaustive: never = specifier;
  throw new Error(`Unknown source type: ${(_exhaustive as SourceSpecifier).type}`);
}

/**
 * Convert a parsed SourceSpecifier to an InstallationSource for metadata tracking
 */
function toInstallationSource(specifier: SourceSpecifier): InstallationSource {
  if (isGitHubSource(specifier)) {
    return {
      type: "github",
      url: `https://github.com/${specifier.owner}/${specifier.repo}`,
      ref: specifier.ref,
    };
  }

  if (isLocalSource(specifier)) {
    return {
      type: "local",
      url: specifier.path,
    };
  }

  // TypeScript exhaustiveness check
  const _exhaustive: never = specifier;
  throw new Error(`Unknown source type: ${(_exhaustive as SourceSpecifier).type}`);
}

/**
 * Print validation errors in a user-friendly format
 */
function printValidationErrors(result: ValidationResult): void {
  if (result.errors.length > 0) {
    console.log("");
    console.log("Validation errors:");
    for (const error of result.errors) {
      const pathInfo = error.path ? ` (${error.path})` : "";
      console.log(`  - ${error.message}${pathInfo}`);
    }
  }
}

/**
 * Print validation warnings in a user-friendly format
 */
function printValidationWarnings(result: ValidationResult): void {
  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      const pathInfo = warning.path ? ` (${warning.path})` : "";
      console.log(`  - ${warning.message}${pathInfo}`);
    }
  }
}

/**
 * Print environment variables summary
 */
function printEnvVariables(envResult: EnvScanResult): void {
  if (envResult.variables.length === 0) {
    return;
  }

  console.log("");
  console.log("Environment variables to configure:");

  if (envResult.required.length > 0) {
    console.log("  Required (no defaults):");
    for (const variable of envResult.required) {
      console.log(`    ${variable.name}`);
    }
  }

  if (envResult.optional.length > 0) {
    console.log("");
    console.log("  Optional (have defaults):");
    for (const variable of envResult.optional) {
      console.log(`    ${variable.name} (default: ${variable.defaultValue})`);
    }
  }

  console.log("");
  console.log("Add these to your .env file, then run: herdctl start");
}

/**
 * Handle known error types and print user-friendly messages
 * Returns true if the error was handled, false otherwise
 */
function handleKnownError(error: unknown): boolean {
  if (error instanceof SourceParseError) {
    logger.error(`Invalid source: ${error.message}`);
    return true;
  }

  if (error instanceof GitHubCloneAuthError) {
    logger.error(`Authentication failed: ${error.message}`);
    return true;
  }

  if (error instanceof GitHubRepoNotFoundError) {
    logger.error(`Repository not found: ${error.message}`);
    return true;
  }

  if (error instanceof NetworkError) {
    logger.error(`Network error: ${error.message}`);
    return true;
  }

  if (error instanceof LocalPathError) {
    logger.error(`Local path error: ${error.message}`);
    return true;
  }

  if (error instanceof RepositoryFetchError) {
    logger.error(`Failed to fetch: ${error.message}`);
    return true;
  }

  if (error instanceof AgentInstallError) {
    if (error.code === AGENT_ALREADY_EXISTS) {
      logger.error(`Installation failed: ${error.message}`);
      logger.error("Use --force to overwrite the existing agent.");
    } else {
      logger.error(`Installation failed: ${error.message}`);
    }
    return true;
  }

  if (error instanceof FleetConfigError) {
    logger.error(`Config update failed: ${error.message}`);
    return true;
  }

  return false;
}

// =============================================================================
// Main Command
// =============================================================================

/**
 * Install an agent from a source specifier
 *
 * Orchestrates the full installation flow:
 * 1. Parse source specifier
 * 2. Fetch repository
 * 3. Validate repository
 * 4. Install files (unless dry-run)
 * 5. Update fleet config (unless dry-run)
 * 6. Scan and display env variables
 * 7. Cleanup temp directory
 *
 * @param source - Source specifier (e.g., "github:user/repo", "./local/path")
 * @param options - Command options
 */
export async function agentAddCommand(source: string, options: AgentAddOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const { dryRun, force, path: customPath } = options;

  // Determine target base directory
  const targetBaseDir = customPath ? path.dirname(path.resolve(customPath)) : cwd;
  const targetPath = customPath ? path.resolve(customPath) : undefined;

  // ==========================================================================
  // Step 1: Parse source specifier
  // ==========================================================================
  let specifier: SourceSpecifier;
  try {
    specifier = parseSourceSpecifier(source);
  } catch (error) {
    handleKnownError(error);
    process.exit(1);
  }

  const sourceStr = stringifySourceSpecifier(specifier);
  console.log(`Fetching ${sourceStr}...`);

  // ==========================================================================
  // Step 2: Fetch repository
  // ==========================================================================
  let fetchResult: Awaited<ReturnType<typeof fetchRepository>> | undefined;

  try {
    const fetchSource = toFetchSource(specifier);
    fetchResult = await fetchRepository(fetchSource);
  } catch (error) {
    handleKnownError(error);
    process.exit(1);
  }

  // Ensure cleanup happens even on errors
  try {
    // ==========================================================================
    // Step 3: Validate repository
    // ==========================================================================
    console.log("Validating agent repository...");

    const validationResult = await validateRepository(fetchResult.path);

    // Print warnings regardless of validation result
    printValidationWarnings(validationResult);

    // If there are errors, print them and exit
    if (!validationResult.valid) {
      printValidationErrors(validationResult);
      console.log("");
      logger.error("Validation failed. Cannot install agent.");
      process.exitCode = 1;
      return;
    }

    const agentName = validationResult.agentName!;

    // ==========================================================================
    // Step 4: Install files (or describe what would happen)
    // ==========================================================================
    const installSource = toInstallationSource(specifier);
    const effectiveTargetPath = targetPath ?? path.join(cwd, "agents", agentName);
    const relativeInstallPath = path.relative(cwd, effectiveTargetPath);

    if (dryRun) {
      console.log("");
      console.log("Dry run mode - no changes will be made.");
      console.log("");
      console.log(`Would install agent '${agentName}' to ${relativeInstallPath}/`);
      console.log("");
      console.log("Files that would be installed:");

      // List files that would be copied
      const filesToCopy = await listFilesRecursive(fetchResult.path);
      for (const file of filesToCopy) {
        console.log(`  ${relativeInstallPath}/${file}`);
      }
      console.log(`  ${relativeInstallPath}/workspace/ (created)`);

      console.log("");
      console.log("Config changes:");
      console.log(`  herdctl.yaml (would add agent reference)`);
    } else {
      console.log(`Installing agent '${agentName}' to ${relativeInstallPath}/...`);

      const installResult = await installAgentFiles({
        sourceDir: fetchResult.path,
        targetBaseDir,
        source: installSource,
        targetPath,
        force,
      });

      // ==========================================================================
      // Step 5: Update fleet config
      // ==========================================================================
      console.log("Updating herdctl.yaml...");

      // Determine the relative path to the agent.yaml for the fleet config
      const agentYamlPath = `./${path.relative(cwd, path.join(installResult.installPath, "agent.yaml"))}`;

      await addAgentToFleetConfig({
        configPath,
        agentPath: agentYamlPath,
      });

      // ==========================================================================
      // Step 6: Scan environment variables
      // ==========================================================================
      const agentYamlFullPath = path.join(installResult.installPath, "agent.yaml");
      const agentYamlContent = fs.readFileSync(agentYamlFullPath, "utf-8");
      const envResult = scanEnvVariables(agentYamlContent);

      // ==========================================================================
      // Print success summary
      // ==========================================================================
      console.log("");
      console.log(`Agent '${agentName}' installed successfully!`);
      console.log("");
      console.log("Files installed:");
      for (const file of installResult.copiedFiles) {
        console.log(`  ${relativeInstallPath}/${file}`);
      }
      console.log(`  ${relativeInstallPath}/workspace/ (created)`);

      console.log("");
      console.log("Config updated:");
      console.log("  herdctl.yaml (added agent reference)");

      printEnvVariables(envResult);
    }
  } catch (error) {
    // Handle known errors from validation, installation, or config update
    if (handleKnownError(error)) {
      process.exitCode = 1;
      return;
    }
    // Re-throw unknown errors
    throw error;
  } finally {
    // ==========================================================================
    // Step 7: Cleanup temp directory
    // ==========================================================================
    if (fetchResult) {
      await fetchResult.cleanup();
    }
  }
}

/**
 * Recursively list files in a directory (excluding .git and node_modules)
 */
async function listFilesRecursive(dir: string, relativePath: string = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const excludedDirs = new Set([".git", "node_modules"]);

  for (const entry of entries) {
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) {
        const subFiles = await listFilesRecursive(path.join(dir, entry.name), entryPath);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

// =============================================================================
// Agent List Command
// =============================================================================

export interface AgentListOptions {
  /** Output as JSON for scripting */
  json?: boolean;
}

/**
 * Format a date string for display
 */
function formatDate(isoDate: string | undefined): string {
  if (!isoDate) {
    return "-";
  }
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "-";
  }
}

/**
 * Get source description from agent metadata
 */
function getSourceDescription(agent: DiscoveredAgent): string {
  if (!agent.metadata) {
    return "manual";
  }

  const { source } = agent.metadata;
  if (source.type === "github") {
    // Extract owner/repo from URL
    const match = source.url?.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      return source.ref ? `${match[1]}@${source.ref}` : match[1];
    }
    return source.ref ?? "github";
  }

  if (source.type === "local") {
    return source.url ?? "local";
  }

  return source.type;
}

/**
 * Maximum number of agents before switching to summary mode.
 * When total agents exceed this threshold, fleet-level counts are shown
 * instead of individual agent names to avoid overwhelming output.
 */
export const TREE_AGENT_THRESHOLD = 200;

/**
 * Tree node representing a fleet or agent in the hierarchy
 */
export interface FleetTreeNode {
  name: string;
  description?: string;
  agents: string[];
  children: FleetTreeNode[];
}

/**
 * Build a tree structure from a flat array of resolved agents.
 *
 * Groups agents by their fleetPath hierarchy. Root-level agents (empty fleetPath)
 * go directly under the root node. Sub-fleet agents are nested under their
 * respective fleet nodes.
 */
export function buildFleetTree(
  agents: ResolvedAgent[],
  rootName: string,
  rootDescription?: string,
): FleetTreeNode {
  const root: FleetTreeNode = {
    name: rootName,
    description: rootDescription,
    agents: [],
    children: [],
  };

  for (const agent of agents) {
    if (agent.fleetPath.length === 0) {
      // Root-level agent
      root.agents.push(agent.name);
    } else {
      // Walk/create the tree path for this agent
      let current = root;
      for (const fleetName of agent.fleetPath) {
        let child = current.children.find((c) => c.name === fleetName);
        if (!child) {
          child = { name: fleetName, agents: [], children: [] };
          current.children.push(child);
        }
        current = child;
      }
      current.agents.push(agent.name);
    }
  }

  return root;
}

/**
 * Render a fleet tree with box-drawing characters.
 *
 * Uses standard Unicode box-drawing characters for the tree structure:
 * - Connector for intermediate items
 * - End connector for last items
 * - Vertical bar for continuing branches
 *
 * @param node - The tree node to render
 * @param prefix - Current indentation prefix
 * @param isLast - Whether this node is the last child of its parent
 * @param isRoot - Whether this is the root node
 * @param summaryMode - When true, show agent counts instead of names
 */
export function renderFleetTree(
  node: FleetTreeNode,
  prefix: string = "",
  isLast: boolean = true,
  isRoot: boolean = true,
  summaryMode: boolean = false,
): string[] {
  const lines: string[] = [];

  // Render this node's header
  if (isRoot) {
    const desc = node.description ? ` (${node.description})` : "";
    lines.push(`${node.name}${desc}`);
  } else {
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    lines.push(`${prefix}${connector}${node.name}`);
  }

  // Determine the prefix for children
  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");

  // Collect all items to render (agents + child fleets)
  const allItems: Array<{ type: "agent"; name: string } | { type: "fleet"; node: FleetTreeNode }> =
    [];

  // Add child fleets first
  for (const child of node.children) {
    allItems.push({ type: "fleet", node: child });
  }

  // Add agents (or summary)
  if (summaryMode && node.agents.length > 0) {
    allItems.push({ type: "agent", name: `(${node.agents.length} agents)` });
  } else {
    for (const agentName of node.agents) {
      allItems.push({ type: "agent", name: agentName });
    }
  }

  // Render each item
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const itemIsLast = i === allItems.length - 1;

    if (item.type === "agent") {
      const connector = itemIsLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      lines.push(`${childPrefix}${connector}${item.name}`);
    } else {
      const subLines = renderFleetTree(item.node, childPrefix, itemIsLast, false, summaryMode);
      lines.push(...subLines);
    }
  }

  return lines;
}

/**
 * Check if the fleet config at the given path has sub-fleets defined.
 * Reads the YAML file and checks for a non-empty fleets array.
 */
function configHasSubFleets(configPath: string): boolean {
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = parseYaml(content);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Record<string, unknown>).fleets) &&
      ((parsed as Record<string, unknown>).fleets as unknown[]).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * List all agents in the fleet
 *
 * Discovers agents from the fleet configuration and displays them.
 * When sub-fleets exist, displays a tree view showing agents grouped by fleet hierarchy.
 * When no sub-fleets exist, displays a flat table (original behavior).
 *
 * If total agents across the hierarchy exceed 200, shows fleet-level summary counts
 * instead of individual agent names.
 *
 * @param options - Command options
 */
export async function agentListCommand(options: AgentListOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");

  // Check if this fleet has sub-fleets for the tree view
  const hasSubFleets = configHasSubFleets(configPath);

  if (hasSubFleets) {
    // Use loadConfig for full fleet-of-fleets resolution
    try {
      const resolvedConfig = await loadConfig(configPath);
      const allAgents = resolvedConfig.agents;

      if (options.json) {
        // Output the full resolved agents with fleet hierarchy info
        const jsonOutput = allAgents.map((a) => ({
          name: a.name,
          qualifiedName: a.qualifiedName,
          fleetPath: a.fleetPath,
          configPath: a.configPath,
          description: a.description,
        }));
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      if (allAgents.length === 0) {
        console.log("No agents found across fleet hierarchy.");
        console.log("");
        console.log("To add an agent, run:");
        console.log("  herdctl agent add <source>     Install from GitHub or local path");
        console.log("  herdctl init agent <name>      Create a new agent manually");
        return;
      }

      // Build and render the tree
      const rootName = resolvedConfig.fleet.fleet?.name ?? "fleet";
      const rootDescription = resolvedConfig.fleet.fleet?.description;
      const tree = buildFleetTree(allAgents, rootName, rootDescription);
      const summaryMode = allAgents.length > TREE_AGENT_THRESHOLD;
      const treeLines = renderFleetTree(tree, "", true, true, summaryMode);

      console.log("");
      for (const line of treeLines) {
        console.log(line);
      }

      console.log("");
      console.log(
        `Total: ${allAgents.length} agent${allAgents.length === 1 ? "" : "s"} across fleet hierarchy`,
      );
    } catch (error) {
      if (error instanceof ConfigNotFoundError || error instanceof ConfigError) {
        logger.error(`Config error: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
  } else {
    // Original flat table behavior when no sub-fleets
    try {
      const result = await discoverAgents({ configPath });

      if (options.json) {
        console.log(JSON.stringify(result.agents, null, 2));
        return;
      }

      if (result.agents.length === 0) {
        console.log("No agents found in fleet configuration.");
        console.log("");
        console.log("To add an agent, run:");
        console.log("  herdctl agent add <source>     Install from GitHub or local path");
        console.log("  herdctl init agent <name>      Create a new agent manually");
        return;
      }

      // Print table header
      console.log("");
      console.log("Agents in fleet:");
      console.log("");

      // Calculate column widths
      const nameWidth = Math.max(4, ...result.agents.map((a) => a.name.length));
      const sourceWidth = Math.max(6, ...result.agents.map((a) => getSourceDescription(a).length));
      const versionWidth = Math.max(7, ...result.agents.map((a) => (a.version ?? "-").length));
      const dateWidth = 12;
      const statusWidth = 9;

      // Print header row
      const header = [
        "Name".padEnd(nameWidth),
        "Source".padEnd(sourceWidth),
        "Version".padEnd(versionWidth),
        "Installed".padEnd(dateWidth),
        "Status".padEnd(statusWidth),
      ].join("  ");
      console.log(header);
      console.log("-".repeat(header.length));

      // Print each agent
      for (const agent of result.agents) {
        const row = [
          agent.name.padEnd(nameWidth),
          getSourceDescription(agent).padEnd(sourceWidth),
          (agent.version ?? "-").padEnd(versionWidth),
          formatDate(agent.metadata?.installed_at).padEnd(dateWidth),
          (agent.installed ? "installed" : "manual").padEnd(statusWidth),
        ].join("  ");
        console.log(row);
      }

      console.log("");
      console.log(`Total: ${result.agents.length} agent${result.agents.length === 1 ? "" : "s"}`);
    } catch (error) {
      if (error instanceof AgentDiscoveryError) {
        logger.error(`Discovery failed: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
  }
}

// =============================================================================
// Agent Info Command
// =============================================================================

export interface AgentInfoOptions {
  /** Output as JSON for scripting */
  json?: boolean;
}

/**
 * Get detailed information about a specific agent
 *
 * Shows comprehensive agent information including:
 * - Basic info (name, description, status)
 * - Source and installation details
 * - Environment variables
 * - Schedules
 * - Files in the agent directory
 *
 * @param name - Agent name to look up
 * @param options - Command options
 */
export async function agentInfoCommand(name: string, options: AgentInfoOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");

  try {
    const info = await getAgentInfo({ name, configPath });

    if (!info) {
      logger.error(`Agent '${name}' not found in fleet configuration.`);
      logger.error("Run 'herdctl agent list' to see available agents.");
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    // Print formatted output
    printAgentInfo(info);
  } catch (error) {
    if (error instanceof AgentDiscoveryError) {
      logger.error(`Discovery failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Format and print agent info to console
 */
function printAgentInfo(info: AgentDetailedInfo): void {
  console.log("");
  console.log(`Agent: ${info.name}`);

  if (info.description) {
    console.log(`Description: ${info.description}`);
  }

  // Status line
  if (info.installed) {
    const sourceType = info.metadata?.source.type ?? "unknown";
    const sourceLabel =
      sourceType === "github" ? "GitHub" : sourceType === "local" ? "local path" : sourceType;
    console.log(`Status: Installed (via ${sourceLabel})`);
  } else {
    console.log("Status: Manual (not installed via herdctl)");
  }

  // Source info for installed agents
  if (info.metadata?.source.url) {
    console.log(`Source: ${info.metadata.source.url}`);
  }

  if (info.version) {
    console.log(`Version: ${info.version}`);
  }

  if (info.metadata?.installed_at) {
    console.log(`Installed: ${info.metadata.installed_at}`);
  }

  // Schedules
  if (info.schedules && Object.keys(info.schedules).length > 0) {
    console.log("");
    console.log("Schedules:");
    for (const [scheduleName, scheduleConfig] of Object.entries(info.schedules)) {
      const scheduleDesc = formatScheduleDescription(scheduleConfig);
      console.log(`  ${scheduleName}: ${scheduleDesc}`);
    }
  }

  // Environment variables
  if (info.envVariables) {
    console.log("");
    console.log("Environment Variables:");

    if (info.envVariables.required.length > 0) {
      console.log("  Required:");
      for (const variable of info.envVariables.required) {
        console.log(`    ${variable.name}`);
      }
    }

    if (info.envVariables.optional.length > 0) {
      if (info.envVariables.required.length > 0) {
        console.log("");
      }
      console.log("  Optional:");
      for (const variable of info.envVariables.optional) {
        console.log(`    ${variable.name} (default: ${variable.defaultValue})`);
      }
    }
  }

  // Files
  if (info.files.length > 0) {
    console.log("");
    console.log("Files:");
    for (const file of info.files) {
      console.log(`  ${file}`);
    }
  }

  // Workspace
  console.log("");
  if (info.hasWorkspace) {
    const relativePath = path.relative(process.cwd(), info.path);
    console.log(`Workspace: ${relativePath}/workspace/`);
  } else {
    console.log("Workspace: (not created)");
  }

  console.log("");
}

/**
 * Format a schedule configuration for display
 */
function formatScheduleDescription(config: unknown): string {
  if (!config || typeof config !== "object") {
    return "unknown";
  }

  const scheduleObj = config as Record<string, unknown>;
  const scheduleType = (scheduleObj.type ?? scheduleObj.cron) ? "cron" : "unknown";

  if (scheduleType === "cron" && scheduleObj.cron) {
    return `cron (${scheduleObj.cron})`;
  }

  if (scheduleObj.interval) {
    return `interval (${scheduleObj.interval})`;
  }

  return String(scheduleType);
}

// =============================================================================
// Agent Remove Command
// =============================================================================

/**
 * Remove an agent from the fleet
 *
 * This command:
 * 1. Finds the agent by name in the fleet configuration
 * 2. Deletes the agent directory (optionally preserving workspace)
 * 3. Removes the agent reference from herdctl.yaml
 * 4. Reports environment variables that were used (for cleanup reference)
 *
 * @param name - Agent name to remove
 * @param options - Command options
 */
export async function agentRemoveCommand(name: string, options: AgentRemoveOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const { keepWorkspace = false } = options;

  try {
    console.log(`Removing agent '${name}'...`);

    const result = await removeAgent({
      name,
      configPath,
      keepWorkspace,
    });

    // Print what was removed
    const relativePath = path.relative(cwd, result.removedPath);

    if (result.filesRemoved) {
      if (result.workspacePreserved) {
        console.log(`Deleted ${relativePath}/ (workspace preserved)`);
      } else {
        console.log(`Deleted ${relativePath}/`);
      }
    }

    if (result.configUpdated) {
      console.log("Updated herdctl.yaml (removed agent reference)");
    }

    // Print env variables summary if any were found
    if (result.envVariables && result.envVariables.variables.length > 0) {
      console.log("");
      console.log("This agent used the following environment variables:");

      if (result.envVariables.required.length > 0) {
        console.log("  Required:");
        for (const variable of result.envVariables.required) {
          console.log(`    ${variable.name}`);
        }
      }

      if (result.envVariables.optional.length > 0) {
        if (result.envVariables.required.length > 0) {
          console.log("");
        }
        console.log("  Optional:");
        for (const variable of result.envVariables.optional) {
          console.log(`    ${variable.name} (default: ${variable.defaultValue})`);
        }
      }

      console.log("");
      console.log("You may want to remove these from your .env file.");
    }
  } catch (error) {
    if (error instanceof AgentRemoveError) {
      if (error.code === AGENT_NOT_FOUND) {
        logger.error(`Agent '${name}' not found in fleet configuration.`);
        logger.error("Run 'herdctl agent list' to see available agents.");
      } else {
        logger.error(`Removal failed: ${error.message}`);
      }
      process.exit(1);
    }

    if (error instanceof AgentDiscoveryError) {
      logger.error(`Discovery failed: ${error.message}`);
      process.exit(1);
    }

    throw error;
  }
}
