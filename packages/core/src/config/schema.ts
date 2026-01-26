/**
 * Zod schemas for herdctl configuration files
 *
 * Validates herdctl.yaml fleet configuration
 */

import { z } from "zod";

// =============================================================================
// Permission Schemas
// =============================================================================

export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
]);

export const BashPermissionsSchema = z.object({
  allowed_commands: z.array(z.string()).optional(),
  denied_patterns: z.array(z.string()).optional(),
});

export const PermissionsSchema = z.object({
  mode: PermissionModeSchema.optional().default("acceptEdits"),
  allowed_tools: z.array(z.string()).optional(),
  denied_tools: z.array(z.string()).optional(),
  bash: BashPermissionsSchema.optional(),
});

// =============================================================================
// Work Source Schemas
// =============================================================================

export const WorkSourceTypeSchema = z.enum(["github"]);

export const WorkSourceLabelsSchema = z.object({
  ready: z.string().optional(),
  in_progress: z.string().optional(),
});

/**
 * Regex pattern for validating GitHub repository format (owner/repo)
 * Supports alphanumeric characters, hyphens, underscores, and dots
 */
const GITHUB_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * Authentication configuration for GitHub work source
 */
export const GitHubAuthSchema = z.object({
  /** Environment variable name containing the GitHub PAT (default: "GITHUB_TOKEN") */
  token_env: z.string().optional().default("GITHUB_TOKEN"),
});

/**
 * GitHub-specific work source configuration schema
 *
 * Extends the base work source with GitHub-specific fields for
 * repository targeting, label-based workflow, and authentication.
 *
 * @example
 * ```yaml
 * work_source:
 *   type: github
 *   repo: owner/repo-name
 *   labels:
 *     ready: ready-for-agent
 *     in_progress: agent-working
 *   exclude_labels:
 *     - blocked
 *     - wip
 *   cleanup_on_failure: true
 *   auth:
 *     token_env: GITHUB_TOKEN
 * ```
 */
export const GitHubWorkSourceSchema = z.object({
  type: z.literal("github"),
  /** GitHub repository in owner/repo format (required) */
  repo: z
    .string()
    .regex(
      GITHUB_REPO_PATTERN,
      "Repository must be in 'owner/repo' format (e.g., 'octocat/hello-world')"
    ),
  /** Labels for tracking work item state */
  labels: z
    .object({
      /** Label marking issues as ready for agent work (default: "ready") */
      ready: z.string().optional().default("ready"),
      /** Label applied when an agent claims the issue (default: "agent-working") */
      in_progress: z.string().optional().default("agent-working"),
    })
    .optional()
    .default({}),
  /** Labels to exclude from fetched issues (issues with any of these labels are skipped) */
  exclude_labels: z.array(z.string()).optional().default([]),
  /** Re-add ready label when releasing work on failure (default: true) */
  cleanup_on_failure: z.boolean().optional().default(true),
  /** Clean up in-progress labels on startup (backwards compatibility field) */
  cleanup_in_progress: z.boolean().optional(),
  /** Authentication configuration */
  auth: GitHubAuthSchema.optional().default({}),
});

/**
 * Base work source schema (minimal, for backwards compatibility)
 * Used when only type and basic labels are specified
 */
export const BaseWorkSourceSchema = z.object({
  type: WorkSourceTypeSchema,
  labels: WorkSourceLabelsSchema.optional(),
  cleanup_in_progress: z.boolean().optional(),
});

/**
 * Combined work source schema supporting both minimal and full configurations
 *
 * This schema uses a discriminated union based on the `type` field to support:
 * - Full GitHub-specific configuration with all fields
 * - Minimal configuration for backwards compatibility
 *
 * The schema will validate against GitHub-specific rules when type is "github"
 * and all required fields are present, otherwise falls back to base schema.
 */
export const WorkSourceSchema = z.union([
  GitHubWorkSourceSchema,
  BaseWorkSourceSchema,
]);

// =============================================================================
// Instance Schemas
// =============================================================================

export const InstancesSchema = z.object({
  max_concurrent: z.number().int().positive().optional().default(1),
});

// =============================================================================
// Docker Schemas
// =============================================================================

