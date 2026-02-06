# Threat Vectors Analysis

**Analysis Date:** 2026-02-05

## Executive Summary

**Threat landscape:** herdctl is an AI agent orchestration system that spawns Claude Code agents in Docker containers. The primary threats involve configuration-based attacks, container escape, and prompt injection through various input channels.

**Highest residual risks:**
1. **host_config passthrough** - HIGH - Documented bypass allows user to disable all container security
2. **Prompt injection** - MEDIUM - Multiple channels (config, Discord, CLI) feed prompts without content filtering
3. **Shell hooks** - MEDIUM - User-defined commands execute with full host privileges

## T1: Malicious Fleet Configuration

**Attack**: Attacker crafts fleet.yaml to escape intended boundaries

**Vectors**:

1. **Path traversal in agent name** -> MITIGATED (Schema + path-safety)
   - **File**: `packages/core/src/config/schema.ts:715-722`
   - **Attack**: Use `../` or absolute paths in agent name to write files outside .herdctl/
   - **Mitigation**: `AGENT_NAME_PATTERN` restricts to `[a-zA-Z0-9][a-zA-Z0-9_-]*`, `buildSafeFilePath()` verifies result stays in base directory

2. **Docker privilege escalation via host_config** -> ACCEPTED RISK
   - **File**: `packages/core/src/config/schema.ts:309-314`
   - **Attack**: Set `host_config.Privileged: true` or `host_config.CapDrop: []`
   - **Mitigation**: Documented as advanced feature, fleet-level only, user explicitly opts in

3. **Volume mount to sensitive host paths** -> PARTIAL (Format validated, not content)
   - **File**: `packages/core/src/config/schema.ts:279-346`
   - **Attack**: Mount `/`, `/etc`, `/root`, etc. to container
   - **Mitigation**: Only format validated, user could still mount dangerous paths

4. **bypassPermissions mode abuse** -> ACCEPTED RISK
   - **File**: `packages/core/src/config/schema.ts:14-21`
   - **Attack**: Enable bypassPermissions to skip Claude safety checks
   - **Mitigation**: Intentional feature for automation, user explicitly enables

**Residual risk**: MEDIUM - Defensive controls exist for critical paths. Accepted risks are documented and require explicit user configuration.

## T2: Agent-to-Host Escape

**Attack**: Compromised agent code attempts to affect host system

**Vectors**:

1. **Container escape via Docker vulnerability** -> PARTIAL (Hardening applied, not guaranteed)
   - **File**: `packages/core/src/runner/runtime/container-manager.ts:124-127`
   - **Attack**: Exploit Docker daemon vulnerability to escape container
   - **Mitigation**: Default hardening (CapDrop ALL, no-new-privileges), but Docker itself could have vulns

2. **Shared volume abuse** -> PARTIAL (User controls mounts)
   - **File**: `packages/core/src/config/schema.ts:279` (volumes array)
   - **Attack**: Write malicious files to mounted host directories
   - **Mitigation**: Workspace is mounted rw by default, additional volumes require explicit config

3. **Network exfiltration** -> UNMITIGATED (Intentional - agents need network)
   - **File**: `packages/core/src/config/schema.ts:265` (network: bridge default)
   - **Attack**: Agent sends data to external servers
   - **Mitigation**: None - agents need network for Anthropic API. This is expected behavior.

4. **Resource exhaustion (DoS)** -> PARTIAL (Memory limited, CPU shares)
   - **File**: `packages/core/src/config/schema.ts:267-271`
   - **Attack**: Agent spawns processes or allocates memory to exhaust host
   - **Mitigation**: Memory limit (default 2g), cpu_shares, pids_limit (optional)

**Residual risk**: MEDIUM - Container hardening reduces risk but doesn't eliminate it. Network access is intentional and expected.

## T3: State File Manipulation

**Attack**: Attacker modifies .herdctl/ state files to influence behavior

**Vectors**:

1. **Inject malicious session state** -> PARTIAL (JSON parsing, no signature)
   - **File**: `packages/core/src/state/session.ts`
   - **Attack**: Modify `.herdctl/sessions/{agent}.json` to inject state
   - **Mitigation**: Standard JSON.parse, file permissions on .herdctl/

2. **Corrupt job metadata** -> PARTIAL (YAML parsing, no signature)
   - **File**: `packages/core/src/fleet-manager/job-control.ts:627`
   - **Attack**: Modify `.herdctl/jobs/{jobId}/metadata.yaml`
   - **Mitigation**: Standard yaml.parse, file permissions

3. **History manipulation** -> LOW IMPACT
   - **File**: `.herdctl/` directory
   - **Attack**: Delete or modify job history
   - **Mitigation**: None, but impact is limited to hiding past activity

