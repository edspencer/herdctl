/**
 * Zod schemas for herdctl configuration files
 *
 * Validates herdctl.yaml fleet configuration
 */

import { z } from "zod";
import type { HostConfig } from "dockerode";

// =============================================================================
// Permission Schemas
// =============================================================================

export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "delegate",
  "dontAsk",
]);

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
      "Repository must be in 'owner/repo' format (e.g., 'octocat/hello-world')",
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
export const WorkSourceSchema = z.union([GitHubWorkSourceSchema, BaseWorkSourceSchema]);

// =============================================================================
// Instance Schemas
// =============================================================================

export const InstancesSchema = z.object({
  max_concurrent: z.number().int().positive().optional().default(1),
});

// =============================================================================
// Docker Schemas
// =============================================================================

/**
 * Network isolation modes for Docker containers
 * - "none": No network access (most secure, rare use case)
 * - "bridge": Standard Docker networking with NAT (default)
 * - "host": Share host network namespace (least isolated)
 */
export const DockerNetworkModeSchema = z.enum(["none", "bridge", "host"]);

/**
 * Agent-level Docker configuration schema (safe options only)
 *
 * These options can be specified in agent config files (herdctl-agent.yml).
 * Only includes safe options that don't pose security risks if an agent
 * could modify its own config file.
 *
 * For dangerous options (network, volumes, image, user, ports, env),
 * use FleetDockerSchema at the fleet level.
 *
 * @example
 * ```yaml
 * docker:
 *   enabled: true
 *   ephemeral: false        # Reuse container across jobs
 *   memory: 2g              # Memory limit
 *   cpu_shares: 512         # CPU weight
 *   pids_limit: 100         # Prevent fork bombs
 *   tmpfs:
 *     - "/tmp"
 * ```
 */
export const AgentDockerSchema = z
  .object({
    /** Enable Docker containerization for this agent (default: false) */
    enabled: z.boolean().optional().default(false),

    /** Use ephemeral containers (fresh per job, auto-removed) vs persistent (reuse across jobs, kept for inspection) */
    ephemeral: z.boolean().optional().default(true),

    /** Memory limit (e.g., "2g", "512m") (default: 2g) */
    memory: z.string().optional().default("2g"),

    /** CPU shares (relative weight, 512 is normal) */
    cpu_shares: z.number().int().positive().optional(),

    /** Maximum containers to keep per agent before cleanup (default: 5) */
    max_containers: z.number().int().positive().optional().default(5),

    /** Workspace mount mode: rw (read-write, default) or ro (read-only) */
    workspace_mode: z.enum(["rw", "ro"]).optional().default("rw"),

    /** Tmpfs mounts in format "path" or "path:options" (e.g., "/tmp", "/tmp:size=100m,mode=1777") */
    tmpfs: z.array(z.string()).optional(),

    /** Maximum number of processes (PIDs) allowed in the container (prevents fork bombs) */
    pids_limit: z.number().int().positive().optional(),

    /** Container labels for organization and filtering */
    labels: z.record(z.string(), z.string()).optional(),

    /** CPU period in microseconds (default: 100000 = 100ms). Used with cpu_quota for hard CPU limits. */
    cpu_period: z.number().int().positive().optional(),

    /** CPU quota in microseconds per cpu_period. E.g., cpu_period=100000 + cpu_quota=50000 = 50% of one CPU. */
    cpu_quota: z.number().int().positive().optional(),
  })
  .strict() // Reject unknown/dangerous Docker options at agent level
  .refine(
    (data) => {
      if (!data.memory) return true;
      // Validate memory format: number followed by optional unit (k, m, g, t, b)
      return /^\d+(?:\.\d+)?\s*[kmgtb]?$/i.test(data.memory);
    },
    {
      message: 'Invalid memory format. Use format like "2g", "512m", "1024k", or "2048" (bytes).',
      path: ["memory"],
    },
  )
  .refine(
    (data) => {
      if (!data.tmpfs) return true;
      // Validate tmpfs format: "/path" or "/path:options"
      return data.tmpfs.every((mount) => {
        // Must start with /
        const parts = mount.split(":");
        return parts[0].startsWith("/");
      });
    },
    {
      message:
        'Invalid tmpfs format. Use "/path" or "/path:options" (e.g., "/tmp", "/tmp:size=100m").',
      path: ["tmpfs"],
    },
  );

