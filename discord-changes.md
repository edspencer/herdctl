# Discord Changes — herdctl Fork

This document covers all Discord-related changes in the oheckmann74/herdctl fork compared to upstream herdctl. Changes are listed in reverse chronological order (newest first).

---

## 1. Embed Content in Conversation Context

**File:** `packages/discord/src/mention-handler.ts`

**Problem:** When a scheduled job's output was posted to Discord via a hook embed, and the user replied to it ("draft an answer"), the agent's Discord session had no idea what the user was referring to. The conversation context builder only read `message.content` — the plain text body of a Discord message. Discord embeds (structured content with titles, fields, descriptions) live in `message.embeds`, which was completely ignored.

This meant embed-only messages (from herdctl hooks, link previews, other bots) were filtered out as "empty" and invisible to the agent.

**Change:** The `processMessage()` function now extracts text from embed titles, descriptions, and fields and appends it to the message content. Any embed in the channel history — from hooks, link previews, or other bots — becomes part of the conversation context.

**Why this matters:** Scheduled jobs (cron, interval) run in isolated CLI sessions with no Discord channel context. The `after_run` hook posts their output to Discord as an embed. Without this fix, replying to a hook notification was a dead end — the agent couldn't see what it had reported.

---

## 2. File Attachments

**Files:** `packages/discord/src/manager.ts`, `packages/discord/src/types.ts`, `packages/core/src/config/schema.ts`

**Problem:** Users couldn't send images, PDFs, or text files to agents via Discord. Attachments were silently ignored.

**Change:** Added full attachment processing pipeline:
- **Text files** (`.txt`, `.json`, `.csv`, etc.) are inlined directly into the prompt — up to 50,000 characters
- **Images and PDFs** are downloaded to a timestamped directory so agents can access them via their Read tool
- **Automatic cleanup** after processing (configurable)
- Collision-safe: concurrent messages with same filenames get isolated directories

**Config:**
```yaml
chat:
  discord:
    attachments:
      enabled: true
      max_files_per_message: 10
      max_file_size_mb: 10
      allowed_types: ["image/*", "application/pdf", "text/*", "application/json"]
      cleanup_after_processing: true
```

A follow-up commit (dbe4e61) fixed a race condition where concurrent attachments with the same filename could overwrite each other, using timestamp-based directory isolation.

---

## 3. Output Control: `assistant_messages` Enum

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** The original Discord output was extremely verbose — every assistant turn (including internal reasoning and tool-use planning) was posted to the channel. Two earlier attempts to fix this (`final_answer_only` + `concise_mode`) introduced complexity: message buffering, system prompt injection that degraded answer quality, and a "no additional output to share" fallback that confused users.

**Change:** Replaced both boolean flags with a single enum:

```yaml
chat:
  discord:
    output:
      assistant_messages: "answers"  # or "all"
```

- `"answers"` (default): Only send turns that contain NO `tool_use` blocks — pure text responses. This is the agent's actual answer.
- `"all"`: Send every turn that has text content, including reasoning during tool use.

**Why this is better:**
- No message buffering — answer turns are sent immediately
- No system prompt injection — the agent's normal behavior is preserved
- No fallback messages — if a turn has text and no tool use, it's an answer, period
- Simple mental model: you either want just answers or everything

---

## 4. Visual Polish

**Files:** `packages/discord/src/manager.ts`, `packages/discord/src/commands/help.ts`, `reset.ts`, `status.ts`, `packages/discord/src/types.ts`

**Problem:** Default embeds were visually noisy — large titles, inconsistent colors, no branding. Tool result embeds took up excessive vertical space.

**Changes:**
- **Removed titles** from all embeds (progress, tool results, errors, status, summary) — cleaner look
- **Branded footer** on all embeds: `herdctl · agent-name`
- **Refined color palette:**
  - Soft violet (`#8B5CF6`) — progress indicators
  - Emerald (`#10B981`) — success/completion
  - Cool gray (`#6B7280`) — system messages
  - Sky blue (`#0EA5E9`) — command output
- **Compact tool results:** collapsed title + fields into a single description line
- **Horizontal result summary** with centered-dot separators instead of inline fields
- **Syntax highlighting** (`ansi`) for Bash tool output
- **Styled slash commands** (`/help`, `/status`, `/reset`) as embeds instead of plain text
- Made `DiscordReplyEmbed.title` optional (was required)

---

## 5. Message Deduplication

**Files:** `packages/discord/src/manager.ts`, `packages/slack/src/manager.ts`

**Problem:** The CLI runtime streams output by appending to a JSONL session file. The session watcher picks up intermediate snapshots that have `stop_reason: null` and incomplete text. These were being sent to Discord as partial messages, causing duplicated or garbled output. Users sometimes saw "completed the task but no response" fallback messages.

**Change:** Skip intermediate JSONL snapshots that lack a complete response. Deliver only finalized snapshots. Deduplicate by `message.id` to prevent the same message from being sent twice. Applied to both Discord and Slack connectors.

---

## 6. Acknowledgement Emoji

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** When a user sends a message in Discord, there's no immediate feedback that the bot received it. The agent might take 10-30 seconds before the first response appears, leaving the user wondering if the message was seen.

**Change:** Bot reacts with a configurable emoji (default: 👀) on message receipt. The reaction is removed once the response is sent.

```yaml
chat:
  discord:
    output:
      acknowledge_emoji: "👀"
```

---

## 7. Voice Message Transcription