export const DockerSchema = z.object({
  enabled: z.boolean().optional().default(false),
  base_image: z.string().optional(),
});

// =============================================================================
// Session Schema (for agent session config)
// Note: Defined here before DefaultsSchema to allow it to reference SessionSchema
// =============================================================================

export const SessionSchema = z.object({
  max_turns: z.number().int().positive().optional(),
  timeout: z.string().optional(), // e.g., "30m", "1h"
  model: z.string().optional(),
});

// =============================================================================
// Defaults Schema
// =============================================================================

export const DefaultsSchema = z.object({
  docker: DockerSchema.optional(),
  permissions: PermissionsSchema.optional(),
  work_source: WorkSourceSchema.optional(),
  instances: InstancesSchema.optional(),
  // Extended defaults for agent-level configuration
  session: SessionSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  permission_mode: PermissionModeSchema.optional(),
});

// =============================================================================
// Workspace Schema
// =============================================================================

export const WorkspaceSchema = z.object({
  root: z.string(),
  auto_clone: z.boolean().optional().default(true),
  clone_depth: z.number().int().positive().optional().default(1),
  default_branch: z.string().optional().default("main"),
});

// =============================================================================
// Agent Reference Schema
// =============================================================================

export const AgentReferenceSchema = z.object({
  path: z.string(),
});

// =============================================================================
// Identity Schema (for agent identity)
// =============================================================================

export const IdentitySchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  personality: z.string().optional(),
});

// =============================================================================
// Schedule Schema (for agent schedules)
// =============================================================================

export const ScheduleTypeSchema = z.enum(["interval", "cron", "webhook", "chat"]);

export const ScheduleSchema = z.object({
  type: ScheduleTypeSchema,
  interval: z.string().optional(), // "5m", "1h", etc.
  expression: z.string().optional(), // cron expression
  prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  /** When true, job output is also written to .herdctl/jobs/{jobId}/output.log (default: false) */
  outputToFile: z.boolean().optional(),
  /** When false, schedule will not auto-trigger but can still be manually triggered (default: true) */
  enabled: z.boolean().optional().default(true),
});

// =============================================================================
// MCP Server Schema
// =============================================================================

export const McpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
});

// =============================================================================
// Agent Chat Discord Schemas (per-agent Discord bot configuration)
// =============================================================================

/**
 * Discord bot presence/activity configuration
 *
 * @example
 * ```yaml
 * presence:
 *   activity_type: watching
 *   activity_message: "for support requests"
 * ```
 */
export const DiscordPresenceSchema = z.object({
  activity_type: z
    .enum(["playing", "watching", "listening", "competing"])
    .optional(),
  activity_message: z.string().optional(),
});

/**
 * Discord DM (direct message) configuration for an agent's bot
 *
 * @example
 * ```yaml
 * dm:
 *   enabled: true
 *   mode: auto
 *   allowlist: ["123456789012345678"]
 *   blocklist: []
 * ```
 */
export const DiscordDMSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["mention", "auto"]).default("auto"),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
});

/**
 * Discord channel configuration for an agent's bot
 *
 * @example
 * ```yaml
 * channels:
 *   - id: "987654321098765432"
 *     name: "#support"
 *     mode: mention
 *     context_messages: 10
 * ```
 */
export const DiscordChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().int().positive().default(10),
});

/**
 * Discord guild (server) configuration for an agent's bot
 *
 * @example
 * ```yaml
 * guilds:
 *   - id: "123456789012345678"
 *     channels:
 *       - id: "987654321098765432"
 *         name: "#support"
 *         mode: mention
 *     dm:
 *       enabled: true
 *       mode: auto
 * ```
 */
export const DiscordGuildSchema = z.object({
  id: z.string(),
  channels: z.array(DiscordChannelSchema).optional(),
  dm: DiscordDMSchema.optional(),
});

/**
 * Per-agent Discord bot configuration schema
 *
 * Each agent can have its own Discord bot with independent identity,
 * presence, and channel/guild configuration.
 *
 * @example
 * ```yaml
 * chat:
 *   discord:
 *     bot_token_env: SUPPORT_DISCORD_TOKEN
 *     session_expiry_hours: 24
 *     log_level: standard
 *     presence:
 *       activity_type: watching
 *       activity_message: "for support requests"
 *     guilds:
 *       - id: "123456789012345678"
 *         channels:
 *           - id: "987654321098765432"
 *             name: "#support"
 *             mode: mention
 * ```
 */