/**
 * Fleet-level Docker configuration schema (all options)
 *
 * Includes all safe options from AgentDockerSchema plus dangerous options
 * that should only be specified at the fleet level (in herdctl.yml).
 *
 * Also supports a `host_config` passthrough for raw dockerode HostConfig
 * options not explicitly modeled in our schema.
 *
 * @example
 * ```yaml
 * defaults:
 *   docker:
 *     enabled: true
 *     image: anthropic/claude-code:latest
 *     network: bridge
 *     memory: 2g
 *     volumes:
 *       - "/host/data:/container/data:ro"
 *     host_config:           # Raw dockerode passthrough
 *       ShmSize: 67108864
 * ```
 */
export const FleetDockerSchema = z
  .object({
    /** Enable Docker containerization for this agent (default: false) */
    enabled: z.boolean().optional().default(false),

    /** Use ephemeral containers (fresh per job, auto-removed) vs persistent (reuse across jobs, kept for inspection) */
    ephemeral: z.boolean().optional().default(true),

    /** Docker image to use (default: anthropic/claude-code:latest) */
    image: z.string().optional(),

    /** Network isolation mode (default: bridge for full network access) */
    network: DockerNetworkModeSchema.optional().default("bridge"),

    /** Memory limit (e.g., "2g", "512m") (default: 2g) */
    memory: z.string().optional().default("2g"),

    /** CPU shares (relative weight, 512 is normal) */
    cpu_shares: z.number().int().positive().optional(),

    /** Container user as "UID:GID" string (default: match host user) */
    user: z.string().optional(),

    /** Maximum containers to keep per agent before cleanup (default: 5) */
    max_containers: z.number().int().positive().optional().default(5),

    /** Additional volume mounts in Docker format: "host:container:mode" */
    volumes: z.array(z.string()).optional(),

    /** Workspace mount mode: rw (read-write, default) or ro (read-only) */
    workspace_mode: z.enum(["rw", "ro"]).optional().default("rw"),

    /** Environment variables to pass to the container (supports ${VAR} interpolation) */
    env: z.record(z.string(), z.string()).optional(),

    /** Port bindings in format "hostPort:containerPort" or "containerPort" (e.g., "8080:80", "3000") */
    ports: z.array(z.string()).optional(),

    /** Tmpfs mounts in format "path" or "path:options" (e.g., "/tmp", "/tmp:size=100m,mode=1777") */
    tmpfs: z.array(z.string()).optional(),

    /** Maximum number of processes (PIDs) allowed in the container (prevents fork bombs) */
    pids_limit: z.number().int().positive().optional(),

    /** Container labels for organization and filtering */
    labels: z.record(z.string(), z.string()).optional(),

    /** CPU period in microseconds (default: 100000 = 100ms). Used with cpu_quota for hard CPU limits. */
    cpu_period: z.number().int().positive().optional(),

    /** CPU quota in microseconds per cpu_period. E.g., cpu_period=100000 + cpu_quota=50000 = 50% of one CPU. */
    cpu_quota: z.number().int().positive().optional(),

    /** @deprecated Use 'image' instead */
    base_image: z.string().optional(),

    /**
     * Raw dockerode HostConfig passthrough for advanced options.
     * Values here override any translated options (e.g., host_config.Memory overrides memory).
     * See dockerode documentation for available options.
     */
    host_config: z.custom<HostConfig>().optional(),
  })
  .strict() // Reject unknown Docker options to catch typos
  .refine(
    (data) => {
      if (!data.memory) return true;
      // Validate memory format: number followed by optional unit (k, m, g, t, b)
      return /^\d+(?:\.\d+)?\s*[kmgtb]?$/i.test(data.memory);
    },
    {
      message: 'Invalid memory format. Use format like "2g", "512m", "1024k", or "2048" (bytes).',
      path: ["memory"],
    },
  )
  .refine(
    (data) => {
      if (!data.volumes) return true;
      // Validate volume format: host:container or host:container:mode
      return data.volumes.every((vol) => {
        const parts = vol.split(":");
        if (parts.length < 2 || parts.length > 3) return false;
        if (parts.length === 3 && parts[2] !== "ro" && parts[2] !== "rw") {
          return false;
        }
        return true;
      });
    },
    {
      message: 'Invalid volume format. Use "host:container" or "host:container:ro|rw".',
      path: ["volumes"],
    },
  )
  .refine(
    (data) => {
      if (!data.user) return true;
      // Validate user format: UID or UID:GID
      return /^\d+(?::\d+)?$/.test(data.user);
    },
    {
      message: 'Invalid user format. Use "UID" or "UID:GID" (e.g., "1000" or "1000:1000").',
      path: ["user"],
    },
  )
  .refine(
    (data) => {
      if (!data.ports) return true;
      // Validate port format: "hostPort:containerPort" or just "containerPort"
      return data.ports.every((port) => {
        // Format: "hostPort:containerPort" or "containerPort"
        return /^\d+(?::\d+)?$/.test(port);
      });
    },
    {
      message:
        'Invalid port format. Use "hostPort:containerPort" or "containerPort" (e.g., "8080:80", "3000").',
      path: ["ports"],
    },
  )
  .refine(
    (data) => {
      if (!data.tmpfs) return true;
      // Validate tmpfs format: "/path" or "/path:options"
      return data.tmpfs.every((mount) => {
        // Must start with /
        const parts = mount.split(":");
        return parts[0].startsWith("/");
      });
    },
    {
      message:
        'Invalid tmpfs format. Use "/path" or "/path:options" (e.g., "/tmp", "/tmp:size=100m").',
      path: ["tmpfs"],
    },
  );

