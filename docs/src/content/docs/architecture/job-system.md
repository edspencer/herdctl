---
title: Job System
description: Job lifecycle, metadata, output management, and events in herdctl
---

A **job** is a single execution of an agent. Every time an agent runs -- whether triggered by a schedule, a chat message, a manual CLI command, or a fork of a previous job -- herdctl creates a job to track the execution from start to finish. The job system provides the metadata schema, status lifecycle, output file management, and event infrastructure that the rest of herdctl depends on.

This page consolidates all job-specific architecture into one reference. For details on how jobs are executed, see the [Runner](/architecture/runner/). For how job files are stored on disk, see [State Management](/architecture/state-management/).

## What Is a Job

A job represents one invocation of an agent with a prompt. It captures:

- **Identity** -- which agent ran, which schedule (if any) triggered it, and how it was triggered.
- **Lifecycle** -- when it started, its current status, when it finished, and why it ended.
- **Context** -- the prompt given to the agent, the Claude session ID for resume/fork, and a reference to the parent job if forked.
- **Results** -- a summary of what the agent accomplished and a path to the full streaming output log.

Jobs are the primary unit of work in herdctl. The [Scheduler](/architecture/scheduler/) creates jobs when schedules fire. The [Runner](/architecture/runner/) executes them. The [State Manager](/architecture/state-management/) persists them. The [Web Dashboard](/architecture/overview/) and CLI display them.

## JobManager Module

Job operations are split across two modules in `@herdctl/core`:

| Module | Location | Responsibility |
|--------|----------|----------------|
| **Job metadata** | `packages/core/src/state/job-metadata.ts` | CRUD operations for job metadata files (create, read, update, delete, list with filters). |
| **Job output** | `packages/core/src/state/job-output.ts` | Append and read operations for JSONL streaming output files. |
| **Job control** | `packages/core/src/fleet-manager/job-control.ts` | Higher-level orchestration: trigger, cancel, and fork operations coordinated through FleetManager. |

The `JobControl` class in `job-control.ts` is the primary interface for job operations at the fleet level. It handles concurrency checks, session lookup, runtime selection, event emission, and hook execution around the core CRUD operations.

## Job ID Format

Every job receives a unique identifier with the format:

```text
job-YYYY-MM-DD-<random6>
```

For example: `job-2024-01-19-abc123`

The date portion uses the job creation date. The suffix is 6 lowercase alphanumeric characters generated from `Math.random().toString(36)`. The format is enforced by a regex in `JobMetadataSchema`:

```text
/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/
```

The `generateJobId()` function accepts optional `Date` and random function parameters to enable deterministic testing.

## Job Metadata Schema

Each job is persisted as a YAML file at `.herdctl/jobs/<job-id>.yaml`. The schema is defined by `JobMetadataSchema` (a Zod schema in `packages/core/src/state/schemas/job-metadata.ts`).

```yaml
# .herdctl/jobs/job-2024-01-19-abc123.yaml
id: job-2024-01-19-abc123
agent: bragdoc-marketer
schedule: daily-analytics
trigger_type: schedule

status: completed
exit_reason: success

session_id: claude-session-xyz789
forked_from: null

started_at: "2024-01-19T09:00:00Z"
finished_at: "2024-01-19T09:05:23Z"
duration_seconds: 323

prompt: |
  Analyze site traffic for the past 24 hours.
  Create a brief report and post to #marketing channel.

summary: "Generated daily analytics report. Traffic up 12% from yesterday."
output_file: job-2024-01-19-abc123.jsonl
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier in `job-YYYY-MM-DD-<random6>` format |
| `agent` | `string` | Qualified name of the executing agent |
| `schedule` | `string?` | Schedule name that triggered the job (null for manual/chat triggers) |
| `trigger_type` | enum | How the job was started (see [Trigger Types](#trigger-types)) |
| `status` | enum | Current job status (see [Status Lifecycle](#status-lifecycle)) |
| `exit_reason` | enum | Why the job ended (see [Exit Reasons](#exit-reasons)), null while running |
| `session_id` | `string?` | Claude session ID for resume/fork capability |
| `forked_from` | `string?` | Parent job ID when `trigger_type` is `fork` |
| `started_at` | `string` | ISO timestamp when job was created |
| `finished_at` | `string?` | ISO timestamp when job finished (null while running) |
| `duration_seconds` | `number?` | Total execution time in seconds (auto-calculated when `finished_at` is set) |
| `prompt` | `string?` | The prompt given to the agent |
| `summary` | `string?` | Brief summary of job results (extracted from the final assistant message) |
| `output_file` | `string?` | Filename of the JSONL output log |

### Immutable Fields

When updating a job via `updateJob()`, the following fields cannot be changed: `id`, `agent`, `trigger_type`, and `started_at`. These are set at creation time and remain fixed for the job's lifetime.

### Automatic Duration Calculation

When `finished_at` is set during an update and `duration_seconds` is not explicitly provided, `updateJob()` automatically calculates the duration from `started_at` and `finished_at`.

## Trigger Types

The `trigger_type` field records how a job was initiated:

| Trigger Type | Description |
|-------------|-------------|
| `manual` | Started via CLI command or programmatic API call |
| `schedule` | Triggered by the [Scheduler](/architecture/scheduler/) when a schedule fires |
| `webhook` | Triggered by an external HTTP webhook |
| `chat` | Triggered by a generic chat message |
| `discord` | Triggered by a Discord message |
| `slack` | Triggered by a Slack message |
| `web` | Triggered from the web dashboard |
| `fork` | Forked from a previous job's session |

The trigger type is set at job creation time and is immutable. Platform-specific connectors (Discord, Slack) set the appropriate trigger type so that job history can be filtered by source.

## Status Lifecycle

A job progresses through a linear status lifecycle:

```text
pending ──► running ──► completed
                   ├──► failed
                   └──► cancelled
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job record created but execution has not begun |
| `running` | Agent is actively executing the job |
| `completed` | Job finished successfully |
| `failed` | Job ended with an error |
| `cancelled` | Job was cancelled by user or system shutdown |