export const AgentChatDiscordSchema = z.object({
  /** Environment variable name containing the bot token (never store tokens in config) */
  bot_token_env: z.string(),
  /** Session expiry in hours (default: 24) */
  session_expiry_hours: z.number().int().positive().default(24),
  /** Log level for this agent's Discord connector */
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  /** Bot presence/activity configuration */
  presence: DiscordPresenceSchema.optional(),
  /** Guilds (servers) this bot participates in */
  guilds: z.array(DiscordGuildSchema),
  /** Global DM (direct message) configuration - applies to all DMs regardless of guild */
  dm: DiscordDMSchema.optional(),
});

// =============================================================================
// Agent Chat Schema (agent-specific chat config)
// =============================================================================

export const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  // slack: AgentChatSlackSchema.optional(), // Future
});

// =============================================================================
// Agent Workspace Schema (can be string path or full workspace object)
// =============================================================================

export const AgentWorkspaceSchema = z.union([z.string(), WorkspaceSchema]);

// =============================================================================
// Agent Configuration Schema
// =============================================================================

export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  workspace: AgentWorkspaceSchema.optional(),
  repo: z.string().optional(),
  identity: IdentitySchema.optional(),
  system_prompt: z.string().optional(),
  work_source: WorkSourceSchema.optional(),
  schedules: z.record(z.string(), ScheduleSchema).optional(),
  session: SessionSchema.optional(),
  permissions: PermissionsSchema.optional(),
  mcp_servers: z.record(z.string(), McpServerSchema).optional(),
  chat: AgentChatSchema.optional(),
  docker: DockerSchema.optional(),
  instances: InstancesSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  permission_mode: PermissionModeSchema.optional(),
});

// =============================================================================
// Chat Schemas
// =============================================================================

export const DiscordChatSchema = z.object({
  enabled: z.boolean().optional().default(false),
  token_env: z.string().optional(),
});

export const ChatSchema = z.object({
  discord: DiscordChatSchema.optional(),
});

// =============================================================================
// Webhook Schema
// =============================================================================

export const WebhooksSchema = z.object({
  enabled: z.boolean().optional().default(false),
  port: z.number().int().positive().optional().default(8081),
  secret_env: z.string().optional(),
});

// =============================================================================
// Fleet Configuration Schema
// =============================================================================

export const FleetConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  fleet: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  defaults: DefaultsSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  agents: z.array(AgentReferenceSchema).optional().default([]),
  chat: ChatSchema.optional(),
  webhooks: WebhooksSchema.optional(),
  docker: DockerSchema.optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type BashPermissions = z.infer<typeof BashPermissionsSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
export type WorkSourceType = z.infer<typeof WorkSourceTypeSchema>;
export type WorkSourceLabels = z.infer<typeof WorkSourceLabelsSchema>;
export type GitHubAuth = z.infer<typeof GitHubAuthSchema>;
export type GitHubWorkSource = z.infer<typeof GitHubWorkSourceSchema>;
export type BaseWorkSource = z.infer<typeof BaseWorkSourceSchema>;
export type WorkSource = z.infer<typeof WorkSourceSchema>;
export type Instances = z.infer<typeof InstancesSchema>;
export type Docker = z.infer<typeof DockerSchema>;
export type Defaults = z.infer<typeof DefaultsSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type AgentReference = z.infer<typeof AgentReferenceSchema>;
export type DiscordChat = z.infer<typeof DiscordChatSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Webhooks = z.infer<typeof WebhooksSchema>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
// Agent Chat Discord types
export type DiscordPresence = z.infer<typeof DiscordPresenceSchema>;
export type DiscordDM = z.infer<typeof DiscordDMSchema>;
export type DiscordChannel = z.infer<typeof DiscordChannelSchema>;
export type DiscordGuild = z.infer<typeof DiscordGuildSchema>;
export type AgentChatDiscord = z.infer<typeof AgentChatDiscordSchema>;
export type AgentChat = z.infer<typeof AgentChatSchema>;
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
