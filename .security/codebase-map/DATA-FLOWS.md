# Security Data Flows

**Analysis Date:** 2026-02-05
**Scope:** Full codebase mapping

## Flow Summary

| Source | Sink | Validation | Risk |
|--------|------|------------|------|
| Agent name (config) | File system path | Schema + path-safety | LOW |
| Agent prompt (config) | Claude execution | Schema type only | MEDIUM |
| Hook command (config) | Shell execution | Schema type only | MEDIUM |
| Discord message | Agent prompt | Channel/DM filters | MEDIUM |
| Environment variable | Config interpolation | Pattern matching | MEDIUM |
| host_config (config) | Docker API | None (passthrough) | HIGH |
| Volume paths (config) | Docker mount | Format validation only | MEDIUM |
| Trigger --prompt | Claude execution | None | MEDIUM |
| GitHub issue | Agent work item | Label filtering | MEDIUM |

## Detailed Flows

---

### Flow: Agent Name -> File System Operations

**Risk Level:** LOW

**Source:**
- Entry: `fleet.yaml` `agents[].name` field or agent config `name` field
- Type: String (user-controlled)
- Initial trust: UNTRUSTED

**Path:**
1. **Entry** (`packages/core/src/config/loader.ts`):
   - YAML parsed by js-yaml
   - Raw string value extracted

2. **Validation** (`packages/core/src/config/schema.ts:715-722`):
   - `AGENT_NAME_PATTERN`: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
   - Rejects special characters, path separators, `..`
   - Trust after: VALIDATED (constrained character set)

3. **Usage** (`packages/core/src/state/session.ts`):
   - Name used to construct session file path
   - Calls `buildSafeFilePath(baseDir, agentName, '.json')`

4. **Defense** (`packages/core/src/state/utils/path-safety.ts:67-94`):
   - `buildSafeFilePath()` prevents path traversal
   - First check: `isValidIdentifier()` against SAFE_IDENTIFIER_PATTERN
   - Second check: Resolved path must start with base directory
   - Throws `PathTraversalError` if either check fails
   - Trust after: SAFE for file operations

5. **Sink** (fs.writeFileSync):
   - Writes session state to validated path in `.herdctl/sessions/`
   - Operation: File creation/update

**Validation Chain:** COMPLETE (double defense)
**Risk Assessment:** LOW - Schema validation + path-safety utility provides defense-in-depth.

---

### Flow: Agent Prompt -> Claude Execution

**Risk Level:** MEDIUM

**Source:**
- Entry: `fleet.yaml` `agents[].default_prompt` or schedule `prompt` field
- Type: String (free text, user-controlled)
- Initial trust: UNTRUSTED

**Path:**
1. **Entry** (`packages/core/src/config/loader.ts`):
   - Prompt loaded as free text string
   - No content validation (intentional - prompts are free-form)

2. **Minimal validation** (`packages/core/src/config/schema.ts`):
   - `z.string().optional()` type check only
   - No content filtering, length limits, or pattern matching
   - Trust after: UNTRUSTED (content unchanged)

3. **Transformation** (`packages/core/src/runner/sdk-adapter.ts`):
   - Prompt passed through task queue
   - System prompt may be prepended from `identity` or `system_prompt` config
   - Still no sanitization

4. **Sink** (Claude SDK/CLI execution):
   - Via `packages/core/src/runner/runtime/cli-runtime.ts:106`
   - `execa("claude", args, { input: prompt, ... })`
   - Prompt sent to Claude API with configured permissions

**Validation Chain:** INCOMPLETE (content not validated)
**Risk Assessment:** MEDIUM

**Why not HIGH:** This is intentional behavior - users provide prompts for Claude to execute. In herdctl, users control their own fleet.yaml, so this is expected.

**Residual risk:** If fleet.yaml content comes from untrusted source (shared configs, external sync), prompt injection is possible.

---

### Flow: Hook Command -> Shell Execution

**Risk Level:** MEDIUM

**Source:**
- Entry: `fleet.yaml` `agents[].hooks.after_run[].command` or `hooks.on_error[].command`
- Type: String (shell command, user-controlled)
- Initial trust: UNTRUSTED

**Path:**
1. **Entry** (`packages/core/src/config/loader.ts`):
   - Hook commands loaded as strings
   - User defines shell commands to run

