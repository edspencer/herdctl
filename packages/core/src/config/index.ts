/**
 * Configuration module for herdctl
 *
 * Provides parsing and validation for herdctl.yaml fleet configuration files
 */

// Schema exports
export {
  // Schemas
  FleetConfigSchema,
  DefaultsSchema,
  WorkingDirectorySchema,
  AgentReferenceSchema,
  ChatSchema,
  DiscordChatSchema,
  WebhooksSchema,
  WebSchema,
  AgentDockerSchema,
  FleetDockerSchema,
  DockerSchema,
  PermissionModeSchema,
  WorkSourceSchema,
  WorkSourceTypeSchema,
  WorkSourceLabelsSchema,
  GitHubAuthSchema,
  GitHubWorkSourceSchema,
  BaseWorkSourceSchema,
  InstancesSchema,
  // Agent-specific schemas
  AgentConfigSchema,
  IdentitySchema,
  SessionSchema,
  ScheduleSchema,
  ScheduleTypeSchema,
  McpServerSchema,
  AgentChatSchema,
  AgentWorkingDirectorySchema,
  // Agent Chat shared schemas
  ChatDMSchema,
  // Agent Chat Discord schemas
  DiscordPresenceSchema,
  DiscordChannelSchema,
  DiscordGuildSchema,
  DiscordOutputSchema,
  AgentChatDiscordSchema,
  // Agent Chat Slack schemas
  SlackChannelSchema,
  AgentChatSlackSchema,
  // Hook schemas
  HookEventSchema,
  ShellHookConfigSchema,
  WebhookHookConfigSchema,
  DiscordHookConfigSchema,
  SlackHookConfigSchema,
  HookConfigSchema,
  AgentHooksSchema,
  // Types
  type FleetConfig,
  type Defaults,
  type WorkingDirectory,
  type AgentReference,
  type Chat,
  type DiscordChat,
  type Webhooks,
  type WebConfig,
  type AgentDocker,
  type AgentDockerInput,
  type FleetDocker,
  type FleetDockerInput,
  type Docker,
  type PermissionMode,
  type WorkSource,
  type WorkSourceType,
  type WorkSourceLabels,
  type GitHubAuth,
  type GitHubWorkSource,
  type BaseWorkSource,
  type Instances,
  // Agent-specific types
  type AgentConfig,
  type Identity,
  type Session,
  type Schedule,
  type ScheduleType,
  type McpServer,
  type AgentChat,
  type AgentWorkingDirectory,
  // Agent Chat shared types
  type ChatDM,
  // Agent Chat Discord types
  type DiscordPresence,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordOutput,
  type AgentChatDiscord,
  // Agent Chat Slack types
  type SlackChannel,
  type AgentChatSlack,
  // Hook types
  type HookEvent,
  type ShellHookConfig,
  type WebhookHookConfig,
  type DiscordHookConfig,
  type SlackHookConfig,
  type HookConfig,
  type AgentHooks,
  // Hook input types (for construction, allow optional fields)
  type ShellHookConfigInput,
  type WebhookHookConfigInput,
  type DiscordHookConfigInput,
  type SlackHookConfigInput,
  type HookConfigInput,
  type AgentHooksInput,
} from "./schema.js";

// Parser exports
export {
  // Fleet config parsers
  parseFleetConfig,
  validateFleetConfig,
  safeParseFleetConfig,
  // Agent config parsers
  parseAgentConfig,
  validateAgentConfig,
  safeParseAgentConfig,
  loadAgentConfig,
  resolveAgentPath,
  // Error classes
  ConfigError,
  YamlSyntaxError,
  SchemaValidationError,
  FileReadError,
  AgentValidationError,
  AgentYamlSyntaxError,
  type SchemaIssue,
} from "./parser.js";

// Merge exports
export {
  deepMerge,
  mergeAgentConfig,
  mergeAllAgentConfigs,
  type MergeableDefaults,
  type ExtendedDefaults,
} from "./merge.js";

// Interpolation exports
export {
  interpolateConfig,
  interpolateValue,
  interpolateString,
  UndefinedVariableError,
  type InterpolateOptions,
} from "./interpolate.js";

// Loader exports
export {
  loadConfig,
  safeLoadConfig,
  findConfigFile,
  CONFIG_FILE_NAMES,
  ConfigNotFoundError,
  AgentLoadError,
  type ResolvedConfig,
  type ResolvedAgent,
  type LoadConfigOptions,
} from "./loader.js";
