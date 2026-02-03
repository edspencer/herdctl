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
  // Agent Chat Discord schemas
  DiscordPresenceSchema,
  DiscordDMSchema,
  DiscordChannelSchema,
  DiscordGuildSchema,
  AgentChatDiscordSchema,
  // Hook schemas
  HookEventSchema,
  ShellHookConfigSchema,
  WebhookHookConfigSchema,
  DiscordHookConfigSchema,
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
  // Agent Chat Discord types
  type DiscordPresence,
  type DiscordDM,
  type DiscordChannel,
  type DiscordGuild,
  type AgentChatDiscord,
  // Hook types
  type HookEvent,
  type ShellHookConfig,
  type WebhookHookConfig,
  type DiscordHookConfig,
  type HookConfig,
  type AgentHooks,
  // Hook input types (for construction, allow optional fields)
  type ShellHookConfigInput,
  type WebhookHookConfigInput,
  type DiscordHookConfigInput,
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
