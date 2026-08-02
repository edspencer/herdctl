---
title: Session Discovery
description: How herdctl discovers, attributes, and surfaces all Claude Code sessions on the machine — including sessions it did not create — using JSONL parsing, attribution indexing, and metadata caching
sidebar:
  order: 170
---

The session discovery subsystem enables herdctl to discover, attribute, and display all Claude Code sessions on the machine -- not just the ones herdctl created. A user running Claude Code natively from the terminal, through herdctl's scheduler, via the web dashboard, or through Discord/Slack will generate session files on disk. The session discovery subsystem finds all of these, determines where each one came from, and provides the metadata needed to display them in the web dashboard's Fleet view and All Chats page.

All session discovery logic lives in `@herdctl/core` (the `packages/core/src/state/` directory). It is consumed by the web dashboard's REST API but is available to any consumer -- CLI, API scripts, or future integrations -- because it has no web-specific dependencies.

## Module Overview

The subsystem is composed of seven modules, each handling a distinct concern. They layer on top of each other, with the `SessionDiscoveryService` orchestrating the rest.

| Module | File | Purpose |
|--------|------|---------|
| **JSONL Parser** | `packages/core/src/state/jsonl-parser.ts` | Streaming parser for Claude Code `.jsonl` session files |
| **Adoption Store** | `packages/core/src/state/adopted-sessions.ts`, `packages/core/src/state/schemas/adopted-session.ts` | Persists adoption records in `.herdctl/adopted-sessions/`, read as a third attribution source |
| **Claude Home Resolution** | `packages/core/src/runner/runtime/cli-session-path.ts`, `packages/core/src/runner/runtime/claude-config-dir.ts` | Resolves the configurable Claude home into transcript paths, and exports it to Claude Code as `CLAUDE_CONFIG_DIR` |
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
| `parseSessionMessages(filePath, options?)` | Parse a full session into `ChatMessage[]` with tool call/result pairing. Each message carries the stable `uuid` of its source JSONL entry (see below) |
| `extractSessionMetadata(filePath)` | Extract summary metadata (timestamps, message count, git branch, preview, sidechain status) |
| `extractSessionUsage(filePath)` | Extract token usage data (input tokens, turn count) |
| `isSidechainSession(filePath)` | O(1) check -- reads only the first JSONL line to detect sub-agent sessions |
| `extractLastSummary(filePath)` | Extract the last `type: "summary"` entry |
| `extractSessionTitle(filePath)` | Extract the best available title for auto-naming: `custom-title` > `ai-title` > `summary` |

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

### Stable Message IDs

Each JSONL transcript entry carries a stable `uuid` — assigned when the line is written, append-only, and preserved across reloads and session forks. `parseSessionMessages` surfaces it as an optional `uuid` field on each `ChatMessage`:

- User and assistant messages take their own line's `uuid`.
- A paired tool message takes the **originating `tool_use` entry's** `uuid`, so the ID stays deterministic even when several `tool_result`s share a single user line. An orphan tool_result with no matching tool_use falls back to its own line's uuid.
- `uuid` is `undefined` when the source line carries none, so existing consumers are unaffected.

This gives UIs a reload-stable identifier for keying per-message state (React list keys, collapse/pin state, deep links) instead of falling back to array indexes.

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

The `buildAttributionIndex()` function scans three data sources in parallel:

1. **Job metadata files** in `.herdctl/jobs/` -- Each job YAML file contains a `session_id` field, an `agent` field, and a `trigger_type` field. This maps sessions to the agent and trigger that created them.

2. **Platform session YAML files** in `.herdctl/<platform>-sessions/` (where platform is `discord`, `slack`, or `web`) -- These files map channel IDs to session IDs and agent names. They are written by the chat session managers.

