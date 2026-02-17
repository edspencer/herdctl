# Daily Security Audit - 2026-02-14 v4

## 🔴 STATUS: RED - CRITICAL ESCALATION

**Date:** 2026-02-14
**Time:** 12:08 UTC
**Commit:** fa5fd65
**Branch:** security-audit-2026-02-14
**Scanner Runtime:** 316ms

---

## Executive Summary

**CRITICAL ALERT:** The daily security audit has been **ESCALATED TO RED STATUS** due to critical growth in Finding #010 (bypassPermissions in production job files).

### Key Metrics

- **Status:** 🔴 RED (escalated from YELLOW)
- **Critical Findings:** 1 (Finding #010)
- **High Findings:** 1 (accepted risk)
- **bypassPermissions Files:** 103 (+12 in 6 hours, +13.2% growth)
- **Growth Trend:** ACCELERATING to highest rate recorded

---

## Critical Finding: #010 bypassPermissions Growth

### The Problem

Security audit jobs are accumulating in `.herdctl/jobs/` with `bypassPermissions: true`, which bypasses ALL security checks. There is NO cleanup policy, causing unbounded growth.

### Growth Timeline

| Time | Count | Delta | Rate | Status |
|------|-------|-------|------|--------|
| 2026-02-14 00:10 | 85 | +13 | +18.1% | 🟡 High |
| 2026-02-14 02:06 | 87 | +2 | +2.4% | 🟡 Stabilizing |
| 2026-02-14 04:05 | 87 | 0 | 0% | 🟢 Stable |
| 2026-02-14 06:04 | 91 | +4 | +4.6% | 🟡 Re-accelerating |
| **2026-02-14 12:08** | **103** | **+12** | **+13.2%** | **🔴 CRITICAL** |

### Why This Is Critical

1. **Highest growth rate yet**: +13.2% surpasses previous peak of +18.1%
2. **Unbounded exposure**: 103 files bypass path traversal, file access, privilege checks
3. **Self-inflicting wound**: Security audits are making the system LESS secure
4. **No mitigation**: No cleanup policy exists to prevent continued growth
5. **Unstable pattern**: Growth is unpredictable and accelerating

### Security Impact

Each file with `bypassPermissions: true` can:
- Read/write ANY file on the host system
- Bypass path traversal protection
- Escape privilege constraints
- Access sensitive data outside project directory
- Potentially escape container if combined with other vulnerabilities

---

## Immediate Actions Required

### P0 - CRITICAL (Do Immediately)

1. ✋ **STOP creating new security audit jobs** until cleanup is implemented
2. 🔧 **Implement job file retention policy**:
   - Keep last 7-14 days of jobs
   - Archive older jobs to separate directory
   - Add automated cleanup on fleet start
3. 🔍 **Review all 103 job files** for actual security issues
4. 🗑️ **Archive or delete old job files** immediately

### P1 - High Priority

1. Validate `hostConfigOverride` options (Finding #002)
2. Consider removing `bypassPermissions` from security audit agent configs
3. Document job lifecycle management policy

### P2 - Medium Priority

1. Run manual `pnpm audit` (Finding #008 - parser broken)
2. Investigate open questions (Q1, Q4, Q7)
3. Add external prompt filtering for webhooks

---

## Scanner Results Summary

| Check | Status | Duration | Findings |
|-------|--------|----------|----------|
| npm-audit | ⚠️ WARN | 2ms | 1 low |
| docker-config | ❌ FAIL | 147ms | 3 high |
| **permission-modes** | **❌ FAIL** | **27ms** | **1 critical, 1 low** |
| subprocess-patterns | ⚠️ WARN | 32ms | 2 low, 2 medium |
| path-safety | ✅ PASS | 3ms | 0 |
| env-handling | ✅ PASS | 95ms | 0 |

**Total:** 2 passed, 2 warned, 2 failed

---

## All Findings

### Critical (1)
- **#010**: bypassPermissions in 103 production job files (+12 in 6 hours)

### High (1)
- **#002**: hostConfigOverride can bypass Docker security (3 locations) - ACCEPTED RISK

### Medium (3)
- **#008**: npm audit parser broken - manual verification needed
- **#006**: shell:true in hook runner - accepted tech debt
- **#005**: bypassPermissions in example config - intentional

### Low (2)
- **#009**: Incomplete shell escaping in Docker prompts
- bypassPermissions in 1 example config

---

## Security Posture

### ✅ Strong Controls
- Path traversal defenses (buildSafeFilePath)
- Schema validation (Zod strict mode)
- Container hardening (no-new-privileges, CapDrop ALL)
- Agent name validation
- Environment variable handling

### ⚠️ Moderate Controls
- Two-tier Docker schema
- Shell subprocess handling

### ❌ Weak/Missing Controls (CRITICAL)
- **Job file cleanup - P0 CRITICAL**
- hostConfigOverride validation
- Prompt content filtering
- npm dependency scanning

---

## Risk Assessment

### Current Risk Level: RED (High)

**Justification:**
- Critical finding with accelerating growth (+13.2%)
- 103 files with full permission bypass
- No mitigation mechanism in place
- Security process creating security risk
- Unstable and unpredictable trend

### Path to GREEN (Acceptable Risk)

Required actions:
1. ✅ Implement job cleanup policy (7-14 day retention)
2. ✅ Reduce bypassPermissions files to <20
3. ✅ Stabilize growth rate to 0%
4. ✅ Add automated job archival
5. ✅ Document job lifecycle management

---

## Recommendations

### Do NOT:
- ❌ Run another security audit until cleanup policy is implemented
- ❌ Create new jobs with bypassPermissions
- ❌ Ignore this critical finding

### Do:
- ✅ Implement job cleanup IMMEDIATELY (P0)
- ✅ Review and archive existing job files
- ✅ Add retention policy to fleet lifecycle
- ✅ Consider alternative security audit approach without bypassPermissions

---

## Next Audit

**Status:** BLOCKED until job cleanup policy is implemented
**Recommended Timing:** After cleanup implementation only
**Expected Status:** YELLOW if cleanup works, RED if unchanged
**DO NOT RUN** another daily audit until this is resolved

---

## Related Documents

- **Detailed Report:** [intel/2026-02-14-daily-audit-v4.md](/opt/herdctl/.security/intel/2026-02-14-daily-audit-v4.md)
- **Executive Summary:** [summaries/2026-02-14-v4-summary.md](/opt/herdctl/.security/summaries/2026-02-14-v4-summary.md)
- **State Tracking:** [STATE.md](/opt/herdctl/.security/STATE.md)
- **Findings Index:** [intel/FINDINGS-INDEX.md](/opt/herdctl/.security/intel/FINDINGS-INDEX.md)
- **Scanner Output:** [scans/2026-02-14.json](/opt/herdctl/.security/scans/2026-02-14.json)
- **Previous Audit:** [intel/2026-02-14-daily-audit-v3.md](/opt/herdctl/.security/intel/2026-02-14-daily-audit-v3.md)

---

**Audit completed at 2026-02-14 12:08 UTC**
**Status: 🔴 RED - CRITICAL**
**Action Required: P0 CRITICAL - Implement job cleanup policy immediately**
