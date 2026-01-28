---
title: State Management
description: How herdctl stores and manages fleet state
---

herdctl uses a file-based state system to track agents, jobs, and sessions. All state is stored in the `.herdctl/` directory—no database required.

## Directory Structure

```
.herdctl/
├── state.yaml              # Fleet state (agent status, schedules)
├── jobs/
│   ├── job-2024-01-19-abc123.yaml   # Job metadata
│   └── job-2024-01-19-abc123.jsonl  # Streaming output log
├── sessions/
│   └── <agent-name>.json   # Session info per agent
└── logs/
    └── <agent-name>.log    # Agent-level logs
```

### Subdirectory Purposes

| Directory | Purpose |
|-----------|---------|
| `state.yaml` | Fleet-wide state including agent status and scheduling |
| `jobs/` | Individual job metadata (YAML) and streaming output (JSONL) |
| `sessions/` | Claude session information for resume/fork capability |
| `logs/` | Agent-level logs for debugging |

## state.yaml Format

The `state.yaml` file tracks fleet-wide state using the `FleetStateSchema`:

```yaml
# .herdctl/state.yaml
fleet:
  started_at: "2025-01-19T10:00:00Z"   # ISO timestamp when fleet started

agents:
  bragdoc-coder:
    status: idle              # idle | running | error
    current_job: null         # Job ID if currently running
    last_job: job-2024-01-19-abc123
    next_schedule: issue-check
    next_trigger_at: "2025-01-19T10:10:00Z"
    container_id: null        # Docker container ID (if using Docker)
    error_message: null       # Error message if status is 'error'

  bragdoc-marketer:
    status: running
    current_job: job-2024-01-19-def456
    last_job: job-2024-01-19-xyz789
    next_schedule: null
    next_trigger_at: null
    container_id: "def456"
```

### Agent State Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | `idle` \| `running` \| `error` | Current agent status |
| `current_job` | `string?` | ID of currently running job |
| `last_job` | `string?` | ID of the last completed job |
| `next_schedule` | `string?` | Name of the next scheduled trigger |
| `next_trigger_at` | `string?` | ISO timestamp of next scheduled run |
| `container_id` | `string?` | Docker container ID (if containerized) |
| `error_message` | `string?` | Error message when status is `error` |

## Job File Formats

Each job creates two files in `.herdctl/jobs/`:

### Job Metadata (YAML)

```yaml
# .herdctl/jobs/job-2024-01-19-abc123.yaml
id: job-2024-01-19-abc123
agent: bragdoc-marketer
schedule: daily-analytics
trigger_type: schedule        # manual | schedule | webhook | chat | fork

status: completed             # pending | running | completed | failed | cancelled
exit_reason: success          # success | error | timeout | cancelled | max_turns

session_id: claude-session-xyz789
forked_from: null             # Parent job ID if this was forked

started_at: "2024-01-19T09:00:00Z"
finished_at: "2024-01-19T09:05:23Z"
duration_seconds: 323

prompt: |
  Analyze site traffic for the past 24 hours.
  Create a brief report and post to #marketing channel.

summary: "Generated daily analytics report. Traffic up 12% from yesterday."
output_file: job-2024-01-19-abc123.jsonl
```

### Job Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Format: `job-YYYY-MM-DD-<random6>` |
| `agent` | `string` | Name of the executing agent |
| `schedule` | `string?` | Schedule name that triggered the job |
| `trigger_type` | enum | How the job was started |
| `status` | enum | Current job status |
| `exit_reason` | enum | Why the job ended (when finished) |
| `session_id` | `string?` | Claude session ID for resume/fork |
| `forked_from` | `string?` | Parent job ID (for forked jobs) |
| `started_at` | `string` | ISO timestamp when job started |
| `finished_at` | `string?` | ISO timestamp when job finished |
| `duration_seconds` | `number?` | Total execution time |
| `prompt` | `string?` | The prompt given to the agent |
| `summary` | `string?` | Brief summary of job results |
| `output_file` | `string?` | Path to the JSONL output file |

### Job Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job created but not yet started |
| `running` | Job is currently executing |
| `completed` | Job finished successfully |
| `failed` | Job ended with an error |
| `cancelled` | Job was cancelled by user |

### Exit Reason Values

| Exit Reason | Description |
|-------------|-------------|
| `end_turn` | Job completed naturally |
| `stop_sequence` | Job hit a stop sequence |
| `max_turns` | Job reached maximum conversation turns |
| `timeout` | Job exceeded configured time limit |
| `interrupt` | Job was cancelled by user intervention |
| `error` | Job failed due to an error |

### Streaming Output (JSONL)

Job output is stored as newline-delimited JSON (JSONL) for efficient streaming:

