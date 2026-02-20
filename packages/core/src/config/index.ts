/**
 * Configuration module for herdctl
 *
 * Provides parsing and validation for herdctl.yaml fleet configuration files
 */

// Interpolation exports
export {
  type InterpolateOptions,
  interpolateConfig,
  interpolateString,
  interpolateValue,
  UndefinedVariableError,
} from "./interpolate.js";
// Loader exports
export {
  AgentLoadError,
  CONFIG_FILE_NAMES,
  ConfigNotFoundError,
  FleetCycleError,
  FleetLoadError,
  FleetNameCollisionError,
  findConfigFile,
  InvalidFleetNameError,
  type LoadConfigOptions,
  loadConfig,
  type ResolvedAgent,
  type ResolvedConfig,
  safeLoadConfig,
} from "./loader.js";

// Merge exports
export {
  deepMerge,
  type ExtendedDefaults,
  type MergeableDefaults,
  mergeAgentConfig,
  mergeAllAgentConfigs,
} from "./merge.js";
// Parser exports
export {
  AgentValidationError,
  AgentYamlSyntaxError,
  // Error classes
  ConfigError,
  FileReadError,
  loadAgentConfig,
  // Agent config parsers
  parseAgentConfig,
  // Fleet config parsers
  parseFleetConfig,
  resolveAgentPath,
  type SchemaIssue,
  SchemaValidationError,
  safeParseAgentConfig,
  safeParseFleetConfig,
  validateAgentConfig,
  validateFleetConfig,
  YamlSyntaxError,
} from "./parser.js";
// Schema exports
export {
  type AgentChat,
  type AgentChatDiscord,
  AgentChatDiscordSchema,
  AgentChatSchema,
  type AgentChatSlack,
  AgentChatSlackSchema,
  // Agent-specific types
  type AgentConfig,
  // Agent-specific schemas
  AgentConfigSchema,
  type AgentDocker,
  type AgentDockerInput,
  AgentDockerSchema,
  type AgentHooks,
  type AgentHooksInput,
  AgentHooksSchema,
  type AgentReference,
  AgentReferenceSchema,
  type AgentWorkingDirectory,
  AgentWorkingDirectorySchema,
  type BaseWorkSource,
  BaseWorkSourceSchema,
  type Chat,
  type ChatDM,
  ChatDMSchema,
  // Agent Chat shared types
  type ChatOutput,
  // Agent Chat shared schemas
  ChatOutputSchema,
  ChatSchema,
  type Defaults,
  DefaultsSchema,
  type DiscordChannel,
  DiscordChannelSchema,
  type DiscordChat,
  DiscordChatSchema,
  type DiscordGuild,
  DiscordGuildSchema,
  type DiscordHookConfig,
  type DiscordHookConfigInput,
  DiscordHookConfigSchema,
  type DiscordOutput,
  DiscordOutputSchema,
  // Agent Chat Discord types
  type DiscordPresence,
  // Agent Chat Discord schemas
  DiscordPresenceSchema,
  type Docker,
  DockerSchema,
  // Types
  type FleetConfig,
  // Schemas
  FleetConfigSchema,
  type FleetDocker,
  type FleetDockerInput,
  FleetDockerSchema,
  type FleetReference,
  FleetReferenceSchema,
  type GitHubAuth,
  GitHubAuthSchema,
  type GitHubWorkSource,
  GitHubWorkSourceSchema,
  type HookConfig,
  type HookConfigInput,
  HookConfigSchema,
  // Hook types
  type HookEvent,
  // Hook schemas
  HookEventSchema,
  type Identity,
  IdentitySchema,
  type Instances,
  InstancesSchema,
  type McpServer,
  McpServerSchema,
  type PermissionMode,
  PermissionModeSchema,
  type Schedule,
  ScheduleSchema,
  type ScheduleType,
  ScheduleTypeSchema,
  type Session,
  SessionSchema,
  type ShellHookConfig,
  // Hook input types (for construction, allow optional fields)
  type ShellHookConfigInput,
  ShellHookConfigSchema,
  // Agent Chat Slack types
  type SlackChannel,
  // Agent Chat Slack schemas
  SlackChannelSchema,
  type SlackHookConfig,
  type SlackHookConfigInput,
  SlackHookConfigSchema,
  type WebConfig,
  type WebhookHookConfig,
  type WebhookHookConfigInput,
  WebhookHookConfigSchema,
  type Webhooks,
  WebhooksSchema,
  WebSchema,
  type WorkingDirectory,
  WorkingDirectorySchema,
  type WorkSource,
  type WorkSourceLabels,
  WorkSourceLabelsSchema,
  WorkSourceSchema,
  type WorkSourceType,
  WorkSourceTypeSchema,
} from "./schema.js";
