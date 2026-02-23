---
title: CLI Architecture
description: How the herdctl CLI is structured — command routing, FleetManager delegation, output formatting, signal handling, and error reporting
---

The `herdctl` CLI is a thin wrapper around `@herdctl/core`. It contains no business logic. Every command parses user arguments, delegates to FleetManager (or JobManager for read-only job queries), formats the result for the terminal, and exits. This page describes how the CLI achieves that and what patterns it uses.

For a bird's-eye view of how the CLI fits into the broader system, see [System Architecture Overview](/architecture/overview/).

![CLI command mapping showing each herdctl command delegating to its corresponding FleetManager API method](/diagrams/cli-command-mapping.svg)

## Design Principle: Zero Business Logic

The CLI follows the project-wide **library-first** architecture. All fleet management logic lives in `@herdctl/core`. The CLI adds only:

- **Argument parsing** via Commander.js
- **Output formatting** with ANSI colors, tables, and relative timestamps
- **Process lifecycle** management (PID files, signal handlers, exit codes)
- **Interactive prompts** via `@inquirer/prompts` (for `init` and `cancel` confirmation)

If a feature involves decision-making about agents, schedules, jobs, or configuration, it belongs in core, not here.

## Source Code Layout

```text
packages/cli/
├── bin/
│   └── herdctl.js              # Entry point (#!/usr/bin/env node)
├── src/
│   ├── index.ts                # Commander program definition, all command routing
│   ├── commands/
│   │   ├── init.ts             # herdctl init (project scaffolding)
│   │   ├── start.ts            # herdctl start (fleet lifecycle)
│   │   ├── stop.ts             # herdctl stop (PID-based process signaling)
│   │   ├── status.ts           # herdctl status [agent]
│   │   ├── logs.ts             # herdctl logs [agent]
│   │   ├── trigger.ts          # herdctl trigger <agent>
│   │   ├── config.ts           # herdctl config validate / show
│   │   ├── jobs.ts             # herdctl jobs (list with filters)
│   │   ├── job.ts              # herdctl job <id> (detail and logs)
│   │   ├── cancel.ts           # herdctl cancel <id>
│   │   └── sessions.ts         # herdctl sessions / sessions resume
│   └── utils/
│       └── colors.ts           # ANSI color helpers, NO_COLOR support
├── __tests__/
│   ├── smoke.test.ts           # CLI smoke tests
│   └── commands/
│       └── *.test.ts           # Per-command unit tests
├── package.json
└── tsconfig.json
```

## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `@herdctl/core` | All business logic: FleetManager, JobManager, config loading, error types |
| `commander` | Command parsing, option definitions, help generation |
| `@inquirer/prompts` | Interactive prompts for `init` and `cancel` confirmation |
| `@herdctl/web` | Optional web dashboard, started via `--web` flag on `herdctl start` |
| `@herdctl/discord` | Optional Discord connector, loaded by FleetManager when configured |
| `@herdctl/slack` | Optional Slack connector, loaded by FleetManager when configured |

The CLI does not use chalk or cli-table3. Terminal colors are implemented with raw ANSI escape codes in `utils/colors.ts`, and tables are built with string padding.

## Command Hierarchy and Routing

All commands are defined in `src/index.ts` using Commander.js. The program structure is flat with two command groups:

```text
herdctl
├── init                        # Scaffold new project
├── start                       # Start fleet (long-running)
├── stop                        # Stop fleet via PID signal
├── status [agent]              # Fleet overview or agent detail
├── logs [agent]                # Log viewing and streaming
├── trigger <agent>             # Manual agent trigger
├── jobs                        # List recent jobs
├── job <id>                    # Job detail
├── cancel <id>                 # Cancel running job
├── sessions                    # List Claude Code sessions
│   └── resume [session-id]     # Resume session interactively
└── config                      # Configuration group
    ├── validate                # Validate configuration
    └── show                    # Show resolved configuration
```

Each command's action handler follows the same pattern:

