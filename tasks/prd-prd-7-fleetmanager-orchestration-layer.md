# PRD 7: FleetManager - Orchestration Layer

## Overview

**Component**: `@herdctl/core` FleetManager  
**Type**: Core library orchestration module  
**Priority**: Critical (blocks CLI and Web UI development)  
**Sequence**: PRD 7 (follows Scheduler PRD 6, precedes CLI PRD 8)

## Problem Statement

The `@herdctl/core` library has all the foundational modules implemented (Config, State, Runner, Work Sources, Scheduler), but they exist as independent pieces. There is no orchestration layer that wires these modules together into a cohesive runtime that external consumers can use.

Without FleetManager, every consumer (CLI, Web UI, HTTP API) would need to:
- Manually coordinate module initialization order
- Implement their own event handling and state management
- Duplicate business logic across interaction layers

This violates herdctl's core architectural principle: **the core library should be consumable as a standalone library, similar to the Claude Agent SDK**.

## Solution

Implement `FleetManager` - the central orchestration class that:
1. Wires all existing modules together
2. Provides a clean, event-driven API for fleet management
3. Enables interaction layers to be thin wrappers with no business logic

## Architecture

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

## User Stories

### US-1: Library Consumer Initialization
**As a** developer using @herdctl/core as a library  
**I want to** initialize and start a fleet manager with minimal configuration  
**So that** I can manage agent fleets without understanding internal module wiring

**Acceptance Criteria:**
- Can construct FleetManager with just `configPath` and `stateDir`
- `initialize()` loads config, validates it, and prepares state directory
- `start()` begins scheduler and processes schedules
- Clear error messages if config is invalid or paths don't exist
- All options have sensible defaults

**Example:**
```typescript
import { FleetManager } from "@herdctl/core";

const fleet = new FleetManager({
  configPath: "./agents",
  stateDir: "./.herdctl",
});

await fleet.initialize();
await fleet.start();
```

---

### US-2: Real-time Event Subscription
**As a** developer building a UI for herdctl  
**I want to** subscribe to fleet events in real-time  
**So that** I can update my UI as jobs start, complete, and produce output

**Acceptance Criteria:**
- FleetManager extends EventEmitter
- Emits typed events for all state changes
- Events include relevant payload data
- Can subscribe/unsubscribe at any time
- Events are emitted synchronously (non-blocking)

**Events to emit:**
| Event | Payload | When |
|-------|---------|------|
| `started` | `{ timestamp }` | Fleet manager started |
| `stopped` | `{ timestamp, reason? }` | Fleet manager stopped |
| `config:reloaded` | `{ changes: string[] }` | Configuration was hot-reloaded |
| `agent:started` | `{ agentName, jobId }` | An agent began processing |
| `agent:stopped` | `{ agentName, jobId, reason }` | An agent stopped |
| `schedule:triggered` | `{ agentName, scheduleName, jobId }` | A schedule was triggered |
| `schedule:skipped` | `{ agentName, scheduleName, reason }` | A schedule was skipped |
| `job:created` | `{ job: Job }` | A new job was created |
| `job:output` | `{ jobId, chunk: string }` | Job produced output |
| `job:completed` | `{ jobId, result }` | Job finished successfully |
| `job:failed` | `{ jobId, error }` | Job failed with error |

**Example:**
```typescript
fleet.on("job:created", (event) => {
  console.log(`New job: ${event.job.id} for agent ${event.job.agentName}`);
});

fleet.on("job:output", (event) => {
  process.stdout.write(event.chunk);
});

fleet.on("job:failed", (event) => {
  notifySlack(`Job ${event.jobId} failed: ${event.error.message}`);
});
```

---

### US-3: Fleet Status Queries
**As a** CLI user running `herdctl status`  
**I want to** query the current fleet status  
**So that** I can see what agents are configured and what jobs are running

