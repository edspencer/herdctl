---
title: Scheduler Internals
description: How the herdctl scheduler works internally
---

This document describes the internal architecture and implementation of the herdctl scheduler. This is intended for developers working on herdctl itself or integrating with the scheduler programmatically.

## Architecture Overview

The scheduler is a polling-based system that continuously checks agent schedules and triggers due jobs. It consists of several key components:

```mermaid
flowchart TD
  subgraph Scheduler
    PL["Polling Loop"] --> SC["Schedule Checker"] --> TC["Trigger Callback"]
    PL --> SA["Sleep / Abort"]
    SC --> SR["State Reader"]
    TC --> RN["Schedule Runner"]
    SR --> SY[("state.yaml")]
    RN --> WS["Work Source Manager"]
  end

  style Scheduler fill:transparent,stroke:#6366f1,stroke-width:2px
  style PL fill:#4f46e5,color:#fff,stroke:#3730a3
  style SC fill:#4f46e5,color:#fff,stroke:#3730a3
  style TC fill:#4f46e5,color:#fff,stroke:#3730a3
  style SA fill:#64748b,color:#fff,stroke:#475569
  style SR fill:#64748b,color:#fff,stroke:#475569
  style RN fill:#059669,color:#fff,stroke:#047857
  style SY fill:#d97706,color:#fff,stroke:#b45309
  style WS fill:#059669,color:#fff,stroke:#047857
```

## Module Structure

The scheduler module (`packages/core/src/scheduler/`) contains:

| File | Purpose |
|------|---------|
| `index.ts` | Public exports |
| `types.ts` | TypeScript interfaces and types |
| `scheduler.ts` | Main `Scheduler` class |
| `interval.ts` | Interval parsing utilities |
| `schedule-state.ts` | State persistence functions |
| `schedule-runner.ts` | Job execution logic |
| `errors.ts` | Error classes |

## Scheduler Class

The `Scheduler` class manages the polling loop and trigger orchestration.

### Construction

```typescript
import { Scheduler } from "@herdctl/core/scheduler";

const scheduler = new Scheduler({
  checkInterval: 1000,  // Check every 1 second
  stateDir: ".herdctl",
  logger: customLogger,
  onTrigger: async (info) => {
    // Handle triggered schedule
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `checkInterval` | number | 1000 | Milliseconds between checks |
| `stateDir` | string | required | Path to state directory |
| `logger` | SchedulerLogger | console | Logger instance |
| `onTrigger` | callback | undefined | Called when schedule triggers |

### Lifecycle Methods

```typescript
// Start the scheduler with a list of agents
await scheduler.start(agents);

// Check if running
scheduler.isRunning();  // boolean

// Get current status
scheduler.getStatus();  // "stopped" | "running" | "stopping"

// Get detailed state
scheduler.getState();  // { status, startedAt, checkCount, triggerCount, lastCheckAt }

// Stop gracefully
await scheduler.stop({ waitForJobs: true, timeout: 30000 });

// Update agents while running
scheduler.setAgents(newAgents);
```

## Polling Loop

The scheduler runs a continuous loop that:

1. **Checks all schedules**: Iterates through every agent's schedules
2. **Evaluates trigger conditions**: Determines if each schedule should run
3. **Triggers due schedules**: Invokes the callback for schedules that are due
4. **Sleeps**: Waits for the check interval before repeating

```typescript
// Simplified polling loop (from scheduler.ts)
private async runLoop(): Promise<void> {
  while (this.status === "running" && !signal?.aborted) {
    try {
      await this.checkAllSchedules();
    } catch (error) {
      this.logger.error(`Error during schedule check: ${error.message}`);
    }

    if (this.status === "running" && !signal?.aborted) {
      await this.sleep(this.checkInterval, signal);
    }
  }
}
```

### Abort Handling

The loop uses an `AbortController` to support clean shutdown:

```typescript
// Stop signals the loop via AbortController
this.abortController?.abort();

// Sleep is interruptible
private sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
```

## Supported Schedule Types

The scheduler supports two automatic trigger types:

### Interval Schedules

Run at fixed intervals after the previous job completes:

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for ready issues."
```

### Cron Schedules

Run on precise time-based schedules using cron expressions:

```yaml
schedules:
  morning-report:
    type: cron
    expression: "0 9 * * 1-5"  # 9am weekdays
    prompt: "Generate daily report."
```

