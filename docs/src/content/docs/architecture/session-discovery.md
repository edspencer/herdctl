---
title: Session Discovery
description: How herdctl discovers, attributes, and surfaces all Claude Code sessions on the machine — including sessions it did not create — using JSONL parsing, attribution indexing, and metadata caching
sidebar:
  order: 170
---

The session discovery subsystem enables herdctl to discover, attribute, and display all Claude Code sessions on the machine -- not just the ones herdctl created. A user running Claude Code natively from the terminal, through herdctl's scheduler, via the web dashboard, or through Discord/Slack will generate session files on disk. The session discovery subsystem finds all of these, determines where each one came from, and provides the metadata needed to display them in the web dashboard's Fleet view and All Chats page.

All session discovery logic lives in `@herdctl/core` (the `packages/core/src/state/` directory). It is consumed by the web dashboard's REST API but is available to any consumer -- CLI, API scripts, or future integrations -- because it has no web-specific dependencies.

## Module Overview

The subsystem is composed of five modules, each handling a distinct concern. They layer on top of each other, with the `SessionDiscoveryService` orchestrating the rest.

| Module | File | Purpose |
|--------|------|---------|
| **JSONL Parser** | `packages/core/src/state/jsonl-parser.ts` | Streaming parser for Claude Code `.jsonl` session files |
| **Tool Parsing** | `packages/core/src/state/tool-parsing.ts` | Extracts tool_use and tool_result blocks, provides human-readable summaries |
| **Session Attribution** | `packages/core/src/state/session-attribution.ts` | Maps session IDs to their origin (herdctl agent, native CLI, web, Discord, Slack) |
| **Session Metadata Store** | `packages/core/src/state/session-metadata.ts` | Persistent JSON cache for custom names, auto-generated names, and mtime tracking |
| **Session Discovery Service** | `packages/core/src/state/session-discovery.ts` | Main orchestrator that ties parsing, attribution, filtering, and metadata together |

## JSONL Parser

Claude Code stores each session as a `.jsonl` file in `~/.claude/projects/<encoded-path>/`. Each line is a self-contained JSON object representing a message in the conversation. The JSONL parser reads these files and produces structured data for the rest of the system.

### Streaming Architecture

Session files can be large -- 100,000+ lines for long-running sessions. The parser uses Node's `readline` module with `createReadStream` to process files line by line without loading the entire file into memory:

```typescript
function createLineReader(filePath: string): Promise<readline.Interface | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    stream.on("error", () => resolve(null));
    stream.on("open", () => {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      resolve(rl);
    });
  });
}
```

If the file does not exist or cannot be opened, the reader returns `null` and the caller gets an empty result rather than an exception. This is important because session files can be deleted or moved between the directory listing and the parse attempt.

### Key Exports

| Function | Purpose |
|----------|---------|
| `parseSessionMessages(filePath, options?)` | Parse a full session into `ChatMessage[]` with tool call/result pairing |
| `extractSessionMetadata(filePath)` | Extract summary metadata (timestamps, message count, git branch, preview, sidechain status) |
| `extractSessionUsage(filePath)` | Extract token usage data (input tokens, turn count) |
| `isSidechainSession(filePath)` | O(1) check -- reads only the first JSONL line to detect sub-agent sessions |
| `extractLastSummary(filePath)` | Extract the last `type: "summary"` entry for auto-naming |

### Message Deduplication

Claude Code's JSONL format includes duplicate assistant messages (the same message ID appears multiple times as streaming chunks arrive). The parser tracks seen assistant message IDs in a `Set<string>` and skips duplicates:

```typescript
const seenAssistantIds = new Set<string>();

// Inside the parse loop for assistant messages:
if (messageId) {
  if (seenAssistantIds.has(messageId)) continue;
  seenAssistantIds.add(messageId);
}
```

### Tool Call/Result Pairing

Assistant messages contain `tool_use` content blocks; the subsequent user message contains the matching `tool_result` blocks. The parser maintains a `Map<string, PendingToolUse>` keyed by tool use ID. When a tool_use block is encountered, it is stored as pending. When the matching tool_result arrives, the parser pairs them to produce a `ChatMessage` with role `"tool"` that includes both the tool name, input summary, output, error status, and duration.

### SessionMetadata Type

The metadata extractor produces a `SessionMetadata` object without parsing the full message history:

```typescript
interface SessionMetadata {
  sessionId: string;
  firstMessagePreview: string | undefined;
  gitBranch: string | undefined;
  claudeCodeVersion: string | undefined;
  messageCount: number;
  firstMessageAt: string | undefined;  // ISO 8601
  lastMessageAt: string | undefined;   // ISO 8601
  summary: string | undefined;
  isSidechain: boolean;
}
```

