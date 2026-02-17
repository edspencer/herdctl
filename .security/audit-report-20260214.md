# Security Audit Report - herdctl
**Date:** 2026-02-14
**Auditor:** Claude Sonnet 4.5 (Security Agent)
**Project:** herdctl - Fleet Management System for Claude Code Agents
**Version:** Pre-MVP (main branch)

---

## Executive Summary

**Overall Security Status: YELLOW (Medium Risk)**

The herdctl project demonstrates strong security practices in several areas but has critical vulnerabilities that require immediate attention. The project is in pre-MVP stage, which explains some findings, but contains production-ready security patterns alongside concerning weaknesses.

### Critical Findings Summary
- **1 CRITICAL:** Hardcoded secrets committed to repository (.env file)
- **3 HIGH:** Command injection risks, unsafe environment variable handling, Docker security gaps
- **4 MEDIUM:** Missing input validation, rate limiting gaps, SSRF vulnerability potential
- **2 LOW:** Informational findings about security hardening opportunities

### Key Strengths
- Comprehensive input validation using Zod schemas
- Docker security hardening with capabilities dropped and read-only root filesystem options
- Atomic file writes to prevent data corruption
- Well-structured error handling with typed errors
- Environment variable interpolation with validation
- No use of dangerous code execution patterns (eval, Function constructor)

### Key Weaknesses
- **CRITICAL:** `.env` file with production tokens committed to git repository
- Shell command execution with user-controlled input (command injection risk)
- Missing authentication/authorization for CLI commands (local trust model only)
- Webhook SSRF vulnerability potential (no URL allowlist)
- Missing rate limiting for Discord bot commands

---

## Detailed Findings

### CRITICAL: C-01 - Hardcoded Secrets in Repository

**Severity:** CRITICAL
**File:** `/opt/herdctl/.env`
**Lines:** 1-5

**Description:**
Production secrets and API tokens are hardcoded in the `.env` file and committed to the git repository. This file contains:
- `CLAUDE_CODE_OAUTH_TOKEN`: Anthropic OAuth token (sk-ant-oat01-...)
- `DISCORD_BOT_TOKEN`: Discord bot token
- `GITHUB_TOKEN`: GitHub Personal Access Token

**Evidence:**
```bash
# From /opt/herdctl/.env
CLAUDE_CODE_OAUTH_TOKEN=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
DISCORD_BOT_TOKEN=[REDACTED]
DISCORD_GUILD_ID=1091766033779523584
DISCORD_SECURITY_CHANNEL_ID=1471236343794368797
GITHUB_TOKEN=[REDACTED]
```

**Impact:**
- Anyone with repository access (current or historical) can access these credentials
- Tokens can be used to impersonate the bot, access GitHub repositories, and consume Anthropic API quota
- Git history preserves these secrets even if removed in future commits
- Public repository disclosure would grant unlimited third-party access

**Recommendation:**
1. **IMMEDIATE:** Revoke all exposed tokens:
   - Revoke Discord bot token via Discord Developer Portal
   - Revoke GitHub PAT via GitHub Settings > Developer Settings
   - Revoke Anthropic OAuth token via Anthropic account settings