**Acceptance Criteria:**
- `getStatus()` returns overall fleet status
- `getAgents()` returns all configured agents with current state
- `getAgent(name)` returns specific agent details
- Query methods work whether fleet is running or stopped
- Returns consistent snapshot (no partial reads)

**Example:**
```typescript
const status = fleet.getStatus();
// {
//   state: "running",
//   uptime: 3600000,
//   agents: { total: 3, running: 1, idle: 2 },
//   jobs: { active: 1, completed: 47, failed: 2 },
//   scheduler: { nextTrigger: Date, activeSchedules: 5 }
// }

const agents = fleet.getAgents();
// [
//   { name: "pr-reviewer", state: "running", currentJob: "job-123", ... },
//   { name: "issue-triager", state: "idle", lastJob: "job-122", ... }
// ]
```

---

### US-4: Job Management
**As a** developer debugging an agent  
**I want to** query job history and stream job output  
**So that** I can understand what the agent did and troubleshoot issues

**Acceptance Criteria:**
- `getJobs(filter?)` returns jobs with optional filtering by agent, status, time range
- `getJob(id)` returns specific job details including output
- Job history is persisted and survives restarts
- Keeps last N jobs per agent (configurable, default: 100)
- Optional fleet-wide job limit cap
- Can stream output from running jobs in real-time

**Example:**
```typescript
// Get recent jobs for an agent
const jobs = fleet.getJobs({ 
  agentName: "pr-reviewer",
  status: "completed",
  limit: 10 
});

// Get specific job with full output
const job = fleet.getJob("job-123");
// {
//   id: "job-123",
//   agentName: "pr-reviewer",
//   scheduleName: "review-prs",
//   status: "completed",
//   startedAt: Date,
//   completedAt: Date,
//   output: "...",
//   result: { ... }
// }

// Stream output from running job
fleet.streamJobOutput("job-124", (chunk) => {
  process.stdout.write(chunk);
});
```

---

### US-5: Manual Agent Triggering
**As an** operator  
**I want to** manually trigger an agent outside its schedule  
**So that** I can test agents or handle urgent situations

**Acceptance Criteria:**
- `trigger(agentName, scheduleName?, options?)` creates and starts a job
- Can trigger specific schedule or use agent defaults
- Can pass runtime options (work items, prompt overrides)
- Returns the created job
- Respects concurrency limits

**Example:**
```typescript
// Trigger with default schedule
const job = await fleet.trigger("pr-reviewer");

// Trigger specific schedule
const job = await fleet.trigger("issue-triager", "urgent-triage");

// Trigger with options
const job = await fleet.trigger("pr-reviewer", "review-prs", {
  workItems: [{ type: "github-issue", url: "..." }],
  promptOverride: "Focus on security issues"
});
```

---

### US-6: Job Control
**As an** operator  
**I want to** cancel running jobs and fork existing jobs  
**So that** I can manage runaway jobs and re-run jobs with modifications

**Acceptance Criteria:**
- `cancelJob(jobId)` cancels a running job gracefully
- `forkJob(jobId, modifications?)` creates new job based on existing one
- Cancel sends SIGTERM, waits for graceful shutdown, then SIGKILL
- Fork copies job config and optionally applies modifications
- Both operations emit appropriate events

**Example:**
```typescript
// Cancel a runaway job
await fleet.cancelJob("job-123");

// Fork a job to re-run with modifications
const newJob = await fleet.forkJob("job-123", {
  promptOverride: "Also check for performance issues"
});
```

---

### US-7: Schedule Management
**As an** operator  
**I want to** view and control schedules at runtime  
**So that** I can temporarily disable schedules without editing config files

**Acceptance Criteria:**
- `getSchedules()` returns all schedules with next trigger times
- `enableSchedule(agentName, scheduleName)` enables a disabled schedule
- `disableSchedule(agentName, scheduleName)` disables a schedule
- Disabled state persists across restarts (stored in state)
- Disabled schedules don't trigger but remain in config

