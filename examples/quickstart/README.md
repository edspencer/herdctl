# herdctl Quickstart Example

This example demonstrates using herdctl as a library for programmatic fleet control.

## Files

- `quickstart.ts` - Minimal TypeScript example (< 20 lines of core logic)
- `herdctl.yaml` - Fleet configuration
- `agents/hello-agent.yaml` - Agent configuration

## Running

```bash
# Install dependencies
pnpm install

# Run the example
pnpm start

# Or directly with tsx
npx tsx quickstart.ts
```

## What It Does

1. Creates a `FleetManager` with your config
2. Initializes and starts the fleet
3. Logs events as they happen (job created, schedule triggered, job completed)
4. Handles graceful shutdown on Ctrl+C

The hello-agent triggers every 30 seconds and asks Claude to report the current time.

## Expected Output

```
Fleet initialized
Fleet started - watching for scheduled triggers...
Schedule triggered: hello-agent/greet
Job created: job-2025-01-20-abc123 for hello-agent
Job completed: job-2025-01-20-abc123
```

## Type Checking

```bash
pnpm typecheck
```
