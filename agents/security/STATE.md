---
last_updated: 2026-02-20T00:00:00Z
last_mapping: 2026-02-14
last_audit: 2026-02-20
commits_since_audit: 0
commits_since_mapping: 40
open_findings: 7
open_questions: 7
status: audit_complete_yellow
---

# Security Audit State

**Last Updated:** 2026-02-20 00:00 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-02-20 | Incremental - YELLOW - 1 new finding (#011 OAuth) |
| Commits since last audit | 0 | At 5469008 (2026-02-20) |
| Open findings | 7 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 7 | Q1, Q3, Q4, Q5, Q7, Q8, Q9, Q10, Q11 |

**Status:** YELLOW - Finding #011 (OAuth credential management) needs security review for credential leak vectors.

### Finding Breakdown

- **Critical: 0**
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 NEW OAuth, #010 job retention, #008 npm audit, #006 accepted)
- Low: 1 (tech debt - shell escaping #009)
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
| Attack surface | 2026-02-14 | 40 | STALE | Needs refresh - major features added |
| Data flows | 2026-02-14 | 40 | STALE | OAuth flow added, needs mapping |
| Security controls | 2026-02-20 | 0 | Current | Hot spots verified (container-manager.ts OAuth reviewed) |
| Threat vectors | 2026-02-14 | 40 | STALE | New web UI and OAuth paths |
| Hot spots | 2026-02-20 | 0 | Current | Scanner run complete - 2273ms |
| Code patterns | 2026-02-20 | 0 | Current | All checks complete - FAIL (pre-existing) |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #011 | Finding | OAuth credential management in container-manager.ts | **MEDIUM** | YELLOW - Needs review for file permissions, logging leaks | [2026-02-20 Report](intel/2026-02-20.md) |
| #010 | Finding | bypassPermissions in 22 job files | MEDIUM | YELLOW - Retention policy needed (stable growth) | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| #008 | Finding | npm audit parser error | Medium | Manual check needed | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Q1 | Question | Webhook authentication | Medium | Partially answered - secret_env in schema; server impl unclear | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q7 | Question | Docker container user (root?) | Medium | Partially answered - user field configurable; default = image default | [2026-02-17 Report](intel/2026-02-17.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| #009 | Finding | Incomplete shell escaping | Low | Tech debt | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **MEDIUM P1:** Review OAuth logging for credential leaks (#011)
2. **MEDIUM P2:** Add file permission enforcement for credentials.json (#011)
3. **MEDIUM P3:** Implement job file retention policy (30 days) to resolve #010
4. **MEDIUM P4:** Verify webhook server implementation for inbound auth (Q1)
5. **LOW:** Docker container user configuration (Q7) - set explicit UID:GID
6. **LOW:** #009 (shell escaping - fix when convenient)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-20 | #011 MEDIUM - OAuth credential review needed | New credential handling added to container-manager.ts; needs file permission and logging audit |
| 2026-02-17 | #010 DOWNGRADED to MEDIUM; HALT LIFTED | 2026-02-15 audit correctly identified measurement error: 143 count included JSONL files; correct count is 21 YAML files |
| 2026-02-15 | #010 measurement error identified | 143 count was wrong (included JSONL files); corrected to ~21 files; HALT was not justified |
| 2026-02-14 | Comprehensive security audit completed | Full attack surface mapping, data flow tracing, controls assessment, threat modeling |
| 2026-02-05 | #001 path traversal FIXED | buildSafeFilePath + AGENT_NAME_PATTERN in place |
| 2026-02-05 | #002 hostConfigOverride ACCEPTED | Required for advanced Docker configurations at fleet level |
| 2026-02-05 | #006 shell:true ACCEPTED | Required for shell hook functionality |

### Known Gaps

Security capabilities not yet implemented or areas needing investigation:

- **MEDIUM NEW: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM NEW: OAuth error logging may leak tokens** - logger.error() calls need review (#011)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files accumulating (#010)
- **MEDIUM: Inbound webhook authentication status unclear** - secret_env in schema but server impl unknown (Q1)
- **LOW: Container user not explicitly set** - default may be root depending on image (Q7)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-02-20 - Incremental audit covering 40 commits
- **Completed:** Scanner run (FAIL - pre-existing), change analysis (OAuth added), hot spot verification (container-manager.ts), #011 discovery
- **Resume from:** Normal operations; next scheduled audit ~2026-02-27
- **Next priority:** OAuth logging review (#011), credential file permissions (#011), job retention policy (#010)

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

