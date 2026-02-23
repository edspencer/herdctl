---
title: Schedule System
description: How herdctl's polling-based scheduler evaluates triggers and executes agents on time-based schedules
---

The scheduler is the timing engine of herdctl. It runs a continuous polling loop that checks every agent's schedules, evaluates whether each one is due, and fires trigger callbacks into FleetManager when conditions are met. It supports both fixed-interval and cron-based scheduling, tracks concurrency per agent, and shuts down gracefully when the fleet stops.

For the user-facing perspective on configuring schedules, see [Schedules](/concepts/schedules/). For how the scheduler fits into the broader system, see the [Architecture Overview](/architecture/overview/).

![Core architecture diagram showing FleetManager as central orchestrator connecting ConfigLoader, Scheduler, StateManager, Runner, JobManager, Web, and Chat](/diagrams/core-architecture.svg)

![Scheduler polling loop showing tick-based evaluation of agent schedules, condition checking, and trigger firing](/diagrams/scheduler-polling-loop.svg)

## Module Structure

The scheduler module lives in `packages/core/src/scheduler/` and is organized into focused files:

| File | Purpose |
|------|---------|
| `index.ts` | Public exports |
| `types.ts` | TypeScript interfaces and types |
| `scheduler.ts` | Main `Scheduler` class with polling loop |
| `interval.ts` | Interval parsing and next-trigger calculation |
| `cron.ts` | Cron expression parsing via `cron-parser` |
| `schedule-state.ts` | State persistence functions |
| `schedule-runner.ts` | Job execution logic |
| `errors.ts` | Error classes |

## Scheduler Class

The `Scheduler` class is the primary entry point. It manages the polling loop and coordinates trigger evaluation.

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
| `checkInterval` | number | 1000 | Milliseconds between schedule checks |
| `stateDir` | string | required | Path to `.herdctl` state directory |
| `logger` | SchedulerLogger | console | Logger instance with debug/info/warn/error |
| `onTrigger` | callback | undefined | Called when a schedule triggers |

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

// Update agents while running (e.g., after config reload)
scheduler.setAgents(newAgents);
```

## Polling Loop

The scheduler runs a continuous loop that repeats four steps:

1. **Check all schedules** -- iterate through every agent's schedules
2. **Evaluate trigger conditions** -- determine if each schedule should run
3. **Trigger due schedules** -- invoke the callback for schedules that are due
4. **Sleep** -- wait for the check interval before repeating

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

The loop uses an `AbortController` to support clean shutdown. The sleep is interruptible so the scheduler does not block for the full check interval when stopping:

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

## Schedule Types

### Interval Schedules (Automatic)

Run at fixed intervals after the previous job completes. The timer starts on completion, not on start, which prevents job pile-up when execution takes longer than the interval.

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for ready issues."
```

If an agent takes 10 minutes but the interval is 5m, the next run starts 15 minutes after the first began (10 minutes of execution plus 5 minutes of interval).

### Cron Schedules (Automatic)

Run on precise time-based schedules using standard cron expressions:

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

Standard 5-field cron syntax is supported: `minute hour day-of-month month day-of-week`. Six-field cron (with seconds) and per-schedule timezones are not supported. The system timezone is used for all cron evaluation.

When the system was down during a cron trigger, the scheduler does not catch up on missed executions. It calculates the next future occurrence from the current time.

### Non-Automatic Schedule Types

The `webhook` and `chat` schedule types are **not automatically triggered** by the scheduler. They exist for configuration purposes and are handled by their respective subsystems:

- **webhook** -- triggered by external HTTP requests
- **chat** -- triggered by Discord or Slack connectors when messages are received

The scheduler skips these types with the `unsupported_type` skip reason.

## Schedule Checking

Each poll iteration evaluates every agent schedule through a pipeline of conditions. The first failing condition produces a skip reason and short-circuits evaluation:

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
| `disabled` | Schedule status is "disabled" in state |
| `already_running` | Schedule already has an active job in this process |
| `at_capacity` | Agent is at its `max_concurrent` limit |
| `not_due` | Next trigger time has not yet arrived |

![Schedule evaluation decision tree showing the five condition checks performed on each schedule per tick](/diagrams/schedule-evaluation-decision-tree.svg)

## Interval Parsing

The `parseInterval` function converts human-readable duration strings to milliseconds:

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
- Positive integer value (no decimals, no negatives, no zero)
- Valid unit suffix: `s` (seconds), `m` (minutes), `h` (hours), `d` (days)

### Error Messages

Invalid inputs throw `IntervalParseError` with actionable messages:

```text
"5"     -> Missing time unit. Expected format: "{number}{unit}"
"5.5m"  -> Decimal values are not supported
"0m"    -> Zero interval is not allowed
"-5m"   -> Negative intervals are not allowed
"5x"    -> Invalid time unit "x". Valid units are: s, m, h, d
```

## Cron Expression Parsing

The `cron.ts` module wraps `cron-parser` to provide cron support:

