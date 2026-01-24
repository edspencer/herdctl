# Architecture

**Analysis Date:** 2026-01-24

## Pattern Overview

**Overall:** Library-first monorepo with a modular orchestration layer (FleetManager) coordinating specialized subsystems.

**Key Characteristics:**
- Single-process fleet orchestration with child process agents
- Event-driven async architecture with TypeScript strict mode
- Modular composition: Config → State → Scheduler → Runner → Work Sources
- Zod-based runtime validation for all external inputs
- No backwards compatibility: pre-MVP project with breaking change tolerance

## Layers

**Configuration Layer:**
- Purpose: Parse, validate, and resolve herdctl.yaml fleet configuration
- Location: `packages/core/src/config/`
- Contains: Schema validation (Zod), loader, parser, interpolation, merge logic
- Depends on: Node.js fs, zod
- Used by: FleetManager, CLI commands
- Key exports: `loadConfig()`, `ResolvedConfig`, `ResolvedAgent`, `Schedule`

**State Management Layer:**
- Purpose: Persist fleet, job, session, and schedule state to `.herdctl/` directory
- Location: `packages/core/src/state/`
- Contains: Fleet state, job metadata, job output, session info with atomic writes
- Depends on: Zod schemas, YAML I/O, fs promises
- Used by: FleetManager, Scheduler, Runner
- Key exports: `readFleetState()`, `writeFleetState()`, `createJob()`, `updateJob()`

**Scheduler Layer:**
- Purpose: Continuously poll schedules and trigger agents on interval/cron
- Location: `packages/core/src/scheduler/`
- Contains: Polling loop, interval/cron calculation, schedule state tracking
- Depends on: State layer, schedule expressions (node-cron)
- Used by: FleetManager via `Scheduler.start()`
- Key mechanism: 1000ms polling loop checking all enabled schedules, calling `onTrigger` callback when due

**Runner Layer:**
- Purpose: Execute agents as child processes with Claude SDK integration
- Location: `packages/core/src/runner/`
- Contains: Job executor, SDK adapter, message processor, error handling
- Depends on: @anthropic-ai/sdk, state layer, child_process
- Used by: FleetManager's ScheduleExecutor
- Key exports: `executeJob()`, converts SDK messages to job output in real-time

**Work Sources Layer:**
- Purpose: Adapt external systems (GitHub Issues) into work items for agents
- Location: `packages/core/src/work-sources/`
- Contains: Registry, adapters (GitHub), manager interface
- Depends on: Config schemas, external APIs (Octokit)
- Used by: Runner to fetch work items for agent processing
- Pattern: Adapter pattern with registry for extensibility

**Fleet Manager (Orchestration):**
- Purpose: High-level coordination layer exposing unified API to CLI/Web
- Location: `packages/core/src/fleet-manager/`
- Contains: Main FleetManager class + 6 module classes (StatusQueries, ScheduleManagement, ConfigReload, JobControl, LogStreaming, ScheduleExecutor)
- Depends on: All layers above
- Used by: CLI package, future Web/Discord packages
- Pattern: Composition over inheritance - each module handles one concern

**CLI Layer (Thin Client):**
- Purpose: Command-line interface delegating to FleetManager
- Location: `packages/cli/src/`
- Contains: Commands (init, start, stop, status, logs, trigger, jobs, job, cancel, config)
- Depends on: @herdctl/core, commander, inquirer
- Used by: End users, automation scripts
- Pattern: Each command creates FleetManager instance and calls public methods

## Data Flow

**Initialization Flow:**
1. CLI calls `new FleetManager({ configPath, stateDir })`
2. `FleetManager.initialize()`:
   - Loads config via `loadConfig(configPath)`
   - Creates state directory via `initStateDirectory(stateDir)`
   - Instantiates 6 module classes
   - Validates config completeness
   - Emits `initialized` event

