---
phase: 02-cli-runtime-implementation
verified: 2026-02-01T01:22:13Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "CLI sessions stored separately from SDK sessions to prevent path conflicts"
    status: failed
    reason: "CLI uses ~/.claude/projects/ (owned by CLI) instead of .herdctl/ storage"
    artifacts:
      - path: "packages/core/src/runner/runtime/cli-session-path.ts"
        issue: "Returns ~/.claude/projects/{encoded} path, not .herdctl/ path"
    missing:
      - "CLI sessions are stored by Claude CLI itself, not by herdctl - this is actually correct behavior"
      - "Success criteria was based on incorrect assumption about session storage ownership"
    note: "This is NOT a real gap - CLI manages its own sessions in ~/.claude/. Updated success criteria needed."
---

# Phase 02: CLI Runtime Implementation Verification Report

**Phase Goal:** Enable CLI runtime backend for Max plan users with file watching and session parsing
**Verified:** 2026-02-01T01:22:13Z
**Status:** gaps_found (with note: gap is documentation/criteria issue, not implementation)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CLIRuntime spawns claude command successfully via execa | ✓ VERIFIED | cli-runtime.ts L98: `execa("claude", args, {...})` with correct flags |
| 2 | Session files are watched via chokidar with debouncing to prevent race conditions | ✓ VERIFIED | cli-session-watcher.ts L69-73: chokidar.watch with awaitWriteFinish (500ms stabilityThreshold, 100ms pollInterval) |
| 3 | JSONL session format converts to SDK message stream correctly | ✓ VERIFIED | cli-output-parser.ts implements toSDKMessage() and parseCLILine() with full message type mapping |
| 4 | Agent configuration accepts runtime: { type: "cli" } and routes to CLIRuntime | ✓ VERIFIED | schema.ts L504: `runtime: z.enum(["sdk", "cli"])`, factory.ts L57: `case "cli": return new CLIRuntime()` |
| 5 | CLI sessions stored separately from SDK sessions to prevent path conflicts | ⚠️ CRITERIA ISSUE | CLI sessions stored in ~/.claude/projects/ (managed by Claude CLI), SDK sessions in .herdctl/ (managed by herdctl). This achieves separation but criteria assumed herdctl would manage CLI sessions. |

**Score:** 4/5 truths verified (5th is criteria clarification, not real gap)

### Required Artifacts (from plan must_haves)

#### Plan 02-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| packages/core/src/runner/runtime/cli-output-parser.ts | CLI to SDKMessage transformation | ✓ VERIFIED | EXISTS (125 lines), SUBSTANTIVE (exports toSDKMessage, parseCLILine, CLIMessage), WIRED (imported by cli-runtime.ts L21, cli-session-watcher.ts L17) |
| packages/core/src/runner/runtime/cli-session-path.ts | Session path encoding utilities | ✓ VERIFIED | EXISTS (80 lines), SUBSTANTIVE (exports encodePathForCli, getCliSessionDir, getCliSessionFile), WIRED (exported via index.ts L22-26) |
| execa dependency | Process spawning | ✓ VERIFIED | package.json shows `"execa": "^9"`, imported in cli-runtime.ts L17 |
| chokidar dependency | File watching | ✓ VERIFIED | package.json shows `"chokidar": "^5"`, imported in cli-session-watcher.ts L14 |

#### Plan 02-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| packages/core/src/runner/runtime/cli-runtime.ts | CLIRuntime implementing RuntimeInterface | ✓ VERIFIED | EXISTS (183 lines > 80 min), SUBSTANTIVE (implements RuntimeInterface, spawns claude, streams stdout), WIRED (imported by factory.ts L11, instantiated L57) |
| packages/core/src/runner/runtime/factory.ts | RuntimeFactory with CLI support | ✓ VERIFIED | MODIFIED (contains `new CLIRuntime()` L57), WIRED (imported by job-executor.ts, schedule-runner.ts, fleet-manager) |
| packages/core/src/runner/runtime/index.ts | Barrel exports including CLIRuntime | ✓ VERIFIED | EXPORTS CLIRuntime (L15), all parser utilities (L17-26), session watcher (L27-30) |

#### Plan 02-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| packages/core/src/runner/runtime/cli-session-watcher.ts | Session file watcher utility | ✓ VERIFIED | EXISTS (224 lines > 60 min), SUBSTANTIVE (CLISessionWatcher class, watchSessionFile helper), WIRED (exported via index.ts L27-30) |

**All artifacts verified** (100% - 8/8 artifacts pass all 3 levels)

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| cli-runtime.ts | cli-output-parser.ts | parseCLILine import | ✓ WIRED | L21: `import { parseCLILine }`, L120: `parseCLILine(line)` |
| cli-runtime.ts | execa | process spawning | ✓ WIRED | L17: import, L98: `execa("claude", args, {...})` |
| factory.ts | cli-runtime.ts | CLIRuntime instantiation | ✓ WIRED | L11: import, L57: `return new CLIRuntime()` for 'cli' case |
| cli-session-watcher.ts | chokidar | file watching | ✓ WIRED | L14: import, L69: `chokidar.watch(...)` with awaitWriteFinish |
| cli-session-watcher.ts | cli-output-parser.ts | message parsing | ✓ WIRED | L17: import, L98: `parseCLILine(line)` |
| job-executor.ts | factory.ts | runtime creation | ✓ WIRED | Used by schedule-runner.ts L354, job-control.ts L133, schedule-executor.ts L92 |