1. Parse options from Commander
2. Wrap the command function call in a try/catch
3. Handle `User force closed` errors (from inquirer prompts) by exiting cleanly
4. Re-throw other errors

The actual command logic lives in individual files under `src/commands/`. Each exports an async function that receives typed options.

## How Commands Map to FleetManager

Every command delegates to `@herdctl/core` APIs. The CLI never reads configuration files, manages state, or executes agents directly.

| Command | Core API |
|---------|----------|
| `herdctl init` | File system scaffolding (no FleetManager needed) |
| `herdctl start` | `new FleetManager()` then `initialize()`, `start()`, `streamLogs()` |
| `herdctl stop` | Reads PID file, sends OS signals (`SIGTERM`/`SIGKILL`) |
| `herdctl status` | `FleetManager.initialize()`, `getFleetStatus()`, `getAgentInfo()`, `getAgentInfoByName()` |
| `herdctl logs` | `FleetManager.streamLogs()`, `streamAgentLogs()`, or `JobManager.streamJobOutput()` |
| `herdctl trigger` | `FleetManager.initialize()`, `trigger()`, optionally `streamJobOutput()` |
| `herdctl jobs` | `JobManager.getJobs()` with filter |
| `herdctl job <id>` | `JobManager.getJob()`, optionally `streamJobOutput()` |
| `herdctl cancel` | `FleetManager.initialize()`, `cancelJob()` |
| `herdctl config validate` | `safeLoadConfig()` (config loading without FleetManager) |
| `herdctl config show` | `safeLoadConfig()` then formats the `ResolvedConfig` |
| `herdctl sessions` | `listSessions()` and optionally `loadConfig()` for workspace paths |
| `herdctl sessions resume` | `listSessions()`, then spawns `claude --resume <session-id>` |

Commands that only need to read job data (`jobs`, `job`) use `JobManager` directly rather than creating a full `FleetManager`. This avoids configuration validation overhead for read-only queries against the `.herdctl/jobs/` directory.

## PID File Management

![CLI lifecycle flow showing start command, PID file management, signal handling, and graceful shutdown](/diagrams/cli-lifecycle-flow.svg)

The `start` and `stop` commands use a PID file to coordinate the fleet process lifecycle.

**On start:**
1. `herdctl start` creates a `FleetManager`, calls `initialize()` and `start()`
2. Writes the current process PID to `.herdctl/herdctl.pid`
3. Enters the log streaming loop (`streamLogs()`), which keeps the process alive
4. On shutdown (signal or error), removes the PID file

**On stop:**
1. `herdctl stop` reads the PID from `.herdctl/herdctl.pid`
2. Checks whether that process is still running via `process.kill(pid, 0)`
3. Sends `SIGTERM` for graceful shutdown (or `SIGKILL` with `--force`)
4. Polls every 100ms to wait for the process to exit (up to `--timeout` seconds, default 30)
5. If the timeout expires, escalates to `SIGKILL`
6. Removes the PID file after the process has stopped
7. Cleans up stale PID files if the referenced process is no longer running

## Signal Handling

The CLI registers signal handlers for graceful shutdown in commands that run indefinitely or stream output.

### `herdctl start`

Registers handlers for both `SIGINT` and `SIGTERM`. On signal:

1. Sets a shutdown guard flag to prevent re-entrant shutdown
2. Calls `manager.stop({ waitForJobs: true, timeout: 30000, cancelOnTimeout: true })`
3. Removes the PID file
4. Exits with code 0 on success, 1 on error

### `herdctl logs --follow`

Registers `SIGINT`/`SIGTERM` handlers that set a shutdown flag and exit with code 0. The async log iteration loop checks this flag and breaks cleanly.

### `herdctl trigger --wait`

Registers `SIGINT`/`SIGTERM` handlers that exit with code 130 (128 + SIGINT signal number 2). The job continues running in the background; only the CLI's wait loop is interrupted.

### `herdctl job <id> --logs`