3. **Adoption records** in `.herdctl/adopted-sessions/` -- One YAML file per adopted session, claiming a pre-existing transcript for an agent. See [Session Adoption](#session-adoption).

```typescript
const [jobIndex, platformIndex, adoptedIndex] = await Promise.all([
  buildJobIndex(jobsDir),
  buildPlatformIndex(stateDir),
  buildAdoptedIndex(stateDir),
]);
```

Job records get an incremental, mtime-keyed cache (`AttributionIndexBuilder`) because they are numerous and immutable once written. Platform session files and adoption records are few and mutable -- a session can be adopted, re-adopted by another agent, or released -- so both are re-read in full on every build.

### Attribution Result

Each session ID resolves to a `SessionAttribution`:

```typescript
interface SessionAttribution {
  origin: SessionOrigin;      // "web" | "discord" | "slack" | "schedule" | "native" | "adopted"
  agentName: string | undefined;
  triggerType: string | undefined;
}
```

The lookup order is:
1. Check the job index first (covers schedule, manual, webhook, chat, fork, web, discord, slack triggers)
2. Check the platform index (covers sessions created through chat connectors that may not have job records yet)
3. Check the adoption index (covers pre-existing transcripts an agent has claimed; `origin: "adopted"`, no trigger type)
4. Default to `"native"` with no agent name (the session was created by the user running `claude` directly)

Adoption is checked **last**, immediately before the native fallback. A real run record or a live platform binding is stronger evidence of where a session came from than an after-the-fact adoption claim, so adoption never overrides them -- it only rescues sessions that would otherwise be unattributed.

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

`adopted` has no trigger type -- it comes from the adoption store rather than from a job record, so nothing mapped to it.

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
| `getAutoName(agentName, sessionId)` | Get cached auto-generated name, its mtime, and the `autoNameVersion` that produced it |
| `setAutoName(agentName, sessionId, autoName, mtime)` | Cache an auto-generated name with its extraction timestamp |
| `batchSetAutoNames(agentName, entries)` | Set auto-names for multiple sessions in a single file write |

### Auto-Name Extraction

Auto-naming resolves the best available title for a session. `extractSessionTitle()` streams the transcript and returns the highest-precedence title present:

1. `custom-title` entries, whose value lives in a **`customTitle`** field -- a title the user explicitly set, so it always wins
2. `ai-title` entries, whose value lives in an **`aiTitle`** field -- Claude Code's own generated title
3. `summary` entries, whose value lives in a `summary` field -- what herdctl-driven runs emit

Precedence is by **entry type, not by file position**: a later `ai-title` never clobbers an earlier `custom-title`. Within one type the last occurrence wins, since titles are rewritten as a session evolves -- which is why the function streams to EOF with no early exit, matching `extractLastSummary()`. An entry carrying a plain `title` field is not a title herdctl understands and is ignored.

When a transcript carries no title at all, `resolveAutoName` falls back to `extractFirstMessagePreview()`, so a session shows something more useful than its raw ID. This matters most for terminal sessions: CLI transcripts essentially never emit a `type: "summary"` entry, so summary-only extraction left every natively-run session displaying its session ID.

`extractSessionTitle()` is kept separate from `extractLastSummary()` rather than replacing it, so the contract of that function -- and of `extractSessionMetadata()`, which also reads summaries -- is unchanged.

### Auto-Name Cache Invalidation

The auto-name cache is keyed on the session file's modification time (`mtime`) **and** on `AUTO_NAME_EXTRACTOR_VERSION`, the version of the extraction logic that produced the cached value:

```typescript
const cached = await this.sessionMetadataStore.getAutoName(agentName, sessionId);

if (
  cached?.autoNameMtime &&
  cached.autoNameMtime >= fileMtime &&
  cached.autoNameVersion === AUTO_NAME_EXTRACTOR_VERSION
) {
  // Cache is valid AND was produced by the current extractor
  return { autoName: cached.autoName, needsUpdate: false };
}

// Need to re-extract from JSONL
const title = await extractSessionTitle(filePath);
const autoName = title || (await extractFirstMessagePreview(filePath));
```

The version check is load-bearing. The cache is authoritative on the presence of `autoNameMtime`, not of `autoName` -- a transcript that yielded no name is negative-cached so it is never re-streamed. Without a version stamp, changing the extraction logic would therefore appear to do nothing on existing data: every already-listed session still holds a current-mtime entry produced by the old extractor, and the old (usually empty) result would keep winning forever. Requiring the version to match makes each legacy entry miss exactly once; it is then re-extracted and rewritten stamped, while the entry's `customName`, `preview`, `usage` and `isSidechain` caches survive untouched.

`autoNameVersion` is an **optional** field on `SessionMetadataEntrySchema`, deliberately not a bump of the file-level `version` in `SessionMetadataFileSchema`. `loadMetadata()` discards the *entire* file when it fails to parse, so a file-version bump would silently destroy every user-set `customName` rather than invalidate one cached field.

### Batch Writes

When the discovery service resolves auto-names for many sessions at once (e.g., when loading the All Chats page), it collects all updates and writes them in a single `batchSetAutoNames()` call. This avoids N sequential file writes and instead performs one atomic write per agent.

## Claude Home Resolution

Every transcript path in the system is `<claudeHome>/projects/<encoded-cwd>/<session-id>.jsonl`. The Claude home is configurable -- `FleetManagerOptions.claudeHomePath`, defaulting to `~/.claude` -- because an embedding host frequently runs Claude Code against a home it manages itself rather than the operator's own.

There are **three separate names for this one concept**, and they must all agree:

| Name | Owner | Where it appears |
|------|-------|------------------|
| `claudeHomePath` | herdctl | `FleetManagerOptions`, `SessionDiscoveryOptions`, `RuntimeFactory.create()` options, `SDKRuntimeOptions`, and the `CLIRuntime` options |
| `CLAUDE_CONFIG_DIR` | Claude Code | The environment variable the Agent SDK and the `claude` binary read to locate their own home |
| Whatever the embedding app calls it | the host | e.g. a `CLAUDE_HOME` env var the host resolves before constructing the fleet |

### Threading the home through herdctl

`defaultClaudeHome()` (in `packages/core/src/runner/runtime/cli-session-path.ts`) is the single source of truth for the `~/.claude` fallback. It is deliberately a function rather than a module constant, so `os.homedir()` is read at call time.

`getCliSessionDir()` and `getCliSessionFile()` each take an optional trailing `claudeHomePath` and fall back to `defaultClaudeHome()`. `FleetManager` resolves the home once in its constructor, exposes it via `getClaudeHomePath()`, and threads it into:

- `SessionDiscoveryService` (the `claudeHomePath` option), which passes it to every `getCliSessionFile()` call behind auto-name, preview and sidechain resolution
- `RuntimeFactory.create()`, from `JobControl`, `ScheduleExecutor` and `runSchedule()`
- `SDKRuntime` on the streaming-chat resume path in `JobControl`
- `deleteSession()`, and `cliSessionFileExists()` via `SessionFileCheckOptions.claudeHomePath`

Before this threading existed, discovery honoured an injectable home while the path helpers hardcoded `os.homedir()/.claude`: the *listing* path and the *read* path disagreed, so under a non-default home sessions listed but opened empty. The failure is invisible whenever the configured home happens to equal `~/.claude`.

### Telling Claude Code itself

Threading `claudeHomePath` only fixes herdctl's own path arithmetic. The process that actually **writes** transcripts is Claude Code -- the Agent SDK for the `sdk` runtime, the spawned `claude` binary for the `cli` runtime -- and it resolves its home from the `CLAUDE_CONFIG_DIR` environment variable. Neither runtime has a "Claude home" option to pass.

So `packages/core/src/runner/runtime/claude-config-dir.ts` bridges the two:

- `resolveClaudeConfigDir(claudeHomePath)` returns the value to export, or `undefined` when nothing needs to change -- the default home, or an operator who already set `CLAUDE_CONFIG_DIR` themselves (their setting wins).
- `withClaudeConfigDir(claudeHomePath, inherited)` returns a full environment object with the variable added, or `undefined` to leave plain inheritance alone.

`SDKRuntime` applies `withClaudeConfigDir()` to the per-query `sdkOptions.env` as the last step of building its options. This is scoped to the query rather than mutating `process.env`, because a host runs many concurrent agents and a global mutation would leak one agent's home into all of them. Note the SDK's `env` **replaces** the subprocess environment wholesale rather than merging, which is why `withClaudeConfigDir()` spreads the inherited environment itself.

`CLIRuntime` adds the variable to its default `execa` spawn instead. `execa` merges `env` over the inherited environment (`extendEnv` defaults to true), so that is a per-spawn addition. A caller-supplied `processSpawner` owns its own environment and is left alone.

`ContainerRunner` deliberately injects **nothing**. The container has its own filesystem and its own fixed home (`HOME=/home/claude`, with `/home/claude/.claude/projects/-workspace` bind-mounted back to the host `<stateDir>/docker-sessions`, which is how herdctl reads those transcripts at all). A host path would be meaningless inside the container and would move the agent's transcripts off the mount.

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

`getClaudeHomePath()` returns the resolved value, so callers that need to place or inspect a transcript themselves can use the same home the service lists and reads from.

### Public Methods

| Method | Purpose |
|--------|---------|
| `getAgentSessions(agentName, workDir, dockerEnabled, options?)` | Discover sessions for a specific agent. Only returns sessions attributed to the requested agent. Filters sidechain sessions. |
| `getAllSessions(agents, options?)` | Discover all sessions across all agent working directories. Groups by directory. Includes unattributed sessions. |
| `getSessionMessages(workDir, sessionId)` | Get parsed chat messages for a session (delegates to JSONL parser) |
| `getSessionMetadata(workDir, sessionId)` | Get metadata for a session (cached) |
| `getSessionUsage(workDir, sessionId)` | Get token usage data for a session |
| `invalidateCache(workDir?)` | Clear cached data for a specific directory or all caches |
| `listAdoptableSessions(agentName, workDir, fromWorkingDir?)` | List native transcripts an agent could adopt (see [Session Adoption](#session-adoption)) |
| `adoptSession(agentName, sessionId, opts)` | Record an adoption claim for a single session, moving nothing |
| `adoptSessionsFrom(agentName, workDir, opts?)` | Place and claim every adoptable session found in a directory |
| `unadoptSession(sessionId, opts?)` | Remove an adoption record, leaving the transcript on disk |

### DiscoveredSession Type

Each discovered session is returned as a `DiscoveredSession`:

```typescript
interface DiscoveredSession {
  sessionId: string;
  workingDirectory: string;
  mtime: string;                    // ISO 8601
  origin: SessionOrigin;            // "web" | "discord" | "slack" | "schedule" | "native" | "adopted"
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

## Session Adoption

Adoption answers a question discovery cannot: "I already have a pile of Claude Code sessions I ran myself -- can this agent own them?" A native transcript is visible in all-sessions views but invisible under any agent, because nothing attributes it. Adoption records that attribution.

### The Store

An adoption record is a YAML file at `<stateDir>/adopted-sessions/<session-id>.yaml`, validated by `AdoptedSessionSchema`:

```yaml
version: 1
sessionId: 0f3c...
agentName: my-fleet/my-agent
adoptedAt: 2026-08-01T12:00:00.000Z
sourceCwd: /Users/ed/Code/myproject
```

The directory is created lazily on first write, like the sparse `<platform>-sessions` stores; a missing directory simply means "no adoptions". Session IDs arrive from user input (CLI arguments, HTTP bodies), so file paths are built through `buildSafeFilePath()` -- a hostile ID such as `../../etc/passwd` throws rather than escaping the store.

This is a **dedicated store rather than a forged job record**. A job record means "a run happened"; manufacturing one to buy attribution would make job listings, history and metrics lie about work that never ran. The attribution index reads this store as a genuine third source instead.

### FleetManager API

| Method | Purpose |
|--------|---------|
| `listAdoptableSessions(name, fromWorkingDir?)` | Candidates for adoption, newest first -- backs an "import my existing chats" picker |
| `adoptSession(name, sessionId, opts?)` | Claim one session by ID. Records attribution only; moves nothing. Idempotent |
| `adoptSessionsFrom(name, opts?)` | Place and claim every adoptable session in a directory |
| `unadoptSession(name, sessionId)` | Release this agent's claim. The transcript stays on disk |

An `AdoptableSession` is deliberately **not** a `DiscoveredSession`: half of that shape is meaningless before adoption. Its `origin` is by definition `native`, its `agentName` by definition undefined (that is *why* it is invisible), `resumable` is a property of the adopting agent rather than of the candidate, and `customName` is keyed per agent. What a picker needs is which session, what it looks like, when it was last touched, and where it came from -- so the shape is `sessionId`, `sourceCwd`, `mtime`, `autoName`, `preview` and `sizeBytes`. There is no message count: obtaining one means streaming the whole transcript, which is exactly the per-session cost the listing caches exist to avoid. `sizeBytes` comes free from the `stat()` the directory listing already performs.

`unadoptSession()` returns `false` -- rather than removing anything -- when the session is not adopted, or when it is adopted by a *different* agent. One agent must not be able to drop another's claim.

### Placement

`adoptSessionsFrom()` has to solve a second problem: discovery looks for an agent's transcripts under `<claudeHome>/projects/<encoded agent cwd>/`, so a transcript recorded under a *different* working directory is not where discovery will look. Each candidate is therefore placed into the agent's own transcript folder, then attributed with the originating directory as `sourceCwd`. When the source directory already resolves to the agent's own folder, nothing is moved and only attribution is recorded.

`mode` defaults to `"copy"`, so the user's original `~/.claude` transcripts are never mutated unless they explicitly ask:

| Mode | Effect |
|------|--------|
| `copy` (default) | Duplicate the file, preserving the source mtime. The agent appends to its own copy on resume |
| `move` | Relocate the file. It disappears from the user's terminal history |
| `link` | Hard-link (symlink across devices). One inode, so a resume appends to the user's original too |

Copies preserve the source mtime deliberately: mtime drives both list ordering and every metadata cache key, so a fresh mtime would reorder the user's history and invalidate their caches.

**Existing destination files are never overwritten, and that is enforced by the placement syscall rather than by a pre-check.** The caller does `stat()` the destination first, but only to produce a tidy `destination-exists` skip: a check-then-act pre-check cannot see a writer that arrives a microsecond later, and it cannot see a destination `stat()` itself fails on -- a dangling symlink, which is exactly what an earlier cross-device `link` placement leaves behind once the user deletes the original, reads as ENOENT. So each mode creates the destination exclusively: `copy` uses `COPYFILE_EXCL`, `link` uses `link()`/`symlink()`, and `move` -- notably -- does **not** use `rename()`, which silently replaces an existing destination on every platform. It hard-links and then unlinks the source, which is the same net effect (one inode, mtime carried for free) but refuses an occupied destination. An `EEXIST` from any of them is reported as the same `destination-exists` skip. A `move` is the one placement that also destroys the source, so a clobber there would lose both copies of a chat.

Every candidate that is not adopted appears in `skipped` with a reason a UI can show verbatim -- `sidechain`, `already-adopted`, `destination-exists`, `attributed-to-run`, `unreadable`, `placement-failed`, `record-failed` -- and one bad transcript never aborts the batch. With `dryRun: true` nothing at all is written, and the result describes what would have happened. "Nothing" includes the sidechain metadata *cache*: classifying a candidate as a sidechain is a fact the scan learns anyway, but writing it back would create `session-metadata/<agent>.json` on a preview, so the scan takes a flag that suppresses the cache write under a dry run.

`adoptSessionsFrom()` returns an empty result when the agent has no configured `working_directory`, even when `fromWorkingDir` is given: placement needs the agent's own transcript folder as its destination, and the per-agent listing is scoped to that same directory. `listAdoptableSessions()` differs -- it falls back to `fromWorkingDir` -- so it can list candidates that `adoptSessionsFrom()` then adopts none of. Single-session `adoptSession()` moves nothing and needs no working directory.

Placement targets the CLI transcript folder, so `adoptSessionsFrom()` is for non-Docker agents. A Docker-wrapped agent reads its sessions from `<stateDir>/docker-sessions/` (the container's `~/.claude` is ephemeral) and should claim them with `adoptSession()`, which records attribution without moving files.

Adoption resolves every path against the fleet's configured Claude home -- see [Claude Home Resolution](#claude-home-resolution) -- so a transcript is placed exactly where discovery, and the runtime that later resumes it, will look.

## Data Flow

A request for sessions flows through the system as follows:

1. **Web dashboard calls REST API** -- The React frontend issues a fetch to `/api/sessions` or `/api/agents/:name/sessions`.

2. **API calls SessionDiscoveryService** -- The route handler delegates to `getAllSessions()` or `getAgentSessions()` on the service instance.

3. **Service scans Claude Code's projects directory** -- The service reads `<claudeHome>/projects/` (`~/.claude/projects/` by default) to find encoded path directories, each representing a working directory where Claude Code sessions exist.

4. **Directory listing with caching** -- For each directory, `listSessionFiles()` reads the directory (or returns cached results), filters to `.jsonl` files, stats each file for modification time, and sorts by mtime descending.

5. **Sidechain filtering** -- Each session file is checked for sidechain status by reading only its first JSONL line. Sidechain sessions (Task tool sub-agents, `--resume` warmups) are filtered out.

6. **Attribution index lookup** -- The cached attribution index maps each session ID to its origin. The index is rebuilt if the cache TTL has expired.

7. **Per-agent filtering** -- For `getAgentSessions()`, only sessions attributed to the requested agent are returned. For `getAllSessions()`, all sessions are included (attributed and unattributed).

8. **Metadata enrichment** -- The metadata store provides cached custom names and auto-generated names. Auto-names that are stale (file mtime newer than cached mtime, or stamped with an older `autoNameVersion`) are re-extracted with `extractSessionTitle()`, falling back to the first user message. See [Auto-Name Extraction](#auto-name-extraction).

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

### Adoption as a Dedicated Store

Adoption records live in their own `adopted-sessions/` store and are read as a third attribution source, rather than being expressed as synthetic job records. A job record asserts that a run happened; forging one to buy attribution would corrupt job listings, history and metrics. Attribution precedence puts adoption last -- job, then platform, then adopted, then native -- because a real run record or a live platform binding is stronger evidence of origin than an after-the-fact claim.

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
