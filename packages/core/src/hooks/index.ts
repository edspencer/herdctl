/**
 * Execution Hooks Module
 *
 * Provides a config-driven execution hooks system for running
 * arbitrary code at agent lifecycle points (after job completion,
 * on error, etc.).
 *
 * @module hooks
 */

// Type exports - Only export types unique to hooks module
// Note: HookEvent, ShellHookConfig, WebhookHookConfig, DiscordHookConfig, HookConfig
// are exported from config/schema.ts via config/index.ts to avoid duplication
export type {
  HookContext,
  HookResult,
  BaseHookConfig,
  AgentHooksConfig,
  HookRunner,
  // Input types for test construction (allow optional fields)
  ShellHookConfigInput,
  WebhookHookConfigInput,
  DiscordHookConfigInput,
  SlackHookConfigInput,
  HookConfigInput,
} from "./types.js";

// Hook Executor
export {
  HookExecutor,
  type HookExecutorOptions,
  type HookExecutorLogger,
  type HookExecutionResult,
} from "./hook-executor.js";

// Shell Hook Runner
export {
  ShellHookRunner,
  type ShellHookRunnerOptions,
  type ShellHookRunnerLogger,
} from "./runners/shell.js";

// Webhook Hook Runner
export {
  WebhookHookRunner,
  type WebhookHookRunnerOptions,
  type WebhookHookRunnerLogger,
} from "./runners/webhook.js";

// Discord Hook Runner
export {
  DiscordHookRunner,
  type DiscordHookRunnerOptions,
  type DiscordHookRunnerLogger,
} from "./runners/discord.js";

// Slack Hook Runner
export {
  SlackHookRunner,
  type SlackHookRunnerOptions,
  type SlackHookRunnerLogger,
} from "./runners/slack.js";