When streaming live output from a running job, registers signal handlers that exit with code 130.

## Output Formatting

The CLI supports three output modes depending on context and user flags.

### Human-Readable Output (Default)

Terminal output uses ANSI color codes for readability. Colors are applied through the shared `colorize()` function, which checks the `NO_COLOR` environment variable, `FORCE_COLOR`, and TTY detection before emitting escape sequences.

**Status colors** use a consistent scheme:

| Status | Color |
|--------|-------|
| `running` | Green |
| `idle`, `stopped`, `initialized` | Yellow |
| `pending` | Yellow |
| `completed` | Cyan |
| `error`, `failed` | Red |
| `cancelled` | Gray |

**Fleet status** displays a structured overview with sections for counts, scheduler state, and an agent table. When agents belong to sub-fleets (composed fleet configurations), the display switches to a hierarchical tree view grouped by fleet path.

**Agent detail** shows configuration, job history, and per-schedule status with relative timestamps (e.g., "5m ago", "in 45m").

**Job tables** use padded columns with dynamic widths based on content. Column headers are static strings; rows are padded to align.

**Log entries** are formatted as: `<timestamp> <LEVEL> [<source>] (<job-id-prefix>) <message>`, with each component individually colored. The source label identifies the agent, scheduler component, or connector platform. Job output types (assistant, tool, result, error, system) each get distinct colors.

**Brand colors** for connector platforms use 24-bit RGB ANSI sequences for accurate branding: Discord Blurple, Slack Blue, and Web Green. Terminals that do not support true color fall back automatically.

### JSON Output (`--json`)

Most commands support a `--json` flag that outputs structured JSON to stdout. This mode is designed for scripting and CI/CD pipelines:

- Status output includes the full `FleetStatus` and `AgentInfo[]` objects
- Job lists use a structured `{ jobs, total, limit }` envelope
- Trigger results include job ID, agent name, schedule, and timing
- Errors use a consistent `{ error: { code, message, ... } }` envelope
- Log streaming outputs newline-delimited JSON (NDJSON), one entry per line

JSON output writes to `stdout`; errors still go to `stderr`. This allows piping JSON to `jq` or other processors while still seeing error messages.

### Streaming Output

The `start`, `logs --follow`, `trigger --wait`, and `job --logs` commands use async iterables from FleetManager to stream output continuously:

- `FleetManager.streamLogs()` yields `LogEntry` objects via an async iterable
- `FleetManager.streamAgentLogs()` filters the log stream to a specific agent
- `JobManager.streamJobOutput()` yields job output messages via an event emitter
- The `trigger` command receives messages through an `onMessage` callback during execution, then optionally follows up with `streamJobOutput()` in wait mode

The streaming loop runs until the iterator completes (fleet stops, job finishes) or is interrupted by a signal.

## Error Reporting

Errors follow a consistent pattern across all commands. The CLI catches typed error classes from `@herdctl/core` and formats them with context and actionable suggestions.

### Error Format

Human-readable errors include the error message, optional error code, and a suggested next action:

```text
Error: No configuration file found.
Searched from: /home/user/project

Run 'herdctl init' to create a configuration file.
```

```text
Error: Agent 'unknown-agent' not found.

Run 'herdctl status' to see all agents.
```

