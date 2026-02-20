/**
 * Type definitions for the herdctl execution hooks system
 *
 * Hooks allow running arbitrary code at agent lifecycle points
 * (after job completion, on error, etc.)
 *
 * Note: Hook configuration types (ShellHookConfig, WebhookHookConfig, etc.)
 * are defined in config/schema.ts and exported from config/index.ts.
 * This file contains only runtime types not derived from Zod schemas.
 */

// Import config types that are validated by Zod
// We import both output types (after defaults) and input types (for construction)
import type {
  AgentHooks,
  DiscordHookConfig,
  DiscordHookConfigInput,
  HookConfig,
  HookConfigInput,
  HookEvent,
  ShellHookConfig,
  // Input types allow optional fields (for test construction)
  ShellHookConfigInput,
  SlackHookConfig,
  SlackHookConfigInput,
  WebhookHookConfig,
  WebhookHookConfigInput,
} from "../config/schema.js";

// Re-export for convenience within the hooks module
// Export both output types (for processed config) and input types (for test construction)
export type {
  HookEvent,
  HookConfig,
  ShellHookConfig,
  WebhookHookConfig,
  DiscordHookConfig,
  SlackHookConfig,
};
export type {
  ShellHookConfigInput,
  WebhookHookConfigInput,
  DiscordHookConfigInput,
  SlackHookConfigInput,
  HookConfigInput,
};

// =============================================================================
// Hook Context (Runtime Type)
// =============================================================================

/**
 * Context payload passed to all hooks
 *
 * This provides complete information about the job that triggered the hook,
 * allowing hooks to make decisions and take actions based on job results.
 *
 * @example
 * ```typescript
 * // Example hook context for a completed job
 * const context: HookContext = {
 *   event: 'completed',
 *   job: {
 *     id: 'job-2024-01-15-abc123',
 *     agentId: 'daily-reporter',
 *     scheduleName: 'morning-run',
 *     startedAt: '2024-01-15T09:00:00.000Z',
 *     completedAt: '2024-01-15T09:05:30.000Z',
 *     durationMs: 330000,
 *   },
 *   result: {
 *     success: true,
 *     output: 'Daily report generated successfully...',
 *   },
 *   agent: {
 *     id: 'daily-reporter',
 *     name: 'Daily Reporter',
 *   },
 * };
 * ```
 */
export interface HookContext {
  /**
   * The event that triggered this hook
   */
  event: HookEvent;

  /**
   * Information about the job
   */
  job: {
    /**
     * Unique job identifier (format: job-YYYY-MM-DD-<random6>)
     */
    id: string;

    /**
     * ID/name of the agent that executed the job
     */
    agentId: string;

    /**
     * Name of the schedule that triggered the job (if applicable)
     */
    scheduleName?: string;

    /**
     * ISO timestamp when the job started
     */
    startedAt: string;

    /**
     * ISO timestamp when the job completed
     */
    completedAt: string;

    /**
     * Duration of the job in milliseconds
     */
    durationMs: number;
  };

  /**
   * Job execution result
   */
  result: {
    /**
     * Whether the job completed successfully
     */
    success: boolean;

    /**
     * Raw text output from the agent (may be truncated)
     */
    output: string;

    /**
     * Error message if the job failed
     */
    error?: string;
  };

  /**
   * Information about the agent
   */
  agent: {
    /**
     * Agent ID/name
     */
    id: string;

    /**
     * Human-readable agent name (if different from id)
     */
    name?: string;
  };

  /**
   * Agent-provided metadata (from metadata.json or configured metadata_file)
   *
   * This is arbitrary structured data that the agent can write during execution.
   * Hooks can use this for conditional execution via the `when` field.
   *
   * @example
   * ```typescript
   * // Agent writes metadata.json with:
   * // { "shouldNotify": true, "lowestPrice": 1299, "retailer": "MPB" }
   * //
   * // Hook config can conditionally execute:
   * // hooks:
   * //   after_run:
   * //     - type: discord
   * //       when: "metadata.shouldNotify"
   * ```
   */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Hook Result (Runtime Type)
// =============================================================================

/**
 * Result of executing a hook
 */
export interface HookResult {
  /**
   * Whether the hook executed successfully
   */
  success: boolean;

  /**
   * Hook type that was executed
   */
  hookType: "shell" | "webhook" | "discord" | "slack";

  /**
   * Duration of hook execution in milliseconds
   */
  durationMs: number;

  /**
   * Error message if the hook failed
   */
  error?: string;

  /**
   * Hook output (stdout for shell, response body for webhook)
   */
  output?: string;

  /**
   * Exit code for shell hooks
   */
  exitCode?: number;
}

// =============================================================================
// Base Hook Configuration (Interface version for documentation)
// =============================================================================

/**
 * Base configuration shared by all hook types
 *
 * Note: This is a documentation interface - actual validation
 * happens via Zod schemas in config/schema.ts
 */
export interface BaseHookConfig {
  /**
   * Whether to continue with subsequent hooks and job success
   * even if this hook fails.
   *
   * @default true
   */
  continue_on_error?: boolean;

  /**
   * Filter which events trigger this hook.
   * If not specified, all events trigger the hook.
   */
  on_events?: HookEvent[];
}

// =============================================================================
// Agent Hooks Config Alias
// =============================================================================

/**
 * Hook configuration for an agent
 *
 * Alias for AgentHooks from config/schema.ts
 */
export type AgentHooksConfig = AgentHooks;

// =============================================================================
// Hook Runner Interface
// =============================================================================

/**
 * Interface for hook runner implementations
 */
export interface HookRunner {
  /**
   * Execute a hook with the given context
   *
   * @param config - Hook configuration
   * @param context - Hook context with job information
   * @returns Promise resolving to the hook result
   */
  execute(config: HookConfig, context: HookContext): Promise<HookResult>;
}
