---
last_updated: 2026-04-11T00:00:00Z
last_mapping: 2026-02-14
last_audit: 2026-04-11
commits_since_audit: 0
commits_since_mapping: 133
open_findings: 9
open_questions: 10
status: audit_complete_green
---

# Security Audit State

**Last Updated:** 2026-04-11 00:00 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-04-11 | Incremental - GREEN - Path traversal strengthened, 1 new HIGH finding (#013 npm vulns) |
| Commits since last audit | 0 | At 54bff77 (2026-04-11) |
| Open findings | 9 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 10 | Q1, Q4, Q5, Q7, Q8, Q9, Q10, Q11, Q13, Q15, Q16 (5 answered) |

**Status:** GREEN - Security strengthened with path traversal fix; dependency vulnerabilities require triage.

### Finding Breakdown

- **Critical: 0**
- **High: 2** (#013 NEW - npm dependency vulnerabilities 2 crit/15 high/24 mod; #012 web API auth missing)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 4** (#011 OAuth risk elevated, #010 job retention, #008 npm audit superseded, #006 accepted)
- Low: 1 (partially fixed - shell escaping #009)
- Intentional: 1 (#005 example config)

### Question Priorities

- High: 0
- Medium: 7 (Q1 webhook auth, Q4 log injection, Q5 config merge, Q7 container user, Q8 SDK escaping, Q13 encodedPath, Q15 file scanning)
- Low: 3 (Q9 rate limiting, Q10 MCP security, Q11 GitHub SSRF, Q16 voice retention)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-04-11 | 0 | ✅ Current | Discord file attachments + voice transcription analyzed |
| Data flows | 2026-04-11 | 0 | ✅ Current | File upload/download flows traced, MCP HTTP bridges reviewed |
| Security controls | 2026-04-11 | 0 | ✅ Current | Path validation strengthened (commit 31c675c) |
| Threat vectors | 2026-04-11 | 0 | ✅ Current | Prompt injection, path traversal, third-party APIs assessed |
| Hot spots | 2026-04-11 | 0 | ✅ Current | Scanner run complete - 7242ms |
| Code patterns | 2026-04-11 | 0 | ✅ Current | buildSafeFilePath cross-platform fix verified |
| Dependencies | 2026-04-11 | 0 | ⚠️ **STALE** | 2 critical, 15 high npm vulnerabilities - triage needed |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #013 | Finding | npm dependency vulnerability escalation | **HIGH** | OPEN - Triage required | [2026-04-11 Report](intel/2026-04-11.md) |
| #012 | Finding | Web API lacks authentication | **HIGH** | OPEN - Needs documentation | [2026-03-06 Report](intel/2026-03-06.md) |
| #011 | Finding | OAuth credential management - risk elevated | **MEDIUM** | YELLOW - Session exposure risk | [2026-03-06 Report](intel/2026-03-06.md) |
| #010 | Finding | bypassPermissions in 22 job files | MEDIUM | YELLOW - Retention policy needed | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Q15 | Question | File attachment content scanning | Medium | Should we scan uploads for malware? | [2026-04-11 Report](intel/2026-04-11.md) |
| Q13 | Question | encodedPath path traversal | Medium | Partially answered - indirect validation via groups | [2026-03-06 Report](intel/2026-03-06.md) |
| Q1 | Question | Webhook authentication | Medium | Related to #012 - web API has no auth | [2026-03-06 Report](intel/2026-03-06.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q16 | Question | Voice transcription data retention | Low | OpenAI Whisper privacy implications | [2026-04-11 Report](intel/2026-04-11.md) |
| Q11 | Question | GitHub SSRF in repo cloning | Low | Confirmed - no allowlist; mitigations present | [2026-03-06 Report](intel/2026-03-06.md) |
| #009 | Finding | Incomplete shell escaping | Low | Partially fixed (commit a0e7ad8) | [2026-03-06 Report](intel/2026-03-06.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **HIGH P1:** Triage npm dependency vulnerabilities - identify critical packages (#013)
2. **HIGH P2:** Document web dashboard as localhost-only, warn against network exposure (#012)
3. **HIGH P3:** Audit session files for OAuth credential leaks (#011 + #012 combined risk)
4. **MEDIUM P1:** Add encodedPath explicit validation (Q13)
5. **MEDIUM P2:** Review file attachment security model - consider malware scanning (Q15)
6. **MEDIUM P3:** Review OAuth logging for credential leaks (#011)
7. **MEDIUM P4:** Implement job file retention policy (30 days) to resolve #010
8. **LOW P1:** Research OpenAI Whisper data retention policies (Q16)
9. **LOW P2:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-11 | #013 HIGH - npm dependency vulnerabilities escalated | 2 critical, 15 high, 24 moderate; up from 0/4/4; requires immediate triage |
| 2026-04-11 | Path traversal protection STRENGTHENED | Commit 31c675c fixed cross-platform path separator handling |
| 2026-04-11 | Discord file attachments ACCEPTABLE RISK | Comprehensive controls: MIME whitelist, size limits, path validation, cleanup |
| 2026-04-11 | Voice transcription ACCEPTABLE with CAVEATS | Audio sent to OpenAI; users should be aware of data flow |
| 2026-04-11 | Q15 OPENED - File attachment scanning | Should malware scanning be implemented for uploads? |
| 2026-04-11 | Q16 OPENED - Voice retention | Need to research OpenAI Whisper data retention policies |
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

- **HIGH NEW: npm dependency vulnerabilities** - 2 critical, 15 high, 24 moderate requiring triage (#013)
- **HIGH: Web API has no authentication** - localhost-only by design but needs documentation (#012)
- **HIGH: Session files exposed via web API** - may contain OAuth tokens from error logs (#011 + #012)
- **MEDIUM: File attachment malware scanning** - uploads accepted without virus scanning (Q15)
- **MEDIUM: encodedPath validation is indirect** - should add explicit regex validation (Q13)
- **MEDIUM: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#011)
- **MEDIUM: OAuth error logging may leak tokens** - logger.error() calls need review (#011)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files accumulating (#010)
- **LOW: Voice transcription privacy** - data sent to OpenAI without documented retention policy (Q16)
- **LOW: GitHub SSRF potential** - no URL allowlist for repository cloning (Q11)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9

### Session Continuity

- **Last session:** 2026-04-11 - Incremental audit covering 22 commits
- **Completed:** Scanner run (7.2s, FAIL - npm vulns), change analysis (path traversal fix + Discord features), file attachment security review, #013 discovery, Q15/Q16 opened
- **Resume from:** Normal operations; next scheduled audit ~2026-04-18
- **Next priority:** Triage npm vulnerabilities (#013), document web dashboard security model (#012), review file attachment security (Q15)

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

