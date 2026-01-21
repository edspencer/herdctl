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
  WorkspaceSchema,
  AgentReferenceSchema,
  ChatSchema,
  DiscordChatSchema,
  WebhooksSchema,
  DockerSchema,
  PermissionsSchema,
  PermissionModeSchema,
  BashPermissionsSchema,
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
  AgentWorkspaceSchema,
  // Agent Chat Discord schemas
  DiscordPresenceSchema,
  DiscordDMSchema,
  DiscordChannelSchema,
  DiscordGuildSchema,
  AgentChatDiscordSchema,
  // Types
  type FleetConfig,
  type Defaults,
  type Workspace,
  type AgentReference,
  type Chat,
  type DiscordChat,
  type Webhooks,
  type Docker,
  type Permissions,
  type PermissionMode,
  type BashPermissions,
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
  type AgentWorkspace,
  // Agent Chat Discord types
  type DiscordPresence,
  type DiscordDM,
  type DiscordChannel,
  type DiscordGuild,
  type AgentChatDiscord,
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
  type PermissionsInput,
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