```jsonl
{"type":"system","subtype":"init","timestamp":"2024-01-19T09:00:00Z"}
{"type":"assistant","content":"I'll analyze the traffic data...","timestamp":"2024-01-19T09:00:01Z"}
{"type":"tool_use","tool_name":"Bash","input":"node scripts/get-analytics.js","timestamp":"2024-01-19T09:00:02Z"}
{"type":"tool_result","result":"...analytics output...","success":true,"timestamp":"2024-01-19T09:00:05Z"}
{"type":"assistant","content":"Traffic is up 12% from yesterday...","timestamp":"2024-01-19T09:00:10Z"}
```

## JSONL Message Types

All messages include a `type` field and `timestamp`. The five message types are:

### system

System events like session initialization:

```json
{
  "type": "system",
  "subtype": "init",
  "content": "Session initialized",
  "timestamp": "2024-01-19T09:00:00Z"
}
```

### assistant

Claude's text responses:

```json
{
  "type": "assistant",
  "content": "I'll analyze the traffic data...",
  "partial": false,
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 200
  },
  "timestamp": "2024-01-19T09:00:01Z"
}
```

### tool_use

Tool invocations by Claude:

```json
{
  "type": "tool_use",
  "tool_name": "Bash",
  "tool_use_id": "toolu_abc123",
  "input": "gh issue list --label ready --json number,title",
  "timestamp": "2024-01-19T09:00:02Z"
}
```

### tool_result

Results from tool execution:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "result": "[{\"number\":42,\"title\":\"Fix auth timeout\"}]",
  "success": true,
  "error": null,
  "timestamp": "2024-01-19T09:00:05Z"
}
```

### error

Error messages:

```json
{
  "type": "error",
  "message": "Tool execution failed",
  "code": "TOOL_ERROR",
  "stack": "...",
  "timestamp": "2024-01-19T09:00:05Z"
}
```

## Session Info Format

Session files track Claude session state for resume/fork capability:

```json
// .herdctl/sessions/bragdoc-coder.json
{
  "agent_name": "bragdoc-coder",
  "session_id": "claude-session-xyz789",
  "created_at": "2024-01-19T08:00:00Z",
  "last_used_at": "2024-01-19T10:05:00Z",
  "job_count": 15,
  "mode": "autonomous"
}
```

### Session Modes

| Mode | Description |
|------|-------------|
| `autonomous` | Agent runs independently |
| `interactive` | Human-in-the-loop mode |
| `review` | Review/approval required for actions |

## Atomic Writes for Safety

All state file operations use atomic writes to prevent corruption:

1. **Write to temp file**: Content is written to `.<filename>.tmp.<random>` in the same directory
2. **Atomic rename**: The temp file is renamed to the target (atomic on POSIX systems)
3. **Cleanup on failure**: Temp files are cleaned up if the write fails

This pattern ensures:

- **No partial writes**: Files are never in an incomplete state
- **Crash safety**: If the process crashes mid-write, the original file remains intact
- **Concurrent safety**: Multiple readers won't see incomplete data

### JSONL Appends

JSONL files use `fs.appendFile`, which is atomic at the message level on most systems. Each line is a complete, self-contained JSON object.

### Windows Compatibility

On Windows, the rename operation includes retry logic with exponential backoff to handle file locking (EACCES/EPERM errors).

## Debugging State Issues

### Inspect Current State

```bash
# View fleet state
cat .herdctl/state.yaml

# View specific job
cat .herdctl/jobs/job-2024-01-19-abc123.yaml

# View job output
cat .herdctl/jobs/job-2024-01-19-abc123.jsonl

# View session info
cat .herdctl/sessions/bragdoc-coder.json
```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Agent stuck in `running` | Crash during job | Reset agent status in state.yaml |
| Missing job output | Write failure | Check disk space, permissions |
| Session won't resume | Invalid session ID | Clear session file |

## Schedule State

Each agent can have multiple schedules, each with its own state:

```yaml
agents:
  my-agent:
    status: idle
    schedules:
      check-issues:
        status: idle           # idle | running | disabled
        last_run_at: "2025-01-19T10:05:00Z"
        next_run_at: "2025-01-19T10:10:00Z"
        last_error: null
      daily-report:
        status: running
        last_run_at: "2025-01-19T09:00:00Z"
        next_run_at: null
        last_error: null
```

### Schedule State Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | `idle` \| `running` \| `disabled` | Current schedule status |
| `last_run_at` | string (ISO) | When the schedule last completed |
| `next_run_at` | string (ISO) | Calculated next trigger time |
| `last_error` | string \| null | Error message from last failure |

For more details on schedule state, see [Schedules - State and Monitoring](/concepts/schedules/#schedule-state-and-monitoring) and [Scheduler Internals](/internals/scheduler/).

## Related Concepts

- [Sessions](/concepts/sessions/) - Understanding session persistence
- [Jobs](/concepts/jobs/) - Job lifecycle and management
- [Workspaces](/concepts/workspaces/) - Where agents operate
- [Schedules](/concepts/schedules/) - Schedule configuration and state
- [Scheduler Internals](/internals/scheduler/) - How the scheduler works
