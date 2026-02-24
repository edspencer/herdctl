/**
 * Distribution module for herdctl
 *
 * Provides schemas and utilities for the agent distribution system:
 * - Agent repository metadata validation (herdctl.json)
 * - Installation metadata tracking (metadata.json)
 * - Source specifier parsing and repository fetching
 * - Agent discovery and listing
 * - Agent detailed information
 * - Agent removal
 */

// Agent Discovery
export {
  AgentDiscoveryError,
  DISCOVERY_CONFIG_INVALID,
  DISCOVERY_CONFIG_NOT_FOUND,
  type DiscoveredAgent,
  type DiscoveryOptions,
  type DiscoveryResult,
  discoverAgents,
} from "./agent-discovery.js";
// Agent Info
export {
  type AgentDetailedInfo,
  type AgentInfoOptions,
  getAgentInfo,
} from "./agent-info.js";
// Agent Remover
export {
  AGENT_NOT_FOUND,
  AgentRemoveError,
  type RemoveOptions,
  type RemoveResult,
  removeAgent,
} from "./agent-remover.js";
// Agent Repository Metadata (herdctl.json)
export {
  AGENT_NAME_PATTERN,
  type AgentRepoMetadata,
  AgentRepoMetadataSchema,
  type AgentRequires,
  AgentRequiresSchema,
} from "./agent-repo-metadata.js";
// Environment Variable Scanner
export {
  type EnvScanResult,
  type EnvVariable,
  scanEnvVariables,
} from "./env-scanner.js";
// File Installation
export {
  // Error codes
  AGENT_ALREADY_EXISTS,
  AgentInstallError,
  INVALID_AGENT_NAME,
  INVALID_AGENT_YAML as INSTALLER_INVALID_AGENT_YAML,
  type InstallOptions,
  type InstallResult,
  installAgentFiles,
  MISSING_AGENT_YAML as INSTALLER_MISSING_AGENT_YAML,
} from "./file-installer.js";
// Fleet Config Updater
export {
  addAgentToFleetConfig,
  CONFIG_NOT_FOUND,
  CONFIG_PARSE_ERROR,
  CONFIG_WRITE_ERROR,
  FleetConfigError,
  type FleetConfigUpdateOptions,
  type FleetConfigUpdateResult,
  removeAgentFromFleetConfig,
} from "./fleet-config-updater.js";
// Installation Metadata (metadata.json)
export {
  type InstallationMetadata,
  InstallationMetadataSchema,
  type InstallationSource,
  InstallationSourceSchema,
  ISO8601TimestampSchema,
  type SourceType,
  SourceTypeSchema,
} from "./installation-metadata.js";
// Repository Fetching
export {
  type FetchSource,
  fetchRepository,
  // Error classes
  GitHubCloneAuthError,
  type GitHubFetchSource,
  GitHubRepoNotFoundError,
  type LocalFetchSource,
  LocalPathError,
  NetworkError,
  RepositoryFetchError,
  type RepositoryFetchResult,
} from "./repository-fetcher.js";
// Repository Validation
export {
  DOCKER_NETWORK_NONE,
  INVALID_AGENT_YAML,
  INVALID_HERDCTL_JSON,
  JSON_PARSE_ERROR,
  // Error codes
  MISSING_AGENT_YAML,
  MISSING_CLAUDE_MD,
  // Warning codes
  MISSING_HERDCTL_JSON,
  MISSING_README,
  NAME_MISMATCH,
  type ValidationMessage,
  type ValidationResult,
  validateRepository,
  YAML_PARSE_ERROR,
} from "./repository-validator.js";
// Source Specifier Parsing
export {
  type GitHubSource,
  isGitHubSource,
  isLocalSource,
  type LocalSource,
  parseSourceSpecifier,
  SourceParseError,
  type SourceSpecifier,
  stringifySourceSpecifier,
} from "./source-specifier.js";
