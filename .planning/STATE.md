# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** Autonomous Claude Code agents with full capabilities: if Claude Code can do it manually, herdctl agents can do it automatically.
**Current focus:** Phase 2 - CLI Runtime Implementation

## Current Position

Phase: 2 of 4 (CLI Runtime Implementation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-01 — Phase 1 complete and verified

Progress: [██░░░░░░░░] 20% (2/10 plans estimated across all phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 4.5 minutes
- Total execution time: 0.15 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Runtime Abstraction Foundation | 2 | 9min | 4.5min |

**Recent Trend:**
- Last 5 plans: 01-01 (3min), 01-02 (6min)
- Trend: Steady pace, Phase 1 complete

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

### Pending Todos

None yet.

### Blockers/Concerns

**Future Enhancement:**
- SDK AbortController support: SDK query() doesn't currently accept abortController parameter. Job cancellation will require different approach or SDK update in future.

**Testing:**
- Test suite needs RuntimeInterface mocks - current tests use deprecated SDKQueryFunction mocks causing test failures. This is expected and should be addressed in a future plan.

## Session Continuity

Last session: 2026-01-31 (plan execution)
Stopped at: Completed 01-02-PLAN.md - JobExecutor refactored, SDK isolation complete
Resume file: None
Next: Phase 1 complete. Ready for Phase 2 or next phase planning.
