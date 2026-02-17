# Security Audit Intelligence Report
**Date:** 2026-02-14 21:04 UTC
**Audit Type:** Comprehensive Security Audit (Manual Request)
**Commit:** e55a935
**Branch:** security-audit-2026-02-14

---

## Executive Summary

**Overall Status:** 🔴 **RED - CRITICAL**

**Critical Issue:** Finding #010 (bypassPermissions in job files) has grown to **143 occurrences** (+31.2% from previous audit at 109 files). The self-defeating feedback loop is CONFIRMED and ACCELERATING. This audit itself contributes to the problem.

**Immediate Action Required:**
1. **HALT all /security-audit-daily executions immediately**
2. Implement job file cleanup/retention policy (P0 CRITICAL)
3. Manual cleanup of old job files (reduce 143 → ~30)
4. Review audit agent configuration to eliminate bypassPermissions if possible

---

## Scanner Results

**Scan Duration:** 304ms
**Overall Status:** FAIL (2 failed checks, 2 warnings, 2 passed)

### Summary

| Check | Status | Findings | Severity Breakdown |
|-------|--------|----------|-------------------|
| npm-audit | WARN | 1 | 1 Low |
| docker-config | FAIL | 3 | 3 High |
| permission-modes | FAIL | 2 | **1 HIGH (143 files)**, 1 Low |
| subprocess-patterns | WARN | 4 | 2 Medium, 2 Low |
| path-safety | PASS | 0 | - |
| env-handling | PASS | 0 | - |

**Total Findings:** 10 (1 Critical-level HIGH, 5 High, 2 Medium, 2 Low)

---

## Critical Finding: #010 ESCALATED

**Finding #010: bypassPermissions in Production Job Files**

**Current Status:** 🔴 **CRITICAL - 143 files (+31.2% growth)**

### Growth History

```
2026-02-12 Initial:   61 files
2026-02-13:           69 files (+8, +13.1%)
2026-02-14 00:10:     85 files (+13, +18.1%)
2026-02-14 02:06:     87 files (+2, +2.4%)
2026-02-14 04:05:     87 files (+0, 0%)
2026-02-14 06:04:     91 files (+4, +4.6%)
2026-02-14 12:08:    103 files (+12, +13.2%)
2026-02-14 14:03:    109 files (+6, +5.8%)
2026-02-14 21:04:    143 files (+34, +31.2%) ← THIS AUDIT
```

### Why CRITICAL

1. **Highest growth rate recorded:** +31.2% is unprecedented
2. **Self-defeating feedback loop confirmed:** Each security audit creates more findings
3. **Unbounded exposure:** 143 files bypass ALL safety mechanisms
4. **No mitigation in place:** No cleanup policy exists
5. **Exponential trajectory:** Growth is accelerating, not stabilizing

### Security Impact

**bypassPermissions: true** disables:
- Path traversal protection
- File access validation
- Privilege escalation prevention
- Schema validation
- ALL security checks

**Attack Vectors:**
- Path Traversal: Job could read/write ANY file on host
- Privilege Escalation: Could modify system files if running as root
- Data Exfiltration: Could access sensitive files outside project
- Container Escape: Combined with other vulnerabilities

### Root Cause

Security audit agents (including this one) use `bypassPermissions: true` in `.security/agent.yaml` to scan the codebase. Each audit run creates new job files in `.herdctl/jobs/`, which accumulate indefinitely.

**The security audit system is creating the security risk it's designed to prevent.**

### Immediate Actions (P0 CRITICAL)

1. **STOP running /security-audit-daily** - Self-defeating loop must be broken
2. **Implement job retention policy:**
   - Keep only last 7-14 days of job files
   - Archive older jobs to `.herdctl/jobs/archive/`
   - Auto-cleanup on fleet start
3. **Manual cleanup NOW:**
   - Delete job files older than 14 days
   - Target: reduce 143 → ~30 files
4. **Review audit agent config:**
   - Can bypassPermissions be removed?
   - If not, document why it's absolutely required
   - Add safeguards to prevent unbounded growth

---

## Other Findings

### Finding #002: hostConfigOverride Bypass (HIGH - Accepted)

**Status:** ⚠️ Accepted Risk
**Locations:** 3 (docker-config.ts, container-manager.ts)
**Severity:** High