/** @deprecated Use AgentDockerSchema or FleetDockerSchema instead */
export const DockerSchema = FleetDockerSchema;

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
  docker: FleetDockerSchema.optional(),
  work_source: WorkSourceSchema.optional(),
  instances: InstancesSchema.optional(),
  working_directory: z.lazy(() => AgentWorkingDirectorySchema).optional(),
  // Extended defaults for agent-level configuration
  session: SessionSchema.optional(),
  model: z.string().optional(),
  max_turns: z.number().int().positive().optional(),
  permission_mode: PermissionModeSchema.optional(),
  allowed_tools: z.array(z.string()).optional(),
  denied_tools: z.array(z.string()).optional(),
});

// =============================================================================
// Working Directory Schema
// =============================================================================

export const WorkingDirectorySchema = z.object({
  root: z.string(),
  auto_clone: z.boolean().optional().default(true),
  clone_depth: z.number().int().positive().optional().default(1),
  default_branch: z.string().optional().default("main"),
});

// =============================================================================
// Agent Reference Schema (partial - overrides defined after AgentConfigSchema)
// =============================================================================

// Note: AgentOverridesSchema is defined below after AgentConfigSchema
// to avoid forward reference issues. We use a lazy reference here.
export const AgentReferenceSchema = z.object({
  path: z.string(),
  /**
   * Optional overrides to apply on top of the agent config loaded from path.
   * These are deep-merged after fleet defaults are applied.
   * Accepts any partial agent config fields.
   */
  overrides: z.lazy(() => AgentOverridesSchema).optional(),
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
  /** When false, start a fresh session instead of resuming (default: true - resumes existing session) */
  resume_session: z.boolean().optional().default(true),
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
  activity_type: z.enum(["playing", "watching", "listening", "competing"]).optional(),
  activity_message: z.string().optional(),
});

/**
 * DM (direct message) configuration for an agent's chat bot
 *
 * Shared between Discord, Slack, and other chat platforms.
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
export const ChatDMSchema = z.object({
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
  dm: ChatDMSchema.optional(),
});

/**
 * Shared chat output configuration for controlling what gets shown during conversations
 *
 * Used as the base schema for platform-specific output configs (Discord, Slack).
 *
 * @example
 * ```yaml
 * output:
 *   tool_results: true
 *   tool_result_max_length: 900
 *   system_status: true
 *   errors: true
 * ```
 */
