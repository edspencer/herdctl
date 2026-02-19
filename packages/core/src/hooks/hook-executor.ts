/**
 * Hook Executor
 *
 * Orchestrates the execution of hooks after job completion.
 * Handles sequencing, error handling, and event filtering.
 */

import type {
  HookContext,
  HookResult,
  HookEvent,
  // Use input types to accept configs with optional fields
  // The executor handles defaults internally
  ShellHookConfigInput,
  WebhookHookConfigInput,
  DiscordHookConfigInput,
  SlackHookConfigInput,
  HookConfigInput,
} from "./types.js";
import type { AgentHooksInput } from "../config/schema.js";
import { ShellHookRunner, type ShellHookRunnerLogger } from "./runners/shell.js";
import { WebhookHookRunner, type WebhookHookRunnerLogger } from "./runners/webhook.js";
import { DiscordHookRunner, type DiscordHookRunnerLogger } from "./runners/discord.js";
import { SlackHookRunner, type SlackHookRunnerLogger } from "./runners/slack.js";

/**
 * Logger interface for HookExecutor
 */
export interface HookExecutorLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for HookExecutor
 */
export interface HookExecutorOptions {
  /**
   * Logger for hook execution
   */
  logger?: HookExecutorLogger;

  /**
   * Working directory for shell hooks
   */
  cwd?: string;

  /**
   * Additional environment variables for hooks
   */
  env?: Record<string, string>;
}

/**
 * Result of executing all hooks for an event
 */
export interface HookExecutionResult {
  /**
   * Whether all hooks executed successfully
   */
  success: boolean;

  /**
   * Total number of hooks executed
   */
  totalHooks: number;

  /**
   * Number of hooks that succeeded
   */
  successfulHooks: number;

  /**
   * Number of hooks that failed
   */
  failedHooks: number;

  /**
   * Number of hooks that were skipped (filtered by on_events)
   */
  skippedHooks: number;

  /**
   * Total duration of all hook executions in milliseconds
   */
  totalDurationMs: number;

  /**
   * Individual hook results
   */
  results: HookResult[];

  /**
   * Whether hook execution should fail the job
   * (true if any hook with continue_on_error=false failed)
   */
  shouldFailJob: boolean;
}

/**
 * HookExecutor orchestrates the execution of hooks
 *
 * It:
 * - Executes hooks sequentially in order defined
 * - Filters hooks by event type (on_events)
 * - Handles errors based on continue_on_error setting
 * - Collects and returns results from all hooks
 *
 * @example
 * ```typescript
 * const executor = new HookExecutor({ logger: console });
 *
 * const result = await executor.executeHooks(
 *   agentHooksConfig,
 *   hookContext,
 *   'after_run'
 * );
 *
 * if (!result.success) {
 *   console.log(`${result.failedHooks} of ${result.totalHooks} hooks failed`);
 * }
 * ```
 */
export class HookExecutor {
  private logger: HookExecutorLogger;
  private shellRunner: ShellHookRunner;
  private webhookRunner: WebhookHookRunner;
  private discordRunner: DiscordHookRunner;
  private slackRunner: SlackHookRunner;

  constructor(options: HookExecutorOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // Create shell runner with same logger and options
    this.shellRunner = new ShellHookRunner({
      logger: this.logger as ShellHookRunnerLogger,
      cwd: options.cwd,
      env: options.env,
    });

    // Create webhook runner with same logger
    this.webhookRunner = new WebhookHookRunner({
      logger: this.logger as WebhookHookRunnerLogger,
    });

    // Create discord runner with same logger
    this.discordRunner = new DiscordHookRunner({
      logger: this.logger as DiscordHookRunnerLogger,
    });

    // Create slack runner with same logger
    this.slackRunner = new SlackHookRunner({
      logger: this.logger as SlackHookRunnerLogger,
    });
  }

