# Security Findings Index

This index tracks all security findings discovered through automated scanning
and manual review. Updated after each security review.

## Active Findings

| ID | Severity | Title | First Seen | Status | Location |
|----|----------|-------|------------|--------|----------|
| 010 | **CRITICAL** | **bypassPermissions in 143 production jobs** | 2026-02-12 | 🔴 **RED - CRITICAL (143 files, +31.2%)** | .herdctl/jobs/*.yaml |
| 002 | High | hostConfigOverride can bypass Docker security | 2026-02-05 | ⚠️ Accepted Risk | container-manager.ts |
| 005 | Medium | bypassPermissions in example config | 2026-02-05 | ℹ️ Intentional | examples/bragdoc-developer/ |
| 006 | Medium | shell:true in hook runner | 2026-02-05 | ⚠️ Accepted Risk | hooks/runners/shell.ts |
| 008 | Medium | npm audit parser error | 2026-02-05 | 📋 Manual Check Needed | dependencies |
| 009 | Low | Incomplete shell escaping in Docker prompts | 2026-02-05 | 🔧 Tech Debt | container-runner.ts:157 |

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

**Deep Dive**: [001-path-traversal-agent-names.md](./findings/001-path-traversal-agent-names.md)

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

**Recommendation**: Add complete escaping for defense in depth:
```typescript
const escapedPrompt = prompt
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\$/g, '\\$')
  .replace(/`/g, '\\`')
  .replace(/!/g, '\\!');
```

---

### ID 010: bypassPermissions in Production Job Files 🔴 CRITICAL
**Severity**: CRITICAL (escalated from High on 2026-02-14)
**First Seen**: 2026-02-12
**Location**: `.herdctl/jobs/*.yaml` (143 files as of 2026-02-14 21:04)
**Status**: 🔴 RED - CRITICAL PRIORITY - HALT AUDITS REQUIRED

Production job configuration files in `.herdctl/jobs/` contain `bypassPermissions: true`, which bypasses ALL security checks including:
- Path traversal protection
- File access validation
- Privilege escalation prevention
- Schema validation

**Growth History**:
```
2026-02-12 Initial:   61 files (initial detection)
2026-02-13:           69 files (+8, +13.1%)
2026-02-14 00:10:     85 files (+13, +18.1%)
2026-02-14 02:06:     87 files (+2, +2.4%)
2026-02-14 04:05:     87 files (+0, 0%)
2026-02-14 06:04:     91 files (+4, +4.6%)
2026-02-14 12:08:    103 files (+12, +13.2%)
2026-02-14 14:03:    109 files (+6, +5.8%)
2026-02-14 21:04:    143 files (+34, +31.2%) ← HIGHEST GROWTH RATE
```

**Why CRITICAL**:
1. **Record growth rate**: +31.2% is the highest increase recorded
2. **Unbounded exposure**: 143 files bypass ALL safety mechanisms
3. **Self-defeating loop**: Security audits creating security risk
4. **Accelerating trend**: Growth is exponential, not linear
5. **No mitigation**: No cleanup policy exists

**Root Cause**:
Security audit agents use `bypassPermissions: true` to scan the codebase. Each audit run creates new job files in `.herdctl/jobs/`, which accumulate indefinitely with NO cleanup policy implemented.

**THE SECURITY AUDIT SYSTEM IS CREATING THE SECURITY RISK IT'S DESIGNED TO PREVENT.**

**Impact**:
- **Path Traversal**: Malicious job could read/write ANY file on host
- **Privilege Escalation**: Could modify system files if running as root
- **Data Exfiltration**: Could access sensitive files outside project directory
- **Container Escape**: Combined with other vulnerabilities, could escape container

**Immediate Actions Required (P0 CRITICAL)**:
1. **🛑 HALT all /security-audit-daily executions immediately**
2. **Implement job file retention policy** (keep 7-14 days)
3. **Manual cleanup of old job files** (reduce 143 → ~30)
4. **Review audit agent config** - eliminate bypassPermissions if possible

**Mitigation Strategy**:
```yaml
# Implement retention policy:
# 1. Keep only last 7-14 days of job files
# 2. Archive older jobs to .herdctl/jobs/archive/
# 3. Add automated cleanup on fleet start
# 4. Add cleanup to job lifecycle hooks
```

**Risk Assessment**:
- **Current Risk**: CRITICAL - Unbounded growth with no mitigation
- **Residual Risk** (after cleanup): MEDIUM - Still using bypassPermissions but controlled
- **Target State**: LOW - Remove bypassPermissions from audit agents entirely

**Deep Dive**: See audit reports:
- [2026-02-14-comprehensive-v7.md](2026-02-14-comprehensive-v7.md) (THIS AUDIT - 143 files)
- [2026-02-14-audit-v6.md](2026-02-14-audit-v6.md) (109 files)
- [2026-02-14-daily-audit-v4.md](2026-02-14-daily-audit-v4.md) (103 files - ESCALATION)

---

## Statistics

- **Total Findings**: 10
- **Resolved**: 2
- **False Positives**: 2
- **Active**: 6
  - **Critical: 1 (#010 - 143 files - HALT REQUIRED)**
  - High: 1 (accepted)
  - Medium: 3 (2 accepted, 1 needs manual check)
  - Low: 1 (tech debt)

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
| 2026-02-05 | Claude + Ed | 0 | 3 | Review of findings: 2 false positives, 1 already fixed |
| 2026-02-05 | Claude (automated) | 1 | 0 | Evening review: verified fixes, found shell escaping tech debt |
| 2026-02-06 | /security-audit | 0 | 0 | Automated incremental audit; verified 32 commits (all security improvements); Q2 answered |
| 2026-02-12 | /security-audit | 1 | 0 | Finding #010 discovered - bypassPermissions in 61 job files |
| 2026-02-13 | /security-audit | 0 | 0 | #010 tracking - growth to 69 files (+13.1%) |
| 2026-02-14 | /security-audit | 0 | 0 | #010 monitoring - multiple audits showing unstable growth (85→87→91→103→109) |
| 2026-02-14 21:04 | Manual comprehensive audit | 0 | 0 | **#010 CRITICAL - 143 files (+31.2% highest growth) - HALT REQUIRED** |

---

**Last Updated:** 2026-02-14 21:04 UTC
**Status:** 🔴 CRITICAL RED - DO NOT RUN MORE AUDITS