Fields like `gitBranch`, `claudeCodeVersion`, and `isSidechain` are extracted from the first user message in the JSONL file, where Claude Code stores session-level metadata. The `summary` field comes from `type: "summary"` entries that Claude Code appends periodically.

## Tool Parsing

The tool parsing module extracts structured information from tool_use and tool_result content blocks in Claude SDK messages. It was originally a private implementation detail of the Discord connector but was extracted to `@herdctl/core` for reuse across Discord, Slack, web, and the JSONL parser.

### Exports

| Function | Purpose |
|----------|---------|
| `extractToolUseBlocks(message)` | Parse `tool_use` content blocks from assistant messages, returning tool name, ID, and input |
| `extractToolResults(message)` | Parse tool result content from user messages, handling both top-level and nested formats |
| `extractToolResultContent(result)` | Extract text from a single tool result value (string, object with `content`, or content block array) |
| `getToolInputSummary(name, input)` | Produce human-readable input summaries (e.g., the command for Bash, the file path for Read/Write, the pattern for Grep) |

### Input Summaries

`getToolInputSummary()` maps tool names to the most meaningful field in their input object. For example:

- **Bash**: Returns the `command` field (truncated to 200 characters)
- **Read/Write/Edit**: Returns the `file_path` or `path` field
- **Glob/Grep**: Returns the `pattern` field
- **WebFetch/WebSearch**: Returns the `url` or `query` field

These summaries are displayed in the web dashboard's chat view and in Discord tool embeds.

### Tool Emoji Mapping

The `TOOL_EMOJIS` constant provides emoji mappings for common tool names, used by the web dashboard and chat connectors to give tool calls a visual indicator in the UI.

## Session Attribution

Session attribution answers the question: "Where did this session come from?" A session could have been created by a herdctl-managed agent (via schedule, web trigger, Discord, or Slack), or it could be a native Claude Code CLI session that herdctl had nothing to do with. The attribution module cross-references herdctl's own state files to classify each session.

### Data Sources

The `buildAttributionIndex()` function scans two data sources in parallel:

1. **Job metadata files** in `.herdctl/jobs/` -- Each job YAML file contains a `session_id` field, an `agent` field, and a `trigger_type` field. This maps sessions to the agent and trigger that created them.

2. **Platform session YAML files** in `.herdctl/<platform>-sessions/` (where platform is `discord`, `slack`, or `web`) -- These files map channel IDs to session IDs and agent names. They are written by the chat session managers.

```typescript
const [jobIndex, platformIndex] = await Promise.all([
  buildJobIndex(jobsDir),
  buildPlatformIndex(stateDir),
]);
```

### Attribution Result

Each session ID resolves to a `SessionAttribution`:

```typescript
interface SessionAttribution {
  origin: SessionOrigin;      // "web" | "discord" | "slack" | "schedule" | "native"
  agentName: string | undefined;
  triggerType: string | undefined;
}
```

The lookup order is:
1. Check the job index first (covers schedule, manual, webhook, chat, fork, web, discord, slack triggers)
2. Check the platform index (covers sessions created through chat connectors that may not have job records yet)
3. Default to `"native"` with no agent name (the session was created by the user running `claude` directly)

### AttributionIndex Interface

The result of `buildAttributionIndex()` is an `AttributionIndex` object with methods for single and batch lookups:

```typescript
interface AttributionIndex {
  getAttribute(sessionId: string): SessionAttribution;
  getAttributes(sessionIds: string[]): Map<string, SessionAttribution>;
  readonly size: number;
}
```

The index is built once and queried many times per request. The `SessionDiscoveryService` caches the index with a configurable TTL (default 30 seconds) to avoid rebuilding it on every dashboard refresh.

### Origin Mapping

Job trigger types map to session origins as follows:

| Trigger Type | Origin |
|-------------|--------|
| `web` | `web` |
| `discord` | `discord` |
| `slack` | `slack` |
| `schedule` | `schedule` |
| `manual`, `webhook`, `chat`, `fork` | `native` |

## Session Metadata Store

The metadata store provides persistent storage for user-assigned and auto-generated session names. Without it, the dashboard would need to re-parse JSONL files on every page load to extract display names.

### Storage Layout

Metadata files are stored as JSON in `.herdctl/session-metadata/`, with one file per agent (or `adhoc.json` for unattributed sessions):

```text
.herdctl/session-metadata/
├── my-agent.json         # Metadata for sessions attributed to my-agent
├── other-agent.json      # Metadata for sessions attributed to other-agent
└── adhoc.json            # Metadata for unattributed (native CLI) sessions
```

Files use the `SessionMetadataFile` schema:

```typescript
interface SessionMetadataFile {
  version: 1;
  agentName: string;
  sessions: Record<string, SessionMetadataEntry>;
}

interface SessionMetadataEntry {
  customName?: string;       // User-assigned name
  autoName?: string;         // Auto-generated from JSONL summary
  autoNameMtime?: string;    // ISO 8601 — file mtime when autoName was extracted
}
```