**Example:**
```typescript
const schedules = fleet.getSchedules();
// [
//   { agentName: "pr-reviewer", name: "review-prs", 
//     enabled: true, nextTrigger: Date, interval: "*/15 * * * *" },
//   { agentName: "issue-triager", name: "triage", 
//     enabled: false, nextTrigger: null, interval: "0 * * * *" }
// ]

// Disable during maintenance
await fleet.disableSchedule("pr-reviewer", "review-prs");

// Re-enable after maintenance
await fleet.enableSchedule("pr-reviewer", "review-prs");
```

---

### US-8: Graceful Shutdown
**As a** system administrator  
**I want to** shut down the fleet gracefully  
**So that** running jobs complete properly and state is preserved

**Acceptance Criteria:**
- `stop(options?)` initiates graceful shutdown
- Can wait for running jobs to complete
- Can specify timeout for job completion
- After timeout, jobs are cancelled
- All state is persisted before shutdown completes
- Emits `stopped` event when complete

**Example:**
```typescript
// Graceful shutdown - wait for jobs
await fleet.stop({ waitForJobs: true, timeout: 30000 });

// Immediate shutdown - cancel jobs
await fleet.stop({ waitForJobs: false });

// Shutdown with callback for progress
await fleet.stop({
  waitForJobs: true,
  timeout: 60000,
  onProgress: (status) => {
    console.log(`Waiting for ${status.pendingJobs} jobs...`);
  }
});
```

---

### US-9: Hot Configuration Reload
**As an** operator  
**I want to** reload configuration without restarting the fleet  
**So that** I can update agent definitions without downtime

**Acceptance Criteria:**
- `reload()` reloads and validates configuration
- Running jobs continue with their original config
- New jobs use the new configuration
- Scheduler updates to reflect new schedules
- Emits `config:reloaded` event with list of changes
- Fails gracefully if new config is invalid (keeps old config)

**Example:**
```typescript
try {
  await fleet.reload();
  console.log("Config reloaded successfully");
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error("Invalid config, keeping previous:", error.message);
  }
}

fleet.on("config:reloaded", (event) => {
  console.log("Config changes:", event.changes);
  // ["agent:pr-reviewer:schedule:review-prs:interval changed",
  //  "agent:new-agent added"]
});
```

---

### US-10: Concurrency Control
**As a** system administrator  
**I want to** control how many jobs run concurrently  
**So that** I don't overwhelm system resources

**Acceptance Criteria:**
- Per-agent concurrency limit (configurable, default: 1)
- Fleet-wide concurrency limit (optional cap across all agents)
- Jobs queue when limits are reached
- Queue is FIFO within priority levels
- Can query queue status
- Concurrency limits configurable at construction and via config

**Example:**
```typescript
const fleet = new FleetManager({
  configPath: "./agents",
  stateDir: "./.herdctl",
  concurrency: {
    perAgent: 2,        // Each agent can run 2 jobs concurrently
    fleetWide: 10,      // Max 10 jobs across entire fleet
  }
});

// Or in agent config
// agents/pr-reviewer.yaml
// concurrency: 3  # This agent can run 3 concurrent jobs
```

**Schedule Coordination:**
When a schedule triggers but the agent is at its concurrency limit:
- Emit `schedule:skipped` event with reason `"concurrency_limit"`
- Do not queue scheduled triggers (only manual triggers queue)
- Log the skip for debugging

---

### US-11: Log Streaming
**As a** developer monitoring fleet activity  
**I want to** stream logs from the fleet and specific jobs  
**So that** I can observe activity in real-time

**Acceptance Criteria:**
- `streamLogs(options?)` streams all fleet logs
- `streamJobOutput(jobId)` streams specific job output
- `streamAgentLogs(agentName)` streams logs for specific agent
- Streams are async iterables
- Can specify log level filter
- Works with running and completed jobs (replays history for completed)