export const ChatOutputSchema = z.object({
  /** Show tool results (default: true) */
  tool_results: z.boolean().optional().default(true),
  /** Max chars of tool output to include (default: 900, max: 1000) */
  tool_result_max_length: z.number().int().positive().max(1000).optional().default(900),
  /** Show system status messages like "compacting context..." (default: true) */
  system_status: z.boolean().optional().default(true),
  /** Show error messages from the SDK (default: true) */
  errors: z.boolean().optional().default(true),
});

/**
 * Discord output configuration for controlling what gets shown during conversations
 *
 * Extends the shared ChatOutputSchema with Discord-specific options.
 *
 * @example
 * ```yaml
 * output:
 *   tool_results: true
 *   tool_result_max_length: 900
 *   system_status: true
 *   result_summary: false
 *   errors: true
 * ```
 */
export const DiscordOutputSchema = ChatOutputSchema.extend({
  /** Show a summary embed when the agent finishes a turn (cost, tokens, turns) (default: false) */
  result_summary: z.boolean().optional().default(false),
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
 *     output:
 *       tool_results: true
 *       tool_result_max_length: 900
 *       system_status: true
 *       result_summary: false
 *       errors: true
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
  /** Output configuration for controlling what gets shown during conversations */
  output: DiscordOutputSchema.optional().default({}),
  /** Bot presence/activity configuration */
  presence: DiscordPresenceSchema.optional(),
  /** Guilds (servers) this bot participates in */
  guilds: z.array(DiscordGuildSchema),
  /** Global DM (direct message) configuration - applies to all DMs regardless of guild */
  dm: ChatDMSchema.optional(),
});

// =============================================================================
// Agent Chat Slack Schemas (per-agent Slack bot configuration)
// =============================================================================

/**
 * Slack channel configuration for an agent's bot
 *
 * @example
 * ```yaml
 * channels:
 *   - id: "C0123456789"
 *     name: "#support"
 * ```
 */
export const SlackChannelSchema = z.object({
  /** Slack channel ID */
  id: z.string(),
  /** Human-readable channel name (for documentation) */
  name: z.string().optional(),
  /** Channel message mode: "mention" = only respond to @mentions, "auto" = respond to all messages */
  mode: z.enum(["mention", "auto"]).default("mention"),
  /** Number of context messages to include (future use) */
  context_messages: z.number().int().positive().default(10),
});

/**
 * Per-agent Slack bot configuration schema
 *
 * Unlike Discord where each agent has its own bot token,
 * Slack uses a single app with one bot token per workspace.
 * All agents share the same bot + app token pair.
 *
 * @example
 * ```yaml
 * chat:
 *   slack:
 *     bot_token_env: SLACK_BOT_TOKEN
 *     app_token_env: SLACK_APP_TOKEN
 *     session_expiry_hours: 24
 *     log_level: standard
 *     channels:
 *       - id: "C0123456789"
 *         name: "#support"
 * ```
 */
export const AgentChatSlackSchema = z.object({
  /** Environment variable name containing the bot token (xoxb-...) */
  bot_token_env: z.string().default("SLACK_BOT_TOKEN"),
  /** Environment variable name containing the app token for Socket Mode (xapp-...) */
  app_token_env: z.string().default("SLACK_APP_TOKEN"),
  /** Session expiry in hours (default: 24) */
  session_expiry_hours: z.number().int().positive().default(24),
  /** Log level for this agent's Slack connector */
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  /** Channels this agent listens in */
  channels: z.array(SlackChannelSchema),
  /** DM (direct message) configuration — enable/disable, mode, allowlist/blocklist */
  dm: ChatDMSchema.optional(),
  /** Output configuration controlling what gets shown during conversations */
  output: ChatOutputSchema.optional(),
});

// =============================================================================
// Agent Chat Schema (agent-specific chat config)
// =============================================================================

export const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  slack: AgentChatSlackSchema.optional(),
});

// =============================================================================
// Execution Hook Schemas
// =============================================================================

/**
 * Hook events that can trigger hooks
 */
export const HookEventSchema = z.enum(["completed", "failed", "timeout", "cancelled"]);

