---
title: Schedules
description: Defining when and how agents execute tasks
---

A **Schedule** combines a trigger with a prompt to define when and how an agent executes. Each schedule is a named entry that specifies what event triggers execution and what instructions the agent receives.

## Why Schedules?

Agents need to know:
1. **When** to run (the trigger)
2. **What** to do (the prompt)

A schedule bundles these together. One agent can have multiple schedules for different tasks—checking issues every 5 minutes, generating reports daily, or responding to webhooks.

## Multiple Schedules Per Agent

Agents can have as many schedules as needed. Each schedule operates independently with its own trigger and prompt:

```yaml
# agents/marketing-agent.yaml
name: marketing-agent
description: "Handles analytics, social monitoring, and reports"

schedules:
  hourly-scan:
    type: interval
    interval: 1h
    prompt: |
      Scan social media channels for product mentions.
      Log any notable conversations to mentions.md.

  daily-analytics:
    type: cron
    cron: "0 9 * * *"
    prompt: |
      Analyze yesterday's site traffic and conversion data.
      Update analytics/daily-report.md with findings.

  weekly-report:
    type: cron
    cron: "0 10 * * 1"
    prompt: |
      Generate the weekly marketing summary.
      Include: traffic trends, top content, social engagement.
      Create reports/weekly/{{date}}.md with the full report.
```

This agent runs three independent tasks:
- **hourly-scan**: Checks social media every hour
- **daily-analytics**: Generates analytics report at 9am daily
- **weekly-report**: Creates comprehensive weekly summary on Mondays at 10am

## Schedule Configuration

Schedules are defined as a named map within an agent configuration:

```yaml
schedules:
  schedule-name:
    type: interval | cron | webhook | chat
    interval: "5m"           # For interval triggers
    cron: "0 9 * * *"  # For cron triggers
    prompt: |
      Instructions for what the agent should do.
    work_source:             # Optional: where to get tasks
      type: github
      labels:
        ready: "ready"
        in_progress: "in-progress"
```

### Schedule Properties

| Property | Required | Description |
|----------|----------|-------------|
| `type` | Yes | Trigger type: `interval`, `cron`, `webhook`, or `chat` |
| `interval` | For interval | Duration string like `5m`, `1h`, `30s` |
| `cron` | For cron | Cron expression like `0 9 * * 1-5` |
| `prompt` | No | Instructions for this schedule |
| `work_source` | No | Task source configuration (e.g., GitHub Issues) |

## Interval Configuration

Interval triggers are the most common schedule type for automated agents. They execute at fixed time intervals after the previous job completes.

### Syntax

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for new issues and triage them."
```

### Supported Units

| Unit | Description | Example | Milliseconds |
|------|-------------|---------|--------------|
| `s` | Seconds | `30s` | 30,000 |
| `m` | Minutes | `5m` | 300,000 |
| `h` | Hours | `1h` | 3,600,000 |
| `d` | Days | `1d` | 86,400,000 |

### Interval Syntax Rules

- **Positive integers only**: No decimals (`5.5m` is invalid)
- **No zero values**: `0m` is invalid
- **No negative values**: `-5m` is invalid
- **Single unit per interval**: Use `90m` instead of `1h30m`
- **Case insensitive**: `5M` and `5m` are equivalent

### Examples

```yaml
# Quick polling every 30 seconds
schedules:
  quick-check:
    type: interval
    interval: 30s

# Standard 5-minute check
schedules:
  issue-check:
    type: interval
    interval: 5m

# Hourly processing
schedules:
  hourly-sync:
    type: interval
    interval: 1h

# Daily batch job
schedules:
  daily-cleanup:
    type: interval
    interval: 1d
```

## How Interval Timing Works

Understanding how interval timing works is critical for planning your agent schedules.

### Key Principle: After Completion, Not Start

Intervals measure time **from the completion of the previous job**, not from when it started. This prevents job pile-up when execution time varies:

```
Timeline with 5-minute interval:

