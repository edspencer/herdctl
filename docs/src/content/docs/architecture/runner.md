---
title: Agent Execution Engine
description: How herdctl executes agents using the Claude Agent SDK, manages runtimes, and streams output
---

The Runner is the execution engine at the heart of herdctl. It receives a prompt and an agent configuration, selects the appropriate runtime, invokes the Claude Agent SDK, streams output in real time, and reports results back to the caller. Every agent execution -- whether triggered by a schedule, a chat message, or a manual command -- flows through the Runner.

## Architecture Overview

<img src="/diagrams/runner-architecture.svg" alt="Runner architecture diagram showing job creation, session validation, runtime factory, SDK adapter, message processing, and error handling" width="100%" />

The runner module (`packages/core/src/runner/`) consists of four primary components and a runtime layer:

| Component | File | Purpose |
|-----------|------|---------|
| **JobExecutor** | `job-executor.ts` | Orchestrates the full execution lifecycle: creates job records, validates sessions, delegates to a runtime, streams output, and persists results. |
| **SDK Adapter** | `sdk-adapter.ts` | Transforms a `ResolvedAgent` configuration into the SDK's `SDKQueryOptions` format -- permission modes, MCP servers, system prompt, tool restrictions, and session parameters. |
| **Message Processor** | `message-processor.ts` | Validates and transforms each SDK message into job output format. Detects terminal messages, extracts session IDs, and handles malformed responses without crashing. |
| **Error Handler** | `errors.ts` | Classifies errors into typed classes (`SDKInitializationError`, `SDKStreamingError`, `MalformedResponseError`) and provides detection helpers for API keys, rate limits, and network issues. |
| **Runtime Layer** | `runtime/` | Pluggable execution backends (SDK, CLI, Docker) behind a unified `RuntimeInterface`. |

## Job Execution Lifecycle

Every agent execution follows a six-step lifecycle managed by `JobExecutor.execute()`:

### 1. Create Job Record

Before any execution begins, the executor creates a job record in the state directory. This ensures the job is tracked even if execution fails immediately.

```typescript
const job = await createJob(jobsDir, {
  agent: agent.qualifiedName,
  trigger_type: effectiveTriggerType, // "manual", "schedule", "chat", "fork"
  prompt,
  schedule: scheduleName,
  forked_from: forkOptions?.parentJobId,
});
```

The `onJobCreated` callback fires at this point, allowing callers (like the web dashboard or chat connectors) to track the job before execution starts.

### 2. Validate Session

When resuming a previous session, the executor validates the stored session against the current agent configuration:

- **Working directory check** -- if the agent's working directory has changed since the session was created, the session is cleared and a fresh one starts.
- **Runtime context check** -- if the runtime type (SDK vs CLI) or Docker configuration has changed, the session is invalidated.
- **Expiry check** -- sessions older than the configured timeout (default: 24 hours) are automatically cleared.
- **Caller-provided sessions** -- when the caller provides a session ID that differs from the agent-level session on disk (as with per-channel Slack sessions), the executor trusts the caller's ID directly. This enables external session management without interference from the agent-level session file.

### 3. Select Runtime

The `RuntimeFactory` creates the appropriate runtime based on agent configuration:

```typescript
const runtime = RuntimeFactory.create(agent, { stateDir });
```