**Residual risk**: LOW - Attacker needs file system access to .herdctl/. If they have that, they can already run herdctl commands.

## T4: Prompt Injection

**Attack**: Malicious prompts alter agent behavior beyond intended scope

**Vectors**:

1. **Via task prompts in config** -> ACCEPTED RISK (Intentional)
   - **File**: `packages/core/src/config/schema.ts:729` (default_prompt)
   - **Attack**: Craft prompt to override system instructions
   - **Mitigation**: None - prompts are user-controlled by design

2. **Via Discord messages** -> PARTIAL (Channel filtering, no content filtering)
   - **File**: `packages/core/src/fleet-manager/discord-manager.ts`
   - **Attack**: Send malicious message from allowed channel
   - **Mitigation**: Channel/DM allowlist, mode (mention vs auto)

3. **Via CLI trigger --prompt** -> ACCEPTED RISK (User's own machine)
   - **File**: `packages/cli/src/commands/trigger.ts:154`
   - **Attack**: Inject prompt via command line
   - **Mitigation**: None needed - user is running their own commands

4. **Via GitHub issues** -> PARTIAL (Label filtering, issue content unfiltered)
   - **File**: `packages/core/src/work-sources/adapters/github.ts`
   - **Attack**: Create issue with malicious content in title/body
   - **Mitigation**: Label-based filtering for which issues to process

**Residual risk**: MEDIUM - Prompt injection is inherent to LLM systems. herdctl provides channel filtering but no content filtering. Users must trust sources of prompts.

## T5: Supply Chain

**Attack**: Compromise via dependencies or external services

**Vectors**:

1. **Dependency vulnerabilities (npm packages)** -> PARTIAL (Dependabot)
   - **Attack**: Vulnerable npm package is exploited
   - **Mitigation**: Dependabot enabled for security alerts

2. **Claude SDK compromise** -> UNMITIGATED (External trust)
   - **Attack**: Malicious code in @anthropic-ai/claude-code package
   - **Mitigation**: None - must trust Anthropic's npm package

3. **js-yaml vulnerabilities** -> PARTIAL (Using safe loading)
   - **File**: `packages/core/src/config/loader.ts`
   - **Attack**: YAML deserialization vulnerability
   - **Mitigation**: js-yaml default settings (safe load)

4. **Docker image vulnerabilities** -> PARTIAL (User controls image)
   - **File**: `packages/core/src/config/schema.ts:262` (image field)
   - **Attack**: Malicious base image with backdoors
   - **Mitigation**: Default to official anthropic/claude-code image, user can override

5. **dockerode vulnerabilities** -> PARTIAL (Dependabot)
   - **Attack**: Vulnerability in Docker API client library
   - **Mitigation**: Dependabot monitoring, standard npm audit

**Residual risk**: MEDIUM - Supply chain is inherently difficult to fully secure. Key mitigations are Dependabot and using trusted packages.

## Accepted Risks Summary

| Risk | Why Accepted | Mitigation Approach |
|------|--------------|---------------------|
| host_config passthrough | Advanced users need Docker control | Documented, fleet-level only |
| bypassPermissions mode | Automation requires permission bypass | Explicit opt-in via config |
| Shell hooks | Users need custom automation | User defines own commands |
| Network access | Agents must call Anthropic API | Cannot disable without breaking core function |
| Prompt injection via config | Users control their own prompts | User responsibility |
| Volume mounts | Users need to share directories | Format validated, fleet-level only |

## Threat Matrix

| Threat | Likelihood | Impact | Residual Risk | Priority |
|--------|------------|--------|---------------|----------|
| T1: Config attacks | MEDIUM | HIGH | MEDIUM | 2 |
| T2: Container escape | LOW | HIGH | MEDIUM | 3 |
| T3: State manipulation | LOW | LOW | LOW | 5 |
| T4: Prompt injection | HIGH | MEDIUM | MEDIUM | 1 |
| T5: Supply chain | LOW | HIGH | MEDIUM | 4 |

**Priority explanation:**
1. **T4 (Prompt injection)**: High likelihood, multiple entry points, inherent LLM risk
2. **T1 (Config attacks)**: Good controls exist, but host_config bypass is powerful
3. **T2 (Container escape)**: Low likelihood with hardening, but high impact
4. **T5 (Supply chain)**: Low likelihood, standard mitigation (Dependabot)
5. **T3 (State manipulation)**: Requires prior access, limited impact

---

## Key Defensive Recommendations

1. **Document host_config risks prominently** - Users need to understand this bypasses all container security
2. **Consider content filtering for Discord** - Rate limiting, length limits, or moderation
3. **Add integrity checking for state files** - Detect tampering with .herdctl/ contents
4. **Consider webhook signature requirement** - Make secret_env mandatory or default

---

*Threat vector analysis: 2026-02-05*