```typescript
import {
  parseCronExpression,
  calculateNextCronTrigger,
  isValidCronExpression,
} from "@herdctl/core/scheduler";

// Parse and validate
const parsed = parseCronExpression("0 9 * * 1-5");

// Calculate next trigger
const next = calculateNextCronTrigger("0 9 * * *", new Date());

// Validate without throwing
isValidCronExpression("invalid");  // false
```

Invalid cron expressions throw `CronParseError` with context:

```text
CronParseError: Invalid cron expression "0 25 * * *" - hour must be 0-23
CronParseError: Invalid cron expression "* * *" - expected 5 fields, got 3
```

## Next Trigger Calculation

### Interval Schedules

The `calculateNextTrigger` function determines when an interval schedule should next run:

```typescript
import { calculateNextTrigger } from "@herdctl/core/scheduler";

// First run: triggers immediately
calculateNextTrigger(null, "5m");  // returns now

// Subsequent run: adds interval to last completion
calculateNextTrigger(new Date("2025-01-19T10:00:00Z"), "5m");
// returns 2025-01-19T10:05:00Z

// With jitter (0-10%) to prevent thundering herd
calculateNextTrigger(lastRun, "1h", 5);  // adds 0-5% random jitter
```

### Cron Schedules

For cron schedules, `calculateNextCronTrigger` finds the next matching time after a given date:

```typescript
import { calculateNextCronTrigger } from "@herdctl/core/scheduler";

// Next 9am after 8am today -> today at 9am
calculateNextCronTrigger("0 9 * * *", new Date("2025-01-15T08:00:00"));

// Next 9am after 9am today -> tomorrow at 9am
calculateNextCronTrigger("0 9 * * *", new Date("2025-01-15T09:00:00"));
```

### Clock Skew Handling

If the calculated trigger time is in the past (e.g., after a long sleep or system resume), the function returns `now` to trigger immediately:

```typescript
// lastCompletedAt was 2 hours ago, interval is 5 minutes
// Calculated next: 1h55m ago (in the past)
// Returns: now (trigger immediately)
```

## Schedule State

Schedule state is persisted to `.herdctl/state.yaml` using the existing [state management](/architecture/state-management/) module. Each schedule has its own state entry:

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

### Status Transitions

- **idle** -- default state; schedule is available to trigger
- **running** -- a job for this schedule is currently executing
- **disabled** -- schedule has been manually disabled and will be skipped

The state moves from `idle` to `running` when a trigger fires, and back to `idle` when the job completes (whether successfully or with an error). The `disabled` status is set by explicit user action and persists across restarts.

## Schedule Runner

The `runSchedule` function handles the full execution flow when a schedule triggers. For details on how jobs are created and managed, see the [Job System](/architecture/job-system/). For runner internals, see the [Agent Execution Engine](/architecture/runner/).

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
```

### Execution Flow

1. **Update state to running** -- mark the schedule as active in state.yaml
2. **Fetch work item** -- if the schedule has a work source configured, get the next item (see [Work Sources](/architecture/work-sources/))
3. **Build prompt** -- combine the schedule prompt with work item details
4. **Execute job** -- run via JobExecutor (see [Job System](/architecture/job-system/))
5. **Report outcome** -- tell the work source about success/failure
6. **Calculate next trigger** -- determine when to run again
7. **Update final state** -- record completion time and next run time

### Prompt Building

```typescript
const prompt = buildSchedulePrompt(schedule, workItem);

// Without work item:
// Returns schedule.prompt or default prompt

// With work item:
// Returns schedule.prompt + formatted work item details
```

## Concurrency Tracking

The scheduler tracks running jobs using both in-memory data structures (for speed) and persisted state (for durability):

```typescript
// Per-agent running schedules (in-memory)
private runningSchedules: Map<string, Set<string>> = new Map();

// All running job promises (for shutdown)
private runningJobs: Map<string, Promise<void>> = new Map();

// Check running count for an agent
scheduler.getRunningJobCount("my-agent");

