/**
 * Execution Hooks Module
 *
 * Provides a config-driven execution hooks system for running
 * arbitrary code at agent lifecycle points (after job completion,
 * on error, etc.).
 *
 * @module hooks
 */

// Hook Executor
export {
  type HookExecutionResult,
  HookExecutor,
  type HookExecutorLogger,
  type HookExecutorOptions,
} from "./hook-executor.js";
// Discord Hook Runner
export {
  DiscordHookRunner,
  type DiscordHookRunnerLogger,
  type DiscordHookRunnerOptions,
} from "./runners/discord.js";

// Shell Hook Runner
export {
  ShellHookRunner,
  type ShellHookRunnerLogger,
  type ShellHookRunnerOptions,
} from "./runners/shell.js";
// Slack Hook Runner
export {
  SlackHookRunner,
  type SlackHookRunnerLogger,
  type SlackHookRunnerOptions,
} from "./runners/slack.js";
// Webhook Hook Runner
export {
  WebhookHookRunner,
  type WebhookHookRunnerLogger,
  type WebhookHookRunnerOptions,
} from "./runners/webhook.js";
// Type exports - Only export types unique to hooks module
// Note: HookEvent, ShellHookConfig, WebhookHookConfig, DiscordHookConfig, HookConfig
// are exported from config/schema.ts via config/index.ts to avoid duplication
export type {
  AgentHooksConfig,
  BaseHookConfig,
  DiscordHookConfigInput,
  HookConfigInput,
  HookContext,
  HookResult,
  HookRunner,
  // Input types for test construction (allow optional fields)
  ShellHookConfigInput,
  SlackHookConfigInput,
  WebhookHookConfigInput,
} from "./types.js";