The scheduler uses [cron-parser](https://www.npmjs.com/package/cron-parser) for cron expression evaluation. Supported shorthands:

| Shorthand | Equivalent | Description |
|-----------|------------|-------------|
| `@hourly` | `0 * * * *` | Every hour |
| `@daily` | `0 0 * * *` | Every day at midnight |
| `@weekly` | `0 0 * * 0` | Every Sunday at midnight |
| `@monthly` | `0 0 1 * *` | First of each month |
| `@yearly` | `0 0 1 1 *` | January 1st |

### Non-Automatic Schedule Types

The `webhook` and `chat` schedule types are **not automatically triggered** by the scheduler. They exist for configuration documentation and are handled by their respective subsystems:

- **webhook**: Triggered by external HTTP requests
- **chat**: Triggered by the Discord connector when messages are received

## Schedule Checking

Each schedule check evaluates multiple conditions:

```typescript
private async checkSchedule(agent, scheduleName, schedule): Promise<ScheduleCheckResult> {
  // 1. Skip unsupported types (webhook, chat)
  if (schedule.type !== "interval" && schedule.type !== "cron") {
    return { shouldTrigger: false, skipReason: "unsupported_type" };
  }

  // 2. Get current state
  const state = await getScheduleState(this.stateDir, agent.name, scheduleName);

  // 3. Skip if disabled
  if (state.status === "disabled") {
    return { shouldTrigger: false, skipReason: "disabled" };
  }

  // 4. Skip if already running (tracked in-memory)
  if (this.runningSchedules.get(agent.name)?.has(scheduleName)) {
    return { shouldTrigger: false, skipReason: "already_running" };
  }

  // 5. Check capacity
  if (runningCount >= maxConcurrent) {
    return { shouldTrigger: false, skipReason: "at_capacity" };
  }

  // 6. Calculate next trigger time
  const nextTrigger = calculateNextTrigger(lastRunAt, schedule.interval);

  // 7. Check if due
  if (!isScheduleDue(nextTrigger)) {
    return { shouldTrigger: false, skipReason: "not_due" };
  }

  return { shouldTrigger: true };
}
```

### Skip Reasons

| Reason | Description |
|--------|-------------|
| `unsupported_type` | Schedule type is not automatically triggered (webhook, chat) |
| `disabled` | Schedule status is "disabled" |
| `already_running` | Schedule has an active job |
| `at_capacity` | Agent at `max_concurrent` limit |
| `not_due` | Next trigger time hasn't arrived |

## Interval Parsing

The `parseInterval` function converts human-readable strings to milliseconds:

```typescript
import { parseInterval } from "@herdctl/core/scheduler";

parseInterval("30s");  // 30000
parseInterval("5m");   // 300000
parseInterval("1h");   // 3600000
parseInterval("1d");   // 86400000
```

### Validation

The parser validates:
- Non-empty input
- Positive integer value
- Valid unit (s, m, h, d)
- No decimals
- No negatives or zero

### Error Messages

Invalid inputs throw `IntervalParseError` with helpful messages:

```
"5"     → Missing time unit. Expected format: "{number}{unit}"
"5.5m"  → Decimal values are not supported
"0m"    → Zero interval is not allowed
"-5m"   → Negative intervals are not allowed
"5x"    → Invalid time unit "x". Valid units are: s, m, h, d
```

## Next Trigger Calculation

The `calculateNextTrigger` function determines when a schedule should next run:

```typescript
import { calculateNextTrigger } from "@herdctl/core/scheduler";

// First run: triggers immediately
calculateNextTrigger(null, "5m");  // returns now

// Subsequent run: adds interval to last completion
calculateNextTrigger(new Date("2025-01-19T10:00:00Z"), "5m");
// returns 2025-01-19T10:05:00Z

// With jitter (0-10%)
calculateNextTrigger(lastRun, "1h", 5);  // adds 0-5% random jitter
```

### Clock Skew Handling

If the calculated time is in the past, the function returns `now`:

```typescript
// lastCompletedAt was 2 hours ago, interval is 5 minutes
// Calculated next: 1h55m ago (in the past)
// Returns: now (trigger immediately)
```

## Schedule State

State is persisted to `.herdctl/state.yaml` using the existing state module:

```typescript
import {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
} from "@herdctl/core/scheduler";

// Read current state
const state = await getScheduleState(stateDir, "my-agent", "check-issues");
// { status: "idle", last_run_at: "...", next_run_at: "...", last_error: null }

// Update state
await updateScheduleState(stateDir, "my-agent", "check-issues", {
  status: "running",
  last_run_at: new Date().toISOString(),
});

// Get all schedules for an agent
const schedules = await getAgentScheduleStates(stateDir, "my-agent");
// { "check-issues": {...}, "daily-report": {...} }
```

### State Schema

```typescript
type ScheduleState = {
  status: "idle" | "running" | "disabled";
  last_run_at?: string;   // ISO timestamp
  next_run_at?: string;   // ISO timestamp
  last_error?: string;    // Error message from last failure
}
```

## Schedule Runner

The `runSchedule` function handles actual job execution:

```typescript
import { runSchedule, buildSchedulePrompt } from "@herdctl/core/scheduler";

const result = await runSchedule({
  agent,
  schedule,
  scheduleName: "check-issues",
  stateDir: ".herdctl",
  workSourceManager,
  jobExecutor,
  logger,
});

// result: {
//   success: boolean,
//   workItem?: WorkItem,
//   processedWorkItem: boolean,
//   ...runnerResult
// }
```

### Execution Flow

1. **Update state to running**: Mark schedule as active
2. **Fetch work item**: If work source configured, get next item
3. **Build prompt**: Combine schedule prompt with work item details
4. **Execute job**: Run via JobExecutor
5. **Report outcome**: Tell work source about success/failure
6. **Calculate next trigger**: Determine when to run again
7. **Update final state**: Record completion and next run time

### Prompt Building

```typescript
const prompt = buildSchedulePrompt(schedule, workItem);

// Without work item:
// Returns schedule.prompt or default prompt

// With work item:
// Returns schedule.prompt + formatted work item details
```

## Concurrency Tracking

The scheduler tracks running jobs in-memory:

```typescript
// Per-agent running schedules
private runningSchedules: Map<string, Set<string>> = new Map();

// All running job promises (for shutdown)
private runningJobs: Map<string, Promise<void>> = new Map();

// Check running count for an agent
scheduler.getRunningJobCount("my-agent");

// Check total running jobs
scheduler.getTotalRunningJobCount();
```

### Why In-Memory?

The in-memory tracking complements the persisted state:

- **In-memory**: Fast checks, accurate for current process
- **Persisted**: Survives restarts, but may be stale after crash

The scheduler uses both: in-memory for the `already_running` check, persisted for schedule metadata.

## Graceful Shutdown

The `stop` method supports graceful shutdown:

```typescript
await scheduler.stop({
  waitForJobs: true,   // Wait for running jobs to complete
  timeout: 30000,      // Max wait time in ms
});
```

### Shutdown Flow

1. Set status to "stopping"
2. Signal the polling loop to stop via AbortController
3. Wait for current jobs if `waitForJobs: true`
4. Throw `SchedulerShutdownError` if timeout reached
5. Set status to "stopped"

### Timeout Handling

```typescript
if (result === "timeout") {
  throw new SchedulerShutdownError(
    `Scheduler shutdown timed out after ${timeout}ms with ${count} job(s) still running`,
    { timedOut: true, runningJobCount: count }
  );
}
```

## Error Classes

The scheduler defines specific error types:

```typescript
import {
  SchedulerError,
  IntervalParseError,
  ScheduleTriggerError,
  SchedulerShutdownError,
} from "@herdctl/core/scheduler";

// Base error
class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerError";
  }
}

// Interval parsing failed
class IntervalParseError extends SchedulerError {
  constructor(message: string, public readonly interval: string) {
    super(message);
    this.name = "IntervalParseError";
  }
}

// Schedule trigger failed
class ScheduleTriggerError extends SchedulerError {
  constructor(message: string, public readonly context: TriggerErrorContext) {
    super(message);
    this.name = "ScheduleTriggerError";
  }
}

// Shutdown timed out
class SchedulerShutdownError extends SchedulerError {
  constructor(message: string, public readonly context: ShutdownErrorContext) {
    super(message);
    this.name = "SchedulerShutdownError";
  }
}
```

## Public Exports

The module exports everything needed for integration:

```typescript
// From packages/core/src/scheduler/index.ts
export * from "./errors.js";

export {
  parseInterval,
  calculateNextTrigger,
  isScheduleDue,
} from "./interval.js";

export {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
  type ScheduleStateLogger,
  type ScheduleStateOptions,
  type ScheduleStateUpdates,
} from "./schedule-state.js";

export type {
  SchedulerOptions,
  SchedulerStatus,
  SchedulerState,
  SchedulerLogger,
  ScheduleCheckResult,
  ScheduleSkipReason,
  TriggerInfo,
  SchedulerTriggerCallback,
  AgentScheduleInfo,
  StopOptions,
} from "./types.js";

export { Scheduler } from "./scheduler.js";

export {
  runSchedule,
  buildSchedulePrompt,
  type RunScheduleOptions,
  type ScheduleRunResult,
  type ScheduleRunnerLogger,
  type TriggerMetadata,
} from "./schedule-runner.js";
```

## Testing

The scheduler has comprehensive tests in `__tests__/`:

```bash
# Run scheduler tests
pnpm test packages/core/src/scheduler/

# Run specific test file
pnpm test packages/core/src/scheduler/__tests__/interval.test.ts
```

### Test Structure

- `interval.test.ts` - Interval parsing and calculation
- `schedule-state.test.ts` - State persistence
- `schedule-runner.test.ts` - Job execution
- `scheduler.test.ts` - Full scheduler lifecycle

## Performance Considerations

### Check Interval Tuning

- **1 second** (default): Good for responsive triggering
- **5 seconds**: Reduces CPU for large fleets
- **10+ seconds**: For very large deployments

### Memory Usage

The scheduler maintains:
- Agent list reference
- Running schedules map (Set per agent)
- Running jobs map (Promise per job)

Memory grows linearly with concurrent jobs, not with total schedules.

### State I/O

Schedule state is read on each check and written on each trigger. For high-frequency schedules, consider:
- Using SSD storage
- Increasing check interval
- Batching state updates (future enhancement)