/**
 * Base hook configuration shared by all hook types
 */
const BaseHookConfigSchema = z.object({
  /** Human-readable name for this hook (used in logs) */
  name: z.string().optional(),
  /** Whether to continue with subsequent hooks if this hook fails (default: true) */
  continue_on_error: z.boolean().optional().default(true),
  /** Filter which events trigger this hook (default: all events) */
  on_events: z.array(HookEventSchema).optional(),
  /** Conditional execution: dot-notation path to a boolean field in the hook context (e.g., "metadata.shouldNotify") */
  when: z.string().optional(),
});

/**
 * Shell hook configuration - executes a shell command with HookContext on stdin
 */
export const ShellHookConfigSchema = BaseHookConfigSchema.extend({
  type: z.literal("shell"),
  /** Shell command to execute */
  command: z.string().min(1),
  /** Timeout in milliseconds (default: 30000) */
  timeout: z.number().int().positive().optional().default(30000),
});

/**
 * Webhook hook configuration - POSTs HookContext JSON to a URL
 */
export const WebhookHookConfigSchema = BaseHookConfigSchema.extend({
  type: z.literal("webhook"),
  /** URL to POST the HookContext to */
  url: z.string().url(),
  /** HTTP method (default: POST) */
  method: z.enum(["POST", "PUT"]).optional().default("POST"),
  /** Custom headers (supports ${ENV_VAR} substitution) */
  headers: z.record(z.string(), z.string()).optional(),
  /** Timeout in milliseconds (default: 10000) */
  timeout: z.number().int().positive().optional().default(10000),
});

/**
 * Discord hook configuration - sends notification to Discord channel
 */
export const DiscordHookConfigSchema = BaseHookConfigSchema.extend({
  type: z.literal("discord"),
  /** Discord channel ID */
  channel_id: z.string().min(1),
  /** Environment variable name containing the bot token */
  bot_token_env: z.string().min(1),
});

/**
 * Slack hook configuration - sends notification to a Slack channel
 */
export const SlackHookConfigSchema = BaseHookConfigSchema.extend({
  type: z.literal("slack"),
  /** Slack channel ID to post to */
  channel_id: z.string().min(1),
  /** Environment variable name containing the bot token */
  bot_token_env: z.string().min(1).default("SLACK_BOT_TOKEN"),
});

/**
 * Union of all hook configuration types
 */
export const HookConfigSchema = z.discriminatedUnion("type", [
  ShellHookConfigSchema,
  WebhookHookConfigSchema,
  DiscordHookConfigSchema,
  SlackHookConfigSchema,
]);

/**
 * Agent hooks configuration
 */
export const AgentHooksSchema = z.object({
  /** Hooks to run after every job (success or failure) */
  after_run: z.array(HookConfigSchema).optional(),
  /** Hooks to run only when a job fails */
  on_error: z.array(HookConfigSchema).optional(),
});

// =============================================================================
// Agent Working Directory Schema (can be string path or full working directory object)
// =============================================================================

export const AgentWorkingDirectorySchema = z.union([z.string(), WorkingDirectorySchema]);

// =============================================================================
// Agent Configuration Schema
// =============================================================================

/**
 * Regex for valid agent names - alphanumeric with underscores and hyphens.
 * Must start with alphanumeric character.
 * This prevents path traversal attacks (../) when names are used in file paths.
 */
