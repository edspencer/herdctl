# Codebase Concerns

**Analysis Date:** 2026-01-24

## Tech Debt

### Legacy Code Still Present (Pre-MVP Cleanup)

**Issue:** Deprecated code patterns are still in codebase despite being marked for removal. This contradicts the pre-MVP philosophy of "no backwards compatibility."

**Files:**
- `packages/core/src/fleet-manager/event-types.ts` - Legacy schedule:trigger/complete/error events in FleetManagerEventMap
- `packages/core/src/fleet-manager/fleet-manager.ts` - Public emit methods kept for "backwards compatibility" (emitConfigReloaded, emitJobCreated, etc.)
- `packages/core/src/fleet-manager/errors.ts` - Deprecated error classes: FleetManagerStateError, FleetManagerConfigError
- `packages/core/src/config/schema.ts` - Work source backwards compatibility with BaseWorkSourceSchema union type

**Impact:**
- Code duplication increases maintenance burden
- Event system has both old and new patterns, confusing API surface
- Developers may use deprecated classes unintentionally
- Tests are split between old and new patterns (~100 lines of test overhead)

**Fix approach:**
- Delete all legacy event definitions from FleetManagerEventMap
- Remove public emit* methods from FleetManager (use event-emitters module directly)
- Delete deprecated error classes entirely and update all usages
- Simplify work source schema to require full configuration (no BaseWorkSourceSchema fallback)
- Remove deprecated code tests
- Run typecheck to catch any broken usages

See `legacy.md` for detailed cleanup checklist.

---

### Large File Complexity

**Issue:** Several large files exceed 1000 lines, indicating potential single-responsibility violations.

**Files:**
- `packages/core/src/fleet-manager/__tests__/coverage.test.ts` - 2477 lines
- `packages/core/src/runner/__tests__/job-executor.test.ts` - 1955 lines
- `packages/core/src/work-sources/__tests__/github.test.ts` - 1800 lines
- `packages/core/src/fleet-manager/__tests__/integration.test.ts` - 1343 lines
- `packages/core/src/fleet-manager/fleet-manager.ts` - Refactored but check after splitting

**Impact:**
- Test files are comprehensive but harder to maintain and debug
- Navigation and understanding intent is difficult
- Potential for hidden test bugs or incomplete coverage

**Fix approach:**
- These are test files which are often larger; consider if they can be split by test suite
- Consider breaking large test suites into focused files (e.g., separate test files per module class)
- For production code, measure if splitting improves testability

---

## Fragile Areas

### Race Conditions in File I/O with Job Output

**Files:** `packages/core/src/state/job-output.ts`, `packages/core/src/state/job-metadata.ts`

**Why fragile:**
- Multiple job executions may write to the same job output file simultaneously
- `appendFile` is used for JSONL which is atomic at the message level on most systems, but concurrent writes can still interleave improperly if called rapidly
- No locking mechanism prevents multiple agents from writing to the same job's output simultaneously
- Job metadata updates via `atomicWriteYaml` are atomic for individual writes but not for read-modify-write sequences

**Safe modification:**
- Before modifying job output or metadata operations, understand the concurrent execution model
- Test heavily with concurrent job executions from the same agent
- Consider adding file locks or semaphores if multiple jobs for same agent can run simultaneously

**Test coverage:**
- No tests for concurrent writes to job output
- No tests for concurrent metadata updates
- Focus on sequential execution testing only

---

### Concurrency Limits Not Enforced at Job Executor Level

**Files:** `packages/core/src/runner/job-executor.ts`, `packages/core/src/fleet-manager/job-queue.ts`

**Why fragile:**
- Job execution happens in job-executor without checking concurrency limits before spawn
- Limits are managed in JobQueue but actual execution doesn't block/verify
- If scheduler triggers jobs faster than they're dequeued, limits can be exceeded
- No mechanism prevents a schedule from starting 2 jobs if 1 completes between check and spawn

**Safe modification:**
- Understand the synchronization between scheduler loop and job queue dequeue operations
- Before modifying concurrency enforcement, trace full job lifecycle from trigger to execution
- Test with concurrent schedule triggers for the same agent

**Test coverage:**
- Basic concurrency limit tests exist but focus on queue state, not actual execution counts
- No integration tests for fleet-wide concurrency limits during rapid execution

---

### State Directory Initialization Not Idempotent

**Files:** `packages/core/src/state/directory.ts`

**Why fragile:**
- Multiple FleetManager instances starting simultaneously could both try to initialize state directory
- No file locking prevents concurrent initialization attempts
- Race condition possible on directory creation before subdirectories exist

