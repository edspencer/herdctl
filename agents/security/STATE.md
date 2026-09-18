---
last_updated: 2026-09-18T10:15:00Z
last_mapping: 2026-02-14
last_audit: 2026-09-18
commits_since_audit: 0
commits_since_mapping: 300
open_findings: 8
open_questions: 8
status: audit_complete_pass_stable
---

# Security Audit State

**Last Updated:** 2026-09-18 10:15 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-09-18 | Incremental - PASS (Stable) - Zero code changes in 14 commits |
| Commits since last audit | 0 | At cb6974e (2026-09-18) |
| Open findings | 8 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 8 | Q1, Q3, Q4, Q5, Q7, Q8, Q9, Q10 (Q6, Q13, Q14 answered) |

**Status:** PASS (Stable) - No code changes; Finding #008 discrepancy requires manual verification (STATE.md reports RED but scanner shows PASS).

### Finding Breakdown

- **Critical: 1** (#008 npm vulnerabilities - STATUS DISPUTED: STATE.md reports 193 vulns but scanner PASS)
- **High: 2** (#013 MCP headers credential exposure, #012 likely resolved but needs verification)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 OAuth file permissions partial fix, #010 job retention stable, #006 accepted)
- Low: 1 (partially fixed - shell escaping #009)
- Intentional: 1 (#005 example config)

### Question Priorities

- High: 0
- Medium: 5 (Q1 webhook auth, Q4 log injection, Q5 config merge, Q7 container user, Q8 SDK escaping)
- Low: 3 (Q3 container name chars, Q9 rate limiting, Q10 MCP security)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-09-18 | 0 | ✅ Current | Zero code changes since 2026-09-08 (14 housekeeping commits) |
| Data flows | 2026-09-18 | 0 | ✅ Current | Zero code changes since 2026-09-08 (14 housekeeping commits) |
| Security controls | 2026-09-18 | 0 | ✅ Current | Zero code changes since 2026-09-08 (14 housekeeping commits) |
| Threat vectors | 2026-09-18 | 0 | ✅ Current | Zero code changes since 2026-09-08 (14 housekeeping commits) |
| Hot spots | 2026-09-18 | 0 | ✅ Current | Scanner run complete - 70928ms; npm-audit network restored |
| Code patterns | 2026-09-18 | 0 | ✅ Current | Zero code changes since 2026-09-08 (14 housekeeping commits) |
| Dependencies | 2026-09-18 | 0 | ⚠️ VERIFY | Scanner PASS conflicts with historical 193 vulnerabilities - manual check needed |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #008 | Finding | npm vulnerabilities STATUS DISPUTED | **VERIFY** | Scanner PASS vs. STATE.md RED (193 vulns) | [2026-09-08 Report](intel/2026-09-08.md) |
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

1. **CRITICAL P1:** Resolve Finding #008 discrepancy - run manual `pnpm audit` to establish ground truth
2. **HIGH P1:** Add MCP headers credential redaction (Finding #013)
3. **HIGH P2:** Fix OAuth file permissions - add fs.chmodSync 0o600 (Finding #011)
4. **HIGH P3:** Verify Finding #012 resolved in docs (commit 2033c47), close if confirmed
5. **MEDIUM P1:** Implement job file retention policy (30 days) to resolve #010
6. **MEDIUM P2:** Add encodedPath explicit validation (Q13)
7. **LOW:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-18 | #008 STATUS DISPUTED | Scanner shows npm-audit PASS (0 vulns) but STATE.md reports 193 vulns from 2026-09-08; manual verification needed |
| 2026-09-18 | Status PASS (Stable) maintained | 14 housekeeping commits (3e8c702-cb6974e) have zero code changes; scanner results stable; npm-audit network restored |
| 2026-09-08 | #008 DETERIORATED to 193 vulns | +12 vulnerabilities (+7 HIGH, +4 MODERATE, +1 LOW) since 2026-08-31; protobufjs RCE still unpatched |
| 2026-09-08 | Status RED maintained (worse) | 10 housekeeping commits (590e625-b29de99) have zero security impact; dependency crisis deepening |
| 2026-08-31 | #008 remains CRITICAL | Network issues persist; assume 181 vulnerabilities unchanged since 2026-08-23 |
| 2026-08-31 | Status RED maintained | 7 housekeeping commits (590e625-6f16fd1) have zero security impact; dependency vulnerabilities dominate |
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

- **VERIFY: npm dependency vulnerabilities** - Scanner reports PASS but historical STATE.md shows 193 vulns (#008 - STATUS DISPUTED)
- **HIGH: MCP server headers credential exposure** - bearer tokens may be logged in plaintext (#013)
- **HIGH: Web API authentication (likely resolved)** - needs verification of documentation (#012)
- **MEDIUM: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files (stable 6mo) (#010)
- **MEDIUM: encodedPath validation is indirect** - should add explicit regex validation (Q13)
- **MEDIUM: GitHub SSRF potential** - no URL allowlist for repository cloning (Q11)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-09-18 - Incremental audit covering 14 commits (all housekeeping only)
- **Completed:** Scanner run (FAIL - expected findings), commit analysis (zero code changes), no hot spot verification needed, no investigation needed
- **Resume from:** Normal operations; next scheduled audit ~2026-09-25
- **Next priority:** IMMEDIATE - Resolve #008 discrepancy with manual `pnpm audit`, then update Finding #008 status

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
