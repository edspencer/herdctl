# Security Findings Index

This index tracks all security findings discovered through automated scanning
and manual review. Updated after each security review.

## Active Findings

| ID | Severity | Title | First Seen | Status | Location |
|----|----------|-------|------------|--------|----------|
| 013 | **HIGH** | **npm dependency vulnerabilities (DEGRADED)** | 2026-04-11 | 🔴 OPEN - lodash runtime vuln urgent | dependencies |
| 012 | **HIGH** | **Web API lacks authentication** | 2026-03-06 | 🔴 OPEN - Document localhost-only | packages/web/src/server/routes/chat.ts |
| 011 | **MEDIUM** | **OAuth credential management - risk elevated** | 2026-02-20 | 🟡 YELLOW - Session exposure risk | container-manager.ts + session files |
| 010 | Medium | bypassPermissions in job files (22 files) | 2026-02-12 | 🟡 YELLOW - Retention needed | .herdctl/jobs/*.yaml |
| 002 | High | hostConfigOverride can bypass Docker security | 2026-02-05 | ⚠️ Accepted Risk | container-manager.ts |
| 005 | Medium | bypassPermissions in example config | 2026-02-05 | ℹ️ Intentional | examples/bragdoc-developer/ |
| 006 | Medium | shell:true in hook runner | 2026-02-05 | ⚠️ Accepted Risk | hooks/runners/shell.ts |
| 008 | Medium | npm audit parser error (superseded by #013) | 2026-02-05 | 📋 Manual Check Needed | dependencies |
| 009 | Low | Incomplete shell escaping in Docker prompts | 2026-02-05 | 🔧 Partially Fixed | container-runner.ts (commit a0e7ad8) |

## Resolved Findings

| ID | Title | Fixed In | Verified |
|----|-------|----------|----------|
| 001 | Path traversal via agent names | feature/security-scanner | 2026-02-05 |
| 007 | network:none in example config | Already commented out | 2026-02-05 |

## False Positives (Scanner Limitations)

| ID | Title | Why False Positive | Action |
|----|-------|-------------------|--------|
| 003 | "Secret logging" in init.ts | Logs help text "set GITHUB_TOKEN env var", not actual token | Improve scanner |
| 004 | "Secret logging" in error-handling.ts | Logs help text about missing API key, not actual key | Improve scanner |

## Won't Fix (Accepted Risks)

| ID | Title | Reason | Documented In |
|----|-------|--------|---------------|
| 002 | hostConfigOverride bypass | Required for advanced Docker configuration at fleet level | THREAT-MODEL.md |
| 005 | bypassPermissions in example | Intentional for demo purposes, not production code | CHECKLIST.md |
| 006 | shell:true in hook runner | Required for shell hook functionality; user controls hook config | THREAT-MODEL.md |

---

## Finding Details

### ID 001: Path Traversal via Agent Names ✅ FIXED
**Severity**: High → Resolved
**First Seen**: 2026-02-05
**Status**: Fixed

Agent names were used directly in file paths without validation. A malicious
name like `../../../tmp/evil` could write files outside `.herdctl/`.

**Fix Applied**:
- Added `AGENT_NAME_PATTERN` regex validation to config schema
- Created `buildSafeFilePath()` utility for defense-in-depth
- Updated session.ts and job-metadata.ts to use safe utility

---

### ID 002: hostConfigOverride Bypass ⚠️ ACCEPTED
**Severity**: High
**Status**: Accepted risk with documentation

The `hostConfigOverride` option in Docker config can bypass all security
hardening (capability dropping, no-new-privileges, etc.).

**Why Accepted**:
- Required for legitimate advanced Docker configurations
- Only available at fleet level, not agent level
- Must be explicitly configured by the fleet operator

**Mitigations**:
- Documented in THREAT-MODEL.md
- Security scanner flags all usages
- Schema prevents this at agent config level

---

### ID 003: "Secret Logging" in init.ts ❌ FALSE POSITIVE
**Severity**: Was High → False Positive
**Location**: `packages/cli/src/commands/init.ts:339`

Scanner detected `token` in proximity to a log statement. Manual review
confirmed this is just help text telling users to set an environment variable:
```typescript
console.log("  and set the GITHUB_TOKEN environment variable.");
```

No actual secrets are logged. Scanner needs improvement to understand context.

---

### ID 004: "Secret Logging" in error-handling.ts ❌ FALSE POSITIVE
**Severity**: Was High → False Positive
**Location**: `examples/library-usage/error-handling.ts:443-444`

Scanner detected `api_key` in proximity to log statements. Manual review
confirmed this is help text for missing credentials:
```typescript
console.error("ERROR: Missing ANTHROPIC_API_KEY environment variable");
console.error("  Set it with: export ANTHROPIC_API_KEY=sk-ant-...");
```

The `sk-ant-...` is a placeholder example, not an actual key.

---

### ID 007: network:none in Example ✅ RESOLVED
**Severity**: Medium → Resolved
**Location**: `examples/runtime-showcase/agents/mixed-fleet.yaml:67`

Scanner flagged `network: none` which would break Claude agents. Manual review
found it's already commented out with a warning:
```yaml
#   network: none  # Can't reach APIs!
```

Scanner should skip commented lines.

---

### ID 008: npm Audit Vulnerabilities 📋 TRACKED
**Severity**: Medium
**Status**: Manual check needed

Scanner cannot parse pnpm audit output. Manual verification recommended.

**Action Required:** Run `pnpm audit` manually to check for vulnerabilities.

---

### ID 009: Incomplete Shell Escaping in Docker Prompts 🔧 TECH DEBT
**Severity**: Low
**First Seen**: 2026-02-05 (evening review)
**Location**: `packages/core/src/runner/runtime/container-runner.ts:157-162`
**Status**: Technical debt - low priority

When constructing Docker exec commands, prompts are escaped for `\` and `"` only:
```typescript
const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
```

Missing escapes for shell special characters: `$`, `` ` ``, `!`

**Risk Assessment**:
- Command runs inside container (security boundary)
- Fleet config authors are trusted
- Practical risk is low

**Recommendation**: Add complete escaping for defense in depth.

---

### ID 010: bypassPermissions in Job Files 🟡 DOWNGRADED
**Severity**: MEDIUM (downgraded from CRITICAL on 2026-02-17)
**First Seen**: 2026-02-12
**Location**: `.herdctl/jobs/*.yaml` (22 files as of 2026-02-20)
**Status**: 🟡 YELLOW - Retention policy needed

Job configuration files in `.herdctl/jobs/` contain `bypassPermissions: true`, which bypasses security checks. 

**Growth History**:
```
2026-02-12 Initial:   61 files (initial detection)
2026-02-14:          143 files (measurement ERROR - included JSONL files)
2026-02-17:           21 files (corrected count - YAML only)
2026-02-20:           22 files (+1 in 3 days)
```

**CRITICAL CORRECTION (2026-02-17)**:
The 2026-02-14 audit incorrectly counted 143 files by including JSONL log files. The correct count is **21 YAML job files**, revised to 22 on 2026-02-20. This is 22.9% of total job files (96), not 100% as previously thought.

**Why Downgraded from CRITICAL**:
1. Count was overstated by ~6.8x due to measurement error
2. 22 files over ~3 weeks = expected audit cadence
3. Growth is stable (+1 file in 3 days)
4. Files are in `.herdctl/jobs/` which is internal state
5. Not unbounded growth - just needs cleanup policy

**Root Cause**:
Security audit agents use `bypassPermissions: true` to scan the codebase. Each audit creates new job files which accumulate without cleanup.

**Recommended Actions (MEDIUM Priority)**:
1. Implement 30-day job file retention policy
2. Add automated cleanup on fleet start
3. Consider reducing bypassPermissions scope in audit agents

**Current Risk**: MEDIUM - Needs retention policy but not emergency

---

### ID 011: OAuth Credential Management 🟡 RISK ELEVATED
**Severity**: MEDIUM
**First Seen**: 2026-02-20
**Updated**: 2026-03-06 (risk elevated)
**Location**: `packages/core/src/runner/runtime/container-manager.ts` + session files
**Status**: 🟡 YELLOW - Session exposure risk added

OAuth token refresh functionality added to container-manager.ts reads/writes credentials from `~/.claude/.credentials.json` and refreshes tokens via HTTPS to console.anthropic.com.

**Original Security Concerns**:
1. **File permissions**: No enforcement of 0600 on credentials file
2. **Logging**: logger.error() calls may leak refresh tokens in error messages
3. **Multi-user systems**: Reading from homedir may expose credentials if permissions wrong
4. **Token lifecycle**: Need to verify old tokens are cleared after refresh

**NEW Risk Vector (2026-03-06)**:
Session discovery now reads all `.jsonl` files and exposes them via web API `/api/chat/session/:encodedPath/:sessionId`. These session files may contain:
- OAuth tokens in error messages during auth failures
- Debug output from container-manager.ts OAuth functions
- Credential material in session metadata

**Combined Impact**:
Finding #011 (credentials in files) + Finding #012 (unauthenticated web API) = credential leakage risk if web dashboard exposed on network.

**Code Added**:
- `readCredentialsFile()` - Reads `~/.claude/.credentials.json`
- `writeCredentialsFile()` - Writes updated tokens to disk
- `refreshClaudeOAuthToken()` - HTTPS POST to console.anthropic.com/v1/oauth/token
- `ensureValidOAuthToken()` - Token expiry check with 5-minute buffer

**Recommended Actions (MEDIUM Priority)**:
1. Audit existing session files for credential leaks
2. Review `jsonl-parser.ts` to ensure it doesn't expose sensitive fields via web API
3. Add credential redaction to session export/API functions
4. Add explicit `fs.chmodSync(credsPath, 0o600)` after writeCredentialsFile()
5. Review all logger calls in OAuth functions - ensure no token data in messages

**Introduced In**: Commits fd8f39d, 0953e36 (2026-02-17 to 2026-02-20)

---

### ID 012: Web API Lacks Authentication 🔴 NEW
**Severity**: HIGH
**First Seen**: 2026-03-06
**Location**: `packages/web/src/server/routes/chat.ts`
**Status**: 🔴 OPEN - Requires documentation

The web dashboard added four new REST API endpoints in commit 01274a8 (PR #144) with no authentication:
- `GET /api/chat/recent` - List recent sessions across all agents
- `GET /api/chat/config` - Read fleet web config
- `GET /api/chat/all` - List all discovered sessions
- `GET /api/chat/session/:encodedPath/:sessionId` - Read arbitrary session files

**Security Impact**:
- **Information disclosure:** Full access to all chat session history
- **Session enumeration:** Attacker can list all sessions and working directories
- **Credential exposure:** Sessions may contain OAuth tokens (Finding #011)
- **No audit trail:** No logging of who accessed what sessions

**Risk Assessment**:
- **Localhost deployment (default):** LOW risk - implicit trust boundary
- **LAN/Internet deployment:** HIGH risk - unauthorized access to sensitive data

**Evidence**:
- Routes registered with no authentication middleware (chat.ts:22-27)
- No JWT, session cookies, API keys, or authorization headers present
- CORS allows localhost origins only (consistent with local dev use)
- Default binding: `host: "localhost"` (safe)

**Recommendation**:
1. **IMMEDIATE:** Document that web dashboard is localhost-only by design
2. **IMMEDIATE:** Add warning against binding to `0.0.0.0` or exposing on network
3. **MEDIUM:** Add explicit validation of `encodedPath` parameter (defense-in-depth)
4. If network deployment needed: implement JWT/session auth, path validation, audit logging, TLS

**Related Findings**:
- Finding #011 (OAuth credentials in sessions)
- Q1 (webhook authentication)

**Introduced In**: Commit 01274a8 (PR #144, 2026-03-06)

---

### ID 013: npm Dependency Vulnerabilities (DEGRADED) 🔴 HIGH
**Severity**: HIGH
**First Seen**: 2026-04-11
**Location**: Package dependencies
**Status**: 🔴 OPEN - lodash runtime vulnerability urgent

**Vulnerability Count History:**
```
2026-03-06:  0 critical,  4 high,  4 moderate                  =  8 total
2026-04-11:  2 critical, 15 high, 24 moderate                  = 41 total (↑33)
2026-04-17:  1 critical, 16 high, 30 moderate, 4 low           = 51 total (↑10)
```

**Current Status (2026-04-17):**
- **1 CRITICAL** (↓1 from previous - improvement)
- **16 HIGH** (↑1 from previous - regression)
- **30 MODERATE** (↑6 from previous - regression)
- **4 LOW** (new)
- **Total: 51 vulnerabilities** (↑10 since last audit)

**Most Affected Packages:**
1. **lodash** (discord.js dependency) - 3 vulnerabilities - **RUNTIME IMPACT**
2. **devalue** (Astro docs) - 7+ vulnerabilities - dev-only
3. **picomatch** (Astro/unstorage) - 2+ vulnerabilities - dev-only
4. **h3** (Astro/unstorage) - 4 vulnerabilities - dev-only
5. **dompurify** (Mermaid) - 5+ vulnerabilities - dev-only

**Impact Assessment:**
- **CRITICAL:** lodash vulnerability affects Discord connector runtime (production impact)
- **MEDIUM:** Most other vulnerabilities are in documentation build dependencies (dev-only)
- **POSITIVE:** 1 critical vulnerability resolved since last audit

**Scanner Output (2026-04-17):**
```
npm-audit: 4 findings
  - CRITICAL: 1 critical vulnerability in dependencies
  - HIGH: 16 high severity vulnerabilities in dependencies
  - MEDIUM: 30 moderate vulnerabilities in dependencies
  - LOW: 4 low severity vulnerabilities in dependencies
```

**Recommended Actions (Updated Priority):**
1. **URGENT (24-48 hours):** Triage lodash vulnerability in Discord connector (runtime impact)
2. **URGENT (24-48 hours):** Update Discord dependencies to resolve lodash vulnerability
3. **HIGH (7 days):** Run `pnpm update` to pull latest patches
4. **HIGH (7 days):** Update Astro dependencies (dev-only impact)
5. **MEDIUM (30 days):** Review if Mermaid/dompurify vulnerabilities affect built artifacts
6. **MEDIUM (30 days):** Implement automated dependency scanning in CI/CD
7. **MEDIUM (30 days):** Set up security advisory alerts (GitHub Dependabot)

**Status Update:**
- ✅ **Positive:** 1 critical vulnerability resolved (2→1)
- ⚠️ **Concern:** Net increase of 10 vulnerabilities (41→51)
- 🔴 **Urgent:** lodash vulnerability affects runtime Discord connector

**Related Findings:**
- Finding #008 (npm audit parser error) - superseded by this finding

**Audit History:**
- 2026-04-11: Discovery - 41 vulnerabilities (2 crit, 15 high, 24 mod)
- 2026-04-17: Degraded - 51 vulnerabilities (1 crit, 16 high, 30 mod, 4 low)

---

## Statistics

- **Total Findings**: 13
- **Resolved**: 2
- **False Positives**: 2
- **Active**: 9
  - Critical: 0
  - **High: 2 (npm vulns #013, web API auth #012)**
  - High: 1 (accepted - hostConfigOverride)
  - **Medium: 4 (1 elevated #011, 1 retention #010, 1 accepted #006, 1 superseded #008)**
  - Low: 1 (partially fixed - shell escaping #009)

---

## Scanner Improvements Needed

Based on false positives identified:

1. **env-handling check**: Should analyze context, not just proximity of
   keywords to log statements. Help text about env vars is not secret logging.

2. **docker-config check**: Should skip YAML comments when looking for
   dangerous patterns like `network: none`.

---

## Review History

| Date | Reviewer | New Findings | Resolved | Notes |
|------|----------|--------------|----------|-------|
| 2026-02-05 | Claude + Ed | 8 | 1 | Initial baseline + path traversal fix |
| 2026-02-05 | Claude + Ed | 0 | 3 | Review: 2 false positives, 1 already fixed |
| 2026-02-05 | Claude (automated) | 1 | 0 | Shell escaping tech debt discovered |
| 2026-02-06 | /security-audit | 0 | 0 | Incremental audit; 32 commits verified |
| 2026-02-12 | /security-audit | 1 | 0 | #010 discovered - bypassPermissions in job files |
| 2026-02-14 | Manual audit | 0 | 0 | #010 CRITICAL escalation (measurement ERROR) |
| 2026-02-17 | /security-audit | 0 | 0 | **#010 DOWNGRADED** - corrected count: 21 files |
| 2026-02-20 | /security-audit | 1 | 0 | **#011 NEW** - OAuth credential management |
| 2026-03-06 | /security-audit | 1 | 0 | **#012 NEW** - Web API lacks auth; #011 risk elevated; 71 commits |
| 2026-04-11 | /security-audit | 1 | 0 | **#013 NEW** - npm vulns escalated (2 crit, 15 high); 22 commits; GREEN status |
| 2026-04-17 | /security-audit | 0 | 0 | **#013 DEGRADED** - npm vulns increased to 51 (1 crit, 16 high); 10 commits; YELLOW status |

---

**Last Updated:** 2026-04-17
**Status:** 🟡 YELLOW - Dependency vulnerabilities degraded, lodash runtime vulnerability urgent