**Safe modification:**
- Before running multiple fleet instances, verify initialization is safe
- Test with parallel FleetManager starts pointing to same state directory

**Test coverage:**
- Initialization tests assume sequential execution
- No stress tests for concurrent state directory access

---

## Missing Critical Features

### No File Locking for State Directory

**Problem:** State persistence assumes single-process access. No locks prevent concurrent modifications.

**Blocks:**
- Running multiple FleetManager instances in same repository
- Distributed job coordination
- Failover scenarios

**Risk:** Silent data corruption or lost state updates if multiple processes write simultaneously.

---

### No Validation of Agent Workspaces

**Problem:** Agent workspace paths are not validated at configuration load time. Bad paths discovered only at runtime.

**Blocks:**
- Early error detection during init
- Clear error messages about missing dependencies

**Risk:** Jobs fail silently with confusing file-not-found errors instead of clear configuration errors.

---

### Limited Error Context in Job Failures

**Files:** `packages/core/src/runner/job-executor.ts`, `packages/core/src/runner/errors.ts`

**Problem:** When SDK calls fail, the error context captured may not include:
- The prompt that was being executed
- The agent configuration (tools, mode)
- The full SDK message stream leading to failure
- Retry information if attempted

**Impact:** Debugging job failures requires manual investigation of raw logs, not programmatic error analysis.

---

### No Graceful Degradation for Missing Claude SDK

**Files:** `packages/core/src/runner/sdk-adapter.ts`

**Problem:** Recent refactor removes sdkQuery option and imports Claude SDK directly. If SDK module is not installed or fails to load, entire fleet manager crashes at import time.

**Blocks:**
- Using herdctl in environments where SDK may not be available initially
- Plugin-based architectures that inject SDK after initialization

**Risk:** Hard dependency makes system fragile; previously injectable dependency was more flexible.

---

## Security Considerations

### Job Output Contains Unfiltered SDK Messages

**Files:** `packages/core/src/state/job-output.ts`, `packages/core/src/runner/job-executor.ts`

**Risk:** Job output stored on disk includes full SDK message stream including tool outputs, system prompts, and intermediate reasoning. If an agent reads file system or has access to job logs, sensitive information is exposed.

**Current mitigation:** None detected. All SDK messages appended directly.

**Recommendations:**
- Add configurable output filtering to remove sensitive fields (system prompts, certain tool outputs)
- Document what data is stored in job output
- Add access control examples for .herdctl directory in documentation
- Consider encryption for job output at rest if handling sensitive data

---

### No Rate Limiting on Schedule Triggers

**Files:** `packages/core/src/scheduler/scheduler.ts`

**Risk:** If a schedule is set to trigger very frequently (e.g., every 100ms), could exhaust resources or cause DOS.

**Current mitigation:** None detected. No minimum interval validation.

**Recommendations:**
- Add validation for minimum interval (e.g., 1 second)
- Add warning for very frequent schedules (e.g., < 5 seconds)
- Document scheduler limitations

---

### GitHub Work Source Credentials in Session Files

**Files:** `packages/core/src/state/session.ts`, `packages/core/src/work-sources/adapters/github.ts`

**Risk:** Session files stored in .herdctl/ may need to contain GitHub credentials or tokens. Not encrypted by default.

**Current mitigation:** None detected.

**Recommendations:**
- Document that .herdctl should be in .gitignore
- Consider encrypting sensitive session data if it will contain credentials
- Add warning if session contains credential patterns

---

## Performance Bottlenecks

### Linear Job Listing with No Indexing

**Files:** `packages/core/src/state/job-metadata.ts`

**Problem:** `listJobs()` reads entire jobs directory and filters in memory. With 10k+ historical jobs, this becomes slow.

**Cause:** No index or database; flat file storage with filesystem enumeration.

**Improvement path:**
- Profile with 1000+ jobs to identify threshold
- Consider JSONL index file for date ranges
- Lazy-load job metadata only when needed

---

### No Pagination for Job Listing

**Files:** `packages/core/src/state/job-metadata.ts`, `packages/cli/src/commands/jobs.ts`

**Problem:** CLI `jobs list` command loads all jobs into memory and displays as one list. With thousands of jobs, this is slow and memory-intensive.

**Cause:** Eager loading of entire job list.

**Improvement path:**
- Add pagination support to ListJobsFilter
- Implement cursor-based pagination for large result sets
- Update CLI to fetch and display jobs in batches

---

### Atomic Writes Always Create Temp Files

**Files:** `packages/core/src/state/utils/atomic.ts`

