# FleetManager Library Usage Examples

These examples demonstrate how to use the `@herdctl/core` library programmatically.

## Prerequisites

1. Install dependencies from the repository root:
   ```bash
   pnpm install
   ```

2. Build the core package:
   ```bash
   pnpm --filter @herdctl/core build
   ```

3. Create a `herdctl.yaml` configuration file in the directory where you run the examples.

## Examples

### Basic Usage (`basic-usage.ts`)

Demonstrates:
- Creating a FleetManager instance with options
- Lifecycle methods (initialize, start, stop)
- Event subscription for all event types
- Querying fleet status and agent information
- Graceful shutdown handling

```bash
npx tsx examples/library-usage/basic-usage.ts
```

### Job Control (`job-control.ts`)

Demonstrates:
- Manual triggering with different options
- Job cancellation with graceful/forced modes
- Job forking with modifications
- Log streaming (fleet, agent, job)

```bash
npx tsx examples/library-usage/job-control.ts
```

### Event Subscription (`event-subscription.ts`)

Demonstrates:
- Subscribing to all major event types (lifecycle, config, agent, schedule, job)
- Tracking active jobs with a Map
- Type-safe event handlers for each event type
- Handling job:forked events
- Graceful shutdown with job completion waiting

```bash
npx tsx examples/library-usage/event-subscription.ts
```

### Progress Monitor (`progress-monitor.ts`)

Demonstrates:
- Building a real-time dashboard in the terminal
- Tracking multiple jobs with their progress
- Using console clearing for dynamic updates
- Displaying job statistics and timing
- Spinner animations for active jobs

```bash
npx tsx examples/library-usage/progress-monitor.ts
```

### Colored Output (`colored-output.ts`)

Demonstrates:
- Streaming job output with ANSI colors
- Different styling based on output type (stdout, stderr, assistant, tool, system)
- Formatting timestamps and job metadata
- Styled job lifecycle banners (created, completed, failed, cancelled)

```bash
npx tsx examples/library-usage/colored-output.ts
```

### Error Handling (`error-handling.ts`)

Demonstrates:
- Using type guards for type-safe error handling
- Handling specific error types (ConfigurationError, AgentNotFoundError, etc.)
- Switching on error codes for programmatic decisions
- Retry patterns with exponential backoff and jitter
- Circuit breaker pattern for external services
- Graceful degradation with fallback values
- Safe event handler wrappers
- Graceful shutdown with timeout handling

```bash
npx tsx examples/library-usage/error-handling.ts
```

### Job History Viewer (`job-history-viewer.ts`)

Demonstrates:
- Using JobManager for job queries (standalone from FleetManager)
- Filtering jobs by agent, status, and date
- Pagination through large job lists
- Building statistics from job history
- Viewing job details with output preview

```bash
npx tsx examples/library-usage/job-history-viewer.ts
```

### Tail Job Output (`tail-job-output.ts`)

Demonstrates:
- Real-time streaming of job output using JobManager
- Following job output like `tail -f`
- Colorized output based on message type
- Graceful handling of completed and running jobs

```bash
npx tsx examples/library-usage/tail-job-output.ts <job-id>

# Options:
#   --no-follow   Exit after replaying existing output
#   --no-color    Disable colored output
#   --raw         Output raw JSON messages
```

## Running with Your Own Config

Create a `herdctl.yaml` in your project:

```yaml
version: 1

agents:
  - path: ./agents/my-agent.yaml
```

And an agent config at `agents/my-agent.yaml`:

```yaml
name: my-agent
description: Example agent

schedules:
  hourly:
    type: interval
    interval: 1h
    prompt: "Check for new tasks"
```

Then run the examples from your project directory.

## Type Checking

The examples are fully typed. To verify types:

```bash
# From the examples/library-usage directory
npx tsc --noEmit

# Or from the repository root
pnpm --filter @herdctl/core build && npx tsc -p examples/library-usage/tsconfig.json --noEmit
```

## Related Documentation

For more details, see:

- [Error Handling Guide](/docs/library-reference/error-handling/) - Complete error reference and patterns
- [Event Handling Guide](/docs/library-reference/events/) - Complete event reference and patterns
- [FleetManager API Reference](/docs/library-reference/fleet-manager/) - Full API documentation
- [JobManager API Reference](/docs/library-reference/job-manager/) - Job queries and output streaming
