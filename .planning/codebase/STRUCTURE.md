# Codebase Structure

**Analysis Date:** 2026-01-24

## Directory Layout

```
herdctl/
├── .changeset/              # Changesets for version management
├── .github/                 # GitHub Actions workflows
├── .planning/codebase/      # GSD codebase analysis documents (this directory)
├── docs/                    # Astro/Starlight documentation site → herdctl.dev
├── examples/                # Example configurations and quickstarts
├── packages/
│   ├── core/                # @herdctl/core - Main library
│   │   ├── src/
│   │   │   ├── config/              # Configuration parsing and validation
│   │   │   ├── fleet-manager/       # Orchestration layer (FleetManager)
│   │   │   ├── runner/              # Agent execution (Claude SDK bridge)
│   │   │   ├── scheduler/           # Schedule polling and triggering
│   │   │   ├── state/               # Persistence (.herdctl/ directory)
│   │   │   ├── work-sources/        # External system adapters (GitHub)
│   │   │   └── index.ts             # Main export barrel
│   │   ├── __tests__/               # Tests at package root (Vitest)
│   │   ├── vitest.config.ts
│   │   └── package.json
│   ├── cli/                 # herdctl - CLI thin client
│   │   ├── bin/             # CLI executable
│   │   ├── src/
│   │   │   ├── commands/            # Command handlers (init, start, stop, etc.)
│   │   │   └── index.ts             # Main CLI entry point
│   │   ├── __tests__/               # Tests for commands
│   │   ├── vitest.config.ts
│   │   └── package.json
│   ├── web/                 # @herdctl/web - Dashboard (future)
│   ├── discord/             # @herdctl/discord - Discord bot (future)
│   └── package.json         # Workspace root (pnpm)
├── tasks/                   # PRD drafts and task tracking
├── CLAUDE.md                # Development guidelines and philosophy
├── SPEC.md                  # Full specification document
├── plan.md                  # Implementation plan and PRD tracking
└── package.json             # Monorepo root
```

## Directory Purposes

**packages/core/src/config:**
- Purpose: Parse herdctl.yaml and agent YAML files, validate with Zod, resolve defaults
- Contains: Schemas (Zod), loader, parser, merge logic, env interpolation
- Key files:
  - `schema.ts`: All Zod validation schemas (400+ lines)
  - `loader.ts`: Auto-discover and load herdctl.yaml
  - `parser.ts`: Convert YAML to ResolvedConfig
  - `merge.ts`: Merge defaults with agent-specific overrides
  - `interpolate.ts`: ${VAR} environment variable substitution

**packages/core/src/fleet-manager:**
- Purpose: High-level orchestration exposing unified API to CLI/Web
- Contains: Main FleetManager class, 6 module classes, event types, error classes
- Key files:
  - `fleet-manager.ts`: Main class (350 lines), composition root
  - `types.ts`: Type definitions for config, state, events (800+ lines)
  - `status-queries.ts`: Read-only status methods
  - `schedule-management.ts`: Enable/disable/get schedules
  - `config-reload.ts`: Hot-reload herdctl.yaml
  - `job-control.ts`: Trigger, cancel, fork jobs
  - `log-streaming.ts`: Stream logs with filtering
  - `schedule-executor.ts`: Execute scheduled jobs
  - `event-types.ts`: Event payload types
  - `context.ts`: Interface for module-to-FleetManager communication
  - `errors.ts`: Typed error classes

**packages/core/src/scheduler:**
- Purpose: Continuously poll schedules and trigger agents on interval/cron
- Contains: Polling loop, interval/cron calculations, schedule state tracking
- Key files:
  - `scheduler.ts`: Main Scheduler class (polling loop)
  - `interval.ts`: Parse and calculate interval schedules (e.g., "5m", "1h")
  - `cron.ts`: Parse and calculate cron schedules (node-cron wrapper)
  - `schedule-state.ts`: Read/write schedule state (lastRunAt, nextRunAt)
  - `schedule-runner.ts`: Run individual schedules
  - `types.ts`: Scheduler types and callback signatures
  - `errors.ts`: SchedulerError, SchedulerShutdownError

**packages/core/src/runner:**
- Purpose: Execute agents as child processes with Claude SDK integration
- Contains: Job executor, SDK adapter, message processor
- Key files:
  - `job-executor.ts`: Main class that executes jobs (300+ lines)
  - `sdk-adapter.ts`: Convert FleetManager options to SDK options
  - `message-processor.ts`: Parse SDK messages, extract summaries
  - `types.ts`: RunnerOptions, RunnerResult, SDKMessage types
  - `errors.ts`: RunnerError, SDKInitializationError, etc.