**Files:** New file `packages/discord/src/voice-transcriber.ts`, `packages/discord/src/manager.ts`, `packages/discord/src/discord-connector.ts`, `packages/core/src/config/schema.ts`

**Problem:** Discord supports voice messages (audio recordings sent inline). Agents couldn't process them — the audio was ignored and only an empty message came through.

**Change:** Added voice message detection and transcription:
- Detects Discord voice messages via `MessageFlags.IsVoiceMessage`
- Downloads the audio attachment
- Transcribes via OpenAI Whisper API using native fetch + FormData (no extra dependencies)
- Inserts the transcription as the message content, prefixed with `[Voice message transcription]:`

```yaml
chat:
  discord:
    voice:
      enabled: true
      api_key_env: OPENAI_API_KEY
      language: en  # optional ISO 639-1 code
```

---

## 8. File Upload (Agent → Discord)

**Files:** `packages/discord/src/discord-connector.ts`, `packages/discord/src/manager.ts`

**Problem:** Agents could receive files but not send them back. An agent that generates an image, PDF, or CSV had no way to deliver it to the Discord channel.

**Change:** Added `uploadFile()` method to DiscordConnector using Discord.js `AttachmentBuilder`. Wired through `FileSenderContext` and `createFileSenderDef` in the manager so agents can send files back to the originating channel via an injected MCP server. Mirrors existing Slack file upload support.

---

## 9. Typing Indicator Control

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** Discord's typing indicator can cause "An unknown error occurred" for long-running jobs. The Discord client has internal timeouts, and continuous typing indicator refreshes can race against rate limits, producing visible errors in the channel.

**Change:** Added a config option to disable the typing indicator entirely:

```yaml
chat:
  discord:
    output:
      typing_indicator: false  # default: true
```

---

## 10. Progress Indicator

**Files:** `packages/discord/src/manager.ts`

**Problem:** With verbose output suppressed, users had no visibility into what the agent was doing. Long-running jobs (30s+) appeared frozen.

**Change:** Added a "Working..." embed that updates in place as tools run. Tool names appear as they execute, throttled to 2-second intervals to avoid rate limits. The embed is deleted when the job completes. Controlled by config:

```yaml
chat:
  discord:
    output:
      progress_indicator: true  # default: true
```

Uses `replyWithRef()` to get edit/delete handles on the progress embed.

---

## 11. MCP Config Format Fix

**File:** `packages/core/src/runner/runtime/cli-runtime.ts`

**Problem:** The CLI runtime passed MCP server configuration to `claude --mcp-config` as inline JSON without the required `mcpServers` wrapper key. The CLI expects `{"mcpServers": {...}}` (same shape as `.mcp.json` files). Without the wrapper, the Claude CLI hung indefinitely during startup — no error, no timeout, just a stuck process.

This was a latent bug that never manifested because agents' MCP servers were loaded from workspace `.mcp.json` files, not via `--mcp-config`. The self-scheduling feature (which injects the `herdctl-scheduler` MCP server via config) was the first to actually use `--mcp-config`, exposing the bug.

**Change:** `JSON.stringify(mcpServers)` → `JSON.stringify({ mcpServers })`

---

## 12. Injected MCP Server Support for CLI Runtime (File Upload Fix)

**File:** `packages/core/src/runner/runtime/cli-runtime.ts`

**Problem:** The file upload feature (#8) worked for SDK and Docker runtimes but silently failed for CLI runtime agents. The `FileSenderContext` MCP server was passed via `injectedMcpServers`, but CLI runtime completely ignored that field — it only supported static MCP servers from agent config via `--mcp-config`.

Since all agents in this deployment use CLI runtime (Max plan pricing), no agent could upload files to Discord. The stlpipeline agent would describe generated images in text but never actually upload them.

**Root cause:** The SDK runtime can host MCP servers in-process (same Node.js process). The CLI runtime spawns `claude` as a separate subprocess — in-process handlers can't cross the process boundary. The container runner already solved this for Docker by starting HTTP bridges (JSON-RPC over HTTP) and passing them as HTTP-type MCP servers. CLI runtime had no equivalent.

**Change:** Reused the existing `mcp-http-bridge.ts` infrastructure. When CLI runtime receives `injectedMcpServers`:

1. Starts an HTTP bridge for each injected server (random localhost port)
2. Merges them into `--mcp-config` as `type: "http"` MCP servers pointing to `http://127.0.0.1:<port>/mcp`
3. Auto-adds `mcp__<name>__*` to `--allowedTools` if the agent has an allowlist
4. Sets `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=120000` for file uploads (same as container runner)
5. Cleans up bridges in `finally` block when the CLI process exits

**Why this matters:** File upload now works across all three runtimes — SDK, Docker, and CLI. The same `InjectedMcpServerDef` pattern works everywhere.

---

## Summary of Config Options Added

```yaml
chat:
  discord:
    output:
      assistant_messages: "answers"  # "answers" | "all" (replaces final_answer_only + concise_mode)
      result_summary: true           # show summary embed after job completes
      typing_indicator: true         # show typing indicator while processing
      progress_indicator: true       # show updating "Working..." embed
      acknowledge_emoji: "👀"        # react on message receipt

    attachments:
      enabled: true
      max_files_per_message: 10
      max_file_size_mb: 10
      allowed_types: ["image/*", "application/pdf", "text/*", "application/json"]
      cleanup_after_processing: true

    voice:
      enabled: true
      api_key_env: OPENAI_API_KEY
      language: en
```