2. **Validation** (`packages/core/src/config/schema.ts:644-649`):
   - `ShellHookConfigSchema`: `command: z.string().min(1)`
   - Type validation and non-empty check only
   - No command sanitization (intentional)
   - Trust after: UNTRUSTED

3. **Execution** (`packages/core/src/hooks/runners/shell.ts:153-213`):
   - Command executed via `spawn(command, { shell: true, ... })`
   - HookContext passed on stdin as JSON
   - Timeout enforced (default 30s)
   - User-defined command runs in host shell

**Validation Chain:** MINIMAL (type only)
**Risk Assessment:** MEDIUM

**Why not HIGH:** Users intentionally define shell hooks for their own use. The command runs in user's own environment with their permissions.

**Residual risk:** If fleet.yaml is attacker-controlled, arbitrary command execution is possible on the host system.

---

### Flow: Discord Message -> Agent Prompt

**Risk Level:** MEDIUM

**Source:**
- Entry: Discord channel or DM message
- Type: String (external user text)
- Initial trust: UNTRUSTED (external origin)

**Path:**
1. **Entry** (`packages/core/src/fleet-manager/discord-manager.ts`):
   - Message received via discord.js WebSocket
   - External user content

2. **Filtering** (`packages/core/src/fleet-manager/discord-manager.ts`):
   - Channel allowlist check (guilds[].channels[])
   - DM blocklist check (dm.blocklist)
   - Mode check: `mention` requires @bot, `auto` accepts all
   - Trust after: FILTERED (allowed channels/users only)

3. **Transformation**:
   - Message content extracted
   - Context messages may be included
   - Formatted as agent prompt

4. **Sink** (Agent execution):
   - Becomes agent task prompt
   - Same path as config prompts to Claude

**Validation Chain:** PARTIAL (source filtering, no content validation)
**Risk Assessment:** MEDIUM

**Why MEDIUM:** Channel/DM filtering provides access control, but message content is not sanitized. Users in allowed channels can send arbitrary content as prompts.

**Residual risk:** Prompt injection from Discord users in allowed channels.

---

### Flow: Environment Variable -> Config Value

**Risk Level:** MEDIUM

**Source:**
- Entry: `${VAR_NAME}` syntax in config values
- Type: String (from process.env)
- Initial trust: LOW-MEDIUM (host environment)

**Path:**
1. **Entry** (`packages/core/src/config/interpolate.ts:75`):
   - `ENV_VAR_PATTERN` regex: `/\$\{([^}]+)\}/g`
   - Matches all `${...}` patterns in string values

2. **Resolution**:
   - Looks up `process.env[varName]`
   - Substitutes value into config string
   - If undefined, uses empty string or default

3. **Validation after interpolation**:
   - Resulting string goes through Zod schema
   - Type and pattern validation applies to final value
   - Trust after: Depends on schema for that field

4. **Sink** (various):
   - Could become any config value: paths, commands, prompts, URLs

**Validation Chain:** PARTIAL (post-interpolation schema only)
**Risk Assessment:** MEDIUM

**Risk:** Environment variables could inject values that pass schema validation but have malicious intent. Example: `GITHUB_TOKEN` could be set to a value that's valid but belongs to wrong account.

---

### Flow: host_config Passthrough -> Docker API

**Risk Level:** HIGH

**Source:**
- Entry: `fleet.yaml` `defaults.docker.host_config` or `docker.host_config`
- Type: Object (raw HostConfig from dockerode)
- Initial trust: UNTRUSTED

**Path:**
1. **Entry** (`packages/core/src/config/schema.ts:314`):
   - `host_config: z.custom<HostConfig>().optional()`
   - No validation - accepts any HostConfig structure

2. **No transformation** (`packages/core/src/config/loader.ts`):
   - Passed through unchanged
   - Overrides any translated options
   - Trust after: UNTRUSTED (no validation occurred)

3. **Merge** (`packages/core/src/runner/runtime/container-manager.ts:135`):
   - Comment: "settings like CapDrop and SecurityOpt if needed"
   - host_config values override default security settings

4. **Sink** (Docker container.create):
   - Raw HostConfig passed to dockerode
   - Can override: Privileged, CapDrop, SecurityOpt, NetworkMode, etc.