### Sparse Storage

Files are only created when the first piece of metadata is set for an agent. If no sessions have custom or auto names, no file exists on disk. This avoids creating empty files for every agent in the fleet.

### Key Operations

| Method | Purpose |
|--------|---------|
| `getCustomName(agentName, sessionId)` | Get user-assigned name for a session |
| `setCustomName(agentName, sessionId, name)` | Set user-assigned name (creates file if needed) |
| `removeCustomName(agentName, sessionId)` | Remove user-assigned name (cleans up empty entries) |
| `getAutoName(agentName, sessionId)` | Get cached auto-generated name and its mtime |
| `setAutoName(agentName, sessionId, autoName, mtime)` | Cache an auto-generated name with its extraction timestamp |
| `batchSetAutoNames(agentName, entries)` | Set auto-names for multiple sessions in a single file write |

### Auto-Name Cache Invalidation

The auto-name cache uses the session file's modification time (`mtime`) as a cache key. When the `SessionDiscoveryService` resolves an auto-name, it compares the file's current mtime against the stored `autoNameMtime`. If the file has been modified since the name was extracted, the name is re-extracted from the JSONL summary and the cache is updated:

```typescript
const cached = await this.sessionMetadataStore.getAutoName(agentName, sessionId);

if (cached?.autoNameMtime && cached.autoNameMtime >= fileMtime) {
  // Cache is valid
  return { autoName: cached.autoName, needsUpdate: false };
}

// Need to re-extract from JSONL
const summary = await extractLastSummary(filePath);
```

### Batch Writes

When the discovery service resolves auto-names for many sessions at once (e.g., when loading the All Chats page), it collects all updates and writes them in a single `batchSetAutoNames()` call. This avoids N sequential file writes and instead performs one atomic write per agent.

## Session Discovery Service

The `SessionDiscoveryService` is the main orchestrator. It provides the public API that the web dashboard's REST endpoints call, and it coordinates the JSONL parser, attribution index, sidechain filtering, and metadata store into a coherent discovery pipeline.

### Construction

```typescript
const discovery = new SessionDiscoveryService({
  stateDir: "/path/to/.herdctl",
  claudeHomePath: "~/.claude",  // optional, defaults to ~/.claude
  cacheTtlMs: 30_000,           // optional, defaults to 30 seconds
});
```

### Public Methods

| Method | Purpose |
|--------|---------|
| `getAgentSessions(agentName, workDir, dockerEnabled, options?)` | Discover sessions for a specific agent. Only returns sessions attributed to the requested agent. Filters sidechain sessions. |
| `getAllSessions(agents, options?)` | Discover all sessions across all agent working directories. Groups by directory. Includes unattributed sessions. |
| `getSessionMessages(workDir, sessionId)` | Get parsed chat messages for a session (delegates to JSONL parser) |
| `getSessionMetadata(workDir, sessionId)` | Get metadata for a session (cached) |
| `getSessionUsage(workDir, sessionId)` | Get token usage data for a session |
| `invalidateCache(workDir?)` | Clear cached data for a specific directory or all caches |

### DiscoveredSession Type

Each discovered session is returned as a `DiscoveredSession`:

```typescript
interface DiscoveredSession {
  sessionId: string;
  workingDirectory: string;
  mtime: string;                    // ISO 8601
  origin: SessionOrigin;            // "web" | "discord" | "slack" | "schedule" | "native"
  agentName: string | undefined;
  resumable: boolean;
  customName: string | undefined;
  autoName: string | undefined;
  preview: string | undefined;
}
```

### Directory Grouping

`getAllSessions()` returns results grouped by working directory as `DirectoryGroup` objects:

```typescript
interface DirectoryGroup {
  workingDirectory: string;
  encodedPath: string;
  agentName: string | undefined;
  sessionCount: number;             // Total sessions in directory (before filtering)
  sessions: DiscoveredSession[];    // Enriched sessions (may be limited)
}
```

Groups are sorted by most recent session modification time (newest directory first).

### Caching Strategy

The service maintains three caches:

| Cache | Key | TTL | Purpose |
|-------|-----|-----|---------|
| Attribution index | Global (single instance) | 30s (configurable) | Avoid rebuilding the job/platform index on every request |
| Directory listing | Session directory path | 30s (configurable) | Avoid re-scanning `readdir` + `stat` for each directory |
| Session metadata | File path | Indefinite (in-memory) | Avoid re-parsing JSONL for metadata on repeated calls |

The attribution index and directory listing caches use the same configurable TTL. The metadata cache is in-memory only and cleared when `invalidateCache()` is called.

## Data Flow

A request for sessions flows through the system as follows:

