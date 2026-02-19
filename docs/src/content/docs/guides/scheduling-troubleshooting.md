---
title: Troubleshooting Scheduling Issues
description: Common scheduling problems and how to fix them
---

This guide covers common scheduling issues you may encounter when running herdctl agents and how to resolve them.

## Quick Diagnostic Commands

```bash
# Check current fleet state
cat .herdctl/state.yaml

# View scheduler logs
tail -f .herdctl/logs/scheduler.log

# Check specific agent state
herdctl status my-agent

# Validate agent configuration
herdctl validate agents/my-agent.yaml
```

## Common Issues

### Schedule Not Triggering

**Symptoms**: Agent schedule never runs, no jobs created.

**Possible Causes**:

#### 1. Schedule is Disabled

Check if the schedule status is `disabled`:

```yaml
# .herdctl/state.yaml
agents:
  my-agent:
    schedules:
      check-issues:
        status: disabled  # <- Problem
```

**Fix**: Set status to `idle`:

```yaml
agents:
  my-agent:
    schedules:
      check-issues:
        status: idle
```

#### 2. Invalid Interval Format

The interval string may be malformed:

```yaml
# Invalid examples
schedules:
  bad-1:
    type: interval
    interval: "5"      # Missing unit
  bad-2:
    type: interval
    interval: "5.5m"   # Decimals not supported
  bad-3:
    type: interval
    interval: "0m"     # Zero not allowed
  bad-4:
    type: interval
    interval: "-5m"    # Negative not allowed
```

**Fix**: Use valid format `{positive-integer}{unit}`:

```yaml
schedules:
  good:
    type: interval
    interval: "5m"     # Valid: 5 minutes
```

#### 3. Missing Interval Field

For interval type schedules, the `interval` field is required:

```yaml
# Missing interval
schedules:
  broken:
    type: interval
    # interval: missing!
    prompt: "Do something"
```

**Fix**: Add the interval field.

#### 4. Wrong Schedule Type

The scheduler processes both `interval` and `cron` type schedules. However, `webhook` and `chat` types are **not** automatically triggered by the scheduler -- they rely on external events (incoming HTTP requests or chat messages).

```yaml
# These ARE processed by the scheduler
schedules:
  my-interval:
    type: interval
    interval: "5m"
    prompt: "Check for updates"
  my-cron:
    type: cron
    expression: "0 9 * * *"
    prompt: "Run daily report"

# These are NOT processed by the scheduler
schedules:
  my-webhook:
    type: webhook  # Triggered by incoming HTTP requests
    prompt: "Handle webhook"
  my-chat:
    type: chat     # Triggered by chat messages
    prompt: "Respond to message"
```

**Fix**: If your schedule is not triggering, verify that you are using `type: interval` or `type: cron`. For `interval` schedules, ensure the `interval` field is set. For `cron` schedules, ensure the `expression` field contains a valid cron expression. Webhook and chat schedules require their respective external trigger mechanisms to be running.

### Schedule Stuck in "Running" State

**Symptoms**: Schedule shows `status: running` but no job is active.

**Possible Causes**:

#### 1. Process Crashed During Job

If herdctl crashed or was killed while a job was running:

```yaml
agents:
  my-agent:
    schedules:
      stuck-schedule:
        status: running  # Stuck from previous crash
        last_run_at: "2025-01-19T10:00:00Z"
```

**Fix**: Reset the schedule status:

```yaml
agents:
  my-agent:
    schedules:
      stuck-schedule:
        status: idle  # Reset to idle
```

#### 2. Graceful Shutdown Timeout

If shutdown timed out while waiting for jobs:

```
[scheduler] Shutdown timed out with 1 job(s) still running
```

**Fix**: Check for orphaned processes and reset state:

```bash
# Check for orphaned Claude processes
ps aux | grep claude

# Reset schedule state
# Edit .herdctl/state.yaml
```

### Schedule Triggers Too Frequently

**Symptoms**: Jobs run back-to-back without waiting the full interval.

**Possible Causes**:

#### 1. Multiple Scheduler Instances

Running multiple scheduler instances will cause duplicate triggers:

```bash
# Check for multiple processes
ps aux | grep herdctl
```

**Fix**: Stop duplicate instances. Only one scheduler should run.

#### 2. Clock Skew

If system time changed or was adjusted, next trigger times may be in the past:

```yaml
# State shows past time
schedules:
  my-schedule:
    next_run_at: "2025-01-19T09:00:00Z"  # In the past
```

**Fix**: The scheduler handles this automatically by triggering immediately when the calculated next time is in the past. This is expected behavior after system sleep or clock adjustments.

### Schedule Skipped: At Capacity

**Symptoms**: Scheduler logs show "at max capacity" skip messages.

```
[scheduler] Skipping my-agent/process-issues: at max capacity (1/1)
```

**Causes**:

This occurs when:
- A job is already running for this agent
- The agent's `max_concurrent` limit has been reached

**Fix**: This is normal behavior. Options:

1. **Wait**: The schedule will trigger once current jobs complete
2. **Increase capacity**: Raise `max_concurrent` if appropriate

```yaml
instances:
  max_concurrent: 2  # Allow 2 concurrent jobs
```

3. **Reduce job duration**: Optimize agent prompts for faster execution

### Schedule Skipped: Already Running

**Symptoms**: Schedule logs show "already running" skip messages.

