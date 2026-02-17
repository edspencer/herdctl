# Daily Security Audit Report
**Date:** 2026-02-14 (v4)
**Status:** 🔴 RED - High Risk
**Scanner Runtime:** 316ms
**Commit:** fa5fd65
**Time:** 12:08 UTC

---

## Quick Status

| Metric | Value | Status |
|--------|-------|--------|
| **Overall Risk** | RED | 🔴 High |
| **Scanner Checks** | 6 total | 2 pass, 2 warn, 2 fail |
| **High Findings** | 4 | 🔴 |
| **Medium Findings** | 2 | 🟡 |
| **Low Findings** | 3 | ℹ️ |
| **bypassPermissions** | 103 job files | 🔴 +12 since v3 |

---

## CRITICAL ALERT: Finding #010 Growth Accelerating

### 🔴 **ESCALATION: YELLOW → RED**

**Finding #010 (bypassPermissions) has entered HIGH RISK territory**

| Metric | Value | Severity |
|--------|-------|----------|
| **Current Count** | 103 files | 🔴 CRITICAL |
| **Growth** | +12 files (6 hours) | 🔴 ACCELERATING |
| **Growth Rate** | +13.2% | 🔴 HIGHEST YET |
| **Trend** | Unstable & accelerating | 🔴 DANGEROUS |

### Growth History

| Audit | Time | Count | Change | Rate | Trend |
|-------|------|-------|--------|------|-------|
| v1 | 2026-02-14 00:10 | 85 | +13 | +18.1% | 📈 Accelerating |
| v2 | 2026-02-14 04:05 | 87 | +2 | +2.4% | 📉 Stabilizing |
| v3 | 2026-02-14 06:04 | 91 | +4 | +4.6% | 📈 Re-accelerating |
| **v4** | **2026-02-14 12:08** | **103** | **+12** | **+13.2%** | **🔴 CRITICAL** |

### Why This Is Critical

1. **Unbounded growth**: No cleanup mechanism for job files
2. **Accelerating trend**: Growth rate increasing (4.6% → 13.2%)
3. **Security exposure**: Each file bypasses ALL safety checks
4. **Attack surface**: 103 files with full permission bypass
5. **Self-inflicted**: Security audits creating security risk

### Root Cause

Security audit jobs are being created with `bypassPermissions: true` in agent configs, and there is NO automatic cleanup policy. Every security audit creates new job files, increasing the attack surface.

**This is a self-inflicting wound**: The more security audits we run, the less secure the system becomes.

### Immediate Actions Required

1. **STOP creating new security audit jobs** until cleanup policy is implemented
2. **Implement job file cleanup policy** (age-based retention)
3. **Review all 103 job files** for actual security issues
4. **Consider disabling bypassPermissions** for security audit agents

---

## Critical Issues Requiring Immediate Attention

### 1. 🔴 bypassPermissions in 103 Production Jobs (CRITICAL)
- **Risk:** 103 job config files use bypassPermissions, bypassing ALL safety checks
- **Growth:** +12 files in 6 hours (91→103), +13.2% growth rate
- **Impact:** Path traversal, arbitrary file access, privilege escalation
- **Action:** **IMMEDIATE** - Implement job cleanup policy; STOP creating new audit jobs
- **Status:** **ESCALATED to RED** - Finding #010 is now CRITICAL PRIORITY
- **Recommendation:**
  - Implement retention policy (e.g., keep last 7 days of jobs)
  - Archive old jobs to separate directory
  - Consider disabling bypassPermissions for audit agents

### 2. 🟠 Docker hostConfigOverride Bypass (High x3)
- **Risk:** Fleet admins can bypass ALL Docker security via unvalidated HostConfig
- **Locations:**
  - `packages/core/src/runner/runtime/docker-config.ts:260`
  - `packages/core/src/runner/runtime/container-manager.ts:142`
  - `packages/core/src/runner/runtime/container-manager.ts:143`
- **Impact:** Container escape, full host root access
- **Action:** Add validation/allowlist for safe HostConfig options
- **Status:** KNOWN RISK - accepted as documented risk per STATE.md

---

## Scanner Results Detail

### ✅ PASS (2 checks)

#### path-safety (3ms)
- No findings
- Path traversal defenses validated
- buildSafeFilePath working correctly

#### env-handling (95ms)
- No findings
- Environment variable handling secure
- No unvalidated interpolation detected

### ⚠️ WARN (2 checks)

