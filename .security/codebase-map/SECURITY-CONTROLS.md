# Security Controls Inventory

**Analysis Date:** 2026-02-13

## Input Validation

### Agent Name Validation
- **Location**: `packages/core/src/config/schema.ts:715`
- **What it validates**: Agent names used in file paths
- **Key patterns**: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
- **Coverage**: Prevents path traversal in agent names (blocks `../`, `.`, special chars). Applied at config parse time via Zod schema.
- **Gaps**: Only validates at config parse time. Assumes name doesn't change after validation. No length limit on agent names.

### GitHub Repository Format Validation
- **Location**: `packages/core/src/config/schema.ts:38`
- **What it validates**: GitHub repository strings in work_source config
- **Key patterns**: `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`
- **Coverage**: Ensures repository is in `owner/repo` format. Blocks path traversal and shell metacharacters.
- **Gaps**: Doesn't verify repository exists or is accessible. Accepts dots/hyphens in owner/repo names (valid but potentially confusing).

### Docker Memory Format Validation
- **Location**: `packages/core/src/config/schema.ts:203-213, 317-328`
- **What it validates**: Memory limit strings for Docker containers
- **Key patterns**: `/^\d+(?:\.\d+)?\s*[kmgtb]?$/i`
- **Coverage**: Prevents invalid memory specifications, ensures parseable format. Supports k/m/g/t/b units.
- **Gaps**: Allows extremely large values (e.g., "999999t") that may exceed host capacity. No minimum validation.

### Docker Volume Mount Validation
- **Location**: `packages/core/src/config/schema.ts:329-346`
- **What it validates**: Volume mount strings in format "host:container:mode"
- **Key patterns**: Split on `:`, verify 2-3 parts, mode must be `ro` or `rw`
- **Coverage**: Ensures valid mount syntax, enforces read-only or read-write mode
- **Gaps**: No path traversal checks on host paths. Accepts any absolute path. No verification that host path exists.

### Docker User Format Validation
- **Location**: `packages/core/src/config/schema.ts:348-358`
- **What it validates**: Container user specification as UID or UID:GID
- **Key patterns**: `/^\d+(?::\d+)?$/`
- **Coverage**: Prevents username strings, enforces numeric UIDs. Blocks root username but allows UID 0.
- **Gaps**: Doesn't verify UID/GID exists on host system. Allows UID 0 (root).

### Docker Port Format Validation
- **Location**: `packages/core/src/config/schema.ts:359-372`
- **What it validates**: Port bindings in "hostPort:containerPort" format
- **Key patterns**: `/^\d+(?::\d+)?$/`
- **Coverage**: Ensures ports are numeric. Prevents string injection.
- **Gaps**: No range checking (allows port 0, ports > 65535). No validation of privileged ports (<1024).

### Tmpfs Mount Path Validation
- **Location**: `packages/core/src/config/schema.ts:373-387`
- **What it validates**: Tmpfs mount paths must start with `/`
- **Key patterns**: Split on `:`, verify first part starts with `/`
- **Coverage**: Prevents relative paths in tmpfs mounts
- **Gaps**: No restrictions on which paths can be tmpfs-mounted. No validation of mount options syntax.

### Environment Variable Interpolation
- **Location**: `packages/core/src/config/interpolate.ts:36`
- **What it validates**: `${VAR}` and `${VAR:-default}` patterns in config strings
- **Key patterns**: `/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g`
- **Coverage**: Validates variable name format (letters, numbers, underscores). Supports defaults. Throws UndefinedVariableError if var missing and no default.
- **Gaps**: Default values are not validated (can contain arbitrary strings). No protection against expanding large env vars. Silent empty string if env var undefined in webhook header substitution.

### Fleet Configuration Schema Validation
- **Location**: `packages/core/src/config/parser.ts:161-187`
- **What it validates**: Entire fleet configuration YAML against FleetConfigSchema
- **Coverage**: Type checking, required fields, enum values, nested objects. Uses `.strict()` to reject unknown fields.
- **Gaps**: Schema validation happens after YAML parsing. Malformed YAML causes YamlSyntaxError before schema validation. AgentOverridesSchema uses `z.record(z.string(), z.unknown())` - accepts anything.

