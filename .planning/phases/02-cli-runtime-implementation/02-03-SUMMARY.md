---
phase: 02-cli-runtime-implementation
plan: 03
subsystem: runtime
tags: [chokidar, file-watching, session-replay, cli]
requires: [02-01, 02-02]
provides:
  - CLISessionWatcher for monitoring session files
  - watchSessionFile helper with AbortSignal
affects: []
tech-stack:
  added: []
  patterns: [file-watching-with-debouncing]
decisions:
  - id: session-watcher-exports
    decision: Export CLISessionWatcher for session replay use cases
    rationale: Enables advanced features like session replay and robust message capture from disk
key-files:
  created: []
  modified:
    - packages/core/src/runner/runtime/index.ts
metrics:
  duration: 192
  completed: 2026-02-01
---

# Phase 02 Plan 03: CLI Session File Watcher Summary

**One-liner:** Export CLISessionWatcher utilities for session file monitoring with chokidar debouncing

## What Was Built

This plan exposed the CLISessionWatcher utilities (already implemented in plan 02-02) by adding exports to the runtime module's barrel export file.

**Key deliverables:**
1. CLISessionWatcher exported from runtime module
2. watchSessionFile helper function exported

The actual implementation was already completed in plan 02-02. This plan focused on making those utilities publicly available through proper module exports.

## Files Modified

### packages/core/src/runner/runtime/index.ts
- **Change:** Added CLISessionWatcher and watchSessionFile exports
- **Purpose:** Make session file watching utilities available for session replay and robustness use cases
- **Exports added:**
  - `CLISessionWatcher` - Class for watching session files
  - `watchSessionFile` - Helper function with AbortSignal support

## Implementation Notes

### Session File Watching (Already Implemented in 02-02)

The CLISessionWatcher class provides:
- **Chokidar-based watching:** Uses `chokidar.watch()` for robust file monitoring
- **Debouncing:** `awaitWriteFinish` with 500ms stabilityThreshold prevents partial reads
- **Incremental processing:** Tracks line count to avoid re-processing existing content
- **Message parsing:** Transforms JSONL lines to SDKMessage format using parseCLILine

**Configuration:**
```typescript
chokidar.watch(sessionFilePath, {
  awaitWriteFinish: {
    stabilityThreshold: 500,  // Wait 500ms after last write
    pollInterval: 100,         // Check every 100ms
  },
});
```

### Use Cases

1. **Session Replay:** Read historical session data from disk
2. **Robustness:** Session files persist even if process crashes
3. **Debugging:** Inspect raw CLI session output
4. **Alternative Message Source:** Fallback when stdout streaming isn't available

## Decisions Made

### Export Session Watcher Utilities

**Decision:** Export CLISessionWatcher and watchSessionFile from runtime module

**Rationale:**
- Enables advanced use cases like session replay and debugging
- Provides alternative message source for robustness
- Makes file-watching capabilities accessible to consumers of @herdctl/core

**Alternatives Considered:**
- Keep utilities internal: Would limit flexibility for advanced use cases

**Impact:** Minimal - just adds exports, no behavior changes

## Testing

No tests added in this plan. The CLISessionWatcher implementation was tested in plan 02-02.

## Next Phase Readiness

**Ready for:** Plans that need session file monitoring (session resume, replay features)

**Provides:**
- CLISessionWatcher class for monitoring CLI session files
- watchSessionFile helper with AbortSignal support

**Dependencies satisfied:**
- Depends on 02-01 (CLI output parser, session path utilities) ✓
- Depends on 02-02 (CLISessionWatcher implementation) ✓

**No blockers identified.**

## Deviations from Plan

None - plan executed exactly as written.

The CLISessionWatcher implementation was already completed in plan 02-02. This plan only added the exports as specified.

## Metrics

- **Duration:** 192 seconds (~3.2 minutes)
- **Tasks completed:** 2/2
- **Commits:** 1
- **Files modified:** 1

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 3dba133 | feat | Export CLISessionWatcher from runtime module |