**Schedule Execution Flow:**
1. `FleetManager.start()` → calls `scheduler.start(agents)`
2. Scheduler polling loop (1000ms intervals):
   - For each agent: for each schedule: check if due
   - If due and schedule enabled and agent not at max_concurrent:
     - Call `onTrigger(triggerInfo)` callback
3. Callback routes to `ScheduleExecutor.executeSchedule()`:
   - Calls `JobControl.trigger()` to create job
   - Streams to `ScheduleExecutor.executeSchedule()` which:
     - Gets work items from `WorkSourceManager.getNextWorkItem()`
     - Builds prompt from work item
     - Calls `JobExecutor.executeJob()` with Claude SDK
     - Streams SDK messages to job output in real-time
     - Reports outcome via `WorkSourceManager.reportOutcome()`
     - Updates job status to completed/failed

**Manual Trigger Flow:**
1. User calls `herdctl trigger <agent> [--schedule <name>] [--prompt <custom>]`
2. CLI calls `FleetManager.trigger(agentName, scheduleName?, options?)`
3. `JobControl.trigger()`:
   - Checks concurrency limits (unless bypassConcurrencyLimit=true)
   - Creates job record in state
   - Calls `ScheduleExecutor.executeSchedule()` immediately (not via scheduler)
   - Returns TriggerResult with jobId

**Job Cancellation Flow:**
1. User calls `herdctl cancel <jobId>`
2. CLI calls `FleetManager.cancelJob(jobId)`
3. `JobControl.cancelJob()`:
   - Sends SIGTERM to job process
   - Waits up to timeout for graceful shutdown
   - Sends SIGKILL if needed
   - Updates job status to cancelled
   - Emits `job:cancelled` event

**State Persistence:**
- Fleet state (state.yaml): Updated after each schedule trigger, job completion
- Job metadata (jobs/<id>.yaml): Created at job start, updated on completion
- Job output (jobs/<id>.output): Appended in real-time as SDK messages arrive
- Session info (session.yaml): Tracks session lifecycle

**Event Emission:**
- FleetManager extends EventEmitter
- Events flow: `config:reloaded`, `agent:started`, `agent:stopped`, `schedule:triggered`, `schedule:skipped`, `job:created`, `job:output`, `job:completed`, `job:failed`, `job:cancelled`, `job:forked`
- Subscribers: CLI (logs), Web dashboard (UI updates), external integrations

## Key Abstractions

**FleetManager (Composition Root):**
- Purpose: Single entry point for all fleet operations
- Located in: `packages/core/src/fleet-manager/fleet-manager.ts`
- Pattern: Composes 6 specialized modules, each with single responsibility
- Lifecycle: initialize → start → (run) → stop
- Context: Implements `FleetManagerContext` to share state with module classes

**Module Classes (Composition):**
- `StatusQueries`: Read-only fleet/agent/schedule status
- `ScheduleManagement`: Enable/disable schedules
- `ConfigReload`: Hot-reload herdctl.yaml without restart
- `JobControl`: Manual trigger, cancel, fork operations
- `LogStreaming`: Async iterable log streaming with filtering
- `ScheduleExecutor`: Execute scheduled jobs (called by scheduler + manual trigger)

**ResolvedConfig (Configuration Object):**
- Purpose: Fully validated, interpolated fleet configuration
- Located in: `packages/core/src/config/`
- Contains: ResolvedAgent[], defaults, work sources
- Pattern: Immutable snapshot of configuration at initialization time
- Each ResolvedAgent has: name, description, model, workspace, max_concurrent, permissions, work_source, schedules[]

**Scheduler (Polling Orchestrator):**
- Purpose: Background polling loop triggering schedules
- Pattern: Stateful polling with schedule state tracking
- Skips: webhook/chat schedules (unsupported), disabled schedules, agents at max_concurrent
- State: Maintains ScheduleState for each schedule (lastRunAt, nextRunAt, disabled status)