### Agent Configuration Schema Validation
- **Location**: `packages/core/src/config/parser.ts:245-274`
- **What it validates**: Agent-specific configuration files (herdctl-agent.yml)
- **Coverage**: Validates agent name, schedules, Docker config, session settings. Uses `.strict()` to reject unknown fields.
- **Gaps**: Agent configs loaded from paths specified in fleet config. No validation that agent config path is safe. Relative paths resolved from fleet config directory.

### CLI Argument Parsing
- **Location**: `packages/cli/src/index.ts`
- **What it validates**: Command-line arguments via Commander.js
- **Coverage**: Command structure, option types (e.g., `--timeout <seconds>` parsed as integer)
- **Gaps**: No validation of file paths provided via `--config` or `--state` options. User can specify arbitrary paths.

## Path Safety

### buildSafeFilePath
- **Location**: `packages/core/src/state/utils/path-safety.ts:67-94`
- **Function**: `buildSafeFilePath(baseDir: string, identifier: string, extension: string): string`
- **What it prevents**: Path traversal attacks in state file operations
- **How it works**:
  1. Validates identifier against `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
  2. Constructs path with `path.join(baseDir, identifier + extension)`
  3. Resolves absolute paths with `path.resolve()`
  4. Verifies resolved path starts with `resolvedBase + "/"` or equals resolvedBase
- **Usage**: Used in session files (`packages/core/src/state/session.ts`), job metadata (`packages/core/src/state/job-metadata.ts`), fleet state persistence
- **Gaps**: Only protects state directory (`.herdctl/`). Working directory paths are not validated (user-controlled in config). No length limits on identifiers.

### isValidIdentifier
- **Location**: `packages/core/src/state/utils/path-safety.ts:41-43`
- **Function**: `isValidIdentifier(identifier: string): boolean`
- **What it prevents**: Use of special characters in identifiers used for file paths
- **How it works**: Tests against `SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
- **Usage**: Called by buildSafeFilePath, used for agent names and job IDs
- **Gaps**: Doesn't prevent very long identifiers (no length limit). Doesn't prevent filesystem-reserved names (e.g., `CON`, `PRN` on Windows).

### PathTraversalError
- **Location**: `packages/core/src/state/utils/path-safety.ts:13-27`
- **What it prevents**: None (error class, not a control)
- **Information exposed**: baseDir, identifier, resultPath in error message
- **Usage**: Thrown when path escapes base directory or identifier is invalid
- **Gaps**: Error message leaks file system paths (acceptable for debugging, but could aid attacker reconnaissance).

### CLI Session Path Encoding
- **Location**: `packages/core/src/runner/runtime/cli-session-path.ts:31-34`
- **Function**: `encodePathForCli(absolutePath: string): string`
- **What it prevents**: Path traversal in CLI session directory names
- **How it works**: Replaces all `/` and `\` with `-` (e.g., `/Users/ed/Code/project` → `-Users-ed-Code-project`)
- **Usage**: Used by CLI runtime to locate session files in `~/.claude/projects/{encoded-path}/`
- **Coverage**: Prevents directory traversal in session paths. Creates safe directory names from workspace paths.
- **Gaps**: Encoding is not reversible (information loss). Multiple different paths could theoretically collide (e.g., `a/b-c` and `a-b/c` both → `a-b-c`). No validation of workspace path before encoding.

### resolveAgentPath
- **Location**: `packages/core/src/config/parser.ts:334-342`
- **Function**: `resolveAgentPath(agentPath: string, basePath: string): string`
- **What it prevents**: None - this is a resolution utility, not a security control
- **How it works**: Returns absolute paths as-is, resolves relative paths from basePath
- **Gaps**: No validation that resolved path is safe. Agent paths can reference any file system location (e.g., `/etc/passwd`, `../../../../etc/passwd`).

### Volume Mount Path Construction
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:264-301` (buildContainerMounts)
- **Function**: `buildContainerMounts(agent, dockerConfig, stateDir): PathMapping[]`
- **What it prevents**: None - constructs mounts from config without validation
- **How it works**: Maps working_directory to `/workspace`, adds docker-sessions dir, adds custom volumes from config
- **Gaps**: No path validation. Working directory and custom volumes come directly from config. User can mount any host path into container.

## Container Hardening

