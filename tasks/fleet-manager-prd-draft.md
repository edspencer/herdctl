# FleetManager PRD Prompt Draft

Use this prompt with ralph-tui to generate the FleetManager PRD.

---

## Prompt

Create a PRD for `herdctl-fleet-manager` - the orchestration layer for the herdctl autonomous agent fleet management system.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The core library (`@herdctl/core`) already has these modules implemented:

- **Config** (`packages/core/src/config/`) - YAML config parsing, validation, agent definitions
- **State** (`packages/core/src/state/`) - Fleet and agent state persistence to state.yaml
- **Runner** (`packages/core/src/runner/`) - Job execution via Claude Code subprocess
- **Work Sources** (`packages/core/src/work-sources/`) - GitHub Issues integration for work items
- **Scheduler** (`packages/core/src/scheduler/`) - Interval-based schedule triggering

What's missing is an **orchestration layer** that wires these modules together into a cohesive runtime. This is the FleetManager.

### Architectural Requirement

**CRITICAL**: herdctl has a stated architectural goal that the core library (`@herdctl/core`) should be consumable as a standalone library, similar to the Claude Agent SDK. All business logic must live in core. The CLI, Web UI, and HTTP API are thin wrappers that delegate to FleetManager.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Interaction Layers (THIN)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │   CLI    │  │  Web UI  │  │ HTTP API │  │ Discord/Slack    ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘│
│       └─────────────┴─────────────┴──────────────────┘          │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    @herdctl/core                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                  FleetManager                        │  │  │
│  │  │  (orchestration layer - wires everything together)   │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │     ┌─────────┬──────────┬───────────┬─────────┐         │  │
│  │     ▼         ▼          ▼           ▼         ▼         │  │
│  │  Config   Scheduler   Runner    WorkSources  State       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### FleetManager Responsibilities

#### Lifecycle Management
- `initialize()` - Load config, validate, prepare state directory
- `start()` - Start scheduler, begin processing schedules
- `stop(options?)` - Graceful shutdown with optional timeout
- `reload()` - Hot-reload configuration without full restart

#### Query Methods (Read Operations)
- `getStatus()` - Overall fleet status (running/stopped, agent count, job stats)
- `getAgents()` - List all configured agents with their current state
- `getAgent(name)` - Get specific agent details and state
- `getJobs(filter?)` - List jobs with optional filtering (by agent, status, time range)
- `getJob(id)` - Get specific job details including output
- `getSchedules()` - List all schedules across all agents with next trigger times

#### Action Methods (Write Operations)
- `trigger(agentName, scheduleName?, options?)` - Manually trigger an agent
- `cancelJob(jobId)` - Cancel a running job
- `resumeJob(jobId)` - Resume a stopped job (if supported)
- `forkJob(jobId, modifications?)` - Create new job based on existing one
- `enableSchedule(agentName, scheduleName)` - Enable a disabled schedule
- `disableSchedule(agentName, scheduleName)` - Disable a schedule

#### Event Emission (Real-time Updates)
FleetManager should extend EventEmitter and emit events for:
- `started` - Fleet manager started
- `stopped` - Fleet manager stopped
- `config:reloaded` - Configuration was hot-reloaded
- `agent:started` - An agent began processing
- `agent:stopped` - An agent stopped
- `schedule:triggered` - A schedule was triggered
- `schedule:skipped` - A schedule was skipped (with reason)
- `job:created` - A new job was created
- `job:output` - Job produced output (for streaming)
- `job:completed` - Job finished successfully
- `job:failed` - Job failed with error

#### Log Streaming
- `streamLogs(options?)` - Stream all fleet logs
- `streamJobOutput(jobId)` - Stream specific job output in real-time
- `streamAgentLogs(agentName)` - Stream logs for specific agent

### Configuration

FleetManager should accept options at construction:

```typescript
interface FleetManagerOptions {
  // Required
  configPath: string;      // Path to agents directory or single agent file
  stateDir: string;        // Path to .herdctl directory

  // Optional
  logger?: Logger;         // Custom logger implementation
  scheduler?: {
    checkInterval?: number;  // Override scheduler check interval
  };
  autoStart?: boolean;     // Start immediately on construction (default: false)
}
```

### Usage Examples

```typescript
// Library usage (like Claude Agent SDK)
import { FleetManager } from "@herdctl/core";

const fleet = new FleetManager({
  configPath: "./agents",
  stateDir: "./.herdctl",
});

// Subscribe to events
fleet.on("job:created", (job) => {
  console.log(`New job: ${job.id} for agent ${job.agentName}`);
});

fleet.on("job:output", (jobId, chunk) => {
  process.stdout.write(chunk);
});

// Start the fleet
await fleet.start();

// Query state
const status = fleet.getStatus();
const agents = fleet.getAgents();

// Manual trigger
await fleet.trigger("my-agent", "process-issues");

// Graceful shutdown
await fleet.stop({ waitForJobs: true, timeout: 30000 });
```

### Integration Points

1. **Config Module**: FleetManager calls `loadConfig()` to load and validate agent configurations
2. **State Module**: FleetManager calls state functions to persist/read fleet and agent state
3. **Scheduler Module**: FleetManager creates a Scheduler instance and handles its trigger callbacks
4. **Runner Module**: FleetManager creates JobExecutor instances for each triggered job
5. **Work Sources Module**: FleetManager creates WorkSourceManager for schedules with work sources

### Error Handling

FleetManager should define specific error types:
- `FleetManagerError` - Base error class
- `ConfigurationError` - Config loading/validation failed
- `AgentNotFoundError` - Referenced agent doesn't exist
- `JobNotFoundError` - Referenced job doesn't exist
- `ScheduleNotFoundError` - Referenced schedule doesn't exist
- `InvalidStateError` - Operation not valid in current state (e.g., start when already running)

### Testing Requirements

- Unit tests for all lifecycle methods
- Unit tests for all query methods
- Unit tests for all action methods
- Integration tests with real scheduler and runner
- Event emission tests
- Error handling tests
- Hot-reload tests

### Deliverables

1. `packages/core/src/fleet-manager/` directory with:
   - `index.ts` - Public exports
   - `types.ts` - TypeScript interfaces
   - `fleet-manager.ts` - Main FleetManager class
   - `errors.ts` - Error classes
   - `__tests__/` - Comprehensive tests

2. Update `packages/core/src/index.ts` to export FleetManager

3. Update documentation with library usage examples

### Constraints

- Must work in Node.js (not browser)
- Must support both ESM and CJS (already configured via tsup)
- Must not introduce new dependencies beyond what's already in core
- Must maintain backward compatibility with existing module APIs
- All state must be serializable (for potential future clustering)

### Out of Scope

- HTTP API implementation (that's @herdctl/web)
- CLI implementation (that's herdctl package)
- Discord/Slack connectors (future PRD)
- Multi-process clustering (future enhancement)
- Authentication/authorization (future enhancement)

---

## Notes for PRD Generation

- Emphasize the "library-first" architecture
- Include TypeScript code examples
- Reference existing module documentation in `docs/src/content/docs/internals/`
- This is PRD 7 in the sequence, follows Scheduler (PRD 6), precedes CLI (PRD 8)