### Transitions

The job starts in `pending` when `createJob()` writes the metadata file. The [Runner](/architecture/runner/) transitions it to `running` when the SDK execution loop begins. On completion, the Runner sets the final status based on the outcome:

- **Success**: status becomes `completed`, exit_reason is set to `success`.
- **Error**: status becomes `failed`, exit_reason indicates the failure type.
- **Cancellation**: status becomes `cancelled`, exit_reason is `cancelled`.

A job in a terminal state (`completed`, `failed`, `cancelled`) is never updated again. There is no mechanism to restart a finished job -- instead, fork it to create a new job with the same context.

### Relationship to Agent State

When a job starts running, the agent's entry in `state.yaml` is updated: `status` becomes `running` and `current_job` is set to the job ID. When the job finishes, the agent returns to `idle` (or `error` if the job failed), `current_job` is cleared, and `last_job` is set to the completed job's ID.

## Exit Reasons

The `exit_reason` field captures why a job ended. It is set when the job transitions to a terminal status.

| Exit Reason | Description |
|-------------|-------------|
| `success` | Job completed naturally -- the agent finished its work |
| `error` | Job failed due to an unrecoverable error (SDK error, API failure, etc.) |
| `timeout` | Job exceeded its configured time limit or encountered a network timeout |
| `cancelled` | Job was explicitly cancelled by user intervention or system shutdown |
| `max_turns` | Job reached the maximum number of conversation turns configured for the agent |

The Runner's `classifyError()` function examines error messages and codes to determine the appropriate exit reason. For example, `ETIMEDOUT` errors map to the `timeout` exit reason, while `AbortController` signals map to `cancelled`.

## Job Forking

Forking creates a new job based on an existing one. The new job inherits the original's agent and schedule but receives a fresh job ID and starts in `pending` status. The `forked_from` field links back to the parent job.

### Fork Mechanics

The `JobControl.forkJob()` method:

1. Reads the original job's metadata.
2. Validates that the agent still exists in the current configuration.
3. Creates a new job with `trigger_type: "fork"` and `forked_from` set to the original job ID.
4. Allows optional modifications: a different prompt or schedule name.
5. Emits `job:created` and `job:forked` events.

```typescript
const result = await manager.forkJob("job-2024-01-19-abc123", {
  prompt: "Try a different approach to the same task",
});
// result.jobId → "job-2024-01-19-def456"
// result.forkedFromJobId → "job-2024-01-19-abc123"
```

### Fork vs Resume

Forking and resuming both build on previous sessions but serve different purposes:

| Operation | Session behavior | Use case |
|-----------|-----------------|----------|
| **Resume** | Continues the exact same session | Pick up where the previous job left off |
| **Fork** | Branches from the session to explore alternatives | Try a different approach without losing the original |