```
[scheduler] Skipping my-agent/check-issues: already running
```

**Cause**: The same schedule is currently executing a job.

**Fix**: This is expected behavior. A schedule can only have one active job at a time. Wait for the current job to complete.

### Jobs Fail with Work Source Errors

**Symptoms**: Jobs start but fail immediately with work source errors.

**Possible Causes**:

#### 1. GitHub Token Issues

```
Error: Bad credentials
```

**Fix**: Check your `GITHUB_TOKEN` environment variable:

```bash
# Verify token is set
echo $GITHUB_TOKEN

# Verify token has correct permissions
gh auth status
```

#### 2. Repository Access

```
Error: Resource not accessible by integration
```

**Fix**: Ensure the token has access to the configured repository.

#### 3. Label Not Found

```
Error: Label 'ready-for-dev' not found
```

**Fix**: Create the required labels in your GitHub repository.

### Interval Parsing Errors

**Symptoms**: Error messages about invalid interval format.

```
IntervalParseError: Invalid time unit "min" in interval "5min"
```

**Fix**: Use valid unit abbreviations:

| Valid | Invalid |
|-------|---------|
| `5s` | `5sec`, `5seconds` |
| `5m` | `5min`, `5minutes` |
| `1h` | `1hr`, `1hour` |
| `1d` | `1day` |

### State File Corruption

**Symptoms**: Errors reading or parsing state file.

```
Error: YAML parsing failed
```

**Fix**:

1. **Backup current state**:
   ```bash
   cp .herdctl/state.yaml .herdctl/state.yaml.backup
   ```

2. **Validate YAML syntax**:
   ```bash
   # Check for syntax errors
   python -c "import yaml; yaml.safe_load(open('.herdctl/state.yaml'))"
   ```

3. **Reset state if necessary**:
   ```bash
   # Remove corrupted state (schedules will trigger immediately on restart)
   rm .herdctl/state.yaml
   ```

### Scheduler Won't Start

**Symptoms**: Scheduler fails to start with an error.

**Possible Causes**:

#### 1. State Directory Missing

```
Error: ENOENT: no such file or directory '.herdctl'
```

**Fix**: Create the state directory:

```bash
mkdir -p .herdctl
```

#### 2. Permission Denied

```
Error: EACCES: permission denied
```

**Fix**: Check directory permissions:

```bash
ls -la .herdctl/
chmod 755 .herdctl
chmod 644 .herdctl/state.yaml
```

#### 3. Already Running

```
Error: Scheduler is already running
```

**Fix**: Stop the existing scheduler instance first.

## Debugging Tips

### Enable Debug Logging

Set the log level to debug for more detailed output:

```bash
HERDCTL_LOG_LEVEL=debug herdctl start
```

### Inspect Schedule State

View the raw state file to understand current schedule status:

```bash
cat .herdctl/state.yaml | grep -A 10 "schedules:"
```

### Trace Scheduler Checks

The scheduler logs each check cycle. Look for patterns:

```bash
# Count trigger attempts
grep "Triggering" .herdctl/logs/scheduler.log | wc -l

# View skip reasons
grep "Skipping" .herdctl/logs/scheduler.log | tail -20
```

### Test Interval Parsing

Verify your interval strings are valid:

```typescript
import { parseInterval } from "@herdctl/core/scheduler";

// Test your intervals
console.log(parseInterval("5m"));  // 300000 (milliseconds)
console.log(parseInterval("1h"));  // 3600000
```

## Recovery Procedures

### Reset All Schedule States

To reset all schedules to idle (triggers immediate execution):

```bash
# Backup first
cp .herdctl/state.yaml .herdctl/state.yaml.backup

# Remove schedule states (or edit to set all to idle)
# Schedules will reinitialize on next scheduler start
```

### Force Immediate Trigger

To force a schedule to trigger immediately:

```yaml
# Set next_run_at to a past time
agents:
  my-agent:
    schedules:
      force-me:
        status: idle
        next_run_at: "2020-01-01T00:00:00Z"  # Past date
```

### Clear Stuck Jobs

If jobs are stuck, you can clear them by:

1. Stopping the scheduler
2. Resetting schedule states to `idle`
3. Clearing any orphaned processes
4. Restarting the scheduler

## Performance Tuning

### Reduce Check Frequency

For large agent fleets, increase the check interval:

```typescript
const scheduler = new Scheduler({
  checkInterval: 5000,  // Check every 5 seconds instead of 1
  stateDir: ".herdctl",
});
```

### Optimize Agent Count

The scheduler checks all agents every cycle. For better performance:

- Group related schedules into single agents
- Use appropriate intervals (don't poll every second if 5 minutes is sufficient)
- Consider multiple scheduler instances for very large fleets

### Monitor Resource Usage

Watch for:
- High CPU from frequent checks
- Memory growth from accumulated state
- Disk I/O from state file updates

```bash
# Monitor herdctl resource usage
top -p $(pgrep -f herdctl)
```

## Getting Help

If you're still having issues:

1. **Check logs**: Look in `.herdctl/logs/` for detailed error messages
2. **Validate configuration**: Run `herdctl validate` on your agent configs
3. **Review state**: Inspect `.herdctl/state.yaml` for inconsistencies
4. **File an issue**: Report bugs at the project repository with:
   - Your agent configuration (sanitized)
   - Relevant log output
   - Steps to reproduce