**packages/core/src/state:**
- Purpose: Persist fleet, job, session, and schedule state to .herdctl/ directory
- Contains: Fleet state, job metadata, job output, session info, atomic writes
- Key files:
  - `fleet-state.ts`: Read/write fleet state (state.yaml)
  - `job-metadata.ts`: Create/read/update job records (jobs/<id>.yaml)
  - `job-output.ts`: Stream job output (jobs/<id>.output)
  - `session.ts`: Track session lifecycle (session.yaml)
  - `directory.ts`: Initialize and manage .herdctl/ directory
  - `schemas/`: Zod schemas for all state files
  - `utils/atomic.ts`: Atomic YAML writes
  - `utils/reads.ts`: Safe YAML reads with validation
  - `errors.ts`: StateFileError, InvalidStateError

**packages/core/src/work-sources:**
- Purpose: Adapt external systems (GitHub) into work items for agents
- Contains: Registry, adapters, manager interface
- Key files:
  - `manager.ts`: WorkSourceManager interface
  - `registry.ts`: Register adapters per agent
  - `adapters/github.ts`: GitHub Issues adapter (with Octokit)
  - `types.ts`: WorkItem, WorkSourceAdapter interfaces
  - `errors.ts`: WorkSourceError, GitHubAdapterError

**packages/cli/src/commands:**
- Purpose: Command handlers, each creates FleetManager and calls methods
- Contains: Implementation for init, start, stop, status, logs, trigger, jobs, job, cancel, config
- Key files:
  - `init.ts`: `herdctl init` - interactive setup
  - `start.ts`: `herdctl start` - start fleet with live logs
  - `stop.ts`: `herdctl stop` - graceful shutdown
  - `status.ts`: `herdctl status [agent]` - fleet/agent status
  - `logs.ts`: `herdctl logs [agent]` - tail agent/job logs
  - `trigger.ts`: `herdctl trigger <agent>` - manual trigger
  - `jobs.ts`: `herdctl jobs` - list recent jobs
  - `job.ts`: `herdctl job <id>` - show job details
  - `cancel.ts`: `herdctl cancel <id>` - cancel running job
  - `config.ts`: `herdctl config validate/show` - config operations

