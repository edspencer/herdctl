# Attack Surface Map

**Analysis Date:** 2026-02-05
**Scope:** Full codebase mapping

## Entry Points

### Configuration Loading

**fleet.yaml (Primary Configuration)**
- **Source**: User-created YAML file
- **Parser**: js-yaml via `packages/core/src/config/loader.ts`
- **Trust level**: MEDIUM (user's own files, but untrusted content)
- **Validation**: Zod schema in `packages/core/src/config/schema.ts`
- **Key defenses**:
  - `AgentConfigSchema.strict()` - rejects unknown fields
  - `AGENT_NAME_PATTERN` - `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` restricts agent name characters
  - Type validation on all fields via Zod
  - `FleetConfigSchema.strict()` - prevents typos and unknown fields
- **Key files**: `loader.ts`, `schema.ts`, `interpolate.ts`, `parser.ts`

**Agent Config Files (herdctl-agent.yml)**
- **Source**: Agent-specific configuration files loaded via path reference
- **Parser**: Same YAML/Zod pipeline as fleet.yaml
- **Trust level**: MEDIUM (could be in untrusted directories)
- **Validation**: `AgentDockerSchema.strict()` - safe options only at agent level
- **Key defense**: Dangerous Docker options (volumes, network, image) restricted to fleet level only
- **Key files**: `packages/core/src/config/loader.ts:186-282`

**Environment Variable Interpolation**
- **Source**: Environment variables referenced in config via `${VAR}` syntax
- **Parser**: `packages/core/src/config/interpolate.ts`
- **Trust level**: LOW-MEDIUM (controlled by host environment)
- **Key variables**:
  - `ANTHROPIC_API_KEY` - API authentication
  - `CLAUDE_CODE_OAUTH_TOKEN` - OAuth authentication
  - `GITHUB_TOKEN` - GitHub work source authentication
  - `NO_COLOR`, `FORCE_COLOR` - Terminal color control
- **Risk**: Variable substitution happens in config values, enabling injection
- **Key files**: `packages/core/src/config/interpolate.ts`

### CLI Arguments

**Command Line Input**
- **Source**: User-provided CLI arguments via commander.js
- **Parser**: commander.js in `packages/cli/src/index.ts`
- **Trust level**: MEDIUM (user input, but local execution)
- **Key commands**:
  - `herdctl init` - Initialize fleet config (options: name, example, force)
  - `herdctl start` - Start fleet (options: config, state paths)
  - `herdctl stop` - Stop fleet (options: force, timeout, state)
  - `herdctl status` - Show status (options: json, config, state)
  - `herdctl logs` - View logs (options: follow, job, lines, json)
  - `herdctl trigger` - Trigger agent (options: schedule, prompt, wait)
  - `herdctl jobs` - List jobs (options: agent, status, limit)
  - `herdctl job` - Show job details (options: logs, output, cancel)
  - `herdctl sessions` - Manage sessions (attach, list, delete, reset)
- **Key files**: `packages/cli/src/index.ts`, `packages/cli/src/commands/*.ts`

**Trigger Prompt Argument**
- **Source**: `--prompt` option on `herdctl trigger` command
- **Trust level**: MEDIUM (user provides arbitrary prompt)
- **Validation**: None (prompts are intentionally free-form)
- **Risk**: Direct path to Claude execution with user content
- **Key files**: `packages/cli/src/commands/trigger.ts`

### File System Inputs

**State Directory (.herdctl/)**
- **Source**: Local file system
- **Trust level**: MEDIUM (user's project directory)
- **Operations**: Read/write session state, job metadata, output logs
- **Structure**:
  - `.herdctl/sessions/{agent}.json` - Session state per agent
  - `.herdctl/jobs/{jobId}/` - Job metadata and output
  - `.herdctl/discord-sessions/` - Discord session persistence
- **Defenses**:
  - `buildSafeFilePath()` in `packages/core/src/state/utils/path-safety.ts`
  - `SAFE_IDENTIFIER_PATTERN` validation for agent names in paths
- **Key files**: `packages/core/src/state/session.ts`, `packages/core/src/state/utils/path-safety.ts`

**Workspace Directories**
- **Source**: User-specified working directories for agents
- **Trust level**: LOW (agent may read/write arbitrary files within workspace)
- **Configuration**: `working_directory` field in agent config
- **Risk**: Agents can access entire workspace tree
- **Key files**: `packages/core/src/config/schema.ts` (WorkingDirectorySchema)

### External Service Calls

**Claude SDK/CLI Execution**
- **Source**: Anthropic API via SDK or CLI
- **Trust level**: HIGH (trusted service)
- **Authentication**:
  - `ANTHROPIC_API_KEY` environment variable
  - `CLAUDE_CODE_OAUTH_TOKEN` for Max plan OAuth
- **Key files**:
  - `packages/core/src/runner/runtime/cli-runtime.ts`
  - `packages/core/src/runner/sdk-adapter.ts`

**GitHub API (Work Source)**
- **Source**: GitHub REST API via Octokit
- **Trust level**: MEDIUM (user-controlled token scope)
- **Authentication**: `GITHUB_TOKEN` environment variable
- **Operations**: Issue listing, label management, PR creation
- **Key files**: `packages/core/src/work-sources/adapters/github.ts`

**Docker API**
- **Source**: Local Docker daemon via dockerode
- **Trust level**: LOW-MEDIUM (local service, but powerful)
- **Operations**: Container creation, exec, volume mounting
- **Key files**:
  - `packages/core/src/runner/runtime/container-manager.ts`
  - `packages/core/src/runner/runtime/container-runner.ts`

### Webhooks

**Webhook Server**
- **Source**: Incoming HTTP requests
- **Trust level**: LOW (external network input)
- **Configuration**: `webhooks` field in fleet config
- **Port**: Configurable (default: 8081)
- **Authentication**: `secret_env` for HMAC signature verification
- **Key files**: Schema at `packages/core/src/config/schema.ts` (WebhooksSchema)

### Discord Integration

**Discord Bot Messages**
- **Source**: Discord API via discord.js
- **Trust level**: LOW (external users can send messages)
- **Configuration**: `chat.discord` in agent config
- **Authentication**: `bot_token_env` environment variable
- **Controls**:
  - DM allowlist/blocklist
  - Channel mode (mention vs auto)
  - Guild-specific configuration
- **Key files**:
  - `packages/core/src/fleet-manager/discord-manager.ts`
  - `packages/discord/src/discord-connector.ts`

## Trust Boundaries

### Boundary: User Input -> Validated Configuration

**Location**: `packages/core/src/config/loader.ts` -> `schema.ts`

**What crosses**:
- Raw YAML content
- Environment variable values
- File paths

**Validation applied**:
- Zod schema parsing with strict mode
- Type coercion and validation
- Pattern matching for identifiers (AGENT_NAME_PATTERN, GITHUB_REPO_PATTERN)
- Memory/port/volume format validation via Zod refine

**Trust after crossing**: HIGH (within FleetManager)

**Bypass vectors**:
- None identified for schema validation (schema.strict() enforces structure)
- `host_config` passthrough allows raw Docker HostConfig (documented bypass)

---

### Boundary: FleetManager -> Agent Process

**Location**: `packages/core/src/runner/`

**What crosses**:
- Agent configuration (already validated)
- Prompts and tasks
- Permission settings
- Session state

**Validation applied**:
- Config already validated by schema
- Permission mode enforcement

**Trust after crossing**: VARIES (depends on agent config)

**Bypass vectors**:
- `bypassPermissions` option - documented, intentional for automation
- `host_config` for Docker - allows user to override security defaults

---

### Boundary: FleetManager -> Docker Container

**Location**: `packages/core/src/runner/runtime/container-manager.ts`

**What crosses**:
- Container configuration
- Volume mounts
- Environment variables
- Commands

**Validation applied**:
- Default security hardening (CapDrop ALL, no-new-privileges)
- Memory limits enforced
- Network mode validated

**Trust after crossing**: LOW (agent code runs with container privileges)

**Bypass vectors**:
- `host_config` passthrough can override all security settings
- Volume mounts can grant access to host filesystem

---

### Boundary: External Input -> Shell Execution

**Location**: `packages/core/src/hooks/runners/shell.ts`

**What crosses**:
- Hook commands from config
- HookContext data on stdin

**Validation applied**:
- Type validation (command must be string)
- Timeout enforcement (default: 30s)

**Trust after crossing**: FULL HOST (shell execution with user privileges)

**Bypass vectors**:
- None needed - shell execution is intentional user feature
- Config controls what commands run

---

### Boundary: Discord Messages -> Agent Prompts

**Location**: `packages/core/src/fleet-manager/discord-manager.ts`

**What crosses**:
- User messages from Discord
- Channel context

**Validation applied**:
- Channel/guild allowlist checking
- DM blocklist checking
- Bot mention requirement (in mention mode)

**Trust after crossing**: MEDIUM (becomes agent prompt)

**Bypass vectors**:
- If in `auto` mode, any message triggers agent

## Summary

| Category | Entry Points | Trust Level | Primary Defense |
|----------|--------------|-------------|-----------------|
| Configuration | 3 (fleet, agent, env) | MEDIUM | Zod schema validation |
| CLI Arguments | 10 commands | MEDIUM | Commander.js parsing |
| Environment | 5+ variables | LOW-MEDIUM | Interpolation only |
| File System | 3 areas | MEDIUM | Path safety utilities |
| External Services | 4 (Claude, GitHub, Docker, Discord) | VARIES | Service-specific auth |
| Webhooks | 1 | LOW | HMAC signature (optional) |

**Total entry points**: 22+
**Trust boundaries**: 5 major
**Highest risk areas**:
1. `host_config` Docker passthrough (bypasses all container hardening)
2. Shell hooks with user-defined commands (full host access)
3. Discord auto mode (external users can trigger agents)
4. Prompt injection via trigger --prompt (no content filtering)

---

*Attack surface analysis: 2026-02-05*