export const AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export const AgentConfigSchema = z
  .object({
    name: z.string().regex(AGENT_NAME_PATTERN, {
      message:
        "Agent name must start with a letter or number and contain only letters, numbers, underscores, and hyphens",
    }),
    description: z.string().optional(),
    working_directory: AgentWorkingDirectorySchema.optional(),
    repo: z.string().optional(),
    identity: IdentitySchema.optional(),
    system_prompt: z.string().optional(),
    /** Default prompt used when triggering without --prompt */
    default_prompt: z.string().optional(),
    work_source: WorkSourceSchema.optional(),
    schedules: z.record(z.string(), ScheduleSchema).optional(),
    session: SessionSchema.optional(),
    mcp_servers: z.record(z.string(), McpServerSchema).optional(),
    chat: AgentChatSchema.optional(),
    hooks: AgentHooksSchema.optional(),
    docker: AgentDockerSchema.optional(),
    instances: InstancesSchema.optional(),
    model: z.string().optional(),
    max_turns: z.number().int().positive().optional(),
    permission_mode: PermissionModeSchema.optional(),
    allowed_tools: z.array(z.string()).optional(),
    denied_tools: z.array(z.string()).optional(),
    /** Path to metadata JSON file written by agent (default: metadata.json in workspace) */
    metadata_file: z.string().optional(),
    /**
     * Setting sources for Claude SDK configuration discovery.
     * Controls where Claude looks for CLAUDE.md, skills, commands, etc.
     * - "user" - reads from ~/.claude/ (global user settings, plugins)
     * - "project" - reads from .claude/ in the workspace directory
     * - "local" - reads from .claude/settings.local.json (project-local overrides)
     *
     * Default: ["project"] when workspace is set, [] otherwise
     */
    setting_sources: z.array(z.enum(["user", "project", "local"])).optional(),
    /**
     * Runtime backend for executing Claude agents
     * - "sdk" - Claude Agent SDK (default, standard pricing)
     * - "cli" - Claude CLI (Max plan pricing, Phase 2)
     *
     * Default: "sdk"
     */
    runtime: z.enum(["sdk", "cli"]).optional(),
  })
  .strict();

/**
 * Schema for agent overrides in fleet config.
 * Uses passthrough to allow any partial agent config fields.
 * The base agent config is already validated, so we just need to
 * accept any valid partial structure that will be deep-merged.
 *
 * This allows overriding nested fields like `schedules.check.interval`
 * without having to re-specify all required fields like `type`.
 */
export const AgentOverridesSchema = z.record(z.string(), z.unknown());

// =============================================================================
// Fleet Reference Schema (for composing sub-fleets)
// =============================================================================

/**
 * Schema for fleet references in the `fleets` array.
 * Each entry references a sub-fleet YAML file, with optional name override
 * and top-level config overrides.
 *
 * @example
 * ```yaml
 * fleets:
 *   - path: ./herdctl/herdctl.yaml
 *     name: herdctl
 *     overrides:
 *       web:
 *         enabled: false
 * ```
 */
export const FleetReferenceSchema = z.object({
  /** Path to a sub-fleet YAML file (relative to parent fleet config) */
  path: z.string(),
  /** Optional name override for the sub-fleet (must match agent name pattern — no dots) */
  name: z
    .string()
    .regex(AGENT_NAME_PATTERN, {
      message:
        "Fleet name must start with a letter or number and contain only letters, numbers, underscores, and hyphens (no dots)",
    })
    .optional(),
  /** Optional top-level config overrides applied to the sub-fleet */
  overrides: z.record(z.string(), z.unknown()).optional(),
});

export type FleetReference = z.infer<typeof FleetReferenceSchema>;

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
// Web UI Schema
// =============================================================================

/**
 * Web UI configuration schema
 *
 * Configures the @herdctl/web dashboard server.
 *
 * @example
 * ```yaml
 * web:
 *   enabled: true
 *   port: 3232
 *   host: localhost
 *   session_expiry_hours: 24
 *   open_browser: false
 * ```
 */
export const WebSchema = z.object({
  /** Enable the web dashboard (default: false) */
  enabled: z.boolean().optional().default(false),
  /** Port to serve the dashboard on (default: 3232) */
  port: z.number().int().positive().optional().default(3232),
  /** Host to bind to (default: localhost) */
  host: z.string().optional().default("localhost"),
  /** Session expiry in hours (default: 24) */
  session_expiry_hours: z.number().int().positive().optional().default(24),
  /** Automatically open browser when starting (default: false) */
  open_browser: z.boolean().optional().default(false),
  /** Show tool call results in chat conversations (default: true) */
  tool_results: z.boolean().optional().default(true),
});

// =============================================================================
// Fleet Configuration Schema
// =============================================================================