**packages/core/__tests__:**
- Purpose: Unit and integration tests for core library
- Structure: Tests co-located at package root (not src/__tests__)
- Key test files:
  - `coverage.test.ts`: Test coverage assertions
  - `errors.test.ts`: Error class behavior
  - `reload.test.ts`: Config hot-reload
  - (Others for scheduler, runner, state, etc.)

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts`: Main library exports (all public APIs)
- `packages/cli/src/index.ts`: CLI entry point, command setup (commander)
- `packages/cli/bin/`: Executable symlink to CLI
- `SPEC.md`: Full project specification
- `CLAUDE.md`: Development guidelines

**Configuration:**
- `herdctl.yaml`: Fleet configuration (example in examples/)
- `packages/*/package.json`: Package metadata and scripts
- `pnpm-workspace.yaml`: Monorepo workspace configuration (root)
- `turbo.json`: Build caching and task definitions
- `vitest.config.ts`: Test runner config (per package)

**Core Logic:**
- `packages/core/src/fleet-manager/fleet-manager.ts`: Orchestration root
- `packages/core/src/scheduler/scheduler.ts`: Polling loop
- `packages/core/src/runner/job-executor.ts`: Agent execution
- `packages/core/src/config/schema.ts`: Configuration validation
- `packages/core/src/state/fleet-state.ts`: Persistence

**Testing:**
- `packages/core/__tests__/`: Core test suite
- `packages/cli/src/commands/__tests__/`: Command tests
- Each test file: `*.test.ts` suffix, Vitest framework

**Examples:**
- `examples/hello-world/`: Minimal getting started example
- `examples/price-checker/`: Price monitoring with Discord notifications
- `examples/hurricane-watcher/`: Weather monitoring example
- `examples/library-usage/`: TypeScript library usage

## Naming Conventions

**Files:**
- Source files: `kebab-case.ts` (e.g., `job-executor.ts`, `fleet-state.ts`)
- Test files: `*.test.ts` (e.g., `errors.test.ts`)
- Configuration: `*.config.ts` or lowercase (e.g., `vitest.config.ts`, `herdctl.yaml`)
- Special: `index.ts` for barrel exports, `types.ts` for type definitions

**Directories:**
- Modules: `kebab-case` (e.g., `fleet-manager`, `job-control`)
- Subdirectories: `kebab-case` (e.g., `work-sources`, `state/schemas`)
- Test: `__tests__/` (double underscore convention, co-located)

**Classes:**
- PascalCase (e.g., `FleetManager`, `Scheduler`, `JobExecutor`)
- Error classes: Suffix with `Error` (e.g., `FleetManagerError`, `RunnerError`)

**Types/Interfaces:**
- PascalCase (e.g., `ResolvedConfig`, `AgentInfo`, `JobMetadata`)
- Unions: Descriptive PascalCase (e.g., `FleetManagerStatus`, `JobStatus`)
- Options: Suffix with `Options` (e.g., `FleetManagerOptions`, `TriggerOptions`)
- Payloads: Suffix with `Payload` (e.g., `JobCreatedPayload`)

**Functions:**
- camelCase (e.g., `loadConfig`, `createJob`, `updateScheduleState`)
- Utilities: Descriptive (e.g., `isScheduleDue`, `calculateNextTrigger`)
- Factory: Prefix with `create` (e.g., `createInitialFleetState`)

**Constants:**
- UPPER_SNAKE_CASE (e.g., `DEFAULT_CHECK_INTERVAL`, `DEFAULT_STATE_DIR`)

**Variables:**
- camelCase (e.g., `configPath`, `stateDir`, `agentInfo`)
- Booleans: Prefix with is/has/can/should (e.g., `isEnabled`, `hasErrors`)

## Where to Add New Code

**New Feature (within existing domain):**
- Implementation: `packages/core/src/<domain>/<feature-name>.ts`
  - Example: To add "pause schedule" feature in schedule-management:
    - Modify: `packages/core/src/fleet-manager/schedule-management.ts` (add method)
    - Create: `packages/core/src/fleet-manager/schedule-pause.ts` if substantial
    - Exports: Update `packages/core/src/fleet-manager/index.ts`
- Tests: `packages/core/__tests__/<domain>-<feature>.test.ts`
- CLI command: `packages/cli/src/commands/pause.ts` + update `packages/cli/src/index.ts`

**New Work Source Adapter (GitHub → GitLab, etc.):**
- Adapter: `packages/core/src/work-sources/adapters/<service>.ts`
- Schema: Add to `packages/core/src/config/schema.ts` as new `<Service>WorkSourceSchema`
- Registry: Update `packages/core/src/work-sources/registry.ts` to instantiate adapter
- Tests: `packages/core/__tests__/work-sources-<service>.test.ts`

**New Module Class (if refactoring FleetManager):**
- Module: `packages/core/src/fleet-manager/<module-name>.ts`
- Constructor: Accepts FleetManager instance (FleetManagerContext)
- Implementation: Single responsibility, public methods delegated from FleetManager
- Initialize: Add to `FleetManager.initializeModules()`

**New CLI Command:**
- Handler: `packages/cli/src/commands/<command>.ts`
- Export: Add to `packages/cli/src/index.ts` (commander setup)
- Tests: `packages/cli/src/commands/__tests__/<command>.test.ts`

**Utilities/Helpers:**
- Shared helpers: `packages/core/src/<domain>/utils/<util>.ts`
  - Example: `packages/core/src/state/utils/reads.ts` for safe YAML reads
- Format helpers: Place near usage or in utilities
- Validation helpers: If reusable, place in schemas or utils

**Types Only:**
- Definition: `packages/core/src/<domain>/types.ts`
- Re-export: From module index barrel file
- Example: `packages/core/src/scheduler/types.ts` exports all scheduler types

## Special Directories

**packages/core/src/state/schemas:**
- Purpose: Zod validation schemas for all persistent state files
- Files: `fleet-state.ts`, `job-metadata.ts`, `job-output.ts`, `session-info.ts`
- Pattern: Define schema + type export + default factory
- Used by: state/fleet-state.ts, state/job-metadata.ts, etc.
- Generated: No (hand-written)
- Committed: Yes

**packages/core/src/state/utils:**
- Purpose: Low-level file I/O utilities for state persistence
- Files: `atomic.ts` (safe YAML writes), `reads.ts` (safe YAML reads)
- Pattern: Functional utilities, no classes
- Used by: Fleet state, job metadata, session management
- Generated: No
- Committed: Yes

**.herdctl/ (State Directory):**
- Created by: `initStateDirectory()` at first FleetManager.initialize()
- Committed: No (gitignored)
- Contains:
  - `state.yaml`: Fleet state snapshot
  - `session.yaml`: Session metadata
  - `schedule-state/`: Per-schedule state (lastRunAt, nextRunAt, etc.)
  - `jobs/<id>.yaml`: Job metadata
  - `jobs/<id>.output`: Job output (streamed during execution)
  - `logs/`: Log files (future)

**docs/**
- Purpose: Astro/Starlight documentation site
- Generates: herdctl.dev
- Structure: Markdown content in `src/content/docs/`
- Build: Separate turbo task
- Committed: Yes (source), dist may be gitignored

**examples/**
- Purpose: Reference configurations for different use cases
- Subdirs:
  - `simple/`: Minimal single-agent setup
  - `quickstart/`: Multi-agent with GitHub
  - `github/`: Advanced GitHub integration
  - `library-usage/`: TypeScript library usage (not YAML)
  - `recipes/`: Advanced patterns
- Committed: Yes
- Testing: May be used by integration tests

---

*Structure analysis: 2026-01-24*