**Example:**
```typescript
// Stream all fleet logs
for await (const log of fleet.streamLogs({ level: "info" })) {
  console.log(`[${log.level}] ${log.source}: ${log.message}`);
}

// Stream job output
for await (const chunk of fleet.streamJobOutput("job-123")) {
  process.stdout.write(chunk);
}

// Stream with callback (alternative API)
fleet.streamAgentLogs("pr-reviewer", (log) => {
  console.log(log);
});
```

---

### US-12: Error Handling
**As a** library consumer  
**I want** clear, typed errors for all failure modes  
**So that** I can handle errors appropriately in my application

**Acceptance Criteria:**
- All errors extend `FleetManagerError` base class
- Specific error types for different failure modes
- Errors include relevant context (agent name, job id, etc.)
- Errors are typed for TypeScript consumers
- Error messages are actionable

**Error Types:**
```typescript
class FleetManagerError extends Error {
  code: string;
  context?: Record<string, unknown>;
}

class ConfigurationError extends FleetManagerError {
  code = "CONFIGURATION_ERROR";
  configPath: string;
  validationErrors: string[];
}

class AgentNotFoundError extends FleetManagerError {
  code = "AGENT_NOT_FOUND";
  agentName: string;
}

class JobNotFoundError extends FleetManagerError {
  code = "JOB_NOT_FOUND";
  jobId: string;
}

class ScheduleNotFoundError extends FleetManagerError {
  code = "SCHEDULE_NOT_FOUND";
  agentName: string;
  scheduleName: string;
}

class InvalidStateError extends FleetManagerError {
  code = "INVALID_STATE";
  currentState: string;
  expectedState: string;
  operation: string;
}

class ConcurrencyLimitError extends FleetManagerError {
  code = "CONCURRENCY_LIMIT";
  agentName: string;
  currentJobs: number;
  limit: number;
}
```

## Technical Specifications

### FleetManager Options Interface

```typescript
interface FleetManagerOptions {
  // Required
  configPath: string;      // Path to agents directory or single agent file
  stateDir: string;        // Path to .herdctl directory

  // Optional
  logger?: Logger;         // Custom logger implementation
  
  scheduler?: {
    checkInterval?: number;  // Override scheduler check interval (ms)
  };
  
  concurrency?: {
    perAgent?: number;       // Max concurrent jobs per agent (default: 1)
    fleetWide?: number;      // Max concurrent jobs fleet-wide (optional)
  };
  
  history?: {
    maxJobsPerAgent?: number;  // Max job history per agent (default: 100)
    maxJobsTotal?: number;     // Max total job history (optional cap)
  };
  
  autoStart?: boolean;     // Start immediately on construction (default: false)
}
```

### FleetManager Class Signature

```typescript
import { EventEmitter } from "events";

class FleetManager extends EventEmitter {
  constructor(options: FleetManagerOptions);
  
  // Lifecycle
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
  reload(): Promise<void>;
  
  // State
  readonly state: "uninitialized" | "initialized" | "running" | "stopping" | "stopped";
  
  // Query Methods
  getStatus(): FleetStatus;
  getAgents(): AgentInfo[];
  getAgent(name: string): AgentInfo;
  getJobs(filter?: JobFilter): Job[];
  getJob(id: string): Job;
  getSchedules(): ScheduleInfo[];
  getSchedule(agentName: string, scheduleName: string): ScheduleInfo;
  
  // Action Methods
  trigger(agentName: string, scheduleName?: string, options?: TriggerOptions): Promise<Job>;
  cancelJob(jobId: string): Promise<void>;
  forkJob(jobId: string, modifications?: JobModifications): Promise<Job>;
  enableSchedule(agentName: string, scheduleName: string): Promise<void>;
  disableSchedule(agentName: string, scheduleName: string): Promise<void>;
  
  // Log Streaming
  streamLogs(options?: LogStreamOptions): AsyncIterable<LogEntry>;
  streamJobOutput(jobId: string): AsyncIterable<string>;
  streamAgentLogs(agentName: string): AsyncIterable<LogEntry>;
}
```