**JobExecutor (SDK Bridge):**
- Purpose: Bridge between Fleet system and Claude SDK
- Pattern: Converts SDK AsyncIterable<SDKMessage> to job output in real-time
- Lifecycle: Create job → Update to running → Stream messages → Update to completed/failed
- Error handling: Classifies errors as user/system/timeout; logs to job output

**WorkSourceManager (Adapter Registry):**
- Purpose: Extensible work source abstraction
- Pattern: Registry pattern with per-agent adapter caching
- Currently: GitHub adapter (issues with labels)
- Future: Support multiple work sources per agent

## Entry Points

**CLI Entry Point:**
- Location: `packages/cli/src/index.ts`
- Invoked by: `herdctl` command (via npm bin)
- Responsibilities:
  - Parse command-line arguments (commander)
  - Route to command handlers
  - Each handler creates FleetManager + calls methods
  - Format output (console, JSON, tables)

**Library Entry Point:**
- Location: `packages/core/src/index.ts`
- Exports: All public APIs (Config, State, Runner, WorkSources, Scheduler, FleetManager)
- Used by: @herdctl/web, @herdctl/discord, external tools

**FleetManager Initialization:**
```typescript
const manager = new FleetManager({
  configPath: './herdctl.yaml',    // Auto-discovered if omitted
  stateDir: './.herdctl',          // Will create if missing
  logger?: { debug, info, warn, error },
  checkInterval?: 1000,            // Scheduler polling interval
});
await manager.initialize();        // Load config, setup state
await manager.start();             // Start scheduler
```

**Scheduler Lifecycle:**
```typescript
scheduler.start(agents)            // Begin polling loop
// ... polling runs in background ...
await scheduler.stop({
  waitForJobs: true,               // Wait for running jobs
  timeout: 30000,                  // 30s max wait
})
```

## Error Handling

**Strategy:** Typed error classes with discriminator unions for recovery

**Patterns:**
- All errors extend base classes: `FleetManagerError`, `SchedulerError`, `RunnerError`, `StateFileError`, etc.
- Error context preserved: cause chains, config paths, job IDs
- Error messages include actionable guidance (missing env vars, malformed config, etc.)
- Validation errors from Zod enriched with field paths and suggestions

**Recovery:**
- Config errors: Logged, fleet status set to "error", operations blocked
- State file corruption: Warning logged, defaults used
- Job execution errors: Classified (system/user/timeout), job marked failed
- Schedule trigger errors: Logged, skipped (scheduler continues), schedule marked skipped
- Scheduler shutdown timeout: Can opt to cancel jobs or throw FleetManagerShutdownError

## Cross-Cutting Concerns

**Logging:**
- Framework: console-based (customizable via logger option)
- Prefix: `[fleet-manager]`, `[scheduler]`, `[herdctl]`
- Levels: debug, info, warn, error
- Not stored to files (handled by job output layer)

**Validation:**
- Framework: Zod schemas
- Scope: Config files (herdctl.yaml), state files (YAML), API inputs
- Strategy: Parse + throw validation errors, graceful degradation for missing optional fields

**Authentication:**
- GitHub: Token via GITHUB_TOKEN env var (configurable)
- Claude SDK: API key via ANTHROPIC_API_KEY env var (handled by SDK)
- No built-in auth for herdctl API (future: API key for web/discord packages)

**Concurrency Control:**
- Agent level: max_concurrent setting (default 1)
- Job level: Process-based isolation (each job = separate child process)
- Schedule level: Per-schedule locking via state file updates
- Fleet level: Stateless polling (no global locks)

**Job Lifecycle Tracking:**
- States: pending → running → (completed|failed|cancelled)
- Metadata: job ID, agent, schedule, trigger type, prompt, workspace, model
- Output: Streamed in real-time, stored as JSONL in job.output
- Artifacts: Stored in .herdctl/jobs/<id>/ (metadata, output, working dir)

---

*Architecture analysis: 2026-01-24*
