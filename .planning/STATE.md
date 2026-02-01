# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** Autonomous Claude Code agents with full capabilities: if Claude Code can do it manually, herdctl agents can do it automatically.
**Current focus:** Phase 3 - Docker Integration

## Current Position

Phase: 3 of 4 (Docker Integration)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-01 — Phase 2 complete and verified

Progress: [█████░░░░░] 50% (5/10 plans estimated across all phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 3.4 minutes
- Total execution time: 0.3 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Runtime Abstraction Foundation | 2 | 9min | 4.5min |
| 2. CLI Runtime Implementation | 3 | 9min | 3.0min |

**Recent Trend:**
- Last 5 plans: 01-02 (6min), 02-01 (3min), 02-02 (3min), 02-03 (3min)
- Trend: Consistent 3min pace for Phase 2 plans

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Runtime abstraction will provide unified interface regardless of backend
- CLI runtime will watch session files to provide streaming message format
- Docker sessions stored separately from host sessions to prevent path conflicts
- Auth files mounted read-only into containers for security
- **01-01:** AsyncIterable<SDKMessage> for streaming (matches existing SDK pattern)
- **01-01:** SDK does not support AbortController - tracked for future enhancement
- **01-01:** Default to 'sdk' runtime when not specified in agent config
- **01-01:** Added runtime field to AgentConfigSchema for configuration support
- **01-02:** JobExecutor accepts RuntimeInterface via dependency injection
- **01-02:** All execution entry points use RuntimeFactory.create(agent)
- **01-02:** SDK isolation complete - SDK only imported in sdk-runtime.ts
- **01-02:** Deprecated SDKQueryFunction but kept for test compatibility
- **02-01:** Use execa ^9 for process spawning with AbortController support
- **02-01:** Use chokidar ^5 for file watching with awaitWriteFinish debouncing
- **02-01:** CLI messages destructured to avoid type field overwriting when spreading
- **02-01:** CLI session paths encoded by replacing slashes with hyphens
- **02-02:** Handle workspace as string | object in CLIRuntime cwd parameter
- **02-02:** RuntimeFactory now supports both 'sdk' and 'cli' runtime types
- **02-03:** Export CLISessionWatcher for session replay and robustness use cases
- **02-VERIFY:** CLI sessions managed by Claude CLI (in ~/.claude/), separate from herdctl sessions (.herdctl/) - no conflicts

### Pending Todos

None yet.

### Blockers/Concerns

**Future Enhancement:**
- SDK AbortController support: SDK query() doesn't currently accept abortController parameter. Job cancellation will require different approach or SDK update in future.

**Testing:**
- Test suite needs RuntimeInterface mocks - current tests use deprecated SDKQueryFunction mocks causing test failures. This is expected and should be addressed in a future plan.

## Session Continuity

Last session: 2026-02-01 (phase execution)
Stopped at: Completed Phase 2 - CLI Runtime Implementation (all 3 plans executed and verified)
Resume file: None
Next: Phase 2 complete. Ready for Phase 3 (Docker Integration) planning.
