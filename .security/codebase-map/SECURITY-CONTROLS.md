# Security Controls Inventory

**Analysis Date:** 2026-02-05

## Input Validation

### Zod Schema Validation (Primary Defense)

- **Location**: `packages/core/src/config/schema.ts`
- **What it validates**: All configuration input (fleet.yaml, agent configs)
- **Key patterns**:
  - `FleetConfigSchema.strict()` - rejects unknown fields
  - `AgentConfigSchema.strict()` - rejects unknown fields
  - `AgentDockerSchema.strict()` - rejects dangerous Docker options at agent level
  - `FleetDockerSchema.strict()` - validates Docker config format
- **Coverage**: ALL configuration fields go through schema validation
- **Gaps**:
  - `host_config` is `z.custom<HostConfig>()` - no validation (intentional passthrough)
  - `prompt` fields are `z.string()` - no content validation
  - `AgentOverridesSchema` uses `z.record(z.string(), z.unknown())` - accepts anything

### Agent Name Pattern

- **Location**: `packages/core/src/config/schema.ts:715`
- **Pattern**: `AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
- **What it validates**: Agent names in config
- **Purpose**: Prevents path traversal, shell metacharacters
- **Coverage**: All agent name fields (`agents[].name`)
- **Gaps**: None identified - pattern is restrictive and correct

### GitHub Repository Pattern

- **Location**: `packages/core/src/config/schema.ts:38`
- **Pattern**: `GITHUB_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`
- **What it validates**: `work_source.repo` field
- **Purpose**: Ensures valid owner/repo format
- **Coverage**: All GitHub work source configurations
- **Gaps**: Does not validate repo exists or user has access

### Memory Format Validation

- **Location**: `packages/core/src/config/schema.ts:202-212, 317-327`
- **Pattern**: `/^\d+(?:\.\d+)?\s*[kmgtb]?$/i`
- **What it validates**: Docker memory limits (e.g., "2g", "512m")
- **Coverage**: `docker.memory` field in both agent and fleet schemas
- **Gaps**: Does not validate reasonable limits (user could set 1 byte)

### Volume Format Validation

- **Location**: `packages/core/src/config/schema.ts:329-346`
- **What it validates**: Docker volume mount format
- **Pattern**: "host:container" or "host:container:ro|rw"
- **Coverage**: `docker.volumes` array
- **Gaps**: Does not validate host path safety - any path accepted

### User Format Validation

- **Location**: `packages/core/src/config/schema.ts:348-357`
- **Pattern**: `/^\d+(?::\d+)?$/`
- **What it validates**: Docker user as "UID" or "UID:GID"
- **Coverage**: `docker.user` field
- **Gaps**: None - format is correct

### Port Format Validation

- **Location**: `packages/core/src/config/schema.ts:359-371`
- **Pattern**: `/^\d+(?::\d+)?$/`
- **What it validates**: Docker port bindings
- **Coverage**: `docker.ports` array
- **Gaps**: Does not validate port ranges (1-65535) or privileged ports (<1024)

### Tmpfs Mount Validation

- **Location**: `packages/core/src/config/schema.ts:373-386`
- **What it validates**: Tmpfs mount paths start with "/"
- **Coverage**: `docker.tmpfs` array
- **Gaps**: Does not validate mount options syntax

## Path Safety

### buildSafeFilePath()

- **Location**: `packages/core/src/state/utils/path-safety.ts:67-94`
- **Function**: `buildSafeFilePath(baseDir: string, identifier: string, extension: string): string`
- **What it prevents**: Path traversal attacks
- **How it works**:
  1. Validates identifier against `SAFE_IDENTIFIER_PATTERN`
  2. Constructs path with `path.join(baseDir, identifier + extension)`
  3. Resolves both base and result paths
  4. Verifies result starts with base directory
- **Usage**: Session state files, job metadata files
- **Gaps**: Only used for state file operations, not all file paths

### SAFE_IDENTIFIER_PATTERN

- **Location**: `packages/core/src/state/utils/path-safety.ts:33`
- **Pattern**: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
- **What it prevents**: Path traversal characters (../, /, \)
- **Usage**: Called by `isValidIdentifier()` and `buildSafeFilePath()`
- **Gaps**: None - pattern is correct

### PathTraversalError

- **Location**: `packages/core/src/state/utils/path-safety.ts:13-27`
- **What it does**: Custom error class for path traversal detection
- **Information exposed**: baseDir, identifier, resultPath
- **Usage**: Thrown when path escapes base directory

## Container Hardening

### Docker Security Defaults

- **Location**: `packages/core/src/runner/runtime/container-manager.ts:124-127`
- **Controls applied**:
  - `SecurityOpt: ["no-new-privileges:true"]` - Prevents privilege escalation
  - `CapDrop: ["ALL"]` - Drops all Linux capabilities
  - `ReadonlyRootfs: false` - Not read-only (Claude needs to write temp files)
- **Applied when**: All Docker container creation (unless overridden by host_config)
- **Bypass risk**: `host_config` passthrough can override all these settings

### Network Mode Validation

- **Location**: `packages/core/src/config/schema.ts:142`
- **Default**: "bridge" (standard NAT networking)
- **Options**: "none", "bridge", "host"
- **Control**: Schema validation prevents arbitrary network modes
- **Gaps**: Does not prevent "host" mode which shares host network namespace

### Memory Limits

- **Location**: `packages/core/src/config/schema.ts:267` (default: "2g")
- **Control**: Docker memory cgroup limit
- **How enforced**: Translated to HostConfig.Memory
- **Gaps**: User can set very low or very high limits

### Container Cleanup

- **Location**: `packages/core/src/runner/runtime/container-manager.ts`
- **Controls**:
  - `max_containers` (default: 5) - Limits containers per agent
  - Ephemeral mode removes containers after use
- **Gaps**: Persistent containers remain if not cleaned up

## Permission Controls

### Permission Mode System

- **Location**: `packages/core/src/config/schema.ts:14-21`
- **Modes available**:
  - `default` - Standard Claude permissions
  - `acceptEdits` - Auto-accept file edits
  - `bypassPermissions` - Skip all permission checks
  - `plan` - Planning mode only
  - `delegate` - Delegation mode
  - `dontAsk` - Don't ask for permissions
- **Enforcement**: Passed to Claude SDK/CLI as flag
- **Bypass mechanisms**: `bypassPermissions` mode is intentional bypass

### Agent-Level Docker Restrictions

- **Location**: `packages/core/src/config/schema.ts:166-228`
- **What's restricted**: Agent config files cannot specify:
  - `image` - Docker image
  - `network` - Network mode
  - `volumes` - Volume mounts
  - `env` - Environment variables
  - `ports` - Port bindings
  - `user` - Container user
  - `host_config` - Raw HostConfig
- **How enforced**: `AgentDockerSchema.strict()` rejects unknown fields
- **Purpose**: Prevents agent configs from escalating their own privileges
- **Gaps**: Fleet-level config can still grant all these

### Allowed/Denied Tools

- **Location**: `packages/core/src/config/schema.ts:417-418, 741-742`
- **What it controls**: Which tools Claude can use
- **Configuration**: `allowed_tools` and `denied_tools` arrays
- **Enforcement**: Passed to Claude SDK/CLI
- **Gaps**: Configuration only - enforcement is in Claude, not herdctl

## Logging and Audit

### Job Output Logging

- **Location**: `packages/core/src/fleet-manager/job-manager.ts`
- **Events logged**:
  - Job start/completion/failure
  - Agent output (when outputToFile enabled)
- **Format**: JSONL for structured logs
- **Gaps**: No security-specific event logging (auth failures, config errors)

### Session State Persistence

- **Location**: `packages/core/src/state/session.ts`
- **What's logged**: Session state per agent
- **Storage**: `.herdctl/sessions/{agent}.json`
- **Gaps**: No audit trail of session changes

### Job Metadata

- **Location**: `.herdctl/jobs/{jobId}/`
- **What's stored**: Job metadata, output logs
- **Format**: YAML for metadata, log files for output
- **Gaps**: No integrity verification

## Control Dependencies

### Schema Validation depends on YAML Parsing

- **Reason**: Malformed YAML could bypass schema validation
- **Risk if parsing fails**: Error thrown, config not loaded
- **Mitigation**: js-yaml is used with default safe settings

### buildSafeFilePath depends on AGENT_NAME_PATTERN

- **Reason**: First check is pattern validation
- **Risk if pattern bypassed**: Path traversal possible
- **Mitigation**: Pattern is applied at schema level before buildSafeFilePath is called

### Docker Hardening depends on No host_config Override

- **Reason**: host_config is deep-merged last, overrides defaults
- **Risk if host_config set**: All security settings can be bypassed
- **Mitigation**: Documented as advanced feature, fleet-level only

---

## Summary Table

| Control Category | Count | Primary Location |
|-----------------|-------|------------------|
| Schema Validation | 12+ patterns | `schema.ts` |
| Path Safety | 3 functions | `path-safety.ts` |
| Container Hardening | 5 settings | `container-manager.ts` |
| Permission Controls | 3 systems | Various |
| Logging | 3 areas | Job/session/output |

---

*Security controls inventory: 2026-02-05*