When `--json` is active, errors are returned as structured JSON on stdout:

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent 'unknown-agent' not found in configuration",
    "agentName": "unknown-agent"
  }
}
```

### Error Types Handled

Each command handles the error types relevant to its operation using `instanceof` checks and type guard functions from `@herdctl/core`:

| Error Type | Commands | User Message |
|-----------|----------|-------------|
| `ConfigNotFoundError` | start, status, logs, trigger, cancel | Suggests `herdctl init` |
| `AgentNotFoundError` | status, logs, trigger | Suggests `herdctl status` to list agents |
| `JobNotFoundError` | logs, job, cancel, jobs | Suggests `herdctl jobs` to list jobs |
| `ScheduleNotFoundError` | trigger | Suggests `herdctl status <agent>` for schedules |
| `ConcurrencyLimitError` | trigger | Explains the limit and suggests waiting |
| `SchemaValidationError` | config validate | Shows all validation issues with paths |
| `YamlSyntaxError` | config validate | Shows line/column and common fixes |
| `UndefinedVariableError` | config validate | Suggests `export VAR=value` |
| `FleetManagerError` (generic) | all | Shows error code and message |

The `config validate` command with `--fix` provides additional repair suggestions for each validation issue, including type mismatches, missing required fields, unrecognized keys, and invalid enum values.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (config not found, agent not found, job failed, etc.) |
| 130 | Interrupted by signal (128 + SIGINT signal number 2) |

The `trigger --wait` command exits with the job's own exit code, propagating success or failure from the agent execution.

## Interactive Prompts

Two commands use interactive prompts via `@inquirer/prompts`:

**`herdctl init`** prompts for fleet name, description, and template selection when not running with `--yes`. The `--yes` flag accepts all defaults without prompting, making it suitable for scripted setup.

Three built-in templates are available:

| Template | Description |
|----------|-------------|
| `simple` | Basic fleet with one scheduled agent (default) |
| `quickstart` | Minimal single agent that runs every 30 seconds |
| `github` | Agent configured for GitHub Issues work source |

**`herdctl cancel`** prompts for confirmation before cancelling a job (unless `--yes` is passed). The prompt shows job details (ID, agent, status, schedule) and warns about force cancellation.

## The `NO_COLOR` Convention

The CLI respects the [no-color.org](https://no-color.org/) convention. Color output is controlled by three signals, checked in priority order:

1. `NO_COLOR` environment variable (any non-empty value disables color)
2. `FORCE_COLOR` environment variable (any value other than `"0"` forces color on)
3. TTY detection (`process.stdout.isTTY`) -- colors are disabled when piping to a file or another command

Each command module includes its own `shouldUseColor()` check. The shared `utils/colors.ts` module provides the canonical implementation along with color constants and helper functions used by `start` and `logs`.

## Web Dashboard Integration

The `start` command accepts `--web` and `--web-port` flags to enable the web dashboard alongside the fleet. These flags are translated into `FleetConfigOverrides` and passed to the `FleetManager` constructor:

```typescript
const manager = new FleetManager({
  configPath: options.config,
  stateDir,
  configOverrides: {
    web: {
      enabled: options.web,
      port: options.webPort,
    },
  },
});
```

FleetManager handles the dynamic import and initialization of `@herdctl/web` internally. The CLI does not interact with the web package directly.

## Verbose Logging

The `--verbose` flag on `herdctl start` sets `HERDCTL_LOG_LEVEL=debug` before creating the FleetManager. The start command also registers a global log handler via `setLogHandler()` from `@herdctl/core`, which intercepts all `createLogger` output and formats it with colors, log level badges, and source labels for the terminal.

## Session Management

The `sessions` command provides visibility into Claude Code sessions created by agents with session persistence. It reads session data directly from `.herdctl/sessions/` without requiring a running fleet.

The `sessions resume` subcommand spawns `claude --resume <session-id>` as a child process with `stdio: "inherit"`, giving the user an interactive Claude Code session in the agent's workspace directory. It supports partial session ID matching and agent name lookup for convenience.

## Related Pages

- [System Architecture Overview](/architecture/overview/) -- How the CLI fits into the package dependency graph
- [Configuration System](/architecture/configuration/) -- Config file discovery and validation that `config validate` exposes
- [Job Lifecycle](/architecture/job-system/) -- Job creation, status transitions, and output streaming used by `jobs`, `job`, and `cancel`
- [State Persistence](/architecture/state-management/) -- The `.herdctl/` directory structure the CLI reads from and writes PID files to
- [FleetManager API Reference](/library-reference/fleet-manager/) -- The core API that every CLI command delegates to