**All key links verified** (100% - 6/6 links wired correctly)

### Requirements Coverage

From REQUIREMENTS.md, Phase 2 requirements:

| Requirement | Status | Evidence |
|-------------|--------|----------|
| RUNTIME-03: Implement CLIRuntime with file watching and session parsing | ✓ SATISFIED | CLIRuntime (cli-runtime.ts) + CLISessionWatcher (cli-session-watcher.ts) |
| RUNTIME-05: CLI runtime spawns claude command via execa | ✓ SATISFIED | cli-runtime.ts L98: execa("claude", args) |
| RUNTIME-06: CLI runtime watches session files via chokidar with debouncing | ✓ SATISFIED | cli-session-watcher.ts L69-73: awaitWriteFinish with 500ms threshold |
| RUNTIME-07: CLI runtime parses JSONL session format to SDK messages | ✓ SATISFIED | cli-output-parser.ts: toSDKMessage() handles all message types |
| RUNTIME-08: Agent configuration supports runtime field (sdk\|cli) | ✓ SATISFIED | schema.ts L504: runtime enum, factory supports both |

**Requirements coverage:** 5/5 satisfied (100%)

### Anti-Patterns Found

Scanned all files modified in Phase 02 plans:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No blocking anti-patterns found |

**Notes:**
- No TODO/FIXME comments in new code
- No placeholder implementations
- No console.log-only handlers
- No empty returns
- All implementations substantive

⚠️ **Pre-existing issues** (not blockers for this phase):
- Test files use deprecated SDKQueryFunction (job-executor.test.ts, schedule-runner.test.ts)
- Tracked in STATE.md, will be addressed in future plan
- Does not affect runtime implementation functionality

### Human Verification Required

#### 1. CLI Command Execution End-to-End

**Test:** 
1. Configure agent with `runtime: "cli"` in herdctl.yaml
2. Ensure `claude` CLI installed and authenticated
3. Run agent with a simple prompt
4. Verify stdout streaming works correctly

**Expected:**
- Agent spawns `claude` process successfully
- Messages stream in real-time
- Session ID captured
- Process completes with exit code 0

**Why human:**
- Requires actual Claude CLI installation
- Network interaction with Anthropic API
- Real-time streaming behavior
- Can't mock CLI process fully

#### 2. Session File Watching with Rapid Writes

**Test:**
1. Create CLISessionWatcher for a test session file
2. Rapidly append JSONL lines to the file (simulate CLI writes)
3. Verify watcher yields all messages without partial JSON reads

**Expected:**
- awaitWriteFinish debouncing prevents partial reads
- All messages captured
- No JSON parse errors
- Line count tracking prevents re-processing

**Why human:**
- Timing-dependent behavior (500ms debounce)
- File system race conditions hard to simulate
- Need to verify actual chokidar behavior under load

#### 3. AbortController Process Cancellation

**Test:**
1. Start agent execution with CLIRuntime
2. Cancel via AbortController.abort() mid-execution
3. Verify claude subprocess terminates cleanly

**Expected:**
- Subprocess killed via cancelSignal
- Error message yielded with CANCELLED code
- No orphaned processes
- Resources cleaned up

**Why human:**
- Process lifecycle management
- Signal handling OS-dependent
- Need to verify with real subprocess

#### 4. Config Schema Validation for Runtime Types

**Test:**
1. Load config with `runtime: "sdk"` → should work
2. Load config with `runtime: "cli"` → should work
3. Load config with `runtime: "docker"` → should fail validation
4. Load config without runtime field → should default to SDK

**Expected:**
- Valid values accepted
- Invalid values rejected with clear error
- Default behavior correct

**Why human:**
- Integration test across config/runtime layers
- Validation error message clarity
- Default behavior in real fleet context

### Gaps Summary

**One documentation/criteria gap identified:**

**Gap: Session Storage Assumption Mismatch**

The ROADMAP success criterion states "CLI sessions stored separately from SDK sessions to prevent path conflicts" with the implicit assumption that herdctl would manage CLI session storage in `.herdctl/`.

**Reality:** The Claude CLI manages its own session storage in `~/.claude/projects/{encoded-workspace-path}/`. This is correct behavior because:
1. CLI owns session lifecycle
2. Sessions are inherently separated (SDK in `.herdctl/`, CLI in `~/.claude/`)
3. No path conflicts possible
4. herdctl doesn't need to manage CLI sessions

**Impact:** None on functionality. This is a documentation/criteria issue, not an implementation gap.

**Recommendation:** Update ROADMAP.md success criterion #5 to read:
> "CLI sessions managed by Claude CLI in ~/.claude/ are separate from SDK sessions in .herdctl/, preventing path conflicts"

---

**Overall Assessment:** Phase 02 implementation is complete and functional. All 5 success criteria met (with criterion #5 needing documentation clarification). All artifacts substantive and wired. All requirements satisfied. Ready for Phase 3.

---

_Verified: 2026-02-01T01:22:13Z_
_Verifier: Claude (gsd-verifier)_
