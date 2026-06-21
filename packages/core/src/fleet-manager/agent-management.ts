/**
 * Agent Management Module
 *
 * Centralizes programmatic (in-memory) agent registration for FleetManager.
 *
 * Unlike {@link ConfigReload}, which re-reads agent definitions from disk, this
 * module lets a library consumer add or remove a single agent at runtime by
 * passing an {@link AgentConfig} object directly. This avoids the
 * write-yaml-then-reload() round trip that consumers building project-oriented
 * apps on top of herdctl (e.g. paddock) would otherwise need.
 *
 * The resolved agent is integrated with the same plumbing reload() uses:
 * - the stored {@link ResolvedConfig}'s `agents` array,
 * - the {@link Scheduler} (via `setAgents`),
 * so the new agent is immediately triggerable and appears in fleet status.
 *
 * @module agent-management
 */

import { isAbsolute, resolve } from "node:path";
import {
  type AgentConfig,
  AgentConfigSchema,
  type ExtendedDefaults,
  mergeAgentConfig,
  type ResolvedAgent,
  type ResolvedConfig,
} from "../config/index.js";
import type { FleetManagerContext } from "./context.js";
import { ConfigurationError, InvalidStateError } from "./errors.js";
import type { AgentInfo, ConfigChange } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for {@link AgentManagement.addAgent}.
 */
export interface AddAgentOptions {
  /**
   * Base directory used to resolve a relative `working_directory` to an absolute
   * path. Defaults to the loaded config directory (or `process.cwd()` if the
   * fleet was initialized without a config file).
   */
  baseDir?: string;

  /**
   * Whether to deep-merge fleet `defaults` into the agent (matching how agents
   * loaded from disk are resolved). Defaults to `true`.
   */
  mergeDefaults?: boolean;

  /**
   * When `true`, replace an existing agent with the same qualified name instead
   * of throwing. Defaults to `false`.
   */
  replace?: boolean;
}

// =============================================================================
// AgentManagement Class
// =============================================================================

/**
 * AgentManagement provides programmatic agent registration for the FleetManager.
 *
 * This class encapsulates resolving an {@link AgentConfig} into a
 * {@link ResolvedAgent} and wiring it into the running fleet, using the
 * {@link FleetManagerContext} pattern shared by the other module classes.
 */
export class AgentManagement {
  constructor(
    private ctx: FleetManagerContext,
    private setConfig: (config: ResolvedConfig) => void,
    private getAgentInfoByName: (name: string) => Promise<AgentInfo>,
  ) {}

