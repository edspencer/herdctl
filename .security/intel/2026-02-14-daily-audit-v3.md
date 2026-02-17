# Daily Security Audit Report
**Date:** 2026-02-14 (v3)
**Status:** 🟡 YELLOW - Medium Risk
**Scanner Runtime:** 301ms
**Commit:** cf878c7

---

## Quick Status

| Metric | Value | Status |
|--------|-------|--------|
| **Overall Risk** | YELLOW | 🟡 Medium |
| **Scanner Checks** | 6 total | 2 pass, 2 warn, 2 fail |
| **High Findings** | 4 | 🟠 |
| **Medium Findings** | 2 | 🟡 |
| **Low Findings** | 3 | ℹ️ |
| **bypassPermissions** | 91 job files | 🟠 +4 since v2 |

---

## Critical Issues Requiring Immediate Attention

### 1. 🟠 Docker hostConfigOverride Bypass (High x3)
- **Risk:** Fleet admins can bypass ALL Docker security via unvalidated HostConfig
- **Locations:** 
  - `packages/core/src/runner/runtime/docker-config.ts:260`
  - `packages/core/src/runner/runtime/container-manager.ts:142`
  - `packages/core/src/runner/runtime/container-manager.ts:143`
- **Impact:** Container escape, full host root access
- **Action:** Add validation/allowlist for safe HostConfig options
- **Status:** KNOWN RISK - accepted as documented risk per STATE.md

### 2. 🟠 bypassPermissions in 91 Production Jobs (High)
- **Risk:** 91 job config files use bypassPermissions, bypassing ALL safety checks
- **Growth:** +4 files since v2 audit (87→91), +4.6% growth rate
- **Impact:** Path traversal, arbitrary file access, privilege escalation
- **Action:** Implement job cleanup policy; review each usage
- **Status:** TRACKED as Finding #010 - growth accelerating again

---

## Scanner Results Detail

### ✅ PASS (2 checks)

#### path-safety (3ms)
- No findings
- Path traversal defenses validated
- buildSafeFilePath working correctly

#### env-handling (89ms)
- No findings
- Environment variable handling secure
- No unvalidated interpolation detected

### ⚠️ WARN (2 checks)

