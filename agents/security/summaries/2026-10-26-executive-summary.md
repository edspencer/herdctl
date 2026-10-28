# Security Audit Executive Summary
## 2026-10-26 Daily Audit

**Status:** 🟡 **YELLOW**

**Overall Assessment:** New security findings identified in OAuth handling and configuration validation, but no critical regressions. File serving route added with robust path traversal defenses.

---

## Key Metrics

| Metric | Value | Change |
|--------|-------|--------|
| **Commits Analyzed** | 144 | Since 2026-03-06 (7+ months) |
| **New Findings** | 3 | #013, #014, #015 (2 MEDIUM, 1 LOW) |
| **Total Active Findings** | 11 | +3 from last audit |
| **Critical/High** | 1 | #012 (Web API auth - carryover) |
| **Medium** | 5 | +2 new |
| **Low** | 2 | +1 new |
| **Security Improvements** | 4 | MCP auth, loopback binding, path-safety fix, shell escaping |

---

## New Findings Summary

### 🔴 Finding #013: OAuth Credential File Permissions Not Enforced (MEDIUM)
**File:** `container-manager.ts:336`

`writeCredentialsFile()` does not set file mode to `0600` when writing OAuth credentials. On multi-user systems, this may expose tokens to other users.

**Recommended Fix:** Add `{ mode: 0o600 }` to `fs.writeFileSync()` call.

---

### 🔴 Finding #014: Unvalidated `settings` Config Field (MEDIUM)
**File:** `config/schema.ts:1088`

New `settings` field uses `z.unknown()` which accepts arbitrary data structures without validation. Unknown what SDK settings are security-sensitive.

**Recommended Action:** Review SDK documentation for security-sensitive settings and consider validation.

---

### 🔴 Finding #015: OAuth Error Logging May Leak Tokens (LOW)
**File:** `container-manager.ts:369,389`

OAuth token refresh error handling logs HTTP response bodies and error objects which may contain token data.

**Recommended Fix:** Sanitize error messages before logging to prevent credential leaks.

---

## New Attack Surface

### ✅ File Serving Route: `/files/:agentName/*` (APPROVED)

**Security Posture:** Well-defended with multiple layers of protection.

**Implemented Safeguards:**
- ✅ Structural safety check (rejects `..` and absolute paths)
- ✅ `realpath()` resolution on both working directory and target file
- ✅ Post-resolution containment verification
- ✅ TOCTOU race prevention (single fd for check and read)
- ✅ Type safety (only serves regular files)
- ✅ Content security headers (`CSP: sandbox`, `X-Content-Type-Options: nosniff`)
- ✅ Conservative caching (`max-age=60`)

**Risk:** MEDIUM when exposed on network (relates to Finding #012 - web API has no auth)

**Recommendation:** Document as localhost-only, same as web dashboard.

---

## Security Improvements Noted

1. ✅ **MCP HTTP Bridge Authentication**
   - Bearer token requirement added
   - Loopback binding (127.0.0.1) by default
   - Fixes previous vulnerability where MCP tools were exposed without auth

2. ✅ **Path Traversal Fix (Windows)**
   - Fixed Windows path separator handling in `path-safety.ts`
   - Closes potential traversal on Windows systems

3. ✅ **Shell Escaping Update**
   - Now escapes: `\`, `$`, backtick, `"`
   - Still missing: `!` escape (Finding #009 remains partially fixed)

4. ✅ **File Serving Path Defenses**
   - Comprehensive traversal protections
   - CSP sandbox headers mitigate untrusted agent content

---

## Hot Spot Analysis

**Critical files modified:** 4 (container-manager, container-runner, schema, path-safety)

**Verification Result:** 🟡 **WARN**

| File | Status | Issues |
|------|--------|--------|
| `container-manager.ts` | WARN | OAuth file permissions (#013), error logging (#015) |
| `container-runner.ts` | WARN | Shell escaping incomplete (#009) |
| `config/schema.ts` | WARN | Settings validation gap (#014) |
| `state/session.ts` | PASS | Path safety maintained |

---

## Priority Actions

### Immediate (HIGH)

1. **Document web dashboard security model** (#012)
   - Add "localhost-only by design" to README/docs
   - Warn against network exposure
   - Include file serving route in documentation

### Short-term (MEDIUM)

2. **Fix OAuth credential file permissions** (#013)
   - Add `{ mode: 0o600 }` to `writeCredentialsFile()`
   - Test on multi-user systems

3. **Review SDK `settings` field validation** (#014)
   - Document security-sensitive SDK settings
   - Consider allowlist validation or document accepted risk

4. **Audit session files for credential leaks** (#011)
   - Search existing `.jsonl` files for OAuth tokens
   - Add credential redaction to session export

### Lower Priority (LOW)

5. **Sanitize OAuth error logging** (#015)
   - Redact tokens from HTTP response bodies
   - Sanitize error objects before logging

---

## Carryover Findings Status

| ID | Severity | Status | Change |
|----|----------|--------|--------|
| #012 | HIGH | OPEN | File serving route added to scope |
| #011 | MEDIUM | YELLOW | Relates to new findings #013, #015 |
| #010 | MEDIUM | YELLOW | No change - retention policy still needed |
| #009 | LOW | Partial Fix | Updated escaping (still missing `!`) |
| #008 | MEDIUM | OPEN | npm audit - update `devalue` to 5.9.4 |

---

## Open Questions

**New Questions (Priority: MEDIUM):**
- **Q15:** Are OAuth tokens logged during credential refresh/injection? (relates to #015)
- **Q16:** What SDK settings are security-sensitive? (relates to #014)
- **Q17:** Can session adoption create privilege escalation between agents?
- **Q18:** Can agents access each other's files via the file serving route?

**Carryover Questions:**
- Q1: Webhook authentication (relates to #012)
- Q4: Log injection via agent output
- Q5: Fleet/agent config merge overrides
- Q8: SDK wrapper prompt escaping
- Q11: GitHub SSRF in repo cloning

---

## Dependency Updates

**Major upgrades:**
- **claude-agent-sdk:** `0.1.77` → `0.3.283` (major version jump)
  - **Action:** Review SDK changelog for security fixes

- **Zod:** `v3.25.76` → `v4.4.3` (major version upgrade)
  - No validation regressions detected

- **npm audit:** 11 vulnerabilities in dev dependencies (`docs>astro>devalue`)
  - **Action:** Update `devalue` to 5.9.4

---

## Bottom Line

**What's Good:**
- MCP bridge authentication added (security improvement)
- File serving route has robust path traversal defenses
- Path safety fix for Windows applied
- Shell escaping improved

**What Needs Attention:**
1. OAuth file permissions not enforced (#013)
2. Settings field validation gap (#014)
3. Web dashboard still needs documentation as localhost-only (#012)
4. OAuth error logging needs sanitization (#015)

**Net Security Posture:** Mixed - security improvements present, but new configuration validation gaps and OAuth handling issues identified.

**Recommended Next Audit:** 2026-11-02 (7 days)

---

**Report Generated:** 2026-10-26
**Full Report:** [intel/2026-10-26.md](../intel/2026-10-26.md)
**Findings Index:** [intel/FINDINGS-INDEX.md](../intel/FINDINGS-INDEX.md)
**State:** [STATE.md](../STATE.md)