`hostConfigOverride` can bypass Docker security hardening (capability drops, no-new-privileges, etc.).

**Mitigation:**
- Only available at fleet level (not agent level)
- Must be explicitly configured by fleet operator
- Documented in THREAT-MODEL.md
- Scanner flags all usages

**Decision:** Accept as designed feature with strong documentation.

---

### Finding #008: npm Audit Parser Error (MEDIUM)

**Status:** 📋 Manual Check Needed
**Severity:** Low

Scanner cannot parse pnpm audit output. Manual verification recommended.

**Action:** Run `pnpm audit` manually to check for vulnerabilities.

---

### Finding #009: Incomplete Shell Escaping (LOW - Tech Debt)

**Status:** 🔧 Tech Debt
**Locations:** 2 (shell.ts, sessions.ts use `shell: true`)
**Severity:** Medium

Direct `child_process` usage with `shell: true` enables shell metacharacter processing.

**Risk Assessment:**
- Commands run inside container (security boundary)
- Fleet config authors are trusted
- Practical risk is low

**Recommendation:** Consider using `execa` for better escaping and cross-platform support.

---

## Changes Analysis

**Commits since last audit:** 1 (e55a935 - "security: commit in-progress audit artifacts")

**Change Type:** Security audit artifacts commit (no code changes)

**Risk Level:** NONE (metadata only)

---

## Hot Spot Verification

No hot spot verification performed (comprehensive audit focused on scanner results).

---

## Questions Investigation

No new questions investigated this audit.

**Open Questions:** 9 (see CODEBASE-UNDERSTANDING.md)
**Priority Queue:**
- Q1: Webhook authentication (Medium)
- Q4: Log injection via agent output (Medium)
- Q7: Docker container user (Medium)
- Others: See CODEBASE-UNDERSTANDING.md

---

## Overall Assessment

**Scanner Status:** FAIL
**Change Risk:** NONE
**Open Findings:** 6 active (1 CRITICAL, 1 High accepted, 3 Medium, 1 Low)
**Overall Result:** 🔴 **RED - CRITICAL**

### Status Determination

- **GREEN:** All checks pass, no high/critical findings
- **YELLOW:** Medium findings OR accepted high risks
- **RED:** Critical findings requiring immediate action

**This audit: RED** - Finding #010 at 143 files (+31.2% growth) is CRITICAL and UNCONTROLLED.

---

## Recommendations

### P0 CRITICAL (Immediate Action Required)

1. **HALT /security-audit-daily** - Stop the self-defeating feedback loop
2. **Implement job cleanup policy** - Prevent unbounded growth
3. **Manual job file cleanup** - Reduce 143 → ~30 files immediately
4. **Review audit agent needs** - Can we eliminate bypassPermissions?

### P1 HIGH (Next 7 Days)

1. Review all 143 bypassPermissions job files for actual security issues
2. Document why audit agents require bypassPermissions (if they do)
3. Implement automated job retention in fleet lifecycle
4. Add job cleanup to post-audit hooks

### P2 MEDIUM (Next 30 Days)

1. Run manual `pnpm audit` verification (#008)
2. Investigate Q1 (webhook authentication), Q4 (log injection), Q7 (container user)
3. Consider switching to `execa` for better shell escaping

### P3 LOW (Backlog)

1. Fix incomplete shell escaping (#009)
2. Answer remaining open questions (Q3, Q5, Q8, Q9, Q10, Q11)

---

## Documents Updated

- `.security/scans/2026-02-14.json` - Scanner results saved
- `.security/intel/2026-02-14-comprehensive-v7.md` - This report
- `.security/intel/FINDINGS-INDEX.md` - Finding #010 updated to 143 files
- `.security/STATE.md` - Audit baseline updated (CRITICAL RED status)

---

## Next Steps

**DO NOT RUN ANOTHER SECURITY AUDIT** until:
1. Job cleanup policy is implemented
2. Manual cleanup reduces job files to manageable count
3. Audit agent config is reviewed and optimized

**Resume audits only after** the self-defeating feedback loop is broken.

---

**Report Generated:** 2026-02-14 21:04 UTC
**Auditor:** Security Audit Orchestrator (Manual Request)
**Classification:** CRITICAL RED - IMMEDIATE ACTION REQUIRED
