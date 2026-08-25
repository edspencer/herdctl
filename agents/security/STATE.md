---
last_updated: 2026-08-24T10:05:02Z
last_mapping: 2026-02-14
last_audit: 2026-08-24
commits_since_audit: 0
commits_since_mapping: 269
open_findings: 8
open_questions: 8
status: audit_complete_red
---

# Security Audit State

**Last Updated:** 2026-08-24 10:05 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-08-24 | Incremental - RED - CRITICAL dependency vulnerabilities |
| Commits since last audit | 0 | At cdfbf2b (2026-08-24) |
| Open findings | 8 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 8 | Q1, Q3, Q4, Q5, Q7, Q8, Q9, Q10 (Q6, Q13, Q14 answered) |

**Status:** RED - Finding #008 (181 npm vulnerabilities including 1 CRITICAL protobufjs RCE); Finding #013 (MCP headers credential exposure).

### Finding Breakdown

- **Critical: 1** (#008 npm vulnerabilities - 1 CRITICAL protobufjs RCE + 65 HIGH)
- **High: 2** (#013 MCP headers credential exposure, #012 likely resolved but needs verification)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 OAuth file permissions partial fix, #010 job retention stable, #006 accepted)
- Low: 1 (partially fixed - shell escaping #009)
- Intentional: 1 (#005 example config)

### Question Priorities

- High: 0
- Medium: 5 (Q1 webhook auth, Q4 log injection, Q5 config merge, Q7 container user, Q8 SDK escaping)
- Low: 2 (Q3 container name chars, Q9 rate limiting, Q10 MCP security, Q11 GitHub SSRF)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-08-24 | 0 | ✅ Current | No changes since 2026-08-23 (housekeeping commit) |
| Data flows | 2026-08-24 | 0 | ✅ Current | No changes since 2026-08-23 (housekeeping commit) |
| Security controls | 2026-08-24 | 0 | ✅ Current | No changes since 2026-08-23 (housekeeping commit) |
| Threat vectors | 2026-08-24 | 0 | ✅ Current | No changes since 2026-08-23 (housekeeping commit) |
| Hot spots | 2026-08-24 | 0 | ✅ Current | Scanner run complete - 23128ms |
| Code patterns | 2026-08-24 | 0 | ✅ Current | No changes since 2026-08-23 (housekeeping commit) |
| Dependencies | 2026-08-24 | 0 | 🔴 CRITICAL | 181 vulnerabilities (1 CRITICAL, 65 HIGH) - network issues prevented re-audit |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #008 | Finding | npm vulnerabilities - 1 CRITICAL, 65 HIGH | **CRITICAL** | RED - protobufjs RCE + 180 others | [2026-08-23 Report](intel/2026-08-23.md) |
| #013 | Finding | MCP server headers credential exposure | **HIGH** | RED - Add credential redaction | [2026-08-23 Report](intel/2026-08-23.md) |
| #012 | Finding | Web API lacks authentication | **HIGH** | VERIFY - Likely resolved (commit 2033c47) | [2026-08-22 Report](intel/2026-08-22.md) |
| #011 | Finding | OAuth credential file permissions | **MEDIUM** | YELLOW - Partial fix, chmod missing | [2026-08-23 Report](intel/2026-08-23.md) |
| #010 | Finding | bypassPermissions in 22 job files | MEDIUM | YELLOW - Retention policy needed (stable 6mo) | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Q1 | Question | Webhook authentication | Medium | Related to #012 - web API likely resolved | [2026-03-06 Report](intel/2026-03-06.md) |
| Q13 | Question | encodedPath path traversal | Medium | Partially answered - indirect validation via groups | [2026-03-06 Report](intel/2026-03-06.md) |
| Q11 | Question | GitHub SSRF in repo cloning | Medium | Confirmed - no allowlist; mitigations present | [2026-03-06 Report](intel/2026-03-06.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| #009 | Finding | Incomplete shell escaping | Low | Partially fixed (commit a0e7ad8) | [2026-03-06 Report](intel/2026-03-06.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **CRITICAL P1:** Update protobufjs to >=7.5.5 (Finding #008 - RCE vulnerability)
2. **CRITICAL P2:** Update undici, rollup, minimatch (Finding #008 - 65 HIGH severity vulns)
3. **HIGH P1:** Add MCP headers credential redaction (Finding #013)
4. **HIGH P2:** Fix OAuth file permissions - add fs.chmodSync 0o600 (Finding #011)
5. **HIGH P3:** Verify Finding #012 resolved in docs (commit 2033c47), close if confirmed
6. **MEDIUM P1:** Implement job file retention policy (30 days) to resolve #010
7. **MEDIUM P2:** Add encodedPath explicit validation (Q13)
8. **LOW:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-24 | #008 remains CRITICAL | protobufjs v7.5.4 still installed (local verification); network issues prevented npm audit |
| 2026-08-24 | Status RED maintained | Housekeeping commit (cdfbf2b) has zero security impact; dependency vulnerabilities dominate |
| 2026-08-23 | #008 ESCALATED to CRITICAL | 181 vulnerabilities (1 CRITICAL protobufjs RCE, 65 HIGH); was MEDIUM |
| 2026-08-23 | #013 NEW - MCP headers exposure | Bearer tokens in headers field may be logged; introduced commit d45d7f9 |
| 2026-08-23 | #011 PARTIAL FIX confirmed | OAuth token injection fixed (18834f8); file permissions still missing |
| 2026-08-22 | #012 likely RESOLVED | Documentation added in commit 2033c47; needs verification |
| 2026-03-06 | Q14 ANSWERED - Agent name validation SAFE | AGENT_NAME_PATTERN properly enforced before all file operations |
| 2026-03-06 | Q13 ANSWERED - encodedPath validation PARTIAL | Indirect protection via groups lookup; recommend explicit validation |
| 2026-03-06 | Q12 ANSWERED - Web API auth status NO | No authentication present; localhost-only design |
| 2026-03-06 | Q11 CONFIRMED - GitHub SSRF potential | User controls GitHub URLs; mitigations present but no allowlist |
| 2026-02-20 | #011 MEDIUM - OAuth credential review needed | New credential handling added to container-manager.ts; needs file permission and logging audit |
| 2026-02-17 | #010 DOWNGRADED to MEDIUM; HALT LIFTED | 2026-02-15 audit correctly identified measurement error: 143 count included JSONL files; correct count is 21 YAML files |
| 2026-02-14 | Comprehensive security audit completed | Full attack surface mapping, data flow tracing, controls assessment, threat modeling |
| 2026-02-05 | #001 path traversal FIXED | buildSafeFilePath + AGENT_NAME_PATTERN in place |
| 2026-02-05 | #002 hostConfigOverride ACCEPTED | Required for advanced Docker configurations at fleet level |
| 2026-02-05 | #006 shell:true ACCEPTED | Required for shell hook functionality |

### Known Gaps

Security capabilities not yet implemented or areas needing investigation:

- **CRITICAL: npm dependency vulnerabilities** - protobufjs RCE + 65 HIGH severity issues (#008)
- **HIGH: MCP server headers credential exposure** - bearer tokens may be logged in plaintext (#013)
- **HIGH: Web API authentication (likely resolved)** - needs verification of documentation (#012)
- **MEDIUM: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files (stable 6mo) (#010)
- **MEDIUM: encodedPath validation is indirect** - should add explicit regex validation (Q13)
- **MEDIUM: GitHub SSRF potential** - no URL allowlist for repository cloning (Q11)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-08-24 - Incremental audit covering 1 commit (housekeeping only)
- **Completed:** Scanner run (FAIL - expected findings), commit analysis (zero security impact), dependency verification (network issues), protobufjs local verification (v7.5.4 vulnerable)
- **Resume from:** Normal operations; next scheduled audit ~2026-08-31
- **Next priority:** Update protobufjs (#008), fix MCP headers redaction (#013), fix OAuth chmod (#011), verify #012 resolved

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

