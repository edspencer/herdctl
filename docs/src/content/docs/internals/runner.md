---
title: Runner
description: How herdctl executes agents using the Claude Agent SDK
---

The Runner is the execution engine that powers agent runs in herdctl. It integrates with the Claude Agent SDK to execute agents, stream output in real-time, and manage the full job lifecycle.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         JobExecutor                                 │
├─────────────────────────────────────────────────────────────────────┤
│  1. Create job record                                               │
│  2. Transform config → SDK options (sdk-adapter)                    │
│  3. Execute SDK query (async iterator)                              │
│  4. Process messages (message-processor)                            │
│  5. Stream output to JSONL                                          │
│  6. Update job status and session info                              │
└─────────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
   ┌──────────┐           ┌──────────────┐         ┌────────────┐
   │ SDK      │           │ State        │         │ Error      │
   │ Adapter  │           │ Management   │         │ Handler    │
   └──────────┘           └──────────────┘         └────────────┘
```

The runner module consists of four main components:

| Component | File | Purpose |
|-----------|------|---------|
| **JobExecutor** | `job-executor.ts` | Main execution engine and lifecycle manager |
| **SDK Adapter** | `sdk-adapter.ts` | Transforms agent config to SDK format |
| **Message Processor** | `message-processor.ts` | Validates and transforms SDK messages |
| **Error Handler** | `errors.ts` | Classifies errors and provides diagnostics |

## SDK Integration

The runner integrates with the Claude Agent SDK using an **async iterator pattern**. This enables real-time streaming of agent output without buffering.

### Async Iterator Pattern

The SDK's `query()` function returns an `AsyncIterable<SDKMessage>`, which the runner consumes:

```typescript
// SDK query function signature
type SDKQueryFunction = (params: {
  prompt: string;
  options?: Record<string, unknown>;
  abortController?: AbortController;
}) => AsyncIterable<SDKMessage>;

// Execution loop
const messages = sdkQuery({ prompt, options: sdkOptions });

for await (const message of messages) {
  // Process each message as it arrives
  const processed = processSDKMessage(message);

  // Write immediately to JSONL (no buffering)
  await appendJobOutput(jobsDir, jobId, processed.output);

  // Check for terminal message
  if (processed.isFinal) {
    break;
  }
}
```

### Key Benefits

- **Real-time streaming**: Messages appear immediately in job output
- **Memory efficiency**: No buffering of large outputs
- **Concurrent readers**: Other processes can tail the JSONL file
- **Graceful shutdown**: Can stop mid-execution via AbortController

## Permission Modes

The runner supports four permission modes that control how tool calls are approved:

### Mode Comparison

| Mode | Description | Auto-Approved Tools |
|------|-------------|---------------------|
| `default` | Requires approval for everything | None |
| `acceptEdits` | **Default** - Auto-approves file operations | Read, Write, Edit, mkdir, rm, mv, cp |
| `bypassPermissions` | Auto-approves all tools | All tools |
| `plan` | Planning only, no execution | None |

### Configuration

Set the permission mode in your agent configuration:

```yaml
# agents/my-agent/agent.yaml
name: my-agent

permission_mode: acceptEdits  # default, acceptEdits, bypassPermissions, plan

# Optional: explicitly allow specific tools
allowed_tools:
  - Bash
  - Read
  - Write

# Optional: deny specific tools
denied_tools:
  - mcp__github__create_issue
```

### Permission Examples

#### Default Mode (Safest)

Every tool call requires human approval:

```yaml
permission_mode: default
```

Use for: High-stakes operations, new agents, untested workflows.

#### Accept Edits Mode (Recommended)

File operations auto-approve, other tools require approval:

```yaml
permission_mode: acceptEdits
```

Use for: Most development workflows where file edits are the primary action.

#### Bypass Permissions Mode (Autonomous)

All tools auto-approve—the agent runs fully autonomously:

```yaml
permission_mode: bypassPermissions
```

Use for: Trusted agents in controlled environments, scheduled jobs, CI/CD.

:::caution
`bypassPermissions` gives the agent full control. Only use with thoroughly tested agents on non-critical systems.
:::

#### Plan Mode (Research Only)

Agent can plan but not execute tools:

```yaml
permission_mode: plan
```

Use for: Exploring solutions without making changes, generating plans for review.

### Tool Permissions

Fine-grained control over specific tools:

```yaml
permission_mode: acceptEdits

# Whitelist specific tools
allowed_tools:
  - Bash
  - Read
  - Write
  - Edit
  - mcp__github__*  # Wildcard for all GitHub MCP tools

# Blacklist dangerous tools
denied_tools:
  - mcp__postgres__execute_query  # Prevent database writes