For details on session management, see [Runner: Session Management](/architecture/runner/#session-management).

## Output File Management

Each job produces a JSONL output file alongside its metadata file. The two files share the same base name:

```text
.herdctl/jobs/
├── job-2024-01-19-abc123.yaml    # Metadata
├── job-2024-01-19-abc123.jsonl   # Streaming output
├── job-2024-01-19-def456.yaml
└── job-2024-01-19-def456.jsonl
```

### Writing Output

The Runner writes to the JSONL file in real time during execution via `appendJobOutput()`. Each call appends a single JSON line with an automatically-added timestamp. There is no buffering -- messages appear on disk immediately, enabling concurrent readers.

```typescript
await appendJobOutput(jobsDir, jobId, {
  type: "assistant",
  content: "Analyzing the codebase...",
});
```

Batch writing is also supported via `appendJobOutputBatch()`, which validates all messages before writing any of them.

### Output Message Types

The JSONL file contains five message types, defined by a Zod discriminated union (`JobOutputMessageSchema`):

| Type | Description | Key Fields |
|------|-------------|------------|
| `system` | Session lifecycle events (init, end, complete) | `subtype`, `content` |
| `assistant` | Claude's text responses | `content`, `partial`, `usage` |
| `tool_use` | Tool invocations by the agent | `tool_name`, `tool_use_id`, `input` |
| `tool_result` | Results from tool execution | `tool_use_id`, `result`, `success`, `error` |
| `error` | Error events | `message`, `code`, `stack` |

Every message includes a `type` field and a `timestamp`. The `isValidJobOutputInput()` type guard validates that a message has the minimum required fields before writing.

For complete field-level details on each message type, see [State Management: JSONL Message Types](/architecture/state-management/#jsonl-message-types).

### JSONL Properties

The JSONL format provides several important properties:

- **Streamable** -- each line is self-contained, so the file can be read while still being written to.
- **Append-only** -- messages are never inserted, overwritten, or reordered.
- **Replayable** -- the full conversation can be reconstructed by reading from top to bottom.
- **No buffering** -- `fs.appendFile` writes each message immediately.

For details on write atomicity and concurrent safety, see [State Management: JSONL Append Semantics](/architecture/state-management/#jsonl-append-semantics).

## Reading Job Output

The job output module provides two APIs for reading output: a streaming async generator and a convenience function that collects all messages into an array.

### Async Generator (Streaming)

The `readJobOutput()` function returns an `AsyncGenerator` that yields messages one at a time. This is the memory-efficient choice for large output files:

```typescript
import { readJobOutput } from "@herdctl/core";

for await (const message of readJobOutput(jobsDir, jobId)) {
  switch (message.type) {
    case "assistant":
      console.log(`[Claude] ${message.content}`);
      break;
    case "tool_use":
      console.log(`[Tool] ${message.tool_name}: ${message.input}`);
      break;
    case "error":
      console.error(`[Error] ${message.message}`);
      break;
  }
}
```

The generator handles several edge cases:

- **File not found** -- yields nothing (does not throw).
- **Empty lines** -- silently skipped.
- **Invalid lines** -- throws by default, or skips with `skipInvalidLines: true`.
- **Resource cleanup** -- the readline interface and file stream are closed in a `finally` block.

### Collecting All Messages

The `readJobOutputAll()` convenience function collects every message into an array:

```typescript
import { readJobOutputAll } from "@herdctl/core";

const messages = await readJobOutputAll(jobsDir, jobId);
console.log(`Total messages: ${messages.length}`);
```

For large output files, prefer the streaming generator to avoid loading the entire file into memory.

### Tailing Output (tail -f)

Because JSONL files are append-only with immediate writes, standard Unix tools work for real-time monitoring:

```bash
tail -f .herdctl/jobs/job-2024-01-19-abc123.jsonl | jq .
```

This is useful for debugging from the terminal without involving herdctl's programmatic APIs.

### Extracting Final Output

The `JobControl.getJobFinalOutput()` method reads a completed job's JSONL file and extracts the last meaningful content. It prioritizes assistant text messages over raw tool results, since the agent's response is typically what callers care about. This extracted output is used by the hook system to populate the `result.output` field in `HookContext`.

## Job Retention and Cleanup

Job metadata and output files persist indefinitely by default. There is currently no automatic retention policy or cleanup mechanism built into herdctl. Both the `.yaml` metadata file and `.jsonl` output file remain in `.herdctl/jobs/` until manually removed.

### Manual Cleanup

The `deleteJob()` function removes a job's metadata file:

```typescript
import { deleteJob } from "@herdctl/core";

const deleted = await deleteJob(jobsDir, "job-2024-01-19-abc123");
```

This deletes only the `.yaml` file. The corresponding `.jsonl` output file must be removed separately if desired.

### Listing and Filtering Jobs

The `listJobs()` function supports filtering to help identify jobs for cleanup:

```typescript
import { listJobs } from "@herdctl/core";

// Find all failed jobs older than 7 days
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const { jobs, errors } = await listJobs(jobsDir, {
  status: "failed",
  startedBefore: sevenDaysAgo,
});
```

Available filters:

| Filter | Type | Description |
|--------|------|-------------|
| `agent` | `string` | Filter by agent name |
| `status` | `JobStatus` | Filter by job status |
| `startedAfter` | `string` or `Date` | Jobs started on or after this date |
| `startedBefore` | `string` or `Date` | Jobs started on or before this date |

Results are sorted by `started_at` in descending order (most recent first). The `errors` count indicates how many job files failed to parse (corrupted or incompatible format).

## Job Events

The FleetManager emits strongly-typed events throughout a job's lifecycle. These events drive the web dashboard, CLI output, and any programmatic subscribers.

### Event Timeline

A typical job lifecycle emits events in this order:

```text
job:created    ──► Job record written, status is "pending"
                   (execution begins)
job:output     ──► Repeated for each output chunk during execution
job:completed  ──► Job finished successfully
   or
job:failed     ──► Job ended with an error
   or
job:cancelled  ──► Job was cancelled
```

Fork operations emit an additional event:

```text
job:created    ──► New forked job record written
job:forked     ──► Links the new job to its parent
```

### Event Payloads

| Event | Payload | Key Fields |
|-------|---------|------------|
| `job:created` | `JobCreatedPayload` | `job` (full metadata), `agentName`, `scheduleName` |
| `job:output` | `JobOutputPayload` | `jobId`, `agentName`, `output` (content chunk), `outputType` |
| `job:completed` | `JobCompletedPayload` | `job`, `agentName`, `exitReason`, `durationSeconds` |
| `job:failed` | `JobFailedPayload` | `job`, `agentName`, `error`, `exitReason` |
| `job:cancelled` | `JobCancelledPayload` | `job`, `agentName`, `terminationType`, `durationSeconds` |
| `job:forked` | `JobForkedPayload` | `job` (new job), `originalJob`, `agentName` |

### Subscribing to Events

```typescript
const manager = new FleetManager({ stateDir: ".herdctl" });

manager.on("job:created", (payload) => {
  console.log(`Job ${payload.job.id} created for ${payload.agentName}`);
});

manager.on("job:completed", (payload) => {
  console.log(`Job ${payload.job.id} completed in ${payload.durationSeconds}s`);
});

manager.on("job:failed", (payload) => {
  console.error(`Job ${payload.job.id} failed: ${payload.error.message}`);
});
```

All event payloads include a `timestamp` field (ISO string) indicating when the event occurred. The event map is defined with full TypeScript generics in `FleetManagerEventMap`, providing type-safe `on()` and `emit()` calls.

## Job Cancellation

Jobs can be cancelled through the `JobControl.cancelJob()` method. Cancellation updates the job's status to `cancelled` with exit reason `cancelled`.

### Cancellation Flow

1. The method verifies the job exists and is in a `running` or `pending` state.
2. If the job is already in a terminal state, it returns `terminationType: "already_stopped"` without modification.
3. For running jobs, the metadata is updated to `status: "cancelled"` and `exit_reason: "cancelled"`.
4. A `job:cancelled` event is emitted with the termination type and duration.

### Bulk Cancellation

During fleet shutdown, `cancelRunningJobs()` cancels all currently running jobs in parallel. Each agent's `currentJobId` is collected and cancelled concurrently. Individual cancellation failures are logged as warnings but do not block shutdown of other jobs.

## Source Code Layout

The job system spans several files in `packages/core/src/`:

```text
packages/core/src/
├── state/
│   ├── schemas/
│   │   ├── job-metadata.ts    # JobMetadataSchema, generateJobId(), createJobMetadata()
│   │   └── job-output.ts      # JobOutputMessageSchema, JobOutputInput types
│   ├── job-metadata.ts        # createJob(), updateJob(), getJob(), listJobs(), deleteJob()
│   └── job-output.ts          # appendJobOutput(), readJobOutput(), readJobOutputAll()
└── fleet-manager/
    ├── job-control.ts         # JobControl class: trigger(), cancelJob(), forkJob()
    └── event-types.ts         # Job event payload type definitions
```

## Related Pages

### Architecture
- [System Architecture Overview](/architecture/overview/) -- Job system's role in the overall architecture
- [Agent Execution Engine](/architecture/runner/) -- How the Runner executes jobs and streams output
- [State Persistence](/architecture/state-management/) -- How job files are stored on disk
- [Schedule System](/architecture/scheduler/) -- How schedules create jobs
- [Chat Infrastructure](/architecture/chat-infrastructure/) -- How chat messages trigger jobs

### Concepts
- [Jobs](/concepts/jobs/) -- User-facing guide to jobs
- [Sessions](/concepts/sessions/) -- Session persistence and resume/fork