**Validation Chain:** NONE (intentional passthrough)
**Risk Assessment:** HIGH

**Why HIGH:** This is a documented security bypass. Users can override ALL container security settings including:
- `Privileged: true` - Full host access
- `CapDrop: []` - Keep all capabilities
- `SecurityOpt: []` - Disable security profiles
- `NetworkMode: "host"` - Full network access
- `Binds` - Mount any host path

**Mitigation:** Documented as advanced feature. Users must explicitly configure this.

---

### Flow: Volume Paths -> Docker Mount

**Risk Level:** MEDIUM

**Source:**
- Entry: `fleet.yaml` `docker.volumes` array
- Type: String array in "host:container:mode" format
- Initial trust: UNTRUSTED

**Path:**
1. **Entry** (`packages/core/src/config/schema.ts:279-346`):
   - Volume format validated: "host:container" or "host:container:ro|rw"
   - No path validation beyond format

2. **No path sanitization**:
   - Host paths not validated against allow/deny lists
   - Can mount any path the Docker daemon has access to
   - Trust after: FORMAT VALIDATED only

3. **Sink** (`packages/core/src/runner/runtime/container-manager.ts`):
   - Volumes passed to Docker HostConfig.Binds
   - Container gains access to mounted paths

**Validation Chain:** PARTIAL (format only, not content)
**Risk Assessment:** MEDIUM

**Why MEDIUM:** Fleet-level only (not agent-level), but allows mounting sensitive host directories if user misconfigures. Limited to directories Docker daemon user can access.

---

### Flow: Trigger --prompt -> Claude Execution

**Risk Level:** MEDIUM

**Source:**
- Entry: CLI `herdctl trigger <agent> --prompt "<prompt>"`
- Type: String (CLI argument)
- Initial trust: UNTRUSTED (user input)

**Path:**
1. **Entry** (`packages/cli/src/commands/trigger.ts:50-158`):
   - commander.js parses `--prompt` option
   - Raw string from CLI

2. **No validation**:
   - Prompt passed directly to FleetManager
   - No content filtering

3. **Sink** (Agent execution):
   - Same as config prompts
   - Executes in Claude with agent's permissions

**Validation Chain:** NONE
**Risk Assessment:** MEDIUM

**Why MEDIUM:** Local CLI execution - user is running commands on their own machine. Same trust level as running any other command.

---

## High-Risk Flows

1. **host_config passthrough**: No validation, bypasses all container security. User can grant container full host access.

2. **Discord auto mode + prompts**: External users can inject content that becomes agent prompts. Content not sanitized.

3. **Shell hooks with HookContext**: While command is user-defined, HookContext on stdin could contain user-injected data from job output if not properly escaped by command.

## Validation Gaps

1. **Prompt content**: No validation or sanitization on prompt content anywhere (intentional for flexibility, but means prompt injection is a user responsibility)

2. **host_config fields**: Complete passthrough with no validation or warnings

3. **Volume host paths**: No validation that paths are safe - user could mount `/`, `/etc`, etc.

4. **Discord message content**: No content filtering, sanitization, or length limits

5. **Webhook signature verification**: Optional - if not configured, anyone can trigger webhooks

## Defense Inventory

| Defense | Location | Protects Against |
|---------|----------|------------------|
| AGENT_NAME_PATTERN | `schema.ts:715` | Path traversal via agent names |
| buildSafeFilePath() | `path-safety.ts:67` | Path traversal in state files |
| SAFE_IDENTIFIER_PATTERN | `path-safety.ts:33` | Invalid characters in identifiers |
| schema.strict() | Multiple schemas | Unknown/typo config fields |
| Zod type validation | `schema.ts` throughout | Type mismatches, format errors |
| DockerNetworkModeSchema | `schema.ts:142` | Invalid network modes |
| GITHUB_REPO_PATTERN | `schema.ts:38` | Invalid GitHub repo format |
| Default CapDrop ALL | `container-manager.ts:126` | Excessive container capabilities |
| no-new-privileges | `container-manager.ts:125` | Privilege escalation in containers |
| Hook timeout | `schema.ts:649` | Runaway shell hooks |
| Channel/DM filtering | `discord-manager.ts` | Unauthorized Discord access |

---

*Data flow analysis: 2026-02-05*