### Integration with Existing Modules

| Module | Integration Point | FleetManager Responsibility |
|--------|------------------|----------------------------|
| **Config** | `loadConfig()`, `validateConfig()` | Call during `initialize()` and `reload()` |
| **State** | `loadState()`, `saveState()`, `updateJobState()` | Persist fleet and job state, load on startup |
| **Scheduler** | `new Scheduler()`, `scheduler.on("trigger")` | Create instance, handle trigger callbacks, manage schedule state |
| **Runner** | `new JobExecutor()`, `executor.run()` | Create executor per job, stream output, handle completion |
| **Work Sources** | `new WorkSourceManager()` | Create per schedule with work sources, fetch work items |

### File Structure

```
packages/core/src/fleet-manager/
├── index.ts              # Public exports
├── types.ts              # TypeScript interfaces
├── fleet-manager.ts      # Main FleetManager class
├── errors.ts             # Error classes
├── job-queue.ts          # Job queue with concurrency control
├── event-types.ts        # Typed event definitions
└── __tests__/
    ├── fleet-manager.test.ts      # Core functionality tests
    ├── lifecycle.test.ts          # Lifecycle method tests
    ├── concurrency.test.ts        # Concurrency control tests
    ├── events.test.ts             # Event emission tests
    ├── hot-reload.test.ts         # Configuration reload tests
    └── integration.test.ts        # Integration with real modules
```

## Testing Requirements

### Unit Tests
- All lifecycle methods (`initialize`, `start`, `stop`, `reload`)
- All query methods with various inputs
- All action methods with success and failure cases
- Event emission for all event types
- Error handling for all error types
- Concurrency control logic
- Job queue behavior

### Integration Tests
- Full flow: initialize → start → trigger → complete → stop
- Scheduler integration: schedules trigger jobs correctly
- Runner integration: jobs execute via Claude Code
- State persistence: survives restart with correct state
- Work sources integration: fetches and processes work items

### Edge Cases
- Start when already running
- Stop when already stopped
- Trigger non-existent agent
- Cancel completed job
- Reload with invalid config
- Concurrent triggers exceeding limits
- Graceful shutdown with hanging jobs

## Constraints

1. **Node.js only** - Not designed for browser environments
2. **ESM and CJS support** - Already configured via tsup
3. **No new dependencies** - Use only existing core dependencies
4. **Backward compatible** - Don't break existing module APIs
5. **Serializable state** - All state must be JSON-serializable for potential future clustering

## Out of Scope

- HTTP API implementation (future: `@herdctl/web`)
- CLI implementation (future: `herdctl` package, PRD 8)
- Discord/Slack connectors (future PRD)
- Multi-process clustering (future enhancement)
- Authentication/authorization (future enhancement)
- Distributed state management (future enhancement)

## Definition of Done

1. ✅ `FleetManager` class implemented with all specified methods
2. ✅ All TypeScript interfaces exported from `@herdctl/core`
3. ✅ Event emission working for all specified events
4. ✅ Concurrency control working (per-agent + fleet-wide)
5. ✅ Job history persistence working (last N per agent)
6. ✅ Hot-reload working without affecting running jobs
7. ✅ All error types implemented and documented
8. ✅ Unit tests passing with >90% coverage
9. ✅ Integration tests passing
10. ✅ `packages/core/src/index.ts` updated to export FleetManager
11. ✅ Internal documentation updated in `docs/src/content/docs/internals/`

## Dependencies

- **PRD 1**: Config module (complete)
- **PRD 2**: State module (complete)  
- **PRD 3**: Runner module (complete)
- **PRD 5**: Work Sources module (complete)
- **PRD 6**: Scheduler module (complete)

## Dependents

- **PRD 8**: CLI (`herdctl` package) - thin wrapper around FleetManager
- **PRD 9**: Web UI/HTTP API (`@herdctl/web`) - thin wrapper around FleetManager