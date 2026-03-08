---
last_updated: 2026-03-08T06:01:38Z
last_mapping: 2026-02-14
last_audit: 2026-03-08
commits_since_audit: 0
commits_since_mapping: 116
open_findings: 8
open_questions: 9
status: audit_complete_pass
---

# Security Audit State

**Last Updated:** 2026-03-08 06:01 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-03-08 | Incremental - PASS - 5 commits, all housekeeping |
| Commits since last audit | 0 | At be5c66e (2026-03-08) |
| Open findings | 8 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 9 | Q1, Q3, Q4, Q5, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14 |

**Status:** PASS - No code changes, scanner stable, all findings unchanged.

### Finding Breakdown

- **Critical: 0**
- **High: 1** (#012 - web API auth missing, needs documentation)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 OAuth risk, #010 job retention, #008 npm audit, #006 accepted)
- Low: 1 (partially fixed - shell escaping #009)
- Intentional: 1 (#005 example config)

### Question Priorities

- High: 0
- Medium: 8 (Q1, Q4, Q5, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14)
- Low: 1 (Q3)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-03-08 | 0 | ✅ Current | No code changes since last audit |
| Data flows | 2026-03-08 | 0 | ✅ Current | No changes to web API or OAuth flows |
| Security controls | 2026-03-08 | 0 | ✅ Current | Path validation and escaping unchanged |
| Threat vectors | 2026-03-08 | 0 | ✅ Current | No new attack vectors identified |
| Hot spots | 2026-03-08 | 0 | ✅ Current | Scanner run complete - 3587ms |
| Code patterns | 2026-03-08 | 0 | ✅ Current | No changes to security-sensitive code |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #012 | Finding | Web API lacks authentication | **HIGH** | OPEN - Needs documentation | [2026-03-06 Report](intel/2026-03-06.md) |
| #011 | Finding | OAuth credential management - risk elevated | **MEDIUM** | YELLOW - Session exposure risk | [2026-03-06 Report](intel/2026-03-06.md) |
| #010 | Finding | bypassPermissions in 22 job files | MEDIUM | YELLOW - Retention policy needed | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| #008 | Finding | npm audit - 4 HIGH, 4 MEDIUM vulns | Medium | Manual check needed | Scanner 2026-03-08 |
| Q1 | Question | Webhook authentication | Medium | Related to #012 - web API has no auth | [2026-03-06 Report](intel/2026-03-06.md) |
| Q13 | Question | encodedPath path traversal | Medium | Partially answered - indirect validation via groups | [2026-03-06 Report](intel/2026-03-06.md) |
| Q11 | Question | GitHub SSRF in repo cloning | Medium | Confirmed - no allowlist; mitigations present | [2026-03-06 Report](intel/2026-03-06.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| #009 | Finding | Incomplete shell escaping | Low | Partially fixed (commit a0e7ad8) | [2026-03-06 Report](intel/2026-03-06.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **HIGH P1:** Document web dashboard as localhost-only, warn against network exposure (#012)
2. **HIGH P2:** Audit session files for OAuth credential leaks (#011 + #012 combined risk)
3. **MEDIUM P1:** Add encodedPath explicit validation (Q13)
4. **MEDIUM P2:** Review OAuth logging for credential leaks (#011)
5. **MEDIUM P3:** Implement job file retention policy (30 days) to resolve #010
6. **MEDIUM P4:** Consider GitHub URL allowlist for distribution system (Q11)
7. **LOW:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-08 | No action needed for 2026-03-08 audit | 5 commits all housekeeping (state file updates), no code changes |
| 2026-03-06 | #012 HIGH - Web API lacks authentication | New web API routes have no auth; designed for localhost only; needs documentation |
| 2026-03-06 | #011 risk ELEVATED | Session files exposed via web API may contain OAuth tokens; combined risk with #012 |
| 2026-03-06 | #009 status updated to PARTIALLY FIXED | Commit a0e7ad8 escapes $ and backtick; full verification still needed |
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

- **HIGH NEW: Web API has no authentication** - localhost-only by design but needs documentation (#012)
- **HIGH NEW: Session files exposed via web API** - may contain OAuth tokens from error logs (#011 + #012)
- **MEDIUM: encodedPath validation is indirect** - should add explicit regex validation (Q13)
- **MEDIUM: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM: OAuth error logging may leak tokens** - logger.error() calls need review (#011)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files accumulating (#010)
- **MEDIUM: GitHub SSRF potential** - no URL allowlist for repository cloning (Q11)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-03-08 - Incremental audit covering 5 commits
- **Completed:** Scanner run (FAIL - expected baseline), change analysis (housekeeping only), no hot spot verification needed, no question investigation needed
- **Resume from:** Normal operations; next scheduled audit ~2026-03-13
- **Next priority:** Document web dashboard security model (#012), audit session files for credential leaks (#011), encodedPath validation (Q13)

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