export const FleetConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    fleet: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
      })
      .strict()
      .optional(),
    defaults: DefaultsSchema.optional(),
    working_directory: WorkingDirectorySchema.optional(),
    fleets: z.array(FleetReferenceSchema).optional().default([]),
    agents: z.array(AgentReferenceSchema).optional().default([]),
    chat: ChatSchema.optional(),
    webhooks: WebhooksSchema.optional(),
    web: WebSchema.optional(),
    docker: FleetDockerSchema.optional(),
  })
  .strict();

// =============================================================================
// Type Exports
// =============================================================================

export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type WorkSourceType = z.infer<typeof WorkSourceTypeSchema>;
export type WorkSourceLabels = z.infer<typeof WorkSourceLabelsSchema>;
export type GitHubAuth = z.infer<typeof GitHubAuthSchema>;
export type GitHubWorkSource = z.infer<typeof GitHubWorkSourceSchema>;
export type BaseWorkSource = z.infer<typeof BaseWorkSourceSchema>;
export type WorkSource = z.infer<typeof WorkSourceSchema>;
export type Instances = z.infer<typeof InstancesSchema>;
export type AgentDockerInput = z.input<typeof AgentDockerSchema>;
export type AgentDocker = z.infer<typeof AgentDockerSchema>;
export type FleetDockerInput = z.input<typeof FleetDockerSchema>;
export type FleetDocker = z.infer<typeof FleetDockerSchema>;
/** @deprecated Use AgentDockerInput or FleetDockerInput instead */
export type DockerInput = z.input<typeof DockerSchema>;
/** @deprecated Use AgentDocker or FleetDocker instead */
export type Docker = z.infer<typeof DockerSchema>;
export type Defaults = z.infer<typeof DefaultsSchema>;
export type WorkingDirectory = z.infer<typeof WorkingDirectorySchema>;
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>;
export type AgentReference = z.infer<typeof AgentReferenceSchema>;
export type DiscordChat = z.infer<typeof DiscordChatSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Webhooks = z.infer<typeof WebhooksSchema>;
export type WebConfig = z.infer<typeof WebSchema>;
export type FleetConfig = z.infer<typeof FleetConfigSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
// Agent Chat types (shared)
export type ChatOutput = z.infer<typeof ChatOutputSchema>;
export type ChatDM = z.infer<typeof ChatDMSchema>;
// Agent Chat Discord types
export type DiscordPresence = z.infer<typeof DiscordPresenceSchema>;
export type DiscordChannel = z.infer<typeof DiscordChannelSchema>;
export type DiscordGuild = z.infer<typeof DiscordGuildSchema>;
export type DiscordOutput = z.infer<typeof DiscordOutputSchema>;
export type AgentChatDiscord = z.infer<typeof AgentChatDiscordSchema>;
export type AgentChat = z.infer<typeof AgentChatSchema>;
// Agent Chat Slack types
export type SlackChannel = z.infer<typeof SlackChannelSchema>;
export type AgentChatSlack = z.infer<typeof AgentChatSlackSchema>;
export type AgentWorkingDirectory = z.infer<typeof AgentWorkingDirectorySchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
// Hook types - Output types (after parsing with defaults applied)
export type HookEvent = z.infer<typeof HookEventSchema>;
export type ShellHookConfig = z.infer<typeof ShellHookConfigSchema>;
export type WebhookHookConfig = z.infer<typeof WebhookHookConfigSchema>;
export type DiscordHookConfig = z.infer<typeof DiscordHookConfigSchema>;
export type SlackHookConfig = z.infer<typeof SlackHookConfigSchema>;
export type HookConfig = z.infer<typeof HookConfigSchema>;
export type AgentHooks = z.infer<typeof AgentHooksSchema>;
// Hook types - Input types (for constructing configs, allows optional fields)
export type ShellHookConfigInput = z.input<typeof ShellHookConfigSchema>;
export type WebhookHookConfigInput = z.input<typeof WebhookHookConfigSchema>;
export type DiscordHookConfigInput = z.input<typeof DiscordHookConfigSchema>;
export type SlackHookConfigInput = z.input<typeof SlackHookConfigSchema>;
export type HookConfigInput = z.input<typeof HookConfigSchema>;
export type AgentHooksInput = z.input<typeof AgentHooksSchema>;
