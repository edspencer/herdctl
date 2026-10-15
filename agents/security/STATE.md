---
last_updated: 2026-10-15T12:00:00Z
last_mapping: 2026-02-14
last_audit: 2026-10-15
commits_since_audit: 0
commits_since_mapping: 311
open_findings: 8
open_questions: 6
status: audit_complete_yellow
---

# Security Audit State

**Last Updated:** 2026-10-15 12:00 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-10-15 | Incremental - YELLOW - STABLE (no code changes) |
| Commits since last audit | 0 | At 7e9e54e (2026-10-15) |
| Open findings | 8 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 6 | Q1, Q4, Q5, Q7, Q8, Q9 (Q10-Q14 answered) |

**Status:** YELLOW - Security posture STABLE; no code changes since 2026-10-12.

### Finding Breakdown

- **Critical: 0**
- **High: 1** (#012 NEW - web API auth missing)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 OAuth risk elevated, #010 job retention, #008 npm audit, #006 accepted)
- Low: 1 (partially fixed - shell escaping #009)
- Intentional: 1 (#005 example config)

### Question Priorities

- High: 0
- Medium: 4 (Q1 webhook auth, Q4 log injection, Q5 config merge, Q8 SDK escaping)
- Low: 2 (Q7 container user, Q9 rate limiting)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-10-15 | 0 | ✅ Current | No code changes - stable |
| Data flows | 2026-10-15 | 0 | ✅ Current | No code changes - stable |
| Security controls | 2026-10-15 | 0 | ✅ Current | No code changes - stable |
| Threat vectors | 2026-10-15 | 0 | ✅ Current | No code changes - stable |
| Hot spots | 2026-10-15 | 0 | ✅ Current | Scanner run complete - 25.0s, 0/13 verified (not required) |
| Code patterns | 2026-10-15 | 0 | ✅ Current | No code changes - stable |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #012 | Finding | Web API lacks authentication | **HIGH** | OPEN - Needs documentation | [2026-10-09 Report](intel/2026-10-09.md) |
| #011 | Finding | OAuth credential logging | **MEDIUM** | **ACTIONABLE** - Lines 336, 338, 369, 389 identified | [2026-10-09 Report](intel/2026-10-09.md) |
| #010 | Finding | bypassPermissions in job files | MEDIUM | YELLOW - Retention policy needed | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| #008 | Finding | npm audit parser error | Medium | Manual check needed | Scanner 2026-10-09 |
| Q1 | Question | Webhook authentication | Medium | Related to #012 - web API has no auth | [2026-03-06 Report](intel/2026-03-06.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| #009 | Finding | Incomplete shell escaping | Low | Partially fixed (commit a0e7ad8) | [2026-03-06 Report](intel/2026-03-06.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **HIGH P1:** Document web dashboard as localhost-only, warn against network exposure (#012)
2. **HIGH P2:** Sanitize OAuth error logging - lines 336, 338, 369, 389 (#011)
3. **HIGH P3:** Enforce credential file permissions 0600 (#011)
4. **MEDIUM P1:** Audit session files for OAuth credential leaks (#011 + #012 combined risk)
5. **MEDIUM P2:** Implement job file retention policy (30 days) to resolve #010
6. **MEDIUM P3:** Review SDK 0.3.283 changelog for security changes
7. **LOW:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-15 | **Stability confirmed** - No code changes | 6 commits all housekeeping/docs; security posture unchanged |
| 2026-10-12 | **Settings log redaction** (2cef420) | Security improvement - prevents secret disclosure in debug logs; adversarial review approach demonstrates security-conscious development |
| 2026-10-09 | **MCP bridge auth FIXED** (bf4995a) | Critical vulnerability closed - bearer token required, constant-time comparison, localhost bind |
| 2026-10-09 | #011 ACTIONABLE - Specific lines identified | container-manager.ts:336, 338, 369, 389 - error logging may leak OAuth tokens |
| 2026-10-09 | Files endpoint SAFE | Excellent path traversal protection - double realpath, TOCTOU mitigation, CSP sandbox |
| 2026-10-09 | Session discovery SAFE | Uses encodePathForCli, buildSafeFilePath - no new path traversal vectors |
| 2026-10-09 | Q10 ANSWERED - MCP security | NOW AUTHENTICATED - bearer token required (bf4995a) |
| 2026-10-09 | Q11 ANSWERED - GitHub SSRF | User controls URLs; no allowlist but proper subprocess isolation |
| 2026-10-09 | Q12 ANSWERED - Web API auth | NO - localhost-only by design; needs documentation |
| 2026-10-09 | Q13 ANSWERED - encodedPath validation | PARTIAL - indirect via encodePathForCli; recommend explicit validation |
| 2026-10-09 | Q14 ANSWERED - Agent name validation | SAFE - AGENT_NAME_PATTERN enforced in schema.ts:1053 |
| 2026-03-06 | #012 HIGH - Web API lacks authentication | New web API routes have no auth; designed for localhost only; needs documentation |
| 2026-02-20 | #011 MEDIUM - OAuth credential review needed | New credential handling added to container-manager.ts; needs file permission and logging audit |
| 2026-02-17 | #010 DOWNGRADED to MEDIUM; HALT LIFTED | 2026-02-15 audit correctly identified measurement error: 143 count included JSONL files; correct count is 21 YAML files |
| 2026-02-14 | Comprehensive security audit completed | Full attack surface mapping, data flow tracing, controls assessment, threat modeling |
| 2026-02-05 | #001 path traversal FIXED | buildSafeFilePath + AGENT_NAME_PATTERN in place |
| 2026-02-05 | #002 hostConfigOverride ACCEPTED | Required for advanced Docker configurations at fleet level |
| 2026-02-05 | #006 shell:true ACCEPTED | Required for shell hook functionality |

### Known Gaps

Security capabilities not yet implemented or areas needing investigation:

- **HIGH: Web API has no authentication** - localhost-only by design but needs documentation (#012)
- **MEDIUM: OAuth error logging leaks tokens** - container-manager.ts:336, 338, 369, 389 (#011)
- **MEDIUM: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM: Job file retention policy not implemented** - bypassPermissions files accumulating (#010)
- **MEDIUM: encodedPath validation is indirect** - should add explicit regex validation for defense-in-depth
- **MEDIUM: GitHub SSRF potential** - no URL allowlist for repository cloning (mitigations present)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-10-12 - Incremental audit covering 22 commits (3 code, 19 housekeeping)
- **This session:** 2026-10-15 - Stability verification; 6 commits (0 code, 6 housekeeping)
- **Completed:** Scanner run (FAIL - expected), no change analysis needed, stability confirmed
- **Security Status:** STABLE - No regressions, no improvements, all findings unchanged
- **Resume from:** Normal operations; next scheduled audit ~2026-10-22
- **Next priority:** Sanitize OAuth logging (#011 lines 338, 369, 389), document web security (#012)

---

## Update Protocol

### At Audit Start

1. Read STATE.md to understand current position
2. Check `commits_since_audit` in frontmatter - has anything changed?
3. Check `status` - was previous audit incomplete?
4. Load Active Investigations as priority list

### At Audit End

**1. Update YAML frontmatter:**
**2. Update Coverage Status table**
**3. Update Active Investigations**
**4. Update Accumulated Context**

### Between Audits

When commits occur to the codebase:
1. Increment `commits_since_audit` in frontmatter
2. Increment "Commits Since" for each coverage area

---

**End of STATE.md**