  /**
   * Register an agent at runtime without writing YAML or calling `reload()`.
   *
   * The provided config is validated against the agent schema, merged with
   * fleet defaults (unless disabled), and normalized the same way agents loaded
   * from disk are. The resolved agent is appended to the in-memory config and
   * pushed to the scheduler so it is immediately triggerable and visible in
   * fleet status. A `config:reloaded` event is emitted describing the change.
   *
   * @param agent - The agent configuration to register
   * @param options - Resolution options (base dir, defaults merge, replace)
   * @returns Info for the newly registered agent
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {ConfigurationError} If validation fails or the qualified name
   *   collides with an existing agent (and `replace` is not set)
   */
  async addAgent(
    agent: AgentConfig | (Record<string, unknown> & { name: string }),
    options?: AddAgentOptions,
  ): Promise<AgentInfo> {
    const config = this.requireConfig("addAgent");
    const logger = this.ctx.getLogger();

    // Validate the incoming config against the agent schema. This applies the
    // same defaults/coercions (e.g. schedule.enabled) that a file-loaded agent
    // would receive, and produces a clear error on bad input.
    let validated: AgentConfig;
    try {
      validated = AgentConfigSchema.parse(agent);
    } catch (error) {
      throw new ConfigurationError(
        `Invalid agent configuration for addAgent: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    const resolved = this.resolveAgent(validated, config, options);

    // Detect collisions. Root-level programmatic agents use their name as the
    // qualified name, so this also catches duplicate local names.
    const existingIndex = config.agents.findIndex(
      (a) => a.qualifiedName === resolved.qualifiedName,
    );
    if (existingIndex !== -1 && !options?.replace) {
      throw new ConfigurationError(
        `Agent "${resolved.qualifiedName}" already exists. ` +
          `Use removeAgent() first, or pass { replace: true } to overwrite.`,
      );
    }

    const newAgents = [...config.agents];
    if (existingIndex !== -1) {
      newAgents[existingIndex] = resolved;
    } else {
      newAgents.push(resolved);
    }

    this.commit(config, newAgents, [
      buildChange(existingIndex !== -1 ? "modified" : "added", resolved),
    ]);

    logger.info(
      `Agent "${resolved.qualifiedName}" ${existingIndex !== -1 ? "replaced" : "added"} programmatically`,
    );

    return this.getAgentInfoByName(resolved.qualifiedName);
  }

  /**
   * Unregister an agent at runtime.
   *
   * Removes the agent from the in-memory config and the scheduler. Accepts a
   * qualified name (e.g. `"sub.agent"`) or a local name; qualified names are
   * matched first. Running jobs are unaffected — the scheduler simply stops
   * triggering the removed agent's schedules.
   *
   * @param name - The agent qualified name or local name to remove
   * @returns `true` if an agent was removed, `false` if no match was found
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   */
  async removeAgent(name: string): Promise<boolean> {
    const config = this.requireConfig("removeAgent");
    const logger = this.ctx.getLogger();

    // Match qualified name first, fall back to local name (mirrors
    // getAgentInfoByName / trigger lookup semantics).
    const qualifiedIndex = config.agents.findIndex((a) => a.qualifiedName === name);
    const index =
      qualifiedIndex !== -1 ? qualifiedIndex : config.agents.findIndex((a) => a.name === name);

    if (index === -1) {
      logger.debug(`removeAgent: no agent matching "${name}"`);
      return false;
    }

    const removed = config.agents[index];
    const newAgents = config.agents.filter((_, i) => i !== index);

    this.commit(config, newAgents, [buildChange("removed", removed)]);

    logger.info(`Agent "${removed.qualifiedName}" removed programmatically`);
    return true;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Ensure the fleet is initialized and return the current config.
   */
  private requireConfig(operation: string): ResolvedConfig {
    const status = this.ctx.getStatus();
    if (status === "uninitialized") {
      throw new InvalidStateError(operation, status, [
        "initialized",
        "starting",
        "running",
        "stopping",
        "stopped",
      ]);
    }

    const config = this.ctx.getConfig();
    if (!config) {
      throw new InvalidStateError(operation, status, [
        "initialized",
        "starting",
        "running",
        "stopping",
        "stopped",
      ]);
    }
    return config;
  }

  /**
   * Persist the new agent list to the stored config and the scheduler, then
   * emit a `config:reloaded` event describing the change.
   */
  private commit(
    config: ResolvedConfig,
    newAgents: ResolvedAgent[],
    changes: ConfigChange[],
  ): void {
    const newConfig: ResolvedConfig = { ...config, agents: newAgents };
    this.setConfig(newConfig);

    const scheduler = this.ctx.getScheduler();
    if (scheduler) {
      scheduler.setAgents(newAgents);
    }

    this.ctx.emit("config:reloaded", {
      agentCount: newAgents.length,
      agentNames: newAgents.map((a) => a.qualifiedName),
      configPath: config.configPath,
      changes,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Resolve a validated {@link AgentConfig} into a {@link ResolvedAgent},
   * mirroring the loader's resolution: merge fleet defaults, normalize the
   * working directory, and compute the qualified name.
   *
   * Programmatic agents are always registered at the root fleet level
   * (`fleetPath: []`), so their qualified name equals their local name. This
   * matches how a consumer-managed config dir references agents.
   */
  private resolveAgent(
    agentConfig: AgentConfig,
    config: ResolvedConfig,
    options?: AddAgentOptions,
  ): ResolvedAgent {
    const mergeDefaults = options?.mergeDefaults ?? true;
    const baseDir =
      options?.baseDir ??
      (config.configDir && config.configDir.length > 0 ? config.configDir : process.cwd());

    let merged = agentConfig;
    const defaults = config.fleet.defaults as ExtendedDefaults | undefined;
    if (mergeDefaults && defaults) {
      merged = mergeAgentConfig(defaults, agentConfig);
    }

    // Normalize working_directory: resolve relative paths against baseDir.
    // (Absent working_directory is left undefined — programmatic consumers are
    // expected to provide an absolute path, as paddock does.)
    const normalized = normalizeWorkingDirectory(merged, baseDir);

    return {
      ...normalized,
      configPath: config.configPath,
      fleetPath: [],
      qualifiedName: normalized.name,
    };
  }
}

// =============================================================================
// Module Helpers
// =============================================================================

/**
 * Build a {@link ConfigChange} entry for an agent-level change.
 */
function buildChange(type: "added" | "removed" | "modified", agent: ResolvedAgent): ConfigChange {
  return {
    type,
    category: "agent",
    name: agent.qualifiedName,
    details: type === "removed" ? undefined : agent.description,
  };
}

/**
 * Resolve a relative `working_directory` to an absolute path against `baseDir`.
 * Handles both the string form and the structured `{ root }` form. Returns a
 * shallow copy of the agent so the caller's input is not mutated.
 */
function normalizeWorkingDirectory(agent: AgentConfig, baseDir: string): AgentConfig {
  const wd = agent.working_directory;
  if (wd === undefined) {
    return { ...agent };
  }

  if (typeof wd === "string") {
    return {
      ...agent,
      working_directory: isAbsolute(wd) ? wd : resolve(baseDir, wd),
    };
  }

  // Structured working directory ({ root, ... })
  if (wd.root && !isAbsolute(wd.root)) {
    return {
      ...agent,
      working_directory: { ...wd, root: resolve(baseDir, wd.root) },
    };
  }

  return { ...agent, working_directory: { ...wd } };
}