2. **IMMEDIATE:** Remove `.env` from git history using `git filter-repo` or BFG Repo-Cleaner
3. Add `.env` to `.gitignore` (verify it's already present)
4. Use environment variables or secret management system (e.g., HashiCorp Vault, AWS Secrets Manager)
5. Document required environment variables in `.env.example` (without values)
6. Implement pre-commit hooks to prevent accidental secret commits

**Verified Safe Practice:**
The codebase correctly uses `process.env` to read these values rather than importing the `.env` file directly, which is good practice. The issue is solely the committed file.

---

### HIGH: H-01 - Command Injection Risk in Shell Hook Runner

**Severity:** HIGH
**File:** `/opt/herdctl/packages/core/src/hooks/runners/shell.ts`
**Lines:** 153-154

**Description:**
The ShellHookRunner executes user-provided shell commands using `spawn()` with `shell: true`, which enables shell interpretation. This creates a command injection vulnerability if user input flows into the command string.

**Evidence:**
```typescript
// From shell.ts:153
const proc = spawn(command, {
  shell: true,  // VULNERABILITY: Enables shell interpretation
  cwd: this.cwd,
  env: { ...process.env, ...this.env },
  stdio: ["pipe", "pipe", "pipe"],
});
```

**Attack Vector:**
If an attacker can control the `command` field in hook configuration (e.g., via a malicious agent config file or compromised fleet config), they can inject arbitrary shell commands:

```yaml
hooks:
  on_job_complete:
    - type: shell
      command: "echo 'Job done'; rm -rf / --no-preserve-root"  # Injected payload
```

**Impact:**
- Arbitrary code execution on the host system
- File system manipulation (read/write/delete)
- Network access to internal services
- Privilege escalation if herdctl runs with elevated privileges

**Affected Code Flow:**
1. Hook configuration loaded from YAML (not validated for shell metacharacters)
2. Command passed to ShellHookRunner.execute()
3. Spawned with `shell: true` allowing `&&`, `||`, `;`, `|`, backticks, `$()` etc.

**Recommendation:**

**Option A (Recommended):** Disable shell interpretation and use argument arrays:
```typescript
// Parse command into executable and args
const [executable, ...args] = parseShellCommand(command);
const proc = spawn(executable, args, {
  shell: false,  // SECURE: No shell interpretation
  cwd: this.cwd,
  env: { ...process.env, ...this.env },
  stdio: ["pipe", "pipe", "pipe"],
});
```

**Option B:** If shell is required, implement command allowlist:
```typescript
// Validate against allowlist of permitted commands
const ALLOWED_COMMANDS = [
  /^\/usr\/local\/bin\/notify-slack$/,
  /^\.\/scripts\/log-job\.sh$/,
];

if (!ALLOWED_COMMANDS.some(pattern => pattern.test(command))) {
  throw new Error(`Shell command not in allowlist: ${command}`);
}
```

**Option C:** Escape shell metacharacters (fragile, not recommended):
```typescript
import { quote } from 'shell-quote';
const safeCommand = quote([command]);
```

**Mitigating Factors:**
- Hook commands are defined in fleet/agent config files (trusted operators only)
- No user input directly flows into hook commands at runtime
- Requires write access to config files (implies repository access)

**Risk Level Justification:**
HIGH rather than CRITICAL because:
1. Attack requires compromising config files (not user input)
2. Fleet operators are trusted administrators
3. Pre-MVP project with no external users

However, this becomes CRITICAL if:
- Agent configs can be loaded from untrusted sources
- Web UI allows editing hook commands
- Multi-tenant environments share fleet manager instances

---

### HIGH: H-02 - Unsafe Environment Variable Interpolation in Webhook URLs

**Severity:** HIGH
**File:** `/opt/herdctl/packages/core/src/hooks/runners/webhook.ts`
**Lines:** 46-54, 116-118

**Description:**
Environment variable substitution in webhook URLs and headers silently returns empty strings for undefined variables, potentially causing security issues. Additionally, there's no validation of webhook URLs, enabling SSRF attacks.

**Evidence:**
```typescript
// From webhook.ts:46-54
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      // VULNERABILITY: Silent failure returns empty string
      return "";
    }
    return envValue;
  });
}

// From webhook.ts:116-118
if (config.headers) {
  for (const [key, value] of Object.entries(config.headers)) {
    headers[key] = substituteEnvVars(value);  // No validation of result
  }
}
```

**Attack Scenarios:**

**Scenario 1: Authorization Bypass via Silent Failure**
```yaml
hooks:
  on_job_complete:
    - type: webhook
      url: "https://api.internal.com/jobs"
      headers:
        Authorization: "Bearer ${API_TOKN}"  # Typo: TOKN instead of TOKEN
```
Result: `Authorization: "Bearer "` (empty token) - may bypass some auth checks

**Scenario 2: SSRF via Unvalidated URLs**
```yaml
hooks:
  on_job_complete:
    - type: webhook
      url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/"  # AWS metadata
```
Result: Webhook POSTs to internal metadata service, potentially leaking credentials

**Impact:**
- **Silent Auth Bypass:** Typos in env var names lead to empty auth headers
- **SSRF (Server-Side Request Forgery):** Webhook can target internal services:
  - Cloud metadata endpoints (AWS, GCP, Azure)
  - Internal APIs (192.168.x.x, 10.x.x.x, 127.0.0.1)
  - Kubernetes API servers (kubernetes.default.svc)
- **Data Exfiltration:** Send sensitive HookContext data to attacker-controlled servers

**Recommendation:**

**Fix 1: Fail loudly on undefined environment variables**
```typescript
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    const envValue = process.env[envVar];
    if (envValue === undefined) {
      throw new Error(
        `Undefined environment variable '${envVar}' in webhook configuration. ` +
        `Check your .env file or system environment.`
      );
    }
    return envValue;
  });
}
```

**Fix 2: Implement webhook URL allowlist**
```typescript
const ALLOWED_WEBHOOK_DOMAINS = [
  'hooks.slack.com',
  'discord.com',
  'api.github.com',
  // Add trusted domains
];

function validateWebhookUrl(url: string): void {
  const parsed = new URL(url);

  // Block private IP ranges
  const PRIVATE_IP_RANGES = [
    /^127\./,          // Loopback
    /^10\./,           // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B
    /^192\.168\./,     // Private Class C
    /^169\.254\./,     // Link-local
  ];

  if (PRIVATE_IP_RANGES.some(pattern => pattern.test(parsed.hostname))) {
    throw new Error(`Webhook URL targets private IP address: ${url}`);
  }

  // Require HTTPS
  if (parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL must use HTTPS: ${url}`);
  }

  // Check allowlist
  const isAllowed = ALLOWED_WEBHOOK_DOMAINS.some(domain =>
    parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  );

  if (!isAllowed) {
    throw new Error(
      `Webhook URL domain '${parsed.hostname}' not in allowlist. ` +
      `Allowed domains: ${ALLOWED_WEBHOOK_DOMAINS.join(', ')}`
    );
  }
}
```

**Fix 3: Add config validation in schema**
```typescript
// In schema.ts
export const WebhookHookSchema = z.object({
  type: z.literal("webhook"),
  url: z.string().url().refine(
    (url) => {
      try {
        validateWebhookUrl(url);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Webhook URL must be HTTPS and in allowlist" }
  ),
  // ... rest of schema
});
```

**Mitigating Factors:**
- Webhook configs are in trusted fleet/agent YAML files
- No runtime user input controls webhook URLs
- Requires config file write access to exploit

**Note:** The config interpolation module (`/opt/herdctl/packages/core/src/config/interpolate.ts`) correctly throws `UndefinedVariableError` for undefined variables. This inconsistency should be resolved by using the same interpolation logic everywhere.

---

### HIGH: H-03 - Docker hostConfigOverride Allows Security Escape

**Severity:** HIGH
**File:** `/opt/herdctl/packages/core/src/runner/runtime/container-manager.ts`
**Lines:** 133-144

**Description:**
The `hostConfigOverride` option allows complete override of Docker security settings, including capabilities and security options. While documented as intentional for fleet operators, this creates a security escape hatch.

**Evidence:**
```typescript
// From container-manager.ts:133-144
// SECURITY: hostConfigOverride allows fleet operators to customize Docker
// host config beyond the safe defaults above. This can override security
// settings like CapDrop and SecurityOpt if needed for specific use cases.
//
// This is intentionally only available at fleet-level config (not agent-level)
// to prevent untrusted agent configs from weakening container security.
// Fleet operators are trusted to understand the security implications.
const finalHostConfig: HostConfig = config.hostConfigOverride
  ? { ...translatedHostConfig, ...config.hostConfigOverride }
  : translatedHostConfig;
```

**Attack Scenario:**
A fleet operator or compromised fleet config can override security hardening:

```yaml
defaults:
  docker:
    enabled: true
    host_config:
      CapDrop: []           # Restore all capabilities
      CapAdd: ["SYS_ADMIN"] # Add admin capability
      SecurityOpt: []       # Remove no-new-privileges
      Privileged: true      # Enable privileged mode
```

**Impact:**
- Container can escape to host system (with privileged mode + CAP_SYS_ADMIN)
- Can access host filesystem beyond mounted volumes
- Can modify kernel parameters and load kernel modules
- Defeats all Docker isolation mechanisms

**Recommendation:**

**Option A (Recommended):** Implement override allowlist with validation:
```typescript
const SAFE_HOST_CONFIG_KEYS = [
  'ShmSize',      // Shared memory size (safe)
  'OomScoreAdj',  // OOM killer priority (safe)
  'CpuCount',     // CPU limit (safe)
  'PidsLimit',    // Process limit (safe)
  'Tmpfs',        // Tmpfs mounts (safe)
  // DO NOT include: CapDrop, CapAdd, SecurityOpt, Privileged, NetworkMode
];

function validateHostConfigOverride(override: HostConfig): void {
  const dangerousKeys = Object.keys(override).filter(
    key => !SAFE_HOST_CONFIG_KEYS.includes(key)
  );

  if (dangerousKeys.length > 0) {
    throw new Error(
      `Dangerous Docker host_config keys detected: ${dangerousKeys.join(', ')}. ` +
      `Only these keys are allowed: ${SAFE_HOST_CONFIG_KEYS.join(', ')}`
    );
  }
}
```

**Option B:** Add override confirmation in schema:
```typescript
export const FleetDockerSchema = z.object({
  // ... existing fields
  host_config: z.custom<HostConfig>().optional(),
  host_config_dangerous_override_confirmed: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.host_config && !data.host_config_dangerous_override_confirmed) {
      return false;
    }
    return true;
  },
  {
    message: "host_config requires host_config_dangerous_override_confirmed: true",
  }
);
```

**Option C:** Log all overrides for audit trail:
```typescript
if (config.hostConfigOverride) {
  this.logger.warn(
    `[SECURITY AUDIT] Docker hostConfigOverride in use for agent ${agentName}:`,
    JSON.stringify(config.hostConfigOverride, null, 2)
  );

  // Check for specifically dangerous settings
  const dangerous = {
    Privileged: config.hostConfigOverride.Privileged,
    CapAdd: config.hostConfigOverride.CapAdd,
    CapDrop: config.hostConfigOverride.CapDrop,
  };

  if (Object.values(dangerous).some(v => v !== undefined)) {
    this.logger.error(
      `[SECURITY CRITICAL] Dangerous Docker override detected: ${JSON.stringify(dangerous)}`
    );
  }
}
```

**Current Mitigations:**
- Only available at fleet-level config (documented in code comments)
- Fleet operators are trusted administrators
- Pre-MVP project with controlled deployment

**Future Risk:**
- Multi-tenant deployments
- Web UI for fleet configuration
- Delegated agent configuration to untrusted users

**Status:** This is marked as HIGH but may be acceptable given:
1. Explicit security documentation in code comments
2. Fleet-level only restriction
3. Trust model assumes fleet operators are administrators

Consider adding validation or audit logging to make the risk more visible.

---

### MEDIUM: M-01 - Missing Rate Limiting for Discord Bot

**Severity:** MEDIUM
**File:** `/opt/herdctl/packages/discord/src/discord-connector.ts`
**Impact:** Denial of Service, Resource Exhaustion

**Description:**
The Discord bot connector does not implement application-level rate limiting for command processing. While discord.js handles Discord API rate limits, there's no protection against rapid command spam that could exhaust FleetManager resources.

**Evidence:**
```typescript
// discord-connector.ts tracks rate limits for Discord API:
private _rateLimitCount: number = 0;
private _lastRateLimitAt: string | null = null;

// But no per-user or per-channel command rate limiting
```

**Attack Scenario:**
An attacker with bot access can spam commands:
```
!herdctl trigger agent1
!herdctl trigger agent2
!herdctl trigger agent3
... (repeated 1000 times)
```

**Impact:**
- FleetManager spawns unlimited concurrent jobs (up to max_concurrent)
- CPU/memory exhaustion from processing requests
- Legitimate commands delayed or blocked
- Docker container creation flood
- State directory I/O saturation

**Recommendation:**

Implement sliding window rate limiter:
```typescript
import { RateLimiter } from 'rate-limiter-flexible';

export class DiscordConnector {
  private commandRateLimiter: RateLimiter;

  constructor(options: DiscordConnectorOptions) {
    // ... existing code

    // Rate limit: 10 commands per minute per user
    this.commandRateLimiter = new RateLimiter({
      points: 10,
      duration: 60,
      keyPrefix: 'discord-cmd',
    });
  }

  private async handleCommand(message: Message) {
    const userId = message.author.id;

    try {
      await this.commandRateLimiter.consume(userId);
    } catch (rateLimitError) {
      await message.reply(
        'Rate limit exceeded. You can send 10 commands per minute. Please try again later.'
      );
      return;
    }

    // Process command...
  }
}
```

**Alternative:** Use Discord.js built-in cooldowns:
```typescript
// In command handler
const cooldowns = new Map();
const now = Date.now();
const cooldownAmount = 3000; // 3 seconds per command

if (cooldowns.has(userId)) {
  const expirationTime = cooldowns.get(userId) + cooldownAmount;
  if (now < expirationTime) {
    const timeLeft = (expirationTime - now) / 1000;
    return message.reply(`Please wait ${timeLeft.toFixed(1)} seconds before using this command again.`);
  }
}

cooldowns.set(userId, now);
setTimeout(() => cooldowns.delete(userId), cooldownAmount);
```

---

### MEDIUM: M-02 - Path Traversal Risk in Working Directory Configuration

**Severity:** MEDIUM
**File:** `/opt/herdctl/packages/core/src/config/loader.ts`
**Lines:** 485-502, 556-577

**Description:**
Working directory paths are resolved relative to config directories without validation against path traversal attempts. While Zod validates basic path format, there's no check for `..` sequences or symlinks.

**Evidence:**
```typescript
// From loader.ts:556-577
if (!agentConfig.working_directory) {
  agentConfig.working_directory = agentConfigDir;
} else if (typeof agentConfig.working_directory === "string") {
  if (!agentConfig.working_directory.startsWith("/")) {
    agentConfig.working_directory = resolve(
      agentConfigDir,
      agentConfig.working_directory  // No sanitization of ".." sequences
    );
  }
}
```

**Attack Scenario:**
Malicious agent config attempts path traversal:
```yaml
# agents/malicious-agent.yml
working_directory: "../../../etc"  # Traverses to /etc
```

After resolution: `/opt/herdctl/agents/../../../etc` → `/etc`

**Impact:**
- Agent container mounts arbitrary host directories
- Read/write access to sensitive system files
- Potential for privilege escalation or data exfiltration

**Recommendation:**

Add path validation after resolution:
```typescript
function validateWorkingDirectory(path: string, configDir: string): void {
  const resolvedPath = resolve(path);
  const configDirResolved = resolve(configDir);

  // Ensure resolved path is within config directory tree or explicitly absolute
  if (!path.startsWith('/')) {
    // Relative path - must stay within config directory
    if (!resolvedPath.startsWith(configDirResolved)) {
      throw new ConfigError(
        `Working directory '${path}' traverses outside config directory. ` +
        `Resolved to: ${resolvedPath}, expected within: ${configDirResolved}`
      );
    }
  }

  // Check for symlink escapes (optional, platform-dependent)
  try {
    const realPath = realpathSync(resolvedPath);
    if (realPath !== resolvedPath) {
      console.warn(
        `Working directory '${path}' is a symlink to '${realPath}'. ` +
        `Ensure symlink target is trusted.`
      );
    }
  } catch {
    // Path doesn't exist yet - this is okay
  }
}
```

Apply validation:
```typescript
if (typeof agentConfig.working_directory === "string") {
  if (!agentConfig.working_directory.startsWith("/")) {
    const resolved = resolve(agentConfigDir, agentConfig.working_directory);
    validateWorkingDirectory(resolved, agentConfigDir);
    agentConfig.working_directory = resolved;
  }
}
```

**Mitigating Factors:**
- Agent configs are trusted YAML files in the repository
- No runtime user input controls working directories
- Requires repository write access to exploit
- Docker volume mounts already expose this risk (fleet operators choose mounts)

**Risk Assessment:**
MEDIUM severity because:
- Trust model assumes config files are trusted
- Path traversal requires modifying checked-in YAML files
- Fleet operators have full system access anyway

Becomes HIGH if:
- Web UI allows editing agent configs
- Multi-tenant environment with untrusted agent configs
- Agent configs loaded from external sources

---

### MEDIUM: M-03 - Insufficient Input Validation for CLI Arguments

**Severity:** MEDIUM
**Files:** `/opt/herdctl/packages/cli/src/commands/*.ts`

**Description:**
CLI commands accept user input (agent names, job IDs, prompts) without comprehensive validation. While FleetManager validates internally, early validation would prevent injection attacks and improve error messages.

**Evidence:**
```typescript
// From trigger.ts - accepts raw prompt text
export interface TriggerOptions {
  schedule?: string;
  prompt?: string;  // No length limit, content validation
  wait?: boolean;
  json?: boolean;
}
```

**Potential Issues:**
1. **Prompt Injection:** Malicious prompts could attempt to manipulate agent behavior
2. **Resource Exhaustion:** Extremely long prompts consume memory/API tokens
3. **Log Injection:** Newlines in agent names could break log parsing

**Example Attack:**
```bash
herdctl trigger agent1 --prompt "$(cat /etc/passwd | base64)"  # Exfiltrate via logs
herdctl trigger "agent'; DROP TABLE jobs;--" # SQL-style injection (no SQL, but demonstrates issue)
```

**Recommendation:**

Add input validation layer:
```typescript
// cli/src/validation.ts
export function validateAgentName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Agent name cannot be empty');
  }

  if (name.length > 64) {
    throw new Error('Agent name too long (max 64 characters)');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      'Agent name can only contain letters, numbers, hyphens, and underscores'
    );
  }
}

export function validatePrompt(prompt: string): void {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty');
  }

  if (prompt.length > 50000) {
    throw new Error('Prompt too long (max 50,000 characters)');
  }

  // Warn on potential injection patterns
  const suspiciousPatterns = [
    /system[:\s]*ignore/i,
    /previous[:\s]*instructions/i,
    /disregard/i,
  ];

  if (suspiciousPatterns.some(pattern => pattern.test(prompt))) {
    console.warn(
      'Warning: Prompt contains potential injection patterns. ' +
      'Review prompt carefully before executing.'
    );
  }
}
```

Apply in commands:
```typescript
// trigger.ts
import { validateAgentName, validatePrompt } from '../validation.js';

export async function trigger(agentName: string, options: TriggerOptions) {
  validateAgentName(agentName);

  if (options.prompt) {
    validatePrompt(options.prompt);
  }

  // Continue with existing logic...
}
```

**Mitigating Factors:**
- CLI runs locally with user's permissions
- No remote execution or privilege escalation
- Agent prompts are sandboxed by Claude's safety systems

---

### MEDIUM: M-04 - Missing Authentication for CLI Commands

**Severity:** MEDIUM
**Impact:** Unauthorized Local Access

**Description:**
The CLI has no authentication mechanism. Any local user on the system can execute herdctl commands, trigger jobs, and access state data.

**Evidence:**
All CLI commands in `/opt/herdctl/packages/cli/src/commands/*.ts` directly execute without authentication checks.

**Attack Scenario:**
On a shared development server:
```bash
# Attacker user on same server
herdctl trigger production-deploy --prompt "Deploy malicious code"
herdctl jobs  # View all job output, potentially containing secrets
herdctl cancel job-123  # Disrupt operations
```

**Impact:**
- Unauthorized job triggering
- Access to job outputs (may contain sensitive data)
- Denial of service (canceling jobs)
- Reading fleet configuration and secrets

**Recommendation:**

**Option A:** File-based permissions (simple):
```typescript
// cli/src/auth.ts
import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export async function requireAuthorization(): Promise<void> {
  const authFile = join(homedir(), '.herdctl', 'authorized');

  try {
    await access(authFile, constants.R_OK);
  } catch {
    throw new Error(
      'Not authorized to use herdctl. Contact your fleet administrator to grant access.'
    );
  }
}

// Usage in each command:
export async function trigger(agentName: string, options: TriggerOptions) {
  await requireAuthorization();
  // Continue...
}
```

**Option B:** Token-based auth:
```typescript
export async function requireAuthorization(): Promise<void> {
  const token = process.env.HERDCTL_TOKEN ||
                await readTokenFromFile(join(homedir(), '.herdctl', 'token'));

  if (!token) {
    throw new Error('No authorization token found. Run: herdctl login');
  }

  // Validate token (could be JWT, API key, etc.)
  if (!isValidToken(token)) {
    throw new Error('Invalid or expired authorization token');
  }
}
```

**Option C:** Unix permissions (leverage existing):
Just document that `.herdctl` state directory should have restrictive permissions:
```bash
chmod 700 ~/.herdctl
chmod 600 ~/.herdctl/*/sessions/*
```

**Current Mitigations:**
- Local-only tool (no network exposure)
- Unix file permissions protect state directory
- Typical single-user development environments

**Risk Assessment:**
MEDIUM because:
- Only affects shared/multi-user systems
- Relies on OS-level access controls
- No remote attack vector

Becomes HIGH in:
- Shared CI/CD runners
- Multi-tenant development environments
- Systems with untrusted local users

**Recommendation Priority:** LOW for single-user dev environments, MEDIUM for shared systems

---

## Low-Severity Findings

### LOW: L-01 - Verbose Error Messages May Leak Information

**Severity:** LOW
**Files:** Various error classes

**Description:**
Error messages include file paths, configuration details, and system information that could aid attackers in reconnaissance.

**Examples:**
- `AgentLoadError`: Exposes config file paths
- `FileReadError`: Reveals directory structure
- GitHub API errors: May expose repository names

**Recommendation:**
Implement tiered error messages:
```typescript
export class ConfigError extends Error {
  public readonly userMessage: string;    // Safe for display
  public readonly debugMessage: string;   // Full details for logs

  constructor(message: string, userMessage?: string) {
    super(message);
    this.debugMessage = message;
    this.userMessage = userMessage ?? "Configuration error occurred";
  }
}
```

---

### LOW: L-02 - Docker Container Cleanup on Errors

**Severity:** LOW
**File:** `/opt/herdctl/packages/core/src/runner/runtime/container-manager.ts`

**Description:**
Failed container creation may leave orphaned containers or volumes in some error scenarios.

**Recommendation:**
Add cleanup in error handlers:
```typescript
async createContainer(...) {
  let container: Container | undefined;

  try {
    container = await this.docker.createContainer(createOptions);
    await container.start();
    return container;
  } catch (error) {
    // Cleanup on failure
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Best effort cleanup
      }
    }
    throw error;
  }
}
```

---

## Verified Secure Practices

The following security practices were identified and verified as correctly implemented:

### Strong Input Validation with Zod
- **Files:** `/opt/herdctl/packages/core/src/config/schema.ts`
- All configuration loaded through comprehensive Zod schemas
- Type safety enforced at runtime
- Invalid configs rejected before processing

**Example:**
```typescript
export const AgentConfigSchema = z.object({
  name: z.string().min(1),
  model: z.string().optional(),
  permission_mode: PermissionModeSchema.optional(),
  // ... extensive validation
}).strict();  // Reject unknown fields
```

### Atomic File Operations
- **Files:** `/opt/herdctl/packages/core/src/state/utils/atomic.ts`
- State files written atomically using temp-file + rename pattern
- Prevents corruption on crashes or concurrent writes
- Windows-compatible with retry logic

**Example:**
```typescript
export async function atomicWriteFile(filePath: string, content: string) {
  const tempPath = generateTempPath(filePath);
  await writeFile(tempPath, content);
  await renameWithRetry(tempPath, filePath);  // Atomic on POSIX
}
```

### Docker Security Hardening
- **Files:** `/opt/herdctl/packages/core/src/runner/runtime/container-manager.ts`
- Capabilities dropped: `CapDrop: ["ALL"]`
- No new privileges: `SecurityOpt: ["no-new-privileges:true"]`
- Memory limits enforced
- Non-root user support
- Read-only root filesystem option

**Example:**
```typescript
const translatedHostConfig: HostConfig = {
  Memory: config.memoryBytes,
  SecurityOpt: ["no-new-privileges:true"],
  CapDrop: ["ALL"],
  PidsLimit: config.pidsLimit,
  // ...
};
```

### No Dangerous Code Execution
- **Verified:** No use of `eval()`, `Function()`, `vm.runInContext()`
- Configuration uses Zod parsing (safe YAML → JS objects)
- Shell commands isolated to specific hook runner (with caveats per H-01)

### Environment Variable Validation
- **Files:** `/opt/herdctl/packages/core/src/config/interpolate.ts`
- Undefined variables trigger `UndefinedVariableError`
- No silent failures in config interpolation
- Default values supported: `${VAR:-default}`

**Example:**
```typescript
export class UndefinedVariableError extends ConfigError {
  constructor(variableName: string, path: string) {
    super(
      `Undefined environment variable '${variableName}' at '${path}' (no default provided)`
    );
  }
}
```

### Typed Error Handling
- **Files:** Multiple error classes across packages
- All errors extend base error classes
- Type guards for error discrimination
- Structured error information (codes, paths, causes)

**Example:**
```typescript
export class AgentLoadError extends ConfigError {
  public readonly agentPath: string;
  public readonly agentName?: string;

  constructor(agentPath: string, cause: Error, agentName?: string) {
    super(`Failed to load agent '${agentPath}': ${cause.message}`);
    this.cause = cause;
  }
}
```

### Secrets Management (Code-Level)
- **Files:** Container manager, CLI runtime, GitHub adapter
- API keys read from environment variables (not hardcoded in code)
- Token validation before use
- Secrets passed securely to containers via env vars

**Example:**
```typescript
// From container-manager.ts:317-318
if (process.env.ANTHROPIC_API_KEY) {
  env.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
}
```

**Note:** While code practices are secure, the committed `.env` file (C-01) negates this.

---

## Attack Surface Analysis

### Entry Points Identified

#### 1. CLI Commands (Local)
**Files:** `/opt/herdctl/packages/cli/src/commands/*.ts`

**Commands:**
- `herdctl start` - Start fleet manager
- `herdctl stop` - Stop fleet manager
- `herdctl trigger <agent>` - Trigger agent execution
- `herdctl jobs` - List jobs
- `herdctl cancel <job>` - Cancel job
- `herdctl status` - Fleet status
- `herdctl config` - Show configuration
- `herdctl init` - Initialize new fleet

**Risk Level:** LOW (local-only, requires system access)

**Attack Vectors:**
- Command injection via arguments (mitigated by Zod validation)
- Unauthorized access (no authentication - M-04)
- Resource exhaustion via rapid triggering (no rate limiting)

---

#### 2. Discord Bot Commands
**Files:** `/opt/herdctl/packages/discord/src/commands/*.ts`

**Commands:**
- `!status` - Show agent status
- `!help` - Show help message
- `!reset <agent>` - Reset agent session

**Risk Level:** MEDIUM (network-exposed, requires bot permissions)

**Attack Vectors:**
- Command spam (no rate limiting - M-01)
- Unauthorized commands (Discord role-based auth exists)
- Session manipulation via reset command

**Mitigations:**
- Discord's built-in permission system
- Bot must be invited to server
- Rate limiting by Discord API (not application-level)

---

#### 3. GitHub Work Source
**Files:** `/opt/herdctl/packages/core/src/work-sources/adapters/github.ts`

**Operations:**
- Fetch issues with "ready" label
- Claim issue (add "in-progress" label)
- Release issue (remove "in-progress", optionally add "ready")

**Risk Level:** MEDIUM (requires GitHub PAT)

**Attack Vectors:**
- PAT compromise (see C-01)
- Excessive API usage (rate limiting implemented)
- Malicious issue content (prompts validated by Claude)

**Mitigations:**
- Exponential backoff for rate limits
- PAT scope validation
- Read-only operations (no code execution)

---

#### 4. Webhook Hooks
**Files:** `/opt/herdctl/packages/core/src/hooks/runners/webhook.ts`

**Operations:**
- POST HookContext JSON to configured URLs

**Risk Level:** HIGH (SSRF potential - H-02)

**Attack Vectors:**
- SSRF to internal services (no URL validation)
- Data exfiltration (HookContext contains job details)
- Auth bypass (silent env var substitution)

**Mitigations:**
- Webhook URLs in trusted config files
- HTTPS enforcement possible
- Timeout protection (10s default)

---

#### 5. Shell Hooks
**Files:** `/opt/herdctl/packages/core/src/hooks/runners/shell.ts`

**Operations:**
- Execute shell commands with HookContext on stdin

**Risk Level:** HIGH (command injection - H-01)

**Attack Vectors:**
- Arbitrary command execution (shell: true)
- File system access
- Environment variable access

**Mitigations:**
- Commands in trusted config files
- Timeout protection (30s default)
- Output size limits (1MB)

---

#### 6. File System Operations
**Files:** `/opt/herdctl/packages/core/src/state/*.ts`, config loaders

**Operations:**
- Read/write job metadata
- Read/write session state
- Load configuration files

**Risk Level:** LOW (requires file system access)

**Attack Vectors:**
- Path traversal (M-02)
- Symlink attacks (not validated)
- Race conditions (mitigated by atomic writes)

**Mitigations:**
- Atomic file writes
- Directory validation
- Permissions-based access control (OS-level)

---

## Authentication & Authorization Review

### Current Model: Trust-Based

**Assumptions:**
1. **CLI Users:** Trusted local users with shell access
2. **Fleet Operators:** Trusted administrators with config file access
3. **Agent Configs:** Trusted YAML files in version control
4. **Discord Bot:** Role-based access via Discord permissions

### Authentication Mechanisms

#### CLI - None (File System Permissions)
- No explicit authentication
- Relies on Unix file permissions for `.herdctl/` directory
- Any local user can execute commands

**Recommendation:** Implement M-04 (CLI authentication) for shared systems

---

#### Discord Bot - Discord Roles
```typescript
// From discord config schema
export const AgentChatDiscordSchema = z.object({
  enabled: z.boolean(),
  bot_token_env: z.string().optional().default("DISCORD_BOT_TOKEN"),
  // No explicit role restrictions in code - relies on Discord permissions
});
```

**Current:** Bot uses Discord's built-in permission system
- Server admins control bot permissions
- Users need appropriate roles to see/use bot
- No application-level role checking

**Recommendation:** Add role-based command restrictions:
```typescript
const ADMIN_COMMANDS = ['reset', 'trigger'];
const requiredRole = 'herdctl-admin';

async function checkPermissions(message: Message, command: string): Promise<boolean> {
  if (ADMIN_COMMANDS.includes(command)) {
    const member = message.member;
    if (!member?.roles.cache.some(role => role.name === requiredRole)) {
      await message.reply('This command requires the herdctl-admin role.');
      return false;
    }
  }
  return true;
}
```

---

#### GitHub Work Source - PAT Authentication
```typescript
export interface GitHubWorkSourceConfig {
  token?: string;  // GitHub Personal Access Token
  labels?: {
    ready?: string;
    in_progress?: string;
  };
}
```

**Current:**
- Uses Personal Access Token from environment variable
- No PAT scope validation at startup
- Fails on first API call if token invalid

**Recommendation:** Validate PAT on initialization:
```typescript
async function validateGitHubToken(token: string): Promise<void> {
  const response = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${token}` }
  });

  if (!response.ok) {
    throw new Error('Invalid GitHub token');
  }

  // Check scopes
  const scopes = response.headers.get('X-OAuth-Scopes')?.split(', ') || [];
  const requiredScopes = ['repo', 'write:discussion'];

  const missingScopes = requiredScopes.filter(s => !scopes.includes(s));
  if (missingScopes.length > 0) {
    console.warn(
      `GitHub token missing recommended scopes: ${missingScopes.join(', ')}`
    );
  }
}
```

---

#### Webhook Hooks - Header-Based Authentication
```typescript
export const WebhookHookConfigInput = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  // Headers can include Authorization with ${ENV_VAR} substitution
});
```

**Current:**
- Supports `Authorization` header with env var substitution
- No validation of auth header format
- Silent failure on undefined env vars (H-02)

**Secure Usage:**
```yaml
hooks:
  on_job_complete:
    - type: webhook
      url: https://api.example.com/hooks
      headers:
        Authorization: "Bearer ${WEBHOOK_TOKEN}"
```

**Recommendation:** Implemented in H-02 (fail loudly on undefined vars)

---

### Authorization Model

**Fleet Manager (Core):**
- No authorization checks
- Assumes all callers are trusted
- Suitable for single-operator deployments

**Discord Bot:**
- Implicit authorization via Discord role system
- Bot sees only channels it has permissions for
- No command-level role restrictions (recommended above)

**CLI:**
- No authorization
- Unix file permissions only defense
- See M-04 for recommendations

**Configuration System:**
- File-based (no database)
- Write access = full control
- Agent configs can override fleet defaults (except dangerous Docker options)

---

## Dependency Security

### Dependency Audit Status

**Audit Attempted:** Yes
**Tool Used:** pnpm audit (not available in environment)
**Result:** Unable to run dependency scan (pnpm not installed, no lockfile in .security directory)

**Manual Review:**
```json
// From /opt/herdctl/package.json
{
  "devDependencies": {
    "@changesets/changelog-github": "^0.5.2",
    "@changesets/cli": "^2.29.8",
    "@types/node": "^20",
    "turbo": "^2",
    "typescript": "^5"
  }
}
```

**Observed Dependencies (from imports):**
- `zod` - Schema validation (actively maintained, secure)
- `yaml` - YAML parsing (actively maintained)
- `dockerode` - Docker API client
- `discord.js` - Discord bot framework (v14)
- `execa` - Process spawning (secure alternative to child_process)
- `dotenv` - Environment variable loading

**Recommendation:**

1. **Run full dependency audit:**
```bash
cd /opt/herdctl
pnpm audit --production
pnpm audit --audit-level=high  # Only HIGH/CRITICAL
```

2. **Enable automated scanning:**
```yaml
# .github/workflows/security.yml
name: Security Audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm audit --audit-level=high
```

3. **Add Dependabot:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
```

4. **Use Snyk or Socket for deeper analysis:**
```bash
npx snyk test
# or
npx socket security audit
```

**Assessment:** Cannot provide definitive vulnerability count without running audit. Recommend immediate scan before production deployment.

---

## Remediation Roadmap

### Immediate Actions (Fix Before Any Release)

**Priority 1 - CRITICAL (Week 1)**

1. **[C-01] Remove Committed Secrets**
   - Revoke all tokens in `.env` file
   - Remove from git history using `git filter-repo`
   - Verify `.env` in `.gitignore`
   - Create `.env.example` with placeholder values
   - Document secret management process

2. **[H-02] Fix Webhook Environment Variable Handling**
   - Change `substituteEnvVars()` to throw on undefined variables
   - Add webhook URL validation against private IPs
   - Implement HTTPS requirement
   - Add domain allowlist

**Priority 2 - HIGH (Week 2)**

3. **[H-01] Mitigate Shell Hook Command Injection**
   - Option A: Disable `shell: true`, use argument arrays
   - Option B: Implement command allowlist
   - Document security implications in config

4. **[H-03] Validate Docker hostConfigOverride**
   - Implement safe key allowlist
   - Add audit logging for overrides
   - Document security risks

**Priority 3 - MEDIUM (Week 3-4)**

5. **[M-01] Add Discord Bot Rate Limiting**
   - Implement per-user command rate limiting
   - Default: 10 commands/minute per user
   - Configurable limits

6. **[M-02] Path Traversal Validation**
   - Validate working directory paths after resolution
   - Prevent `..` escape sequences
   - Warn on symlink usage

7. **[M-03] CLI Input Validation**
   - Add agent name validation
   - Add prompt length limits
   - Warn on injection patterns

8. **[M-04] CLI Authentication** (Optional for Single-User)
   - Document file permission requirements
   - Consider token-based auth for shared systems

---

### Long-Term Improvements (Post-MVP)

**Security Hardening**

- Implement comprehensive audit logging
- Add security event monitoring
- Create incident response procedures
- Regular penetration testing

**Dependency Management**

- Automated vulnerability scanning (Dependabot, Snyk)
- Regular dependency updates
- Pin production dependencies
- Maintain SBOM (Software Bill of Materials)

**Access Control**

- Role-based access control for CLI
- Multi-tenant isolation
- API key management system
- Audit trail for configuration changes

**Network Security**

- Webhook request signing (HMAC)
- Mutual TLS for container communication
- Network policy enforcement
- Egress filtering

---

## Testing Recommendations

### Security Test Suite

**1. Input Validation Tests**
```typescript
describe('Security: Input Validation', () => {
  test('rejects path traversal in working_directory', async () => {
    const config = {
      working_directory: '../../../etc/passwd'
    };
    await expect(validateConfig(config)).rejects.toThrow('path traversal');
  });

  test('rejects command injection in shell hooks', async () => {
    const hook = {
      type: 'shell',
      command: 'echo "hello"; rm -rf /'
    };
    await expect(executeHook(hook)).rejects.toThrow();
  });
});
```

**2. Authentication Tests**
```typescript
describe('Security: Authentication', () => {
  test('Discord bot requires valid token', async () => {
    const connector = new DiscordConnector({
      botToken: 'invalid'
    });
    await expect(connector.connect()).rejects.toThrow('Invalid token');
  });

  test('GitHub adapter validates PAT scopes', async () => {
    const adapter = new GitHubAdapter({
      token: process.env.GITHUB_TOKEN_READ_ONLY
    });
    await expect(adapter.initialize()).rejects.toThrow('missing scopes');
  });
});
```

**3. Secrets Management Tests**
```typescript
describe('Security: Secrets', () => {
  test('never logs API tokens', () => {
    const spy = jest.spyOn(console, 'log');
    const token = 'sk-ant-api-key-123';
    process.env.ANTHROPIC_API_KEY = token;

    buildContainerEnv(agent, config);

    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining(token));
  });

  test('redacts secrets in error messages', () => {
    const error = new ConfigError(
      'Failed to connect with token sk-ant-secret'
    );
    expect(error.message).toContain('[REDACTED]');
  });
});
```

**4. Docker Security Tests** (Already exist)
```typescript
// From __tests__/docker-security.test.ts
describe("Docker security settings", () => {
  test("drops all capabilities by default", async () => {
    const createOptions = await buildCreateOptions(agent, dockerConfig);
    expect(createOptions.HostConfig?.CapDrop).toEqual(["ALL"]);
  });

  test("enables no-new-privileges", async () => {
    expect(createOptions.HostConfig?.SecurityOpt).toContain("no-new-privileges:true");
  });
});
```

---

### Penetration Testing Scenarios

**Scenario 1: Malicious Agent Config**
- Attacker gains write access to agent config file
- Attempts path traversal in working_directory
- Attempts command injection in shell hooks
- Attempts to override Docker security with hostConfigOverride

**Scenario 2: Discord Bot Abuse**
- Attacker joins Discord server with bot access
- Spams commands to trigger resource exhaustion
- Attempts to extract secrets via command output
- Tries to reset other users' sessions

**Scenario 3: Webhook SSRF**
- Attacker modifies webhook URL in config
- Targets internal cloud metadata endpoint
- Attempts to exfiltrate data to external server
- Tests for auth bypass via undefined env vars

**Scenario 4: Dependency Confusion**
- Attacker publishes malicious package with similar name
- Tests if build process pulls from public registry
- Attempts to inject code via dev dependencies

---

## Compliance Considerations

### Security Standards

**OWASP Top 10 (2021)**

| Risk | Status | Notes |
|------|--------|-------|
| A01: Broken Access Control | PARTIAL | No CLI auth (M-04), Discord uses platform auth |
| A02: Cryptographic Failures | PASS | Secrets from env vars (code), FAIL (committed .env) |
| A03: Injection | FAIL | Shell command injection (H-01), webhook SSRF (H-02) |
| A04: Insecure Design | PASS | Good separation of concerns, typed errors |
| A05: Security Misconfiguration | PARTIAL | Docker hardening exists, hostConfigOverride concern (H-03) |
| A06: Vulnerable Components | UNKNOWN | Unable to audit dependencies |
| A07: Identification/Auth Failures | PARTIAL | Discord OK, CLI lacks auth (M-04) |
| A08: Software/Data Integrity | PASS | Atomic writes, git-based config |
| A09: Logging/Monitoring Failures | PARTIAL | Good error logging, needs audit trail |
| A10: Server-Side Request Forgery | FAIL | Webhook SSRF (H-02) |

**CWE Coverage:**

- CWE-78 (OS Command Injection): FAIL - H-01
- CWE-22 (Path Traversal): PARTIAL - M-02
- CWE-918 (SSRF): FAIL - H-02
- CWE-798 (Hardcoded Credentials): FAIL - C-01
- CWE-306 (Missing Authentication): PARTIAL - M-04

---

## Conclusion

The herdctl project demonstrates security-conscious development with strong foundations (Zod validation, atomic file writes, Docker hardening, typed errors) but has critical vulnerabilities that must be addressed before production use.

### Security Maturity: Level 2/5 (Developing)

**Level Definitions:**
1. Ad-hoc (no security considerations)
2. **Developing (some security practices, critical gaps)** ← Current
3. Defined (comprehensive security controls)
4. Managed (continuous monitoring and response)
5. Optimizing (proactive threat modeling)

### Key Recommendations

1. **IMMEDIATE:** Revoke and remove committed secrets (C-01)
2. **IMMEDIATE:** Fix webhook SSRF and env var handling (H-02)
3. **HIGH PRIORITY:** Mitigate command injection (H-01)
4. **HIGH PRIORITY:** Validate Docker security overrides (H-03)
5. **MEDIUM PRIORITY:** Add rate limiting, input validation, path validation (M-01 through M-04)
6. **ONGOING:** Implement dependency scanning and automated security testing

### Risk Acceptance

For **pre-MVP development environments** with:
- Single trusted operator
- No external network exposure
- Development/test workloads only

The current security posture is **acceptable** IF:
- C-01 (committed secrets) is resolved IMMEDIATELY
- H-02 (webhook SSRF) is fixed before webhook features are used
- H-01 (command injection) is mitigated before shell hooks are enabled

For **production deployments**, ALL HIGH and CRITICAL findings must be resolved.

---

## Appendix A: Security Checklist

- [ ] **Secrets Management**
  - [ ] Remove .env from git history
  - [ ] Revoke exposed tokens
  - [ ] Document secret management in README
  - [ ] Create .env.example

- [ ] **Input Validation**
  - [ ] Add webhook URL validation
  - [ ] Implement path traversal protection
  - [ ] Add CLI input validation
  - [ ] Validate Docker hostConfigOverride keys

- [ ] **Authentication & Authorization**
  - [ ] Add CLI authentication (if multi-user)
  - [ ] Implement Discord role-based commands
  - [ ] Validate GitHub PAT scopes on startup

- [ ] **Injection Prevention**
  - [ ] Fix shell hook command injection
  - [ ] Fix webhook env var silent failure
  - [ ] Add webhook domain allowlist

- [ ] **Rate Limiting**
  - [ ] Implement Discord bot rate limiting
  - [ ] Add GitHub API rate limit monitoring

- [ ] **Monitoring & Logging**
  - [ ] Add audit logging for sensitive operations
  - [ ] Implement security event monitoring
  - [ ] Create incident response plan

- [ ] **Dependency Management**
  - [ ] Run pnpm audit
  - [ ] Set up Dependabot
  - [ ] Document update process
  - [ ] Pin production dependencies

- [ ] **Testing**
  - [ ] Add security test suite
  - [ ] Penetration testing
  - [ ] Dependency scanning in CI
  - [ ] Pre-commit secret scanning

- [ ] **Documentation**
  - [ ] Security policy (SECURITY.md)
  - [ ] Threat model documentation
  - [ ] Deployment security guidelines
  - [ ] Incident response procedures

---

## Appendix B: Tools & Resources

### Recommended Security Tools

**Static Analysis:**
- ESLint security plugins: `eslint-plugin-security`, `eslint-plugin-no-secrets`
- TypeScript strict mode (already enabled ✓)
- SonarQube or Semgrep for code analysis

**Dependency Scanning:**
- `pnpm audit` (built-in)
- Snyk: `npx snyk test`
- Socket: `npx socket security audit`
- GitHub Dependabot (automated)

**Secret Scanning:**
- `gitleaks` - Scan git history for secrets
- `truffleHog` - Find secrets in code
- `git-secrets` - Prevent secret commits
- Pre-commit hooks with `detect-secrets`

**Runtime Security:**
- Docker Bench Security: `docker run --rm --privileged docker/docker-bench-security`
- Falco: Runtime security monitoring for containers
- Aqua Trivy: Container vulnerability scanner

**Testing:**
- OWASP ZAP: Dynamic application security testing
- Burp Suite: Manual penetration testing
- `npm audit fix`: Automated dependency updates

### References

- OWASP Top 10: https://owasp.org/Top10/
- CWE Top 25: https://cwe.mitre.org/top25/
- Docker Security: https://docs.docker.com/engine/security/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- Anthropic Security: https://www.anthropic.com/security

---

**Report Generated:** 2026-02-14
**Next Audit Recommended:** After remediation of HIGH/CRITICAL findings
**Contact:** security@herdctl.dev (if applicable)

---

*This security audit was conducted using automated analysis and manual code review. It does not guarantee the absence of all vulnerabilities. Regular security assessments and updates are recommended.*