### Default Security Options
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:124-128`
- **Controls applied**:
  - `SecurityOpt: ["no-new-privileges:true"]` - Prevents privilege escalation inside container
  - `CapDrop: ["ALL"]` - Drops all Linux capabilities (no CAP_NET_ADMIN, CAP_SYS_ADMIN, etc.)
  - `ReadonlyRootfs: false` - Root filesystem is writable (Claude needs temp files)
- **Applied when**: Every container created by herdctl via ContainerManager.createContainer
- **Bypass risk**: `hostConfigOverride` (fleet-level config) can override these settings. Documented in lines 133-141 with security comment.

### Network Isolation Modes
- **Location**: `packages/core/src/config/schema.ts:142` (DockerNetworkModeSchema), `packages/core/src/runner/runtime/docker-config.ts:246`
- **Default**: `bridge` (standard Docker NAT with internet access)
- **Configuration**: Can be set to `none`, `bridge`, or `host` in fleet/agent config
- **Gaps**:
  - `network: none` breaks Claude agents (need Anthropic API access per CLAUDE.md warning)
  - `network: host` shares host network namespace (low isolation, bypasses network namespacing)
  - No validation that network choice is appropriate for workload

### Resource Limits
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:103-108`
- **Controls applied**:
  - `Memory: config.memoryBytes` - Hard memory limit (default: 2GB)
  - `MemorySwap: config.memoryBytes` - No swap (same as Memory = no swap usage)
  - `CpuShares: config.cpuShares` - Relative CPU weight (optional, undefined = no limit)
  - `CpuPeriod/CpuQuota` - Hard CPU limits (optional)
  - `PidsLimit: config.pidsLimit` - Max processes (prevents fork bombs, optional)
- **Applied when**: Container creation
- **Bypass risk**: No limits if not configured. Defaults: 2GB memory, no CPU/PID limits. User can disable by omitting config.

### Container User (Non-Root)
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:169`, `packages/core/src/runner/runtime/docker-config.ts:224-229` (getHostUser)
- **Default**: Matches host user UID:GID (from `process.getuid()` / `process.getgid()`)
- **Configuration**: Can be overridden in fleet config (`docker.user: "1000:1000"`)
- **Gaps**:
  - Falls back to `1000:1000` on Windows (no getuid/getgid APIs)
  - User can configure `0:0` (root) if desired (schema allows numeric UID 0)
  - No enforcement of non-root user

### Auto-Removal of Ephemeral Containers
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:130`
- **Controls applied**: `AutoRemove: config.ephemeral` (default: true)
- **Applied when**: Container creation
- **Gaps**:
  - Persistent containers (`ephemeral: false`) are kept for inspection but accumulate disk usage
  - Cleanup only when max_containers exceeded (default: 5)
  - Old containers remain if fleet crashes before cleanup

