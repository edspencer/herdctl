# herdctl Security Documentation

This directory contains security audit artifacts, threat models, and vulnerability tracking for the herdctl project.

## 📋 Quick Status

**Last Audit:** 2026-02-13
**Status:** 🟡 YELLOW (Moderate risk, documented controls)
**Critical Issues:** 0
**High Risks:** 1 (accepted by design)
**Medium Risks:** 10 (mitigated or accepted)

---

## 📁 Directory Structure

```
.security/
├── README.md                    # This file
├── AUDIT-SUMMARY.md             # Executive summary of latest audit
├── codebase-map/                # Detailed security analysis
│   ├── ATTACK-SURFACE.md        # Entry points and trust boundaries
│   ├── SECURITY-CONTROLS.md     # Defense mechanisms inventory
│   ├── DATA-FLOWS.md            # Data flow tracing and validation gaps
│   └── THREAT-VECTORS.md        # Threat scenarios and risk matrix
└── (future directories)
    ├── intel/                   # Threat intelligence reports
    ├── findings/                # Individual vulnerability findings
    └── reviews/                 # Audit review reports
```

---

## 🔍 Key Documents

### [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md)
**Start here.** Executive summary of the security audit including:
- Overall security posture (GREEN/YELLOW/RED)
- Key findings and strengths
- Risk assessment and prioritized recommendations
- Compliance status

### [codebase-map/ATTACK-SURFACE.md](./codebase-map/ATTACK-SURFACE.md)
Deep dive into attack surface:
- 45+ entry points identified
- 6 trust boundaries mapped
- Validation mechanisms documented
- Bypass vectors analyzed

### [codebase-map/SECURITY-CONTROLS.md](./codebase-map/SECURITY-CONTROLS.md)
Inventory of security defenses:
- 12+ input validation patterns
- Path safety mechanisms
- Container hardening settings
- Permission controls
- Secret handling approaches

### [codebase-map/DATA-FLOWS.md](./codebase-map/DATA-FLOWS.md)
Data flow analysis:
- 10 major flows traced from source to sink
- Validation points identified
- Risk assessment per flow
- Gaps and recommendations

### [codebase-map/THREAT-VECTORS.md](./codebase-map/THREAT-VECTORS.md)
Threat modeling:
- 21 threat vectors analyzed
- Risk matrix (likelihood × impact)
- Accepted risks documented
- Mitigation strategies

---

## 🎯 Top Security Priorities

### 1. Understand the Trust Model
herdctl operates on a **two-tier trust model**:

- **Fleet Operators (HIGH TRUST):** Control fleet.yaml, can use advanced features like `host_config`, shell hooks, volume mounts
- **Agent Configs (MEDIUM TRUST):** Restricted to safe Docker options, cannot escalate privileges
- **External Input (LOW TRUST):** Work items, environment variables - validated before use

**Key Insight:** herdctl trusts fleet operators. If you control fleet.yaml, you control the system.

### 2. Secure Your Configuration Files
- Set restrictive file permissions: `chmod 600 fleet.yaml`
- Store in version control with access controls
- Review changes carefully before applying
- Never commit secrets to config files (use environment variables)

### 3. Use Docker Security Features Wisely
- **Default hardening is strong:** `no-new-privileges`, `CapDrop: ALL`
- **Be cautious with overrides:** `host_config` can weaken security
- **Minimize volume mounts:** Avoid mounting sensitive host paths
- **Use read-only workspaces:** `workspace_mode: ro` when possible

---

## 🚨 Known Risks

### Accepted by Design

These are **intentional features** with security implications:

1. **Shell Hooks** - Arbitrary command execution via config
   - **Why:** Flexibility for custom integrations
   - **Mitigation:** Only configurable at fleet/agent level (not runtime)

2. **host_config Passthrough** - Can override Docker security defaults
   - **Why:** Advanced Docker configuration needs
   - **Mitigation:** Fleet-level only, well-documented

3. **Network Access** - Agents have internet access by default
   - **Why:** Required for Claude API communication
   - **Note:** `network: none` breaks agent functionality

4. **Prompt Injection** - No content validation on prompts
   - **Why:** Prompts are free-form by nature
   - **Mitigation:** Relies on Claude's injection defenses

### Improvement Areas

1. **No persistent audit log** - Only ephemeral console logs
2. **No secret rotation** - API keys are static environment variables
3. **No state file integrity checks** - Files can be tampered with
4. **No automated dependency scanning** - Manual `npm audit` only

---

## 🛡️ Security Best Practices

### For Fleet Operators

1. **Secure your fleet.yaml:**
   ```bash
   chmod 600 fleet.yaml
   chown $USER:$USER fleet.yaml
   ```

2. **Use environment variables for secrets:**
   ```yaml
   docker:
     env:
       ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"  # Not hardcoded!
   ```

3. **Minimize volume mounts:**
   ```yaml
   # ❌ Dangerous
   volumes:
     - "/:/host:rw"

   # ✅ Safe
   volumes:
     - "/home/user/project:/workspace:ro"
   ```

4. **Review hook commands carefully:**
   ```yaml
   hooks:
     after_run:
       - type: shell
         command: "notify-send 'Job complete'"  # Simple, auditable
   ```

5. **Use read-only workspaces when possible:**
   ```yaml
   docker:
     workspace_mode: ro  # Agent can read but not modify files
   ```

### For Agent Configurations

1. **Restrict permissions:**
   ```yaml
   permissions:
     mode: default  # Requires approval for sensitive operations
   ```

2. **Limit resource usage:**
   ```yaml
   docker:
     memory: "1g"
     pids_limit: 100
     cpu_quota: 50000
   ```

3. **Use minimal Docker images:**
   ```yaml
   docker:
     image: "herdctl/runtime:minimal"
   ```

---

## 📊 Security Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Total Entry Points | 45+ | ✅ Documented |
| Trust Boundaries | 6 | ✅ Mapped |
| Security Controls | 35+ | ✅ Inventoried |
| Critical Vulnerabilities | 0 | ✅ None found |
| High-Risk Threats | 1 | ⚠️ Accepted |
| Medium-Risk Threats | 10 | ⚠️ Mitigated/Accepted |
| Test Coverage | ~70% | ⚠️ Could improve |
| Dependency Freshness | Current | ✅ Up to date |

---

## 🔄 Audit Schedule

- **Daily:** Automated security checks via `/security-audit-daily`
- **Weekly:** Review new dependencies and advisories
- **Monthly:** Full manual security review
- **Quarterly:** External security audit (recommended)

---

## 📝 Reporting Security Issues

**Found a security vulnerability?**

1. **Do NOT open a public GitHub issue**
2. Email security concerns to: [maintainer email - TBD]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

---

## 📚 Additional Resources

- [SPEC.md](../SPEC.md) - Full project specification
- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [OWASP Container Security](https://owasp.org/www-project-docker-security/)

---

*Last updated: 2026-02-13*
