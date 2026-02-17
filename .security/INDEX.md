# Security Audit Index

**Generated:** 2026-02-13
**Audit Status:** ✅ COMPLETE
**Overall Risk:** 🟡 YELLOW

---

## 📊 Audit Metrics

| Metric | Count | Details |
|--------|-------|---------|
| **Entry Points** | 45+ | Configuration, CLI, filesystem, network, subprocess, environment |
| **Trust Boundaries** | 6 | User input → config, config → fleet manager, fleet → agents, etc. |
| **Security Controls** | 35+ | Validation patterns, path safety, container hardening, permissions |
| **Data Flows Traced** | 10 | All flows from untrusted input to sensitive operations |
| **Threat Vectors** | 21 | Analyzed across 5 categories (config, escape, state, prompt, supply chain) |
| **Critical Issues** | 0 | ✅ None found |
| **High Risks** | 1 | ⚠️ host_config bypass (accepted by design) |
| **Medium Risks** | 10 | ⚠️ Shell hooks, prompt injection, volume mounts, etc. |
| **Low Risks** | 10 | ✅ All mitigated |

---

## 🎯 Risk Summary

### Overall Posture: 🟡 YELLOW
- **Definition:** Moderate risk with documented controls and accepted design decisions
- **Key Strengths:** Path traversal defenses, container hardening, input validation
- **Key Concerns:** Configuration-driven trust model, fleet admin privileges
- **Recommendation:** Maintain current security posture, implement audit logging

### Risk Breakdown

```
Critical: ████████████████████ 0  (0%)
High:     ████████████████████ 1  (5%)
Medium:   ████████████████████ 10 (48%)
Low:      ████████████████████ 10 (47%)
```

---

## 📁 Document Index

### Executive Documents
- **[README.md](./README.md)** - Directory overview and quick reference
- **[AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md)** - Executive summary of security audit
- **[INDEX.md](./INDEX.md)** - This file (audit index and metrics)

### Codebase Mapping (`.security/codebase-map/`)
- **[ATTACK-SURFACE.md](./codebase-map/ATTACK-SURFACE.md)** - 600 lines
  - 45+ entry points identified and documented
  - 6 trust boundaries mapped with crossing details
  - Attack vectors categorized by type
  - Defense summary and gap analysis

- **[SECURITY-CONTROLS.md](./codebase-map/SECURITY-CONTROLS.md)** - 383 lines
  - 12+ input validation patterns (Zod schemas)
  - Path safety utilities and their usage
  - Container hardening mechanisms
  - Permission controls and two-tier privilege model
  - Secret handling approaches
  - Logging and audit capabilities

- **[DATA-FLOWS.md](./codebase-map/DATA-FLOWS.md)** - 622 lines
  - 10 major data flows traced from source to sink
  - Validation points identified for each flow
  - Risk assessment (HIGH/MEDIUM/LOW)
  - Gaps documented with recommendations
  - Defense inventory cross-referenced

- **[THREAT-VECTORS.md](./codebase-map/THREAT-VECTORS.md)** - 465 lines
  - 21 threat vectors across 5 categories
  - Each threat includes: description, mitigation, residual risk
  - Threat matrix (likelihood × impact)
  - Accepted risks documented with rationale
  - Prioritized list by risk level

---

## 🔍 Key Findings

### ✅ Strengths

1. **Defense-in-Depth for Path Traversal**
   - `AGENT_NAME_PATTERN` regex validation
   - `buildSafeFilePath()` runtime checking
   - Path resolution verification
   - **Result:** No path traversal vulnerabilities found

2. **Strong Container Security Defaults**
   - `no-new-privileges:true`
   - `CapDrop: ["ALL"]`
   - Non-root user by default
   - Memory and PID limits
   - **Result:** Solid container isolation

3. **Comprehensive Input Validation**
   - Zod schemas for all config inputs
   - `.strict()` mode rejects unknown fields
   - Type coercion and format validation
   - **Result:** Config injection attacks prevented

4. **Secret Handling Best Practices**
   - API keys never in config files
   - Environment variable only
   - Config uses `${VAR}` references
   - **Result:** Secrets not committed to VCS

5. **Safe YAML Parsing**
   - Modern `yaml` package (not `js-yaml`)
   - No custom type handlers
   - Parse error handling with line/column info
   - **Result:** No deserialization vulnerabilities

### ⚠️ Moderate Risks (Accepted by Design)

1. **host_config Passthrough (HIGH)**
   - Fleet operators can override Docker security defaults
   - **Rationale:** Advanced configuration flexibility
   - **Mitigation:** Fleet-level only, well-documented
   - **Status:** Accepted per operator trust model

2. **Shell Hooks (MEDIUM)**
   - Arbitrary command execution via config
   - **Rationale:** Custom integration flexibility
   - **Mitigation:** Config file access required
   - **Status:** Accepted per operator trust model