**Problem:** Every job metadata update creates a temp file, even for small updates. On systems with slow I/O, this adds overhead.

**Cause:** Conservative atomicity implementation to prevent corruption.

**Improvement path:**
- Profile write latency with moderate job counts
- Consider write-ahead logging instead of temp file pattern for metadata
- Only use atomic pattern for critical state (not per-message output)

---

## Test Coverage Gaps

### No Integration Tests for Multiple Concurrent Agents

**Problem:** Concurrency limits are tested in isolation but not with realistic concurrent workloads from multiple agents.

**Files:** `packages/core/src/fleet-manager/__tests__/job-manager.test.ts`

**Risk:** Race conditions in agent scheduling may not be caught.

**Recommendations:**
- Add integration tests that trigger multiple agents with overlapping schedules
- Test concurrent job completion and job queue draining

---

### Limited Scheduler Timing Tests

**Files:** `packages/core/src/scheduler/__tests__/scheduler.test.ts`

**Problem:** Scheduler tests use mocked time and don't test actual timing behavior. Cron expression tests are comprehensive but scheduler integration is sparse.

**Risk:** Actual schedule execution timing may differ from test behavior.

---

### No Tests for Config Hot Reload Under Load

**Files:** `packages/core/src/fleet-manager/config-reload.ts`, `packages/core/src/fleet-manager/__tests__/reload.test.ts`

**Problem:** Config reload is tested but not while jobs are running or schedules are firing.

**Risk:** Race condition between config reload and ongoing job execution.

---

### Minimal Error Path Testing

**Problem:** Error classes are well-defined but many error cases in job execution are not tested (e.g., SDK initialization failure, prompt too large, workspace permission denied).

**Risk:** Errors in production may not match documented error behavior.

**Priority:** Medium - error handling is defensive but untested edge cases exist.

---

## Known Issues

### Job Cancellation May Not Terminate Process Immediately

**Files:** `packages/core/src/fleet-manager/job-control.ts`

**Symptoms:** Cancel job command returns success but process continues for a few seconds.

**Cause:** Process termination is asynchronous and depends on agent responsiveness to SIGTERM.

**Workaround:** Process will be terminated within timeout (configurable).

---

### Config Changes Not Detected on Some File Systems

**Problem:** Config reload watches file modification time which may not work reliably on some file systems (NFS, some cloud storage).

**Files:** `packages/core/src/fleet-manager/config-reload.ts`

**Workaround:** Manual reload via API call works reliably.

---

## Dependencies at Risk

### Reliance on fs.appendFile for JSONL Atomicity

**File:** `packages/core/src/state/utils/atomic.ts`

**Risk:** Documentation of fs.appendFile atomicity guarantees varies by Node.js version and platform. Not fully atomic on all systems (e.g., NFS, some Windows configurations).

**Impact:** Job output JSONL could have interleaved lines from concurrent writes.

**Migration plan:** Add explicit write locks for concurrent output scenarios or switch to database for job output.

---

### YAML Library for State Serialization

**File:** `packages/core/src/state/utils/atomic.ts` (uses yaml.stringify)

**Risk:** YAML can be sensitive to whitespace and comments are stripped. Round-trip fidelity not guaranteed.

**Impact:** If users manually edit YAML state files, changes may not survive round-trip.

**Migration plan:** Consider JSON for state files or add validation after round-trip.

---

## Scaling Limits

### Single-Process Fleet Management

**Current capacity:** Tested up to ~10 agents, unknown upper limit.

**Limit:** Scheduler loop is single-threaded. Beyond ~100 agents, CPU-bound work may create lag.

**Scaling path:**
- Profile scheduler loop with large agent count
- Consider moving schedule checks to separate thread or worker process
- Implement agent batching for schedule evaluation

---

### State Directory Not Suitable for Many Jobs

**Current capacity:** File system enumeration works for ~1000 jobs on typical systems.

**Limit:** Job listing becomes slow (O(n) enumeration of flat directory).

**Scaling path:**
- Add date-based subdirectory structure (year/month/day/) to limit directory size
- Implement job index for quick lookups
- Consider external state store for production deployments

---

### Job Output Size Unbounded

**Problem:** Job output can grow arbitrarily large with no limits. Large jobs can exhaust disk space.

**Files:** `packages/core/src/state/job-output.ts`

**Limit:** No max size enforced.

**Scaling path:**
- Add output size limits per job and fleet
- Implement rotation/archival of old job output
- Consider streaming job output to external storage for large jobs

---

*Concerns audit: 2026-01-24*