```

## MCP Server Configuration

MCP (Model Context Protocol) servers extend agent capabilities with external tools.

### Server Types

#### Process-Based Servers

Spawn a local process that communicates via stdio:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}  # Environment variable interpolation
```

#### HTTP-Based Servers

Connect to a remote MCP endpoint:

```yaml
mcp_servers:
  custom-api:
    url: http://localhost:8080/mcp
```

### Tool Naming Convention

MCP tools are namespaced as `mcp__<server>__<tool>`:

```
mcp__github__create_issue
mcp__github__list_pull_requests
mcp__postgres__query
mcp__filesystem__read_file
```

### Common MCP Servers

| Server | Package | Purpose |
|--------|---------|---------|
| GitHub | `@modelcontextprotocol/server-github` | Issues, PRs, repos |
| Filesystem | `@modelcontextprotocol/server-filesystem` | File operations |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Database access |
| Memory | `@modelcontextprotocol/server-memory` | Persistent key-value store |

### Full Configuration Example

```yaml
# agents/full-stack/agent.yaml
name: full-stack-agent

mcp_servers:
  # GitHub for issue management
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

  # Database for analytics
  postgres:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: ${DATABASE_URL}

  # Custom internal API
  internal-api:
    url: ${INTERNAL_API_URL}

permission_mode: acceptEdits

allowed_tools:
  - mcp__github__*
  - mcp__postgres__query  # Read-only

denied_tools:
  - mcp__postgres__execute  # No writes
```

## Session Management

Sessions enable resuming conversations and forking agent state.

### Session Concepts

- **Session ID**: Unique identifier from the Claude SDK for conversation context
- **Resume**: Continue a previous conversation with full context
- **Fork**: Branch from a previous state to explore alternatives

### Resume Flow

Resume continues the exact conversation:

```
Job A (creates session)
    │
    ▼
Job B (resume from A) → Continues with full context
    │
    ▼
Job C (resume from B) → Continues with full context
```

Usage:

```typescript
const result = await runner.execute({
  agent: myAgent,
  prompt: "Continue from where we left off",
  stateDir: ".herdctl",
  resume: "session-id-from-previous-job"
});
```

### Fork Flow

Fork branches from a point in history:

```
Job A (creates session)
    │
    ├─► Job B (fork from A) → New branch with A's context
    │
    └─► Job C (fork from A) → Another branch with A's context
```

Usage:

```typescript
const result = await runner.execute({
  agent: myAgent,
  prompt: "Try a different approach",
  stateDir: ".herdctl",
  fork: "session-id-to-fork-from"
});
```

### Session Storage

Session info is persisted in `.herdctl/sessions/<agent-name>.json`:

```json
{
  "agent_name": "bragdoc-coder",
  "session_id": "claude-session-xyz789",
  "created_at": "2024-01-19T08:00:00Z",
  "last_used_at": "2024-01-19T10:05:00Z",
  "job_count": 15,
  "mode": "autonomous"
}
```

### When to Use

| Scenario | Use |
|----------|-----|
| Continue a task | `resume` with previous session ID |
| Try alternative approaches | `fork` from a checkpoint |
| Start fresh | Neither (creates new session) |

## Output Streaming

The runner streams output in real-time using JSONL (newline-delimited JSON).

### Output File Location

By default, job output is written to `.herdctl/jobs/{jobId}.jsonl`. When `outputToFile: true` is specified in the runner options, output is also written to `.herdctl/jobs/{jobId}/output.log` as plain text for easier reading.

### JSONL Format

Each line is a complete, self-contained JSON object:

```jsonl
{"type":"system","subtype":"init","timestamp":"2024-01-19T09:00:00Z"}
{"type":"assistant","content":"Starting analysis...","partial":false,"timestamp":"2024-01-19T09:00:01Z"}
{"type":"tool_use","tool_name":"Bash","tool_use_id":"toolu_123","input":"ls -la","timestamp":"2024-01-19T09:00:02Z"}
{"type":"tool_result","tool_use_id":"toolu_123","result":"total 42...","success":true,"timestamp":"2024-01-19T09:00:03Z"}
```

### Message Types

The runner outputs five message types:

#### system

Session lifecycle events:

```json
{
  "type": "system",
  "subtype": "init",
  "content": "Session initialized",
  "timestamp": "2024-01-19T09:00:00Z"
}
```

Subtypes: `init`, `end`, `complete`

#### assistant

Claude's text responses:

```json
{
  "type": "assistant",
  "content": "I'll analyze the codebase...",
  "partial": false,
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 200
  },
  "timestamp": "2024-01-19T09:00:01Z"
}
```

- `partial`: True for streaming chunks, false for complete messages
- `usage`: Token counts (when available)

