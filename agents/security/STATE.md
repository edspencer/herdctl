---
last_updated: 2026-10-26T00:00:00Z
last_mapping: 2026-02-14
last_audit: 2026-10-26
commits_since_audit: 0
commits_since_mapping: 255
open_findings: 11
open_questions: 12
status: audit_complete_yellow
---

# Security Audit State

**Last Updated:** 2026-10-26 00:00 UTC

This document provides persistent state for security audits, enabling incremental reviews that build on previous work rather than starting fresh each time.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last full mapping | 2026-02-14 | Comprehensive audit completed |
| Last incremental audit | 2026-10-26 | Incremental - YELLOW - 3 new MEDIUM findings (#013, #014, #015) |
| Commits since last audit | 0 | At 3601bfa (2026-10-26) |
| Open findings | 11 | See [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| Open questions | 12 | 4 new questions (Q15-Q18); 8 carried over |

**Status:** YELLOW - Finding #012 (Web API + file serving) needs documentation; 3 new findings in OAuth and config validation.

### Finding Breakdown

- **Critical: 0**
- **High: 1** (#012 web API auth missing - now includes file serving route)
- High: 1 (accepted risk - hostConfigOverride #002)
- **Medium: 5** (#013 OAuth perms NEW, #014 settings validation NEW, #011 OAuth elevated, #010 job retention, #008 npm audit)
- **Low: 2** (#015 OAuth logging NEW, #009 shell escaping partial fix)
- Intentional: 1 (#005 example config)
- Accepted: 1 (#006 shell:true)

### Question Priorities

- High: 0
- Medium: 9 (Q1 webhook auth, Q4 log injection, Q5 config merge, Q7 container user, Q8 SDK escaping, Q15 OAuth logging NEW, Q16 SDK settings validation NEW, Q17 session adoption NEW, Q18 file serving NEW)
- Low: 3 (Q3 container name chars, Q9 rate limiting, Q10 MCP security, Q11 GitHub SSRF)

---

## Coverage Status

Security coverage by area with staleness tracking.

| Area | Last Checked | Commits Since | Status | Notes |
|------|--------------|---------------|--------|-------|
| Attack surface | 2026-10-26 | 0 | ✅ Current | File serving route added (`/files/:agentName/*`) |
| Data flows | 2026-10-26 | 0 | ✅ Current | OAuth credential injection, MCP bridge auth reviewed |
| Security controls | 2026-10-26 | 0 | ✅ Current | Path traversal defenses verified (Windows fix applied) |
| Threat vectors | 2026-10-26 | 0 | ✅ Current | File serving containment, settings validation gaps assessed |
| Hot spots | 2026-10-26 | 0 | ✅ Current | 4 critical files verified - WARN status |
| Code patterns | 2026-10-26 | 0 | ✅ Current | OAuth logging patterns, settings field validation reviewed |

### Staleness Thresholds

- **Current:** <7 days AND <15 commits since last check
- **STALE:** >=7 days OR >=15 commits since last check
- **Not mapped:** Area has never been systematically reviewed

---

## Active Investigations

Active findings and open questions requiring attention.

| ID | Type | Summary | Priority | Status | Source |
|----|------|---------|----------|--------|--------|
| #012 | Finding | Web API lacks authentication (chat + files) | **HIGH** | OPEN - Needs documentation | [2026-10-26 Report](intel/2026-10-26.md) |
| #013 | Finding | OAuth credential file permissions not enforced | **MEDIUM** | OPEN - Code fix needed | [2026-10-26 Report](intel/2026-10-26.md) |
| #014 | Finding | Unvalidated `settings` config field | **MEDIUM** | OPEN - SDK validation review | [2026-10-26 Report](intel/2026-10-26.md) |
| #011 | Finding | OAuth credential management - risk elevated | **MEDIUM** | YELLOW - Session exposure risk | [2026-10-26 Report](intel/2026-10-26.md) |
| #010 | Finding | bypassPermissions in 22 job files | MEDIUM | YELLOW - Retention policy needed | [FINDINGS-INDEX.md](intel/FINDINGS-INDEX.md) |
| #008 | Finding | npm audit - devalue vulnerabilities | Medium | Update to 5.9.4 | [2026-10-26 Report](intel/2026-10-26.md) |
| #015 | Finding | OAuth error logging may leak tokens | Low | OPEN - Sanitize errors | [2026-10-26 Report](intel/2026-10-26.md) |
| #009 | Finding | Incomplete shell escaping | Low | Partially fixed (updated 2026-10-26) | [2026-10-26 Report](intel/2026-10-26.md) |
| Q15 | Question | OAuth tokens logged during refresh/injection? | Medium | Open - relates to #015 | [2026-10-26 Report](intel/2026-10-26.md) |
| Q16 | Question | SDK settings validation requirements | Medium | Open - relates to #014 | [2026-10-26 Report](intel/2026-10-26.md) |
| Q17 | Question | Session adoption privilege boundaries | Medium | Open - new session system | [2026-10-26 Report](intel/2026-10-26.md) |
| Q18 | Question | Can agents access each other's files via route? | Medium | Open - file serving route | [2026-10-26 Report](intel/2026-10-26.md) |
| Q1 | Question | Webhook authentication | Medium | Related to #012 - web API has no auth | [2026-03-06 Report](intel/2026-03-06.md) |
| Q4 | Question | Log injection via agent output | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q5 | Question | Fleet/agent config merge overrides | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |
| Q8 | Question | SDK wrapper prompt escaping | Medium | Open | [CODEBASE-UNDERSTANDING.md](CODEBASE-UNDERSTANDING.md) |

### Priority Queue

Ordered by urgency for next audit session:

1. **HIGH P1:** Document web dashboard + file serving as localhost-only, warn against network exposure (#012)
2. **MEDIUM P1:** Add file permission enforcement to `writeCredentialsFile()` - use mode 0o600 (#013)
3. **MEDIUM P2:** Review SDK `settings` field validation requirements (#014, Q16)
4. **MEDIUM P3:** Audit session files for OAuth credential leaks (#011 + #012 combined risk)
5. **MEDIUM P4:** Sanitize OAuth error logging to prevent token leaks (#015, Q15)
6. **MEDIUM P5:** Implement job file retention policy (30 days) to resolve #010
7. **MEDIUM P6:** Investigate session adoption privilege boundaries (Q17)
8. **MEDIUM P7:** Test file serving route for cross-agent access (Q18)
9. **LOW:** Complete shell escaping verification (#009)

---

## Accumulated Context

### Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-26 | #013 MEDIUM - OAuth file permissions not enforced | Regression check confirms #011 issue still present; `writeCredentialsFile()` needs mode 0o600 |
| 2026-10-26 | #014 MEDIUM - Settings field unvalidated | New `settings` field uses `z.unknown()` - unknown what SDK settings are security-sensitive |
| 2026-10-26 | #015 LOW - OAuth error logging may leak tokens | HTTP response bodies and error objects logged without redaction |
| 2026-10-26 | #012 UPDATED - File serving route added | `/files/:agentName/*` route added; well-defended but same auth gap as chat API |
| 2026-10-26 | #009 status UPDATED | Shell escaping now handles `$`, backtick, `\`, `"` (missing `!` escape) |
| 2026-10-26 | File serving route APPROVED | Path traversal defenses verified; CSP sandbox headers mitigate untrusted content |
| 2026-10-26 | MCP bridge auth IMPROVED | Bearer token + loopback binding added - security improvement |
| 2026-03-06 | #012 HIGH - Web API lacks authentication | New web API routes have no auth; designed for localhost only; needs documentation |
| 2026-03-06 | #011 risk ELEVATED | Session files exposed via web API may contain OAuth tokens; combined risk with #012 |
| 2026-02-20 | #011 MEDIUM - OAuth credential review needed | New credential handling added to container-manager.ts; needs file permission and logging audit |
| 2026-02-17 | #010 DOWNGRADED to MEDIUM; HALT LIFTED | 2026-02-15 audit correctly identified measurement error: 143 count included JSONL files; correct count is 21 YAML files |
| 2026-02-14 | Comprehensive security audit completed | Full attack surface mapping, data flow tracing, controls assessment, threat modeling |
| 2026-02-05 | #001 path traversal FIXED | buildSafeFilePath + AGENT_NAME_PATTERN in place |
| 2026-02-05 | #002 hostConfigOverride ACCEPTED | Required for advanced Docker configurations at fleet level |
| 2026-02-05 | #006 shell:true ACCEPTED | Required for shell hook functionality |

### Known Gaps

Security capabilities not yet implemented or areas needing investigation:

- **HIGH: Web API + file serving have no authentication** - localhost-only by design but needs documentation (#012)
- **MEDIUM NEW: OAuth credential file permissions not enforced** - writeCredentialsFile() doesn't set 0600 (#013)
- **MEDIUM NEW: Settings field unvalidated** - z.unknown() accepts arbitrary SDK settings (#014)
- **MEDIUM: Session files exposed via web API** - may contain OAuth tokens from error logs (#011 + #012)
- **MEDIUM: Job file retention policy not implemented** - 22 bypassPermissions files accumulating (#010)
- **MEDIUM: GitHub SSRF potential** - no URL allowlist for repository cloning (Q11)
- **LOW NEW: OAuth error logging may leak tokens** - logger.error() calls log response bodies and errors (#015)
- **LOW: Shell escaping incomplete** - missing `!` escape (#009)
- No secret detection in logs (output could leak sensitive data) - Q4
- No rate limiting on triggers (DoS vector for scheduled jobs) - Q9
- Session adoption privilege boundaries unclear - Q17
- File serving cross-agent access untested - Q18

### Session Continuity

- **Last session:** 2026-10-26 - Incremental audit covering 144 commits (7+ months)
- **Completed:** Change analysis, hot-spot verification (WARN), file serving route review, OAuth patterns review, findings #013/#014/#015 discovered, dependency audit
- **Resume from:** Normal operations; next scheduled audit ~2026-11-02
- **Next priority:** Document web dashboard + file serving security model (#012), fix OAuth file permissions (#013), review SDK settings validation (#014)

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