1. **Web dashboard calls REST API** -- The React frontend issues a fetch to `/api/sessions` or `/api/agents/:name/sessions`.

2. **API calls SessionDiscoveryService** -- The route handler delegates to `getAllSessions()` or `getAgentSessions()` on the service instance.

3. **Service scans Claude Code's projects directory** -- The service reads `~/.claude/projects/` to find encoded path directories, each representing a working directory where Claude Code sessions exist.

4. **Directory listing with caching** -- For each directory, `listSessionFiles()` reads the directory (or returns cached results), filters to `.jsonl` files, stats each file for modification time, and sorts by mtime descending.

5. **Sidechain filtering** -- Each session file is checked for sidechain status by reading only its first JSONL line. Sidechain sessions (Task tool sub-agents, `--resume` warmups) are filtered out.

6. **Attribution index lookup** -- The cached attribution index maps each session ID to its origin. The index is rebuilt if the cache TTL has expired.

7. **Per-agent filtering** -- For `getAgentSessions()`, only sessions attributed to the requested agent are returned. For `getAllSessions()`, all sessions are included (attributed and unattributed).

8. **Metadata enrichment** -- The metadata store provides cached custom names and auto-generated names. Auto-names that are stale (file mtime newer than cached mtime) are re-extracted from the JSONL summary.

9. **Batch metadata writes** -- Any auto-name updates discovered during enrichment are collected and written in a single batch per agent.

10. **Results returned** -- Sessions are returned sorted by modification time (newest first), grouped by directory for `getAllSessions()`.

### Top-N Optimization

When a `limit` option is provided (e.g., the dashboard's recent sessions widget requesting the 20 most recent), the service avoids enriching all sessions. It uses a merge-select algorithm across the sorted-by-mtime lists from each directory to identify the top N sessions globally, then only enriches those. This avoids JSONL parsing and attribution lookups for sessions that will not be returned.

## Key Design Decisions

### Streaming JSONL Parsing

Session files can grow to hundreds of thousands of lines. Loading the entire file into memory would be wasteful and could cause memory pressure when scanning many sessions. The readline-based streaming approach processes one line at a time with bounded memory usage, regardless of file size.

### O(1) Sidechain Check

The `isSidechainSession()` function reads only the first line of the JSONL file. Claude Code stores the `isSidechain` flag on the first entry, so no further reading is needed. This is critical when scanning hundreds of session files -- an O(n) scan of each file would make directory listing impractically slow.

### Attribution Index Caching

Building the attribution index requires scanning all job metadata files in `.herdctl/jobs/` and all platform session YAML files in `.herdctl/<platform>-sessions/`. This involves many filesystem reads. Caching the index with a 30-second TTL amortizes this cost across multiple dashboard requests while keeping attribution reasonably fresh.

### Batch Metadata Writes

When the All Chats page loads and many sessions need auto-name resolution, the naive approach would write the metadata file once per session. The batch write approach collects all updates for a given agent and performs a single atomic write, reducing filesystem operations from N to 1 per agent.

### Separation from Web

The session discovery subsystem lives entirely in `@herdctl/core`, not in `@herdctl/web`. This follows the library-first design principle: the CLI, API scripts, or future integrations can discover sessions without depending on the web package. The web dashboard consumes the service through its REST API layer, which delegates to `SessionDiscoveryService` methods.

### Temp Directory Filtering

The `isTempDirectory()` helper filters out sessions from `/tmp/`, `/private/tmp/`, `/var/folders/`, and the OS temp directory. These are typically short-lived Claude Code sessions from CI environments or automated scripts that would clutter the UI.

### Path Encoding and Decoding

Claude Code encodes working directory paths by replacing path separators with hyphens (e.g., `/Users/ed/Code/herdctl` becomes `-Users-ed-Code-herdctl`). The service uses `encodePathForCli()` from the runner module to encode paths for directory lookups, and `decodePathForDisplay()` to convert encoded paths back to human-readable form. The decoding is lossy (hyphens in directory names are indistinguishable from path separators) but sufficient for display purposes.

## Related Pages

### Architecture
- [System Architecture Overview](/architecture/overview/) -- How session discovery fits into the broader system
- [State Persistence](/architecture/state-management/) -- The `.herdctl/` directory structure that attribution reads from
- [HTTP API](/architecture/http-api/) -- REST endpoints that expose session discovery to the web dashboard
- [Web Dashboard](/architecture/web-dashboard/) -- The React frontend that displays discovered sessions
- [Shared Chat Layer](/architecture/chat-infrastructure/) -- Chat session managers that write the platform session files used by attribution

### Concepts
- [Sessions](/concepts/sessions/) -- User-facing documentation on how sessions work
- [Jobs](/concepts/jobs/) -- Job metadata that the attribution index reads from