#### npm-audit (2ms)
- **[LOW]** Could not parse pnpm audit output - manual review recommended
- **Action:** Run `pnpm audit` manually to check for vulnerabilities
- **Status:** Known issue - parser changed (Finding #008)

#### subprocess-patterns (30ms)
- **[LOW] x2** Direct child_process import in shell.ts:8 and sessions.ts:14
  - Consider using execa for better escaping
- **[MEDIUM] x2** shell: true option in shell.ts:154 and sessions.ts:415
  - Enables shell metacharacter processing
  - **Status:** Known tech debt (Finding #009)

### ❌ FAIL (2 checks)

#### docker-config (139ms)
- **[HIGH] x3** hostConfigOverride can bypass Docker security hardening
- All three instances in core runtime code
- **Status:** Accepted risk - required for fleet-level advanced config

#### permission-modes (26ms)
- **[HIGH]** bypassPermissions used in 91 production config files
  - Growth: +4 files since v2 (87→91)
  - Rate: +4.6% vs +2.4% in v2 vs +18.1% in v1
  - Trend: Growth accelerating again
- **[LOW]** bypassPermissions in 1 example config
  - `examples/bragdoc-developer/agents/developer.yaml:47`
  - Recommendation: Add Docker isolation example

---

## Finding #010 Analysis: bypassPermissions Growth

### Growth Tracking

| Audit | Date | Count | Change | Rate | Trend |
|-------|------|-------|--------|------|-------|
| v1 | 2026-02-14 00:10 | 85 | +13 | +18.1% | 📈 Accelerating |
| v2 | 2026-02-14 04:05 | 87 | +2 | +2.4% | 📉 Stabilizing |
| v3 | 2026-02-14 06:04 | 91 | +4 | +4.6% | 📈 Re-accelerating |

### Root Cause
- Security audit jobs created with bypassPermissions in agent configs
- No automatic cleanup of old job files
- Each audit run creates new jobs with bypassPermissions enabled

### Mitigation Priority
- **MEDIUM** - Implement job cleanup policy to prevent unbounded growth
- Growth rate unstable: 18.1% → 2.4% → 4.6%
- Total exposure: 91 files with full permission bypass

---

## Open Questions Status

From CODEBASE-UNDERSTANDING.md and STATE.md:

| ID | Question | Priority | Status |
|----|----------|----------|--------|
| Q1 | Webhook authentication mechanism | Medium | Open |
| Q4 | Log injection via agent output | Medium | Open |
| Q5 | Fleet/agent config merge overrides | Medium | Open |
| Q7 | Docker container user (root?) | Medium | Open |
| Q8 | SDK wrapper prompt escaping | Medium | Open |
| Q9 | Session state integrity checks | Medium | Open |
| Q10 | GitHub webhook content filtering | Medium | Open |
| Q11 | Discord message validation | Medium | Open |
| Q3 | Container name special chars | Low | Open |

**Total:** 9 open questions (8 medium, 1 low)

---

## Recommendations Priority Matrix

| Priority | Action | Timeline | Risk Mitigated |
|----------|--------|----------|----------------|
| 🔴 P1 | Validate hostConfigOverride options | Immediate | CRITICAL |
| 🔴 P1 | Implement job cleanup policy | Immediate | HIGH |
| 🟠 P2 | Run manual pnpm audit (#008) | Short-term | MEDIUM |
| 🟠 P2 | Filter external prompts (GitHub/Discord) | Short-term | MEDIUM |
| 🟠 P2 | Add volume mount path safety | Short-term | MEDIUM |
| 🟡 P3 | Migrate to execa for subprocess | Medium-term | LOW |
| 🟡 P3 | Implement audit logging | Medium-term | MEDIUM |
| 🟢 P4 | Add Docker isolation to examples | Long-term | LOW |

---

## Security Posture Summary

### Strong Controls ✅
- Path traversal defenses (buildSafeFilePath with double validation)
- Schema validation (Zod strict mode)
- Container hardening (no-new-privileges, CapDrop ALL)
- Agent name validation (strict regex pattern)
- Environment variable handling (secure interpolation)

### Moderate Controls ⚠️
- Two-tier Docker schema (agent vs fleet privileges)
- Shell subprocess handling (documented tech debt)

### Weak/Missing Controls ❌
- Job file cleanup (unbounded growth)
- hostConfigOverride validation (bypass possible)
- Prompt content filtering (MISSING for webhooks)
- npm dependency scanning (parser broken)

---

## Changes Since Last Audit (v2)

**Time:** ~2 hours since v2 (04:05 → 06:04)
**Commits:** 0 (stable at cf878c7)
**Scanner:** Same baseline, different finding count

### Findings Delta
- bypassPermissions: +4 files (87→91)
- All other findings: Unchanged
- No new code changes detected

### Analysis
Growth in bypassPermissions continues despite no new commits. This indicates:
1. Audit jobs accumulating in .herdctl/jobs/
2. Job cleanup not implemented
3. Each security audit run creates new jobs
4. Growth rate unstable and unpredictable

**Recommendation:** P1 priority for job cleanup policy

---

## Next Audit

**Recommended:** After job cleanup implementation OR in 24 hours
**Expected Status:** 🟢 GREEN if cleanup implemented, 🟡 YELLOW otherwise
**Priority:** Monitor Finding #010 growth trend

---

**Full State:** See `/opt/herdctl/.security/STATE.md`
**Scanner Results:** See `/opt/herdctl/.security/scans/2026-02-14.json`
**Previous Audit:** See `/opt/herdctl/.security/intel/2026-02-14-daily-audit-v2.md`
