# Roadmap: herdctl Runtime & Docker

## Overview

This roadmap transforms herdctl from SDK-only execution to a flexible, secure platform supporting both Claude SDK (standard pricing) and CLI (Max plan pricing) runtimes, with optional Docker containerization for security isolation. Phase 1 establishes runtime abstraction, Phase 2 adds CLI support, Phase 3 integrates Docker security, and Phase 4 completes documentation and comprehensive testing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Runtime Abstraction Foundation** - Interface design and SDK adapter refactoring
- [x] **Phase 2: CLI Runtime Implementation** - CLI backend with file watching and session parsing
- [ ] **Phase 3: Docker Integration** - Container execution with security hardening
- [ ] **Phase 4: Documentation & Testing** - Complete docs, examples, and comprehensive test coverage

## Phase Details

### Phase 1: Runtime Abstraction Foundation
**Goal**: Establish clean runtime abstraction and refactor existing SDK integration behind unified interface
**Depends on**: Nothing (first phase)
**Requirements**: RUNTIME-01, RUNTIME-02, RUNTIME-04, RUNTIME-09, RUNTIME-10
**Success Criteria** (what must be TRUE):
  1. Runtime interface defines single execute() method returning AsyncIterable<SDKMessage>
  2. Existing SDK integration works unchanged through new SDKRuntime adapter
  3. JobExecutor accepts RuntimeInterface instead of direct SDK calls
  4. RuntimeFactory can instantiate SDK runtime from agent config
  5. Old SDK adapter code removed entirely (no backwards compatibility needed)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md - Create runtime abstraction layer (RuntimeInterface, SDKRuntime, RuntimeFactory)
- [x] 01-02-PLAN.md - Refactor JobExecutor and update call sites to use RuntimeFactory

### Phase 2: CLI Runtime Implementation
**Goal**: Enable CLI runtime backend for Max plan users with file watching and session parsing
**Depends on**: Phase 1
**Requirements**: RUNTIME-03, RUNTIME-05, RUNTIME-06, RUNTIME-07, RUNTIME-08
**Success Criteria** (what must be TRUE):
  1. CLIRuntime spawns claude command successfully via execa
  2. Session files are watched via chokidar with debouncing to prevent race conditions
  3. JSONL session format converts to SDK message stream correctly
  4. Agent configuration accepts runtime: { type: "cli" } and routes to CLIRuntime
  5. CLI sessions (managed by Claude CLI in ~/.claude/) are separate from SDK sessions (in .herdctl/) to prevent path conflicts
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md - Install dependencies (execa, chokidar), create CLI output parser and session path utilities
- [x] 02-02-PLAN.md - Implement CLIRuntime class, update RuntimeFactory to support 'cli' type
- [x] 02-03-PLAN.md - Create session file watcher with chokidar debouncing

### Phase 3: Docker Integration
**Goal**: Provide optional Docker containerization for security isolation with configurable resource limits
**Depends on**: Phase 2
**Requirements**: DOCKER-01, DOCKER-02, DOCKER-03, DOCKER-04, DOCKER-05, DOCKER-06, DOCKER-07, DOCKER-08, DOCKER-09, DOCKER-10, DOCKER-11, CONFIG-01, CONFIG-02, CONFIG-03, CONFIG-04, CONFIG-05, CONFIG-06
**Success Criteria** (what must be TRUE):
  1. ContainerRunner decorator wraps any runtime (SDK or CLI) transparently
  2. Docker containers mount workspace and auth files with correct permissions (workspace read-write, auth read-only or via env var)
  3. Docker sessions stored in .herdctl/docker-sessions/ separate from host sessions
  4. Containers enforce memory limits (default 2g) and optional CPU limits
  5. Network isolation modes (none/bridge/host) configurable per agent
  6. Containers run as non-root user with security flags enabled
  7. Containers auto-cleanup after job completion (--rm flag)
  8. Agent config validates docker options with clear error messages
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md - Extend DockerSchema with full configuration options, create docker-config.ts types
- [ ] 03-02-PLAN.md - Implement ContainerRunner decorator and ContainerManager lifecycle
- [ ] 03-03-PLAN.md - Integrate ContainerRunner into RuntimeFactory, wire up stateDir

### Phase 4: Documentation & Testing
**Goal**: Complete production-ready documentation and comprehensive test coverage
**Depends on**: Phase 3
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10
**Success Criteria** (what must be TRUE):
  1. Documentation explains when to use SDK vs CLI runtime with clear decision matrix
  2. Docker security model and isolation guarantees documented with examples
  3. Example configs provided for all use cases (cost-optimized, development, production, mixed fleet)
  4. Troubleshooting guides address path resolution and Docker container issues
  5. Unit tests achieve 85% coverage for runtime implementations and configuration
  6. Integration tests verify SDK runtime, CLI runtime, and Docker execution end-to-end
  7. Tests validate path translation correctness between host and container
  8. All tests pass with no regressions in existing functionality
**Plans**: TBD

Plans:
- [ ] 04-01: TBD during planning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Runtime Abstraction Foundation | 2/2 | ✓ Complete | 2026-02-01 |
| 2. CLI Runtime Implementation | 3/3 | ✓ Complete | 2026-02-01 |
| 3. Docker Integration | 0/3 | Planned | - |
| 4. Documentation & Testing | 0/TBD | Not started | - |