### hostConfigOverride Passthrough
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:133-144`
- **What it does**: Allows fleet operators to override any HostConfig option via `docker.host_config` in fleet config
- **Security implications**: Can override `CapDrop`, `SecurityOpt`, `ReadonlyRootfs`, resource limits, etc.
- **Why it exists**: Flexibility for advanced use cases requiring specific Docker configurations (documented in comment)
- **Mitigation**: Only available at fleet-level config (not agent-level), requires fleet operator access. Fleet operators trusted to understand security implications per `.security/THREAT-MODEL.md`.
- **Gaps**: No validation of overrides. No audit logging of overrides. Silently applies overrides without warning.

### No Seccomp/AppArmor Profiles
- **Location**: None - these controls are not implemented
- **Current state**: Docker's default seccomp and AppArmor profiles apply automatically
- **Gaps**: No custom seccomp profile to further restrict syscalls. No custom AppArmor profile. Relies entirely on Docker defaults.
- **Rationale**: Default Docker profiles provide baseline protection. Custom profiles would require maintenance and testing across distributions.

## Permission Controls

### Permission Modes (Claude SDK)
- **Location**: `packages/core/src/config/schema.ts:14-21` (PermissionModeSchema)
- **Modes available**:
  - `default` - Standard Claude permissions (asks for approvals)
  - `acceptEdits` - Auto-accepts file edits
  - `bypassPermissions` - Bypasses all permission checks
  - `plan` - Planning mode (no execution)
  - `delegate` - Delegate decisions to agent
  - `dontAsk` - Don't ask for permission
- **Default mode**: Not specified in schema (SDK default applies)
- **Enforcement**: Passed to Claude SDK via runtime interface, enforced by SDK
- **Bypass mechanisms**: Config can specify `bypassPermissions` mode (intentional bypass for autonomous operation)

### Tool Allow/Deny Lists
- **Location**: `packages/core/src/config/schema.ts:417-418, 741-742` (AgentConfigSchema)
- **Modes available**: `allowed_tools: string[]`, `denied_tools: string[]`
- **Enforcement**: Passed to Claude SDK, enforced by SDK
- **Gaps**: No validation that tool names are valid. SDK interprets these lists. Empty lists have specific semantics (allow all or deny all) controlled by SDK.

### Docker Enabled Flag
- **Location**: `packages/core/src/config/schema.ts:169, 256` (AgentDockerSchema, FleetDockerSchema)
- **Default**: `enabled: false` (Docker disabled by default)
- **Enforcement**: Checked before container creation in runtime factory
- **Gaps**: Once enabled, all Docker options become available. No gradual privilege escalation - it's binary on/off.

### Agent vs Fleet Docker Options (Two-Tier Privilege Model)
- **Location**: `packages/core/src/config/schema.ts:166-228` (AgentDockerSchema), `253-387` (FleetDockerSchema)
- **Agent-level safe options**: `memory`, `cpu_shares`, `cpu_period`, `cpu_quota`, `tmpfs`, `pids_limit`, `labels`, `workspace_mode`, `ephemeral`, `max_containers`
- **Fleet-level only (dangerous)**: `image`, `network`, `volumes`, `user`, `ports`, `env`, `host_config`
- **Enforcement**: Schema validation (`AgentDockerSchema.strict()` at line 201 rejects unknown fields)
- **Rationale**: Prevents agent configs from escalating privileges (can't change image, network, or add volumes)
- **Gaps**:
  - Agent configs are loaded from file system - if attacker can modify agent config file, they can modify safe options
  - No integrity checks on agent config files
  - Assumes fleet config directory has appropriate file permissions

### Setting Sources Control
- **Location**: `packages/core/src/config/schema.ts:746-754`
- **What it controls**: Where Claude SDK reads config from (`user`, `project`, `local`)
- **Default**: `["project"]` when workspace set, `[]` otherwise
- **Enforcement**: Passed to Claude SDK
- **Gaps**: No validation of which setting sources are safe. `user` setting source reads from `~/.claude/` (global user settings).

## Secret Handling

### API Key Environment Variables
- **Location**: `packages/core/src/runner/runtime/container-manager.ts:317-324` (buildContainerEnv)
- **What it handles**: Passes `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` to containers
- **How it works**: Reads from host environment via `process.env`, passes as container environment variables
- **Coverage**: API keys never appear in config files, only environment variables
- **Gaps**:
  - API keys visible in `docker inspect` output
  - API keys visible in container logs if agent prints environment
  - No secret rotation mechanism
  - No validation that secrets are present (agent fails if missing)

### GitHub Token Environment Variables
- **Location**: `packages/core/src/work-sources/adapters/github.ts:89-90` (config), `packages/core/src/config/schema.ts:44-46` (GitHubAuthSchema)
- **What it handles**: GitHub PAT for work source adapter
- **How it works**: Config specifies env var name (default: `GITHUB_TOKEN`), adapter reads from `process.env[token_env]`
- **Coverage**: GitHub tokens never appear in config files, only environment variable references
- **Gaps**:
  - No validation that token has required scopes
  - No token rotation mechanism
  - Token stored in plaintext environment

### Webhook and Discord Token Environment Variables
- **Location**: `packages/core/src/hooks/runners/webhook.ts:46-54` (substituteEnvVars), `packages/core/src/config/schema.ts:595-607` (AgentChatDiscordSchema)
- **What it handles**: Webhook auth headers and Discord bot tokens
- **How it works**: Config contains `${ENV_VAR}` patterns, substituted at runtime from `process.env`
- **Coverage**: Tokens never appear in config files, only env var references
- **Gaps**:
  - Webhook substituteEnvVars returns empty string for undefined vars (silent failure)
  - No validation that env vars are set before use
  - Substituted values visible in debug logs

## Logging and Audit

### Job Execution Logging
- **Location**: `packages/core/src/runner/job-executor.ts`, `packages/core/src/fleet-manager/job-manager.ts`
- **Events logged**: Job start (with jobId, agent name), job completion, job failure (with error), job timeout, job cancellation
- **Format**: Console output with timestamps, emits typed events via EventEmitter
- **Gaps**:
  - No centralized audit log file
  - Logs are ephemeral unless captured by process manager
  - No log rotation or retention policy
  - No log integrity verification

### Fleet State Persistence
- **Location**: `packages/core/src/state/fleet-state.ts`
- **Events logged**: Running jobs map (agent -> jobId), stored in `.herdctl/state/fleet.json`
- **Format**: JSON with `lastUpdated` timestamp
- **Gaps**:
  - Not a comprehensive audit log
  - Only current state, not historical events
  - No record of config changes or fleet start/stop events

### Job Metadata Persistence
- **Location**: `packages/core/src/state/job-metadata.ts`
- **Events logged**: Job creation (`jobId`, `agentName`, `prompt`, `startedAt`), status updates, exit reason (`completed`, `failed`, `timeout`, `cancelled`), error messages, `finishedAt` timestamp
- **Format**: JSON files at `.herdctl/jobs/{jobId}/metadata.json`
- **Gaps**:
  - Metadata only - no record of actions taken by agent during execution
  - No integrity verification (can be modified after creation)
  - No access control on job metadata files

### Error Logging with Context
- **Location**: `packages/core/src/runner/errors.ts:189-206` (buildErrorMessage)
- **Events logged**: Errors include jobId, agentName, phase (init/streaming)
- **Format**: Structured error objects with context, custom error classes (SDKInitializationError, SDKStreamingError, MalformedResponseError)
- **Gaps**:
  - Error messages may leak sensitive info (file paths, config values) if logged externally
  - No PII scrubbing in error messages
  - Error.cause may contain full stack traces with file paths

### Session Validation Warnings
- **Location**: `packages/core/src/state/session-validation.ts`
- **Events logged**: Session validation errors (workspace mismatch, missing fields, invalid structure)
- **Format**: Console warnings via logger
- **Gaps**:
  - Warnings only, no enforcement
  - Invalid sessions are skipped but not blocked
  - No audit trail of validation failures

### Docker Container Logging
- **Location**: `packages/core/src/runner/runtime/container-runner.ts`
- **Events logged**: Container start, container output (stdout/stderr streams), container exit (exit code)
- **Format**: Stream-based logging via runtime interface
- **Gaps**:
  - No logging of Docker commands executed
  - No audit of container security config applied
  - Container logs may contain sensitive data (API keys if agent prints them)

### Webhook Hook Execution Logging
- **Location**: `packages/core/src/hooks/runners/webhook.ts`
- **Events logged**: Webhook start, HTTP status code, response time, errors
- **Format**: Structured logs via logger interface (debug/info/warn/error)
- **Gaps**:
  - Request headers may contain secrets (Authorization tokens)
  - No separate audit log for hook execution
  - Logs may leak webhook URLs

### Shell Hook Execution Logging
- **Location**: `packages/core/src/hooks/runners/shell.ts`
- **Events logged**: Shell command execution, stdout/stderr output, exit code
- **Format**: Structured logs via logger interface
- **Gaps**:
  - Command output may contain sensitive data
  - No command validation or audit trail
  - Output buffer limited to 1MB (MAX_OUTPUT_SIZE) but may still leak secrets

## Error Handling (Information Disclosure Prevention)

### Typed Error Classes
- **Location**: `packages/core/src/runner/errors.ts`
- **What it prevents**: Generic error messages that leak implementation details
- **How it works**: Custom error classes (SDKInitializationError, SDKStreamingError, MalformedResponseError) with context
- **Coverage**: Structured error handling with specific error types. buildErrorMessage includes only safe context (jobId, agentName).
- **Gaps**: Error messages still include original error text from SDK/API responses. No scrubbing of API responses that might contain sensitive data. PathTraversalError leaks file system paths.

### Error Classification
- **Location**: `packages/core/src/runner/errors.ts:213-248` (classifyError, wrapError)
- **What it prevents**: Loss of error context during propagation
- **How it works**: classifyError maps errors to exit reasons. wrapError converts unknown errors to RunnerError types.
- **Coverage**: Preserves error context through stack. Maps errors to semantic exit reasons.
- **Gaps**: Original error included as `cause` - full stack traces may leak paths. No filtering of error messages before logging.

### Session Validation Error Messages
- **Location**: `packages/core/src/state/session-validation.ts:170-244` (validateSession)
- **What it prevents**: Exposing session internals in validation errors
- **How it works**: Returns structured SessionValidationResult with reason codes and human-readable messages
- **Coverage**: Provides safe error messages (e.g., "Session expired: last used 2h ago, timeout is 1h")
- **Gaps**: Messages include timing information that could aid timing attacks. No rate limiting on validation failures.

## Control Dependencies

### buildSafeFilePath depends on AGENT_NAME_PATTERN
- **Reason**: Both must agree on what constitutes a valid identifier
- **Risk if pattern changes**: If AGENT_NAME_PATTERN allows characters that buildSafeFilePath doesn't sanitize, path traversal possible
- **Coupling**: SAFE_IDENTIFIER_PATTERN (path-safety.ts:33) must match AGENT_NAME_PATTERN (schema.ts:715)

### Container Security depends on Fleet Config Integrity
- **Reason**: Security options come from fleet config (network, user, host_config overrides)
- **Risk if config compromised**: Attacker can weaken container security by modifying fleet config (disable CapDrop, enable host network, mount arbitrary volumes)
- **Mitigation**: Fleet config should have restrictive file permissions (owner-only read/write)

### Input Validation depends on Zod Schema Definitions
- **Reason**: All validation rules encoded in Zod schemas
- **Risk if schema changes**: Loosening schema validation (e.g., removing `.strict()`) allows unexpected fields. Changing regex patterns allows previously-blocked inputs.
- **Coupling**: Schema changes require security review

### Environment Variable Interpolation depends on Process Environment
- **Reason**: `${VAR}` expansion reads from process.env
- **Risk if env compromised**: Attacker who controls process environment can inject values into config. Config becomes partially attacker-controlled.
- **Mitigation**: Process environment should be controlled by fleet operator

### Docker Network Mode depends on Network Type Selection
- **Reason**: `network: none` breaks Claude agents (need Anthropic API), `network: host` reduces isolation
- **Risk if misconfigured**:
  - `none`: Agents fail to function (cannot reach Anthropic APIs)
  - `host`: Agents have full host network access, can reach internal services, bypass network namespacing
- **Mitigation**: Documentation warns against `network: none` (CLAUDE.md:94-112)

### Path Safety depends on Node.js path Module
- **Reason**: buildSafeFilePath uses `path.join()` and `path.resolve()` for canonicalization
- **Risk if path module bypassed**: Platform-specific path handling differences (Windows vs POSIX) could allow traversal
- **Mitigation**: Node.js path module is battle-tested, but edge cases exist (UNC paths on Windows, symlinks)

### CLI Session Path Encoding depends on Consistent Separator Replacement
- **Reason**: encodePathForCli replaces `/` and `\` with `-` to create safe directory names
- **Risk if encoding inconsistent**: Session files could be stored in wrong directory or become inaccessible
- **Coupling**: All code using CLI sessions must use same encoding (getCliSessionDir, getCliSessionFile, waitForNewSessionFile)

---

## Summary Table

| Control Category | Count | Primary Location | Strength |
|-----------------|-------|------------------|----------|
| Schema Validation | 12+ patterns | `config/schema.ts` | Strong |
| Path Safety | 4 functions | `state/utils/path-safety.ts`, `runtime/cli-session-path.ts` | Strong |
| Container Hardening | 6 settings | `runner/runtime/container-manager.ts` | Moderate (overridable) |
| Permission Controls | 4 systems | Various | Moderate (SDK-enforced) |
| Secret Handling | 4 mechanisms | Various | Weak (plaintext env vars) |
| Logging | 7 areas | Job/session/output | Weak (no audit trail) |
| Error Handling | 3 mechanisms | `runner/errors.ts`, `state/session-validation.ts` | Moderate |

---

*Security controls inventory: 2026-02-13 (updated with CLI session path encoding)*