See [Runtime Selection](#runtime-selection) below for details on how this decision is made.

### 4. Execute

The runtime's `execute()` method returns an `AsyncIterable<SDKMessage>`. The executor consumes this iterator in a streaming loop:

```typescript
const messages = runtime.execute({
  prompt,
  agent,
  resume: sessionId,
  abortController,
  injectedMcpServers,
});

for await (const sdkMessage of messages) {
  const processed = processSDKMessage(sdkMessage);
  await appendJobOutput(jobsDir, job.id, processed.output);

  if (processed.sessionId) {
    sessionId = processed.sessionId;
  }

  if (isTerminalMessage(sdkMessage)) {
    break;
  }
}
```

Each message is written to the job's JSONL file immediately -- there is no buffering. This allows concurrent readers (the web dashboard, CLI tail, or other processes) to see output in real time.

### 5. Persist Output and Session

On completion, the executor:

- Extracts a summary from the final `result` message or the last non-partial assistant message.
- Updates the job metadata with final status (`completed` or `failed`), exit reason, session ID, and summary.
- Persists session info to `.herdctl/sessions/<agent>.json` for future resume or fork operations, including the working directory and runtime context.

### 6. Report Completion

The executor returns a `RunnerResult` to the caller:

```typescript
interface RunnerResult {
  success: boolean;
  jobId: string;
  sessionId?: string;
  summary?: string;
  error?: Error;
  errorDetails?: RunnerErrorDetails;
  durationSeconds?: number;
}
```

The `errorDetails` field provides programmatic access to error classification, recoverability, and message counts for streaming errors.

## SDK Integration

The runner integrates with the Claude Agent SDK (`@anthropic-ai/claude-code`) using an async iterator pattern. The SDK's `query()` function returns an `AsyncIterable<SDKMessage>`, which enables real-time streaming without buffering.

### Async Iterator Pattern

```typescript
type SDKQueryFunction = (params: {
  prompt: string;
  options?: Record<string, unknown>;
  abortController?: AbortController;
}) => AsyncIterable<SDKMessage>;
```

The key benefits of this pattern:

- **Real-time streaming** -- messages appear in job output as they arrive from the API.
- **Memory efficiency** -- no accumulation of large output buffers.
- **Concurrent readers** -- other processes can tail the JSONL file while the agent runs.
- **Graceful shutdown** -- the `AbortController` can stop execution mid-stream.

### AbortController Integration

Every execution receives an `AbortController` that enables cancellation from outside the execution loop:

```typescript
const abortController = new AbortController();

// Cancel from elsewhere
abortController.abort();
```

When aborted, the SDK iterator terminates and the executor marks the job as cancelled.

## SDK Adapter

The SDK Adapter (`sdk-adapter.ts`) transforms a `ResolvedAgent` configuration into the format expected by the Claude Agent SDK. This is the translation layer between herdctl's YAML-based agent configuration and the SDK's programmatic options.

### Transformation Map

| Agent Config Field | SDK Option | Notes |
|--------------------|-----------|-------|
| `permission_mode` | `permissionMode` | Defaults to `acceptEdits` |
| `allowed_tools` | `allowedTools` | Direct passthrough, supports wildcards |
| `denied_tools` | `deniedTools` | Direct passthrough |
| `system_prompt` | `systemPrompt` | Plain string; falls back to `claude_code` preset |
| `setting_sources` | `settingSources` | Explicit config, or `["project"]` if working directory set, else `[]` |
| `mcp_servers` | `mcpServers` | Each server transformed individually |
| `max_turns` | `maxTurns` | Agent-level or session-level |
| `working_directory` | `cwd` | Resolved path for session working directory |
| `model` | `model` | Model selection override |

### System Prompt Resolution

The adapter resolves system prompts in priority order:

1. If the agent has an explicit `system_prompt` string, it is passed directly.
2. Otherwise, the `claude_code` preset is used, which provides Claude Code's default behavior.

### Setting Sources

Setting sources control which project-level configuration files (like `CLAUDE.md`) the SDK discovers:

- **With a working directory**: defaults to `["project"]`, inheriting settings from the agent's working directory.
- **Without a working directory**: defaults to `[]`, preventing the agent from picking up settings from wherever herdctl happens to be running.
- **Explicit configuration**: the `setting_sources` field in agent config takes precedence over both defaults.

## Runtime Selection

The runner supports multiple execution backends through the `RuntimeInterface` abstraction:

```typescript
interface RuntimeInterface {
  execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage>;
}
```

All runtimes return the same `AsyncIterable<SDKMessage>` stream, making them interchangeable from the JobExecutor's perspective.

### RuntimeFactory

The `RuntimeFactory` selects and composes runtimes based on agent configuration:

```text
agent.runtime = "sdk" (default)  ──► SDKRuntime
agent.runtime = "cli"            ──► CLIRuntime

Either of the above + agent.docker.enabled = true:
  base runtime wrapped with ContainerRunner (decorator pattern)
```

### SDKRuntime

The default runtime. Uses the Claude Agent SDK's `query()` function directly in the herdctl process:

- Transforms agent config via the SDK Adapter.
- Merges injected MCP servers with config-declared servers.
- Sets `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` when long-running MCP tools (like file uploading) are present.
- Auto-adds `mcp__<name>__*` patterns to `allowedTools` for any injected MCP servers when the agent has an explicit `allowedTools` list.

### CLIRuntime

Spawns `claude` as a child process with the appropriate flags. This runtime uses Claude's Max plan pricing rather than standard API pricing. It communicates through the CLI's JSON output mode and translates CLI messages into the common `SDKMessage` format.

### ContainerRunner (Docker Decorator)

A decorator that wraps any base runtime (SDK or CLI) to execute inside a Docker container. For a deep dive on the Docker runtime, see [Docker Container Runtime](/architecture/docker-runtime/).

Key behaviors:

- Serializes SDK options to JSON for passing into the container.
- Starts an HTTP MCP bridge for injected MCP servers (since function closures cannot be serialized across process boundaries).
- Manages container lifecycle: create, start, execute, stop, remove.
- Translates container paths (`/workspace/...`) to host paths.

## Message Processing

The Message Processor (`message-processor.ts`) transforms raw SDK messages into the structured format used by job output logging.

### processSDKMessage()

The main processing function handles all SDK message types:

| SDK Message Type | Output Type | Description |
|-----------------|-------------|-------------|
| `system` | `system` | Session lifecycle events (init, end, compact_boundary) |
| `assistant` | `assistant` | Claude's text responses with nested API content blocks |
| `stream_event` | `assistant` (partial) | Streaming content deltas during generation |
| `result` | `tool_result` | Final query result with summary and usage stats |
| `user` | `system` or `tool_result` | User messages; tool results extracted if present |
| `tool_progress` | `system` | Progress updates for long-running tools |
| `auth_status` | `system` | Authentication state changes |
| `error` | `error` | Error messages (always terminal) |
| `tool_use` | `tool_use` | Legacy: tool invocations |
| `tool_result` | `tool_result` | Legacy: tool execution results |

The processor extracts text content from Anthropic API content blocks (which may be arrays of `{type: "text", text: "..."}` objects), handles both nested and top-level content fields for backwards compatibility, and captures token usage statistics.

### Terminal Detection

The `isTerminalMessage()` function determines when execution is complete:

- `error` messages are always terminal.
- `result` messages indicate query completion.
- `system` messages with subtypes `end`, `complete`, or `session_end` signal termination.

### Malformed Response Handling

The processor handles invalid SDK responses gracefully -- null messages, non-object messages, and unknown message types are logged as system warnings rather than causing crashes. This ensures a single malformed message does not terminate the entire execution.

## Permission Modes

The runner supports four permission modes that control how tool calls are approved during execution:

| Mode | Description | Auto-Approved Tools |
|------|-------------|---------------------|
| `default` | Requires approval for everything | None |
| `acceptEdits` | **Default** -- auto-approves file operations | Read, Write, Edit, mkdir, rm, mv, cp |
| `bypassPermissions` | Auto-approves all tools | All tools |
| `plan` | Planning only, no tool execution | None |

### Configuration

```yaml
# agents/my-agent/agent.yaml
name: my-agent
permission_mode: acceptEdits

# Optional: fine-grained tool control
allowed_tools:
  - Bash
  - Read
  - Write
  - mcp__github__*   # Wildcard for all GitHub MCP tools

denied_tools:
  - mcp__postgres__execute_query   # Prevent database writes
```

### Choosing a Mode

- **`default`**: Use for high-stakes operations, new agents, or untested workflows where every tool call should be reviewed.
- **`acceptEdits`** (recommended): Use for standard development workflows where file operations are the primary action.
- **`bypassPermissions`**: Use for trusted agents in controlled environments, scheduled jobs, or CI/CD pipelines. This gives the agent full autonomous control.
- **`plan`**: Use for exploring solutions without making changes, generating plans for human review.

:::caution
`bypassPermissions` gives the agent full control over all tools. Only use with thoroughly tested agents on non-critical systems.
:::

### Tool Permissions

Fine-grained control with `allowed_tools` and `denied_tools`:

- **Allowed tools** act as a whitelist -- only listed tools (and their wildcard matches) are available.
- **Denied tools** act as a blacklist -- listed tools are explicitly blocked.
- **Wildcard patterns** like `mcp__github__*` match all tools from a given MCP server.
- **Injected tools** -- when MCP servers are injected at runtime (e.g., the file sender), their tool patterns (`mcp__<name>__*`) are automatically added to `allowedTools` if the agent has an explicit allowed tools list. Without this auto-addition, agents with restrictive tool lists would be unable to call injected tools.

For detailed permission configuration, see [Permissions](/configuration/permissions/).

## MCP Server Configuration

MCP (Model Context Protocol) servers extend agent capabilities with external tools. The runner handles two types of MCP servers.

### Process-Based Servers

Spawn a local process communicating via stdio:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

### HTTP-Based Servers

Connect to a remote MCP endpoint:

```yaml
mcp_servers:
  custom-api:
    url: http://localhost:8080/mcp
```

### Tool Naming Convention

MCP tools are namespaced as `mcp__<server>__<tool>`:

```text
mcp__github__create_issue
mcp__github__list_pull_requests
mcp__postgres__query
```

This namespacing enables wildcard patterns in tool permissions and prevents name collisions between servers.

### Injected MCP Servers

The runner supports runtime injection of MCP servers through the `injectedMcpServers` option. This mechanism is used by platform integrations (like the Slack file sender) to provide tools that are not part of the static agent configuration.

Injected servers use the `InjectedMcpServerDef` abstraction, which separates tool definitions from transport:

- **SDKRuntime**: converts definitions to in-process MCP servers via `createSdkMcpServer()`.
- **ContainerRunner**: starts an HTTP MCP bridge on the Docker network, exposing tools at `http://herdctl:<port>/mcp`.

This separation is necessary because function closures (used by in-process servers) cannot be serialized into a Docker container.

For detailed MCP server configuration, see [MCP Servers](/configuration/mcp-servers/).

## Session Management

Sessions enable agents to maintain conversation context across multiple executions.

### Session Concepts

- **Session ID**: A unique identifier from the Claude SDK representing a conversation's full context.
- **Resume**: Continue a previous conversation with the same context.
- **Fork**: Branch from a previous session to explore an alternative path without modifying the original.
- **Fresh session**: Start with no prior context (the default).

### Resume Flow

Resume continues an exact conversation:

```text
Job A (creates session)
    |
    v
Job B (resume from A) --> continues with full context
    |
    v
Job C (resume from B) --> continues with full context
```

```typescript
const result = await executor.execute({
  agent: myAgent,
  prompt: "Continue from where we left off",
  stateDir: ".herdctl",
  resume: "session-id-from-previous-job",
});
```

### Fork Flow

Fork branches from a point in history:

```text
Job A (creates session)
    |
    +---> Job B (fork from A) --> new branch with A's context
    |
    +---> Job C (fork from A) --> another branch with A's context
```

```typescript
const result = await executor.execute({
  agent: myAgent,
  prompt: "Try a different approach",
  stateDir: ".herdctl",
  fork: "session-id-to-fork-from",
});
```

### Session Storage

Session info is persisted to `.herdctl/sessions/<agent-name>.json`:

```json
{
  "agent_name": "bragdoc-coder",
  "session_id": "claude-session-xyz789",
  "created_at": "2024-01-19T08:00:00Z",
  "last_used_at": "2024-01-19T10:05:00Z",
  "job_count": 15,
  "mode": "autonomous",
  "working_directory": "/home/user/projects/bragdoc",
  "runtime_type": "sdk",
  "docker_enabled": false
}
```

The session file stores one session per agent. This is the agent-level session used by the scheduler and CLI. Chat integrations (Discord, Slack) manage their own per-channel sessions externally and pass the correct session ID to the executor, which trusts caller-provided IDs that differ from the agent-level session.

### Session Validation

Before resuming, the executor validates the stored session:

| Check | Action on Failure |
|-------|-------------------|
| Session exists and is not expired | Start fresh session |
| Working directory matches current config | Clear session, start fresh |
| Runtime context (SDK/CLI, Docker) matches | Clear session, start fresh |
| Server-side session still valid | Auto-retry with fresh session |
| OAuth token still valid | Auto-retry with refreshed token |

The auto-retry behavior for server-side session expiry and token expiry prevents agents from failing due to transient authentication issues. Each retry type is limited to one attempt to avoid infinite loops.

### When to Use

| Scenario | Approach |
|----------|----------|
| Continue a task across multiple jobs | `resume` with previous session ID |
| Try alternative approaches from a checkpoint | `fork` from a previous session |
| Start completely fresh | Neither (creates new session) |
| Per-channel chat conversations | Caller manages session IDs externally |

## Output Streaming

The runner streams output in real time using JSONL (newline-delimited JSON). For full details on the file format, see [State Management](/architecture/state-management/).

### Output File Location

Job output is written to `.herdctl/jobs/{jobId}.jsonl`. Each line is a complete, self-contained JSON object.

When `outputToFile: true` is specified in the runner options, output is also written to `.herdctl/jobs/{jobId}/output.log` as human-readable plain text for easier debugging.

### JSONL Format

```jsonl
{"type":"system","subtype":"init","timestamp":"2024-01-19T09:00:00Z"}
{"type":"assistant","content":"Starting analysis...","timestamp":"2024-01-19T09:00:01Z"}
{"type":"tool_use","tool_name":"Bash","tool_use_id":"toolu_123","input":"ls -la","timestamp":"2024-01-19T09:00:02Z"}
{"type":"tool_result","tool_use_id":"toolu_123","result":"total 42...","success":true,"timestamp":"2024-01-19T09:00:03Z"}
```

### Message Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `system` | Session lifecycle events | `subtype` (init, end, complete, user_input, tool_progress, auth_status) |
| `assistant` | Claude's text responses | `content`, `partial`, `usage` (input/output tokens) |
| `tool_use` | Tool invocations | `tool_name`, `tool_use_id`, `input` |
| `tool_result` | Tool execution results | `tool_use_id`, `result`, `success`, `error` |
| `error` | Error events | `message`, `code`, `stack` |

### Reading Output

Stream output in real time using the async generator:

```typescript
import { readJobOutput } from '@herdctl/core';

for await (const message of readJobOutput(jobsDir, jobId)) {
  console.log(message.type, message.content || message.tool_name);
}
```

Or tail the file directly:

```bash
tail -f .herdctl/jobs/job-2024-01-19-abc123.jsonl | jq .
```

## Error Handling

The runner provides structured error handling with typed error classes, classification helpers, and automatic retry for specific transient failures.

### Error Hierarchy

```text
RunnerError (base)
├── SDKInitializationError
│   ├── isMissingApiKey()   -- missing ANTHROPIC_API_KEY
│   └── isNetworkError()    -- ECONNREFUSED, ENOTFOUND, ETIMEDOUT
├── SDKStreamingError
│   ├── isRateLimited()     -- 429, rate limit messages
│   ├── isConnectionError() -- ECONNRESET, EPIPE
│   └── isRecoverable()     -- rate limit or connection error
└── MalformedResponseError
    └── rawResponse, expected -- for debugging SDK format issues
```

All error classes carry optional `jobId` and `agentName` context for debugging.

### Error Classification

Errors are classified to determine the appropriate exit reason for the job:

| Exit Reason | Trigger |
|-------------|---------|
| `success` | Job completed normally |
| `error` | Unrecoverable error |
| `timeout` | Execution time exceeded or `ETIMEDOUT` |
| `cancelled` | AbortController signal or user cancellation |
| `max_turns` | Reached maximum conversation turns |

The `classifyError()` function examines error messages and codes to determine the correct exit reason. This classification drives job status in the state system and informs callers about the nature of the failure.

### Automatic Retry

The executor automatically retries in two specific cases:

1. **Server-side session expiry** -- if the SDK reports that the resumed session has expired on the server, the executor clears the local session and retries with a fresh session. This handles cases where the local session timeout is longer than the server-side session lifetime.

2. **OAuth token expiry** -- if the SDK reports an authentication error due to an expired OAuth token, the executor retries. On retry, the container runtime reads a refreshed token from the bind-mounted credentials file.

Each retry type is limited to a single attempt. If the retry also fails, the error is reported normally.

### Error Detection Patterns

```typescript
// Check error type for programmatic handling
if (result.errorDetails?.type === 'initialization') {
  // SDK failed to start (API key, network, etc.)
}

if (result.errorDetails?.recoverable) {
  // Can schedule a retry (rate limit, network transient)
}

if (result.errorDetails?.messagesReceived === 0) {
  // Failed before receiving any messages (likely config issue)
}
```

### Troubleshooting

**"Missing API Key" errors**

```text
SDKInitializationError: Missing or invalid API key
```

Set your Anthropic API key: `export ANTHROPIC_API_KEY=sk-ant-...`

**Rate limit errors**

```text
SDKStreamingError: Rate limit exceeded
```

Wait and retry (the `errorDetails` may include retry-after information), reduce concurrent agent runs, or use a higher-tier API plan.

**Connection errors**

```text
SDKStreamingError: Connection refused (ECONNREFUSED)
```

Check network connectivity, verify MCP server URLs are accessible, and review firewall rules.

**Malformed response errors**

```text
MalformedResponseError: Invalid message format
```

Usually indicates an SDK version mismatch. The runner logs these and continues processing other messages -- a single malformed message does not terminate execution.

## Related Documentation

- [System Architecture Overview](/architecture/overview/) -- Runner's role in the overall system
- [State Management](/architecture/state-management/) -- How output and sessions are persisted
- [Scheduler](/architecture/scheduler/) -- How schedules trigger the runner
- [Job System](/architecture/job-system/) -- Job lifecycle and metadata
- [Docker Container Runtime](/architecture/docker-runtime/) -- Container execution details
- [Permissions](/configuration/permissions/) -- Permission mode configuration guide
- [MCP Servers](/configuration/mcp-servers/) -- MCP server setup guide