#### tool_use

Tool invocations by the agent:

```json
{
  "type": "tool_use",
  "tool_name": "Bash",
  "tool_use_id": "toolu_abc123",
  "input": "git status",
  "timestamp": "2024-01-19T09:00:02Z"
}
```

#### tool_result

Results from tool execution:

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "result": "On branch main\nNothing to commit",
  "success": true,
  "error": null,
  "timestamp": "2024-01-19T09:00:05Z"
}
```

#### error

Error events:

```json
{
  "type": "error",
  "message": "API rate limit exceeded",
  "code": "RATE_LIMIT",
  "stack": "...",
  "timestamp": "2024-01-19T09:00:05Z"
}
```

### Reading Output

Stream output in real-time using the async generator:

```typescript
import { readJobOutput } from '@herdctl/core';

// Memory-efficient streaming read
for await (const message of readJobOutput(jobsDir, jobId)) {
  console.log(message.type, message.content || message.tool_name);
}
```

Or tail the file directly:

```bash
tail -f .herdctl/jobs/job-2024-01-19-abc123.jsonl | jq .
```

## Error Handling

The runner provides structured error handling with detailed diagnostics.

### Error Hierarchy

```
RunnerError (base)
├── SDKInitializationError
│   └── Missing API key, network issues
├── SDKStreamingError
│   └── Rate limits, connection drops
└── MalformedResponseError
    └── Invalid SDK message format
```

### Error Classification

Errors are classified to determine the appropriate exit reason:

| Exit Reason | Trigger |
|-------------|---------|
| `success` | Job completed normally |
| `error` | Unrecoverable error |
| `timeout` | Execution time exceeded |
| `cancelled` | User or system cancellation |
| `max_turns` | Reached maximum conversation turns |

### Error Detection

The runner detects common error patterns:

```typescript
// Missing API key
if (error.isMissingApiKey()) {
  // Prompt user to set ANTHROPIC_API_KEY
}

// Rate limiting
if (error.isRateLimited()) {
  // Implement backoff or wait
}

// Network issues
if (error.isNetworkError()) {
  // Check connectivity
}

// Recoverable errors
if (error.isRecoverable()) {
  // Can retry the operation
}
```

### Troubleshooting Guide

#### "Missing API Key" Errors

```
SDKInitializationError: Missing or invalid API key
```

**Solution**: Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

#### Rate Limit Errors

```
SDKStreamingError: Rate limit exceeded
```

**Solutions**:
1. Wait and retry (the error includes retry-after when available)
2. Reduce concurrent agent runs
3. Use a higher-tier API plan

#### Connection Errors

```
SDKStreamingError: Connection refused (ECONNREFUSED)
```

**Solutions**:
1. Check network connectivity
2. Verify MCP server URLs are accessible
3. Check firewall rules

#### Malformed Response Errors

```
MalformedResponseError: Invalid message format
```

This usually indicates an SDK version mismatch or API changes. The runner logs these but continues processing other messages.

### Error Recovery Patterns

#### Automatic Retry (Not Implemented Yet)

The runner currently does not retry failed operations. For critical workflows, implement retry logic at the orchestration layer:

```typescript
async function runWithRetry(options: RunnerOptions, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await runner.execute(options);

    if (result.success) return result;

    if (result.error instanceof SDKStreamingError &&
        result.error.isRecoverable() &&
        attempt < maxRetries) {
      await sleep(1000 * attempt); // Exponential backoff
      continue;
    }

    throw result.error;
  }
}
```

#### Graceful Degradation

Handle partial failures gracefully:

```typescript
const result = await runner.execute(options);

if (!result.success && result.errorDetails?.code === 'RATE_LIMIT') {
  // Save progress and schedule retry
  await scheduleRetry(result.jobId, result.sessionId);
}
```

## Runner Result

The runner returns a structured result:

```typescript
interface RunnerResult {
  success: boolean;              // Whether the run completed successfully
  jobId: string;                 // The job ID for this run
  sessionId?: string;            // Session ID for resume/fork
  summary?: string;              // Brief summary of accomplishments
  error?: Error;                 // Error if run failed
  errorDetails?: {               // Detailed error info
    code: string;
    message: string;
    recoverable: boolean;
  };
  durationSeconds?: number;      // Total execution time
}
```

## Related Documentation

- [State Management](/internals/state-management/) - How state is persisted
- [Sessions](/concepts/sessions/) - Session configuration and lifecycle
- [Jobs](/concepts/jobs/) - Job properties and status
- [Permissions](/configuration/permissions/) - Detailed permission configuration
- [MCP Servers](/configuration/mcp-servers/) - MCP server setup guide