  /**
   * Execute hooks for a given hook list (after_run or on_error)
   *
   * @param hooksConfig - Agent hooks configuration (accepts input types with optional fields)
   * @param context - Hook context with job information
   * @param hookList - Which hook list to execute ('after_run' or 'on_error')
   * @returns Promise resolving to the execution result
   */
  async executeHooks(
    hooksConfig: AgentHooksInput | undefined,
    context: HookContext,
    hookList: "after_run" | "on_error",
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const hooks = hooksConfig?.[hookList] ?? [];

    if (hooks.length === 0) {
      return {
        success: true,
        totalHooks: 0,
        successfulHooks: 0,
        failedHooks: 0,
        skippedHooks: 0,
        totalDurationMs: 0,
        results: [],
        shouldFailJob: false,
      };
    }

    this.logger.info(`Executing ${hooks.length} ${hookList} hook(s) for event: ${context.event}`);

    const results: HookResult[] = [];
    let successfulHooks = 0;
    let failedHooks = 0;
    let skippedHooks = 0;
    let shouldFailJob = false;

    // Execute hooks sequentially
    for (const hookConfig of hooks) {
      // Check if this hook should run (on_events filter and when condition)
      if (!this.shouldExecuteHook(hookConfig, context)) {
        skippedHooks++;
        continue;
      }

      // Execute the hook
      const result = await this.executeHook(hookConfig, context);
      results.push(result);

      if (result.success) {
        successfulHooks++;
        // Log hook output if present (for shell hooks)
        if (result.output) {
          this.logger.info(`Hook output:\n${result.output}`);
        }
      } else {
        failedHooks++;
        this.logger.warn(`${hookConfig.type} hook failed: ${result.error}`);

        // Check if we should fail the job
        if (hookConfig.continue_on_error === false) {
          shouldFailJob = true;
          this.logger.error(`Hook failure will cause job to fail (continue_on_error: false)`);
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;

    this.logger.info(
      `Hook execution complete: ${successfulHooks} succeeded, ` +
        `${failedHooks} failed, ${skippedHooks} skipped ` +
        `(${totalDurationMs}ms)`,
    );

    return {
      success: failedHooks === 0,
      totalHooks: hooks.length,
      successfulHooks,
      failedHooks,
      skippedHooks,
      totalDurationMs,
      results,
      shouldFailJob,
    };
  }

  /**
   * Execute a single hook
   */
  private async executeHook(config: HookConfigInput, context: HookContext): Promise<HookResult> {
    switch (config.type) {
      case "shell":
        return this.shellRunner.execute(config as ShellHookConfigInput, context);

      case "webhook":
        return this.webhookRunner.execute(config as WebhookHookConfigInput, context);

      case "discord":
        return this.discordRunner.execute(config as DiscordHookConfigInput, context);

      case "slack":
        return this.slackRunner.execute(config as SlackHookConfigInput, context);

      default:
        return {
          success: false,
          hookType: "shell",
          durationMs: 0,
          error: `Unknown hook type: ${(config as HookConfigInput).type}`,
        };
    }
  }

  /**
   * Check if a hook should execute for a given event and context
   */
  private shouldExecuteHook(config: HookConfigInput, context: HookContext): boolean {
    const event = context.event;

    // Check on_events filter first
    if (config.on_events && config.on_events.length > 0) {
      if (!config.on_events.includes(event)) {
        return false;
      }
    }

    // Check `when` condition (dot-notation path to boolean in context)
    if (config.when) {
      const value = this.getPathValue(context as unknown as Record<string, unknown>, config.when);
      if (!value) {
        this.logger.debug(
          `Skipping ${config.type} hook: condition "${config.when}" is falsy (value: ${JSON.stringify(value)})`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Get a value from an object using dot-notation path
   *
   * @example
   * getPathValue({ metadata: { shouldNotify: true } }, "metadata.shouldNotify") // true
   * getPathValue({ result: { success: true } }, "result.success") // true
   */
  private getPathValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
