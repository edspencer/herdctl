# Security Hot Spots

This file lists security-critical code areas that MUST be checked during every security audit. These are the places where vulnerabilities are most likely to occur or have the highest impact if exploited.

**Last Updated**: 2026-02-06
**Update Policy**: Add new hot spots when security-relevant code is added. Remove only when code is deleted.

---

## Critical Hot Spots (Always Check)

These files contain security-critical logic that must be reviewed every audit:

| File | Why Critical | What to Check |
|------|--------------|---------------|
| `packages/core/src/runner/runtime/container-manager.ts` | Docker security hardening, hostConfigOverride, OAuth credential handling | Capability drops intact, no new bypass paths, OAuth file permissions enforced (0600), logger calls don't leak tokens |
| `packages/core/src/runner/runtime/container-runner.ts` | Docker exec, prompt embedding | Shell escaping complete, no injection paths |
| `packages/core/src/config/schema.ts` | Primary input validation | All user strings validated, patterns restrictive |
| `packages/core/src/state/utils/path-safety.ts` | Path traversal defense | No new bypass patterns, tests still pass |
| `packages/core/src/config/interpolate.ts` | Environment variable substitution | No command execution, no nested interpolation |
| `packages/core/src/hooks/runners/shell.ts` | Shell command execution | Timeout enforced, output bounded |

## High-Risk Hot Spots (Check If Changed)

Review these if they've been modified since last audit:

| File | Why High-Risk | What to Check |
|------|---------------|---------------|
| `packages/core/src/runner/runtime/cli-runtime.ts` | Process spawning | Array args used (not shell strings) |
| `packages/core/src/runner/runtime/docker-config.ts` | Docker configuration parsing | No dangerous defaults, validation complete |
| `packages/core/src/state/session.ts` | Session file paths | Uses buildSafeFilePath, no direct path construction |
| `packages/core/src/state/job-metadata.ts` | Job file paths | Uses buildSafeFilePath, no direct path construction |
| `packages/core/src/state/job-output.ts` | Job output file paths | Uses validated job.id in path construction |
| `packages/core/src/runner/job-executor.ts` | Job directory creation | mkdir with job.id (line 183) - uses validated ID |
| `packages/core/src/config/loader.ts` | YAML parsing | Safe mode enabled, no code execution |
| `packages/core/src/hooks/hook-runner.ts` | Hook orchestration | Timeout respected, errors handled |
| `packages/core/src/fleet-manager/job-control.ts` | Job lifecycle | Session IDs validated, no path issues |

## Entry Points (Review for New Attack Surface)

These are the main entry points where external input enters the system:

| Entry Point | Input Source | Trust Level | Key Defenses |
|-------------|--------------|-------------|--------------|
| Fleet config YAML | File system | Medium (user's files) | Zod validation, schema.ts |
| CLI arguments | Command line | Medium (user input) | Commander.js parsing |
| Environment variables | Shell environment | High (user controlled) | interpolate.ts substitution only |
| GitHub webhooks | Network (if enabled) | Low (external) | Signature verification (TODO: verify status) |
| Agent output | Claude responses | Low (AI generated) | Output streaming, no re-parsing |

## Patterns to Grep For

During each audit, search for these potentially dangerous patterns:

```bash
# New path construction without safety
grep -r "path.join\|path.resolve" packages/core/src --include="*.ts" | grep -v "buildSafeFilePath\|__tests__"

# New shell execution
grep -r "shell:\s*true\|exec(\|spawn(" packages/ --include="*.ts" | grep -v "__tests__"

# New eval or dynamic code
grep -r "eval(\|Function(\|vm\." packages/ --include="*.ts"

# Secrets in logs
grep -r "console\.\|logger\." packages/ --include="*.ts" | grep -i "key\|token\|secret\|password"

# New Docker capabilities
grep -r "CapAdd\|Privileged\|hostConfigOverride" packages/ --include="*.ts"

# OAuth credential handling
grep -r "readCredentialsFile\|writeCredentialsFile\|refreshClaudeOAuthToken\|ensureValidOAuthToken" packages/ --include="*.ts"
```

## Recent Additions

Track recently added hot spots here (move to main tables after 30 days):

| Date Added | File | Reason |
|------------|------|--------|
| 2026-02-05 | path-safety.ts | New file for path traversal defense |
| 2026-02-05 | container-runner.ts shell escaping | Found incomplete escaping |
| 2026-02-06 | job-output.ts | Discovered during Q2 audit - constructs paths with job.id |
| 2026-02-06 | job-executor.ts | Discovered during Q2 audit - mkdir with job.id |
| 2026-02-20 | container-manager.ts OAuth code | New credential file read/write/refresh functionality (Finding #011) |

---

## Audit Checklist

Use this checklist during each audit:

### Critical Files
- [ ] container-manager.ts - hostConfigOverride still requires explicit config?
- [ ] container-runner.ts - Shell escaping complete? (Known issue: #009)
- [ ] schema.ts - Any new string fields without validation patterns?
- [ ] path-safety.ts - Still used in all path construction?
- [ ] interpolate.ts - Still only does ${VAR} substitution?
- [ ] shell.ts - Timeout and output limits still enforced?

### Changed Files
- [ ] Identified all files changed since last audit
- [ ] Reviewed each for security implications
- [ ] Flagged any that need deeper investigation

### Attack Surface
- [ ] Any new entry points added?
- [ ] Any new external dependencies?
- [ ] Any new network communication?

### Pattern Search
- [ ] Ran grep patterns above
- [ ] Investigated any new matches
- [ ] Updated hot spots if new critical code found

---

## Notes for Maintainers

When adding new security-critical code:
1. Add it to this file immediately
2. Document what makes it critical
3. Specify what to check during audits
4. Add relevant grep patterns if applicable

When fixing a vulnerability:
1. Add the fix location to hot spots temporarily
2. Verify the fix is checked in subsequent audits
3. Move to "High-Risk" after confirmed stable (30 days)