// Check total running jobs
scheduler.getTotalRunningJobCount();
```

### In-Memory vs Persisted

The two tracking mechanisms serve different purposes:

- **In-memory** -- used for the `already_running` and `at_capacity` checks during schedule evaluation. Fast, accurate for the current process, but lost on crash.
- **Persisted** -- stored in state.yaml as schedule status. Survives restarts, but may be stale after an unclean shutdown (a schedule could be stuck in `running` status if the process crashed).

The scheduler uses the in-memory map for its evaluation pipeline and the persisted state for metadata (last_run_at, next_run_at, last_error).

## Graceful Shutdown

The `stop` method supports graceful shutdown with configurable behavior:

```typescript
await scheduler.stop({
  waitForJobs: true,   // Wait for running jobs to complete
  timeout: 30000,      // Max wait time in ms
});
```

### Shutdown Flow

1. Set status to `"stopping"` -- prevents new triggers from firing
2. Signal the polling loop via `AbortController` -- wakes the loop from sleep
3. If `waitForJobs: true`, wait for all running job promises to settle
4. If timeout is reached before jobs complete, throw `SchedulerShutdownError`
5. Set status to `"stopped"`

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

The scheduler defines a hierarchy of error types for specific failure modes:

```typescript
import {
  SchedulerError,
  IntervalParseError,
  ScheduleTriggerError,
  SchedulerShutdownError,
} from "@herdctl/core/scheduler";
```

| Error | Extends | When Thrown |
|-------|---------|------------|
| `SchedulerError` | `Error` | Base class for all scheduler errors |
| `IntervalParseError` | `SchedulerError` | Invalid interval string (e.g., `"5x"`, `"0m"`) |
| `CronParseError` | `FleetManagerError` | Invalid cron expression |
| `ScheduleTriggerError` | `SchedulerError` | Schedule trigger execution failed |
| `SchedulerShutdownError` | `SchedulerError` | Graceful shutdown timed out |

Each error carries contextual data. `IntervalParseError` includes the original interval string. `ScheduleTriggerError` includes the agent and schedule names. `SchedulerShutdownError` includes whether a timeout occurred and how many jobs were still running.

## Performance Considerations

### Check Interval Tuning

The check interval controls how frequently the scheduler evaluates all schedules:

| Interval | Use Case |
|----------|----------|
| 1 second (default) | Responsive triggering, small to medium fleets |
| 5 seconds | Reduced CPU for large fleets (50+ agents) |
| 10+ seconds | Very large deployments where second-level precision is unnecessary |

A shorter check interval means schedules fire closer to their exact trigger time but uses more CPU for the evaluation pass. For most deployments the 1-second default is appropriate.

### Memory Usage

The scheduler maintains:
- A reference to the agent list
- A `Map<string, Set<string>>` of running schedules (one Set per agent)
- A `Map<string, Promise<void>>` of running job promises

Memory grows linearly with the number of concurrent jobs, not with the total number of schedules defined.

### State I/O

Schedule state is read from disk on each check iteration and written on each trigger event. For high-frequency schedules on slow storage:
- Use SSD storage for the `.herdctl` directory
- Increase the check interval to reduce read frequency
- Batching state updates is a potential future enhancement

## Design Decisions

### Why Polling Instead of Event-Driven

The scheduler uses a polling loop rather than an event-driven timer system (e.g., `setInterval` per schedule or a priority queue of next-fire times). Polling was chosen because:

- **Simplicity** -- a single loop with a sleep is straightforward to implement, test, and debug. There are no timer-management edge cases (drift, cancellation races, timer accumulation).
- **Consistency** -- every schedule is evaluated with the same logic on every pass. There is no risk of a timer being lost or not being re-registered after an error.
- **State coherence** -- reading state on each pass means the scheduler always acts on the latest persisted state, which matters when state is updated externally (e.g., disabling a schedule via the API).
- **Bounded resource usage** -- the number of active timers does not grow with the number of schedules. One loop handles any number of agents and schedules.

The trade-off is a small latency (up to `checkInterval` milliseconds) between when a schedule becomes due and when it fires. With the 1-second default, this is negligible for the intended use cases.

### Why Interval-First

Interval scheduling was implemented before cron because it covers the most common agent use case: periodic polling (check for issues every 5 minutes, scan for work every hour). Interval schedules are also simpler to reason about -- there is no timezone or calendar math involved.

Cron was added subsequently for users who need wall-clock precision (daily reports at 9am, weekly summaries on Monday). The two types share the schedule-checking pipeline but use different next-trigger calculation functions.

### Interval Timers Start After Completion

A key design choice is that interval timers measure from job **completion**, not from job start. If an agent has a 5-minute interval and takes 10 minutes to run, the next run begins 15 minutes after the first started (10 minutes of execution + 5 minutes of interval).

This prevents job pile-up: if execution routinely takes longer than the interval, a start-based timer would queue an ever-growing backlog of runs. The completion-based timer guarantees that the agent has at least `interval` milliseconds of idle time between runs.

### No Catch-Up for Missed Cron Triggers

If the system is down when a cron trigger should have fired, the scheduler does not retroactively execute missed runs. Instead, it calculates the next future occurrence from the current time and resumes normal operation. This avoids a burst of catch-up executions after a restart, which could overwhelm downstream systems.

## Public Exports

The module exports everything needed for integration:

```typescript
// From packages/core/src/scheduler/index.ts

// Scheduler class
export { Scheduler } from "./scheduler.js";

// Interval utilities
export { parseInterval, calculateNextTrigger, isScheduleDue } from "./interval.js";

// Cron utilities
export {
  parseCronExpression,
  calculateNextCronTrigger,
  isValidCronExpression,
} from "./cron.js";

// Schedule state
export {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
} from "./schedule-state.js";

// Schedule runner
export { runSchedule, buildSchedulePrompt } from "./schedule-runner.js";

// Errors
export {
  SchedulerError,
  IntervalParseError,
  ScheduleTriggerError,
  SchedulerShutdownError,
} from "./errors.js";

// Types
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
  RunScheduleOptions,
  ScheduleRunResult,
  ScheduleRunnerLogger,
  TriggerMetadata,
} from "./types.js";
```