3. **Prompt Injection (MEDIUM)**
   - No content validation on prompts
   - **Rationale:** Prompts are free-form by nature
   - **Mitigation:** Relies on Claude's defenses
   - **Status:** Accepted (external layer)

4. **Volume Mounts (MEDIUM)**
   - Fleet admins can mount any host path
   - **Rationale:** Workspace access required
   - **Mitigation:** Fleet-level only, format validated
   - **Status:** Accepted per operator trust model

5. **Dependency Vulnerabilities (MEDIUM)**
   - No automated scanning in CI
   - **Rationale:** Manual process currently
   - **Mitigation:** OIDC provenance, manual audits
   - **Status:** Improvement recommended

---

## 🎯 Recommendations

### High Priority (1-2 weeks)

1. **Add persistent audit logging**
   - Log shell hook executions with full commands
   - Log Docker container creations with security config
   - Log configuration reloads and changes
   - Enable forensic investigation

2. **Document trust model clearly**
   - Update README.md with security model
   - Clarify fleet operator vs agent config separation
   - Document host_config risks and use cases
   - Provide secure configuration examples

3. **Integrate automated dependency scanning**
   - Add `npm audit` to CI pipeline
   - Configure automated security advisories
   - Verify lock file integrity in CI
   - Set up Dependabot or similar

### Medium Priority (1 month)

4. **Add warnings for dangerous configs**
   - Detect volume mounts to sensitive paths
   - Warn on host_config overrides that weaken security
   - Alert on `network: host` usage
   - Log warnings without blocking

5. **Implement state file integrity checks**
   - Optional HMAC verification for session files
   - Detect tampering of job metadata
   - Enable via opt-in config flag
   - Document security benefits

6. **Add secret rotation support**
   - API key refresh workflow design
   - Token expiration handling
   - Document secret management best practices
   - Consider integration with secret managers

### Low Priority (3 months)

7. **MCP server security hardening**
   - Validate command paths before implementation
   - Restrict arguments for shell safety
   - Document MCP security model
   - Implement before feature launch

8. **Docker image validation**
   - Add image reference format checking
   - Warn on `latest` tags in production
   - Support digest pinning
   - Document image trust model

---

## 📂 Source Files Analyzed

### Configuration & Validation
- `packages/core/src/config/loader.ts` - Configuration loading and merging
- `packages/core/src/config/parser.ts` - YAML parsing and schema validation
- `packages/core/src/config/schema.ts` - Zod schema definitions (700+ lines)
- `packages/core/src/config/interpolate.ts` - Environment variable interpolation

### State Management
- `packages/core/src/state/session.ts` - Session CRUD operations
- `packages/core/src/state/job-metadata.ts` - Job metadata persistence
- `packages/core/src/state/job-output.ts` - Job output logging (JSONL)
- `packages/core/src/state/fleet-state.ts` - Fleet-level state
- `packages/core/src/state/utils/path-safety.ts` - Path traversal defenses

### Runtime & Execution
- `packages/core/src/runner/job-executor.ts` - Job execution orchestration
- `packages/core/src/runner/runtime/sdk-runtime.ts` - Claude SDK integration
- `packages/core/src/runner/runtime/cli-runtime.ts` - Claude CLI integration
- `packages/core/src/runner/runtime/container-manager.ts` - Docker container management
- `packages/core/src/runner/runtime/container-runner.ts` - Container execution
- `packages/core/src/runner/runtime/docker-config.ts` - Docker configuration resolution

### Hooks & Integration
- `packages/core/src/hooks/runners/shell.ts` - Shell hook execution
- `packages/core/src/hooks/runners/webhook.ts` - Webhook HTTP calls
- `packages/core/src/hooks/runners/discord.ts` - Discord notifications

### Work Sources
- `packages/core/src/work-sources/adapters/github.ts` - GitHub API adapter

### CLI
- `packages/cli/src/index.ts` - Command definitions
- `packages/cli/src/commands/*.ts` - Individual command implementations

---

## 🔄 Change History

### 2026-02-13 - Initial Security Audit
- **Auditor:** Claude Security Agent
- **Scope:** Full codebase analysis
- **Status:** COMPLETE
- **Findings:**
  - 0 critical vulnerabilities
  - 1 high-risk accepted design decision
  - 10 medium-risk mitigated or accepted
  - 10 low-risk mitigated
- **Outcome:** 🟡 YELLOW status
- **Next Audit:** 2026-03-13

---

## 📞 Contact & Reporting

**For security questions:**
- Read: [README.md](./README.md)
- Review: [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md)
- Check: Threat models in `codebase-map/`

**To report vulnerabilities:**
- **DO NOT** open public GitHub issues
- Email security concerns to maintainers
- Include reproduction steps and impact assessment

---

*This index is automatically generated during security audits and should be kept in sync with audit artifacts.*