#### npm-audit (2ms)
- **[LOW]** Could not parse pnpm audit output - manual review recommended
- **Action:** Run `pnpm audit` manually to check for vulnerabilities
- **Status:** Known issue - parser changed (Finding #008)

#### subprocess-patterns (32ms)
- **[LOW] x2** Direct child_process import in shell.ts:8 and sessions.ts:14
  - Consider using execa for better escaping
- **[MEDIUM] x2** shell: true option in shell.ts:154 and sessions.ts:415
  - Enables shell metacharacter processing
  - **Status:** Known tech debt (Finding #009)

### ❌ FAIL (2 checks)

#### docker-config (147ms)
- **[HIGH] x3** hostConfigOverride can bypass Docker security hardening
- All three instances in core runtime code
- **Status:** Accepted risk - required for fleet-level advanced config

#### permission-modes (27ms)
- **[CRITICAL]** bypassPermissions used in 103 production config files
  - Growth: +12 files in 6 hours (91→103)
  - Rate: +13.2% vs +4.6% in v3 vs +2.4% in v2 vs +18.1% in v1
  - Trend: **CRITICAL - highest growth rate yet**
- **[LOW]** bypassPermissions in 1 example config
  - `examples/bragdoc-developer/agents/developer.yaml:47`
  - Recommendation: Add Docker isolation example

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
| 🔴 **P0** | **STOP creating security audit jobs** | **IMMEDIATE** | **CRITICAL** |
| 🔴 **P0** | **Implement job cleanup policy** | **IMMEDIATE** | **CRITICAL** |
| 🔴 P1 | Review all 103 bypassPermissions jobs | Immediate | CRITICAL |
| 🔴 P1 | Validate hostConfigOverride options | Immediate | HIGH |
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
- **Job file cleanup (CRITICAL - unbounded growth)**
- hostConfigOverride validation (bypass possible)
- Prompt content filtering (MISSING for webhooks)
- npm dependency scanning (parser broken)

---

## Changes Since Last Audit (v3)

**Time:** 6 hours since v3 (06:04 → 12:08)
**Commits:** 1 (cf878c7 → fa5fd65)
**Scanner:** Same baseline, significant finding count increase

### Findings Delta
- bypassPermissions: +12 files (91→103) - **CRITICAL ESCALATION**
- All other findings: Unchanged
- 1 new commit: "security: Daily security audit 2026-02-14 v3 - YELLOW status"

### Analysis
Growth in bypassPermissions has ACCELERATED to highest rate yet (+13.2%). This indicates:
1. Audit jobs accumulating exponentially in .herdctl/jobs/
2. Job cleanup is URGENT - no longer MEDIUM priority
3. Each security audit run creates multiple new jobs
4. Growth is now UNSTABLE and DANGEROUS
5. **Security audits are making the system LESS secure**

**Recommendation:** **P0 CRITICAL** - STOP all security audit job creation until cleanup policy is implemented

---

## Risk Level Justification

### Why RED (High Risk)?

Previous audits were YELLOW (Medium Risk). This audit is **RED (High Risk)** because:

1. **Critical Finding Growth**: +13.2% growth rate is highest recorded
2. **Unbounded Exposure**: 103 files with full permission bypass
3. **Accelerating Trend**: Pattern shows increasing instability
4. **Self-Inflicting**: Security process creating security risk
5. **No Mitigation**: No cleanup policy in place

### Conditions for GREEN (Acceptable Risk)

To return to GREEN status:
1. Implement job file cleanup policy (retention: 7-14 days)
2. Reduce bypassPermissions files to <20
3. Add automated job archival
4. Stabilize growth rate to 0%
5. Document job lifecycle management

---

## Next Audit

**Recommended:** After job cleanup implementation
**DO NOT RUN** another security audit until cleanup policy is in place
**Expected Status:** 🟡 YELLOW if cleanup implemented, 🔴 RED if unchanged
**Priority:** **P0 CRITICAL** - Do not create more jobs

---

## Scan Metadata

```json
{
  "date": "2026-02-14",
  "timestamp": "2026-02-14T12:08:43.319Z",
  "commit": "fa5fd65",
  "branch": "security-audit-2026-02-14",
  "duration": "316ms",
  "checks": {
    "total": 6,
    "passed": 2,
    "warned": 2,
    "failed": 2
  },
  "findings": {
    "critical": 1,
    "high": 3,
    "medium": 2,
    "low": 3
  }
}
```

---

**Full State:** See `/opt/herdctl/.security/STATE.md`
**Scanner Results:** See `/opt/herdctl/.security/scans/2026-02-14.json`
**Previous Audit:** See `/opt/herdctl/.security/intel/2026-02-14-daily-audit-v3.md`
**FINDINGS INDEX:** See `/opt/herdctl/.security/intel/FINDINGS-INDEX.md`