10:00 - Job 1 starts
10:03 - Job 1 completes (took 3 minutes)
10:08 - Job 2 starts (5 minutes after 10:03)
10:15 - Job 2 completes (took 7 minutes)
10:20 - Job 3 starts (5 minutes after 10:15)
```

This design ensures:
- **No overlapping jobs**: The next job can't start until the previous one finishes
- **Predictable spacing**: There's always at least the interval duration between job starts
- **Natural backpressure**: Long-running jobs don't cause pile-up

### First Run Behavior

When a schedule has never run before (no `last_run_at` in state), it triggers immediately:

```
New agent deployed at 10:00
→ Schedule "check-issues" has no previous run
→ First job triggers immediately at 10:00
→ Job completes at 10:02
→ Next job scheduled for 10:07 (5 minutes after completion)
```

### Clock Skew Handling

If the calculated next trigger time is in the past (e.g., due to system sleep or clock adjustment), the schedule triggers immediately:

```
Last completion: 10:00
Interval: 5m
Expected next: 10:05
Current time: 10:30 (system was asleep)
→ Triggers immediately at 10:30
```

### Jitter (Thundering Herd Prevention)

When many agents have the same interval, they can synchronize and all trigger simultaneously. The scheduler includes internal jitter handling to spread out triggers naturally, preventing all agents from firing at exactly the same moment.

This behavior is automatic and does not require configuration.

## Concurrency Control with max_concurrent

The `max_concurrent` setting limits how many jobs can run simultaneously for a single agent. This prevents resource exhaustion and ensures predictable behavior.

### Configuration

Set `max_concurrent` in the agent's `instances` configuration:

```yaml
# agents/issue-processor.yaml
name: issue-processor
description: "Processes GitHub issues"

instances:
  max_concurrent: 1  # Only one job at a time (default)

schedules:
  process-issues:
    type: interval
    interval: 5m
    prompt: "Process the next ready issue."
```

### How It Works

The scheduler tracks running jobs per agent and skips triggering if at capacity:

```
max_concurrent: 2

10:00 - Job 1 starts (running: 1)
10:05 - Job 2 starts (running: 2, at capacity)
10:05 - Scheduler check: skipped, at capacity
10:07 - Job 1 completes (running: 1)
10:10 - Job 3 starts (running: 2)
```

### Skip Reason: at_capacity

When a schedule is skipped due to capacity, the scheduler logs:

```
Skipping issue-processor/process-issues: at max capacity (2/2)
```

### Recommended Settings

| Use Case | max_concurrent | Reason |
|----------|----------------|--------|
| Issue processing | 1 | Avoid duplicate work |
| Monitoring/alerts | 1-2 | Limited parallelism |
| Data sync | 1 | Ensure ordering |
| Independent tasks | 2-4 | Parallel execution |

### Example: Multiple Concurrent Jobs

```yaml
name: data-processor
description: "Processes data from multiple sources"

instances:
  max_concurrent: 3  # Process up to 3 items simultaneously

schedules:
  process-queue:
    type: interval
    interval: 1m
    prompt: "Process the next item from the work queue."
    work_source:
      type: github
      labels:
        ready: "ready"
        in_progress: "processing"
```

## Schedule State and Monitoring

Each schedule maintains state that tracks its execution history and status.

### State Structure

Schedule state is stored in `.herdctl/state.yaml`:

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
```

### State Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | `idle` \| `running` \| `disabled` | Current schedule status |
| `last_run_at` | ISO timestamp | When the schedule last completed |
| `next_run_at` | ISO timestamp | When the schedule will next trigger |
| `last_error` | string or null | Error message from last failure |

### Schedule Statuses

- **idle**: Schedule is waiting for its next trigger time
- **running**: Schedule is currently executing a job
- **disabled**: Schedule is disabled and won't trigger

### Monitoring Schedule State

Check schedule state using the CLI:

```bash
# View all agent states
cat .herdctl/state.yaml

# View specific agent schedules
herdctl status my-agent
```

### Disabling Schedules

To temporarily disable a schedule without removing it:

```bash
# Manually edit state (or use CLI when available)
# Set schedule status to "disabled"
```

When a schedule is disabled:
- The scheduler skips it during checks
- It can be re-enabled by setting status to "idle"
- Existing state (last_run_at, etc.) is preserved

## Integration with Work Sources

Schedules can include a work source to pull tasks from external systems like GitHub Issues.

### Configuration

```yaml
schedules:
  issue-processor:
    type: interval
    interval: 5m
    prompt: "Process the next ready issue."
    work_source:
      type: github
      labels:
        ready: "ready"
        in_progress: "in-progress"
```

### Execution Flow

When a schedule with a work source triggers:

1. **Check for work**: Query the work source for available items
2. **Claim work item**: Apply `in_progress` label to claim the item
3. **Build prompt**: Combine schedule prompt with work item details
4. **Execute job**: Run the agent with the combined prompt
5. **Report outcome**: Mark work item as complete or release on failure

### Prompt Building

The schedule prompt is combined with work item details:

```
# Schedule prompt:
Process the next ready issue.

# Combined prompt sent to agent:
Process the next ready issue.

---
## Work Item

**Title:** Fix authentication timeout
**ID:** 42
**URL:** https://github.com/org/repo/issues/42

### Description
Users are experiencing authentication timeouts after 30 minutes...

### Metadata
- **Labels:** bug, authentication
- **Priority:** high
```

### No Work Available

If no work items are available:
- The job completes immediately
- Schedule state is updated with completion time
- Next trigger is calculated normally

### Work Source Failure Handling

If work source operations fail:
- **Claim failure**: Job is aborted, schedule retries next interval
- **Execution failure**: Work item is released back to the queue
- **Report failure**: Logged but doesn't affect job outcome

## Trigger Types

### Interval Triggers

Execute at fixed time intervals:

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for new issues and triage them."
```

Supported units:
- `s` - seconds (e.g., `30s`)
- `m` - minutes (e.g., `5m`)
- `h` - hours (e.g., `1h`)
- `d` - days (e.g., `1d`)

### Cron Triggers

Execute on a cron schedule for precise timing:

```yaml
schedules:
  morning-standup:
    type: cron
    cron: "0 9 * * 1-5"  # 9am weekdays
    prompt: "Review yesterday's progress and plan today's work."
```

Cron expression format: `minute hour day month weekday`

Common patterns:
- `0 9 * * *` - Daily at 9am
- `0 9 * * 1-5` - Weekdays at 9am
- `0 * * * *` - Every hour
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 9 1 * *` - Monthly on the 1st at 9am

### Webhook Triggers

Execute when an HTTP request is received:

```yaml
schedules:
  deploy-hook:
    type: webhook
    prompt: |
      A deployment was triggered.
      Run the test suite and report any failures.
```

### Chat Triggers

Execute in response to chat messages:

```yaml
schedules:
  support-response:
    type: chat
    prompt: |
      A user has asked a question in the support channel.
      Provide a helpful response based on the documentation.
```

## Example: Multi-Schedule Agent

Here's a complete example showing an agent with schedules for different purposes:

```yaml
# agents/devops-agent.yaml
name: devops-agent
description: "Monitors infrastructure and handles deployments"

workspace: infrastructure-repo
repo: company/infrastructure

instances:
  max_concurrent: 2  # Allow 2 concurrent jobs

schedules:
  # Quick health checks every 5 minutes
  health-check:
    type: interval
    interval: 5m
    prompt: |
      Run quick health checks on all services.
      Log any issues to monitoring/health.md.

  # Hourly security scan
  security-scan:
    type: cron
    cron: "0 * * * *"
    prompt: |
      Scan for security vulnerabilities in dependencies.
      Update security/scan-results.md with findings.
      Create issues for any critical vulnerabilities.

  # Daily capacity report
  daily-capacity:
    type: cron
    cron: "0 8 * * *"
    prompt: |
      Analyze resource utilization across all environments.
      Generate capacity report in reports/capacity/{{date}}.md.
      Flag any services approaching resource limits.

  # Weekly infrastructure review
  weekly-review:
    type: cron
    cron: "0 10 * * 1"
    prompt: |
      Comprehensive infrastructure review:
      - Resource utilization trends
      - Cost analysis and optimization opportunities
      - Pending maintenance items
      - Security posture summary
      Write report to reports/weekly/{{date}}.md.

  # Deployment webhook
  deploy:
    type: webhook
    prompt: |
      A deployment has been triggered via webhook.
      Validate the deployment and run post-deploy checks.
      Report status to the deployment channel.
```

## Prompts and Work Sources

### Prompt Templates

Prompts can include variables for dynamic content:

```yaml
schedules:
  process-issue:
    type: interval
    interval: 5m
    prompt: |
      Process issue {{issue.number}}: {{issue.title}}

      Description:
      {{issue.body}}

      Implement the requested changes and submit a PR.
```

### Work Source Integration

Schedules can include a work source to pull tasks from external systems:

```yaml
schedules:
  issue-processor:
    type: interval
    interval: 5m
    prompt: "Process the next ready issue."
    work_source:
      type: github
      labels:
        ready: "ready"
        in_progress: "in-progress"
```

When a work source is configured, the schedule will:
1. Check for available work items
2. Claim an item by applying the `in_progress` label
3. Execute with context about the claimed item
4. Mark completion based on work source settings

## Related Concepts

- [Triggers](/concepts/triggers/) - Detailed trigger configuration
- [Work Sources](/concepts/work-sources/) - How agents get tasks
- [Agents](/concepts/agents/) - What schedules run
- [Jobs](/concepts/jobs/) - Schedule execution results
- [State Management](/internals/state-management/) - How schedule state is stored
