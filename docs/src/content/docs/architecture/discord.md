---
title: Discord Connector
description: How @herdctl/discord connects agents to Discord as independent bots with per-agent identity, slash commands, and rich message formatting
---

The `@herdctl/discord` package connects herdctl agents to Discord. Each agent with Discord configured gets its own bot -- its own discord.js client, its own bot token, its own presence, and its own set of slash commands. Users interact with agents by `@mention`-ing them in channels or sending direct messages, and the agents respond using the Claude Agent SDK through [FleetManager](/architecture/overview/).

This page covers the internal architecture of the Discord connector. For setup instructions, see the [Discord integration guide](/integrations/discord/).

## Architecture Overview

<img src="/diagrams/chat-architecture.svg" alt="Chat architecture diagram showing FleetManager, IChatManager, Discord and Slack managers, connectors, and external APIs" width="100%" />

The Discord package sits at the edge of the system. It depends on `@herdctl/chat` for shared infrastructure (session management, streaming response, message splitting, content extraction) and on `@herdctl/core` for agent configuration types and the `FleetManager` execution interface. It is the only package that imports `discord.js`.

| Dependency | Purpose |
|-----------|---------|
| `discord.js` ^14 | Discord gateway connection, REST API, message types |
| `@discordjs/rest` ^2.6 | Slash command registration via Discord REST API |
| `@herdctl/chat` | `ChatSessionManager`, `StreamingResponder`, message splitting, content extraction, error utilities |
| `@herdctl/core` | `AgentChatDiscord` config types, `FleetManager`, `IChatManager` interface, tool parsing (`extractToolUseBlocks`, `extractToolResults`, `TOOL_EMOJIS`, `getToolInputSummary`), file-sender MCP (`createFileSenderDef`) |

## Per-Agent Bot Model

Unlike architectures that use a single bot to route messages to different backends, herdctl creates one Discord bot per agent. Each bot is a separate Discord Application created in the [Developer Portal](https://discord.com/developers/applications), with its own token, username, avatar, and presence.

```text
Discord Server                          FleetManager
+-----------------------+               +---------------------------+
| Members:              |               | Agent: support            |
| - @alice (human)      |  <-- ws -->   |   DiscordConnector        |
| - @support-bot (bot)  |               |   (token: SUPPORT_TOKEN)  |
| - @marketer-bot (bot) |  <-- ws -->   | Agent: marketer           |
|                       |               |   DiscordConnector         |
+-----------------------+               |   (token: MARKETER_TOKEN) |
                                        +---------------------------+
```

This model has several consequences:

- Users `@mention` the specific agent they want to talk to.
- Each agent maintains independent conversation sessions per channel.
- Bot tokens are read from environment variables at startup -- never stored in configuration files.
- Adding or removing an agent's Discord presence requires creating or deleting a Discord Application manually.

## Component Inventory

The package consists of the following components, each in its own source file:

| Component | File | Purpose |
|-----------|------|---------|
| **DiscordConnector** | `discord-connector.ts` | discord.js client lifecycle, gateway intents, event handler registration, message routing, voice/attachment detection, file upload |
| **DiscordManager** | `manager.ts` | Multiple connector management, message pipeline, voice transcription and attachment processing, run-card/tool embeds, `IChatManager` implementation |
| **MessageNormalizer** | `message-normalizer.ts` | `normalizeDiscordMessage()` — converts the loose SDK message union into typed display events (assistant final/delta, tool results, system status, result, error) |
| **Embeds** | `embeds.ts` | `buildRunCardEmbed()`, `buildToolResultEmbed()`, `buildResultSummaryEmbed()`, `buildStatusEmbed()`, `buildErrorEmbed()`, shared embed colors and footer |
| **VoiceTranscriber** | `voice-transcriber.ts` | `transcribeAudio()` — OpenAI Whisper transcription of voice-message audio buffers |
| **CommandManager** | `commands/command-manager.ts` | Slash command registration via Discord REST API, interaction and autocomplete routing |
| **MentionHandler** | `mention-handler.ts` | Bot mention detection via `message.mentions`, role mention handling, conversation context building from channel history |
| **AutoModeHandler** | `auto-mode-handler.ts` | Guild-based channel resolution, DM channel configuration, mode determination |
| **ErrorHandler** | `error-handler.ts` | Error classification (gateway, rate limit, network, timeout), retry with exponential backoff, user-friendly error messages |
| **DiscordLogger** | `logger.ts` | Configurable per-agent log levels (minimal/standard/verbose) with content redaction |
| **Formatting** | `utils/formatting.ts` | `escapeMarkdown()`, typing indicator management, `sendSplitMessage()` |
| **Errors** | `errors.ts` | `DiscordConnectorError` hierarchy with typed error codes |
| **Types** | `types.ts` | Connector options, state, event map, reply payload types |
| **Slash commands** | `commands/*.ts` | Fourteen built-in commands (`/help`, `/ping`, `/config`, `/tools`, `/usage`, `/skills`, `/skill`, `/status`, `/session`, `/reset`, `/new`, `/stop`, `/cancel`, `/retry`) |

## DiscordConnector

`DiscordConnector` is the core class of the package. It extends `EventEmitter`, implements the `IDiscordConnector` interface, and manages a single discord.js `Client` instance for one agent.

### Gateway Intents and Partials

On `connect()`, the connector creates a discord.js client with the following gateway intents:

| Intent | Reason |
|--------|--------|
| `GatewayIntentBits.Guilds` | Access to guild (server) metadata |
| `GatewayIntentBits.GuildMessages` | Receive messages in guild channels |
| `GatewayIntentBits.DirectMessages` | Receive DM messages |
| `GatewayIntentBits.MessageContent` | Access message text content (privileged intent) |

Two partials are also enabled:

| Partial | Reason |
|---------|--------|
| `Partials.Channel` | Required for DM support in discord.js v14 -- without it, DM channels are not cached and `MessageCreate` events do not fire for DMs |
| `Partials.Message` | Allows receiving messages that were not in the cache |

### Connection Lifecycle

The connector transitions through these states:

```text
disconnected --> connecting --> connected --> disconnecting --> disconnected
                    |               |
                    v               v
                  error        reconnecting --> connected
```

| State | Description |
|-------|-------------|
| `disconnected` | Initial state. No client exists. |
| `connecting` | `Client.login()` has been called. |
| `connected` | The `ClientReady` event has fired. Bot user info is available. |
| `reconnecting` | discord.js is auto-reconnecting after a shard disconnect. |
| `disconnecting` | `disconnect()` has been called. The client is being destroyed. |
| `error` | `Client.login()` threw an exception. The client is cleaned up. |

Reconnection is handled automatically by discord.js with exponential backoff. The connector tracks `reconnectAttempts` and emits `reconnecting` and `reconnected` events for monitoring.

### Event Handler Registration

During `connect()`, the connector registers handlers for the following discord.js events:

| Event | Handler behavior |
|-------|-----------------|
| `ClientReady` | Updates status to `connected`, records bot user info, sets presence, cleans up expired sessions, initializes slash commands, emits `ready` |
| `ShardDisconnect` | Logs warning, emits `disconnect` event (only if not intentionally disconnecting) |
| `ShardReconnecting` | Updates status to `reconnecting`, increments attempt counter, emits `reconnecting` |
| `ShardResume` | Updates status back to `connected`, emits `reconnected` |
| `Error` | Records last error, emits `error` |
| `Warn` | Logs warning |
| `Debug` | Logs debug message (only when log level is `verbose`) |
| `RESTEvents.RateLimited` | Tracks rate limit state, emits `rateLimit` event |
| `MessageCreate` | Routes to `_handleMessage()` for mention/mode/config resolution, voice-message detection, and attachment extraction |
| `InteractionCreate` | Routes slash commands to `CommandManager.handleInteraction()` and autocomplete interactions to `CommandManager.handleAutocomplete()` |

### Connector Event Map

The connector emits a typed event map (`DiscordConnectorEventMap`) with the following events:

| Event | Payload | When emitted |
|-------|---------|-------------|
| `ready` | `{ agentName, botUser }` | Connection established and ready |
| `disconnect` | `{ agentName, code, reason }` | Connection lost |
| `error` | `{ agentName, error }` | Client error |
| `reconnecting` | `{ agentName, attempt }` | Auto-reconnect in progress |
| `reconnected` | `{ agentName }` | Successfully reconnected |
| `message` | `{ agentName, prompt, context, metadata, reply, replyWithRef, startTyping, addReaction, removeReaction }` | Processable message received. `metadata` includes voice-message fields (`isVoiceMessage`, `voiceAttachmentUrl`, `voiceAttachmentName`) and non-voice `attachments`. `replyWithRef` returns an edit/delete handle used for live-updating messages. |
| `messageIgnored` | `{ agentName, reason, channelId, messageId }` | Message filtered out |
| `commandExecuted` | `{ agentName, commandName, userId, channelId }` | Slash command executed |
| `sessionLifecycle` | `{ agentName, event, channelId, sessionId }` | Session created/resumed/expired/cleared |
| `rateLimit` | `{ agentName, timeToReset, limit, method, hash, route, global }` | Rate limit encountered |

### Connector State

`getState()` returns a `DiscordConnectorState` object with connection status, bot user info, rate limit tracking, and message statistics:

```typescript
interface DiscordConnectorState {
  status: DiscordConnectionStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  botUser: { id: string; username: string; discriminator: string } | null;
  rateLimits: {
    totalCount: number;
    lastRateLimitAt: string | null;
    isRateLimited: boolean;
    currentResetTime: number;
  };
  messageStats: { received: number; sent: number; ignored: number };
}
```

## DiscordManager

`DiscordManager` implements the `IChatManager` interface from `@herdctl/core`, which is how FleetManager interacts with the Discord subsystem. It manages the full set of `DiscordConnector` instances across all Discord-enabled agents.

### Lifecycle

The manager follows a three-phase lifecycle:

1. **`initialize()`** -- Iterates through the fleet configuration, finds agents with `chat.discord` configured, reads bot tokens from environment variables, creates a `ChatSessionManager` and `DiscordConnector` for each agent.

2. **`start()`** -- Connects all connectors to the Discord gateway in parallel. Subscribes to `message` and `error` events on each connector. Failures on individual connectors are logged but do not block other connectors from starting.

3. **`stop()`** -- Disconnects all connectors in parallel. Logs active session counts before shutdown. Sessions are already persisted to disk on every update, so they survive restarts without explicit flushing.

### Message Pipeline

When a connector emits a `message` event, the manager's `handleMessage()` method processes it:

1. **Session lookup** -- Checks for an existing session for the channel via `ChatSessionManager`. If found, the session ID is passed to the agent execution for conversation continuity.

2. **File-sender MCP injection** -- If the agent has a working directory, a per-message [file-sender MCP server](#file-sender-mcp) is created and passed to the agent execution.

3. **Streaming responder** -- Creates a `StreamingResponder` (from `@herdctl/chat`) configured with Discord's 2,000-character message limit and a 1,500-character buffer size. Its reply closure drains any files buffered by the file-sender MCP and attaches them to the outgoing message.

4. **Typing indicator and acknowledgement** -- Starts a typing indicator that refreshes every 8 seconds (unless `output.typing_indicator: false`) and reacts to the user's message with `output.acknowledge_emoji` (default 👀; removed when processing finishes).

5. **Prompt preparation** -- For new sessions, recent channel history is prepended via `formatContextForPrompt()`. [Voice messages](#voice-message-transcription) are transcribed and [file attachments](#file-attachments) are downloaded/inlined before the agent is triggered.

6. **Agent execution** -- Calls `FleetManagerContext.trigger()` with the prompt and an `onMessage` streaming callback. Every raw SDK message is first passed through `normalizeDiscordMessage()` (`message-normalizer.ts`), which converts the loose SDK union into typed display events:

   | Normalized event | Behavior |
   |-----------------|----------|
   | `assistant_final` | Records tool-use blocks (for the run card and tool-result pairing), dedups repeated snapshots by message ID, skips intermediate snapshots (`stop_reason: null`), then delivers text. With `assistant_messages: "answers"` (default) only turns without tool-use blocks are sent; with `"all"` every turn is sent. |
   | `assistant_delta` | Only when `assistant_messages: "all"` -- streams text deltas into a single live-edited Discord message (via `replyWithRef`), synced with the final snapshot to avoid duplicates. |
   | `tool_results` | Updates the run-card trace. Only outputs longer than `tool_result_max_length` become a `buildToolResultEmbed()` preview plus a `.txt` file attachment with the full output; shorter outputs appear only in the run-card trace. |
   | `system_status` / `tool_progress` / `auth_status` | Update the run-card status line (e.g., "Compacting context…"); auth errors are sent as standalone error embeds. |
   | `result` | Records per-channel and cumulative usage stats (for `/usage`), finalizes the run card, and optionally sends a `buildResultSummaryEmbed()` when `result_summary: true`. |
   | `error` | Sends a `buildErrorEmbed()` when `errors: true`. |

7. **Fallbacks** -- If no answer turn produced text, the SDK `result` text is sent instead; if nothing at all was sent, a completion or error status embed is posted. Files still buffered by the file-sender MCP are sent as a standalone message.

8. **Session storage** -- After successful execution, stores the returned SDK session ID for future conversation continuity. Failed jobs do not update the session.

### Run Card and Tool Embeds

While a job runs, the manager maintains a single **run card** -- an embed built by `buildRunCardEmbed()` (`embeds.ts`) and updated in place via `replyWithRef` (throttled to one edit per 1.5s). It shows the run status (running/success/error, color-coded), the sequence of tools executed, the latest status line, and a rolling **trace** field of the last few tool invocations and results, each prefixed with a tool-specific emoji from `TOOL_EMOJIS` (in `@herdctl/core`) and an input summary from `getToolInputSummary()`. The run card is controlled by `output.progress_indicator` (default: true).

Individual tool results only get their own embed when the output exceeds `tool_result_max_length` (default: 900 characters). In that case `buildToolResultEmbed()` renders a short preview -- tool emoji and name, input summary, duration, and up to 300 characters of output in a code block -- and the full output is attached as a `.txt` file.

### Output Configuration

Each agent's Discord config includes an `output` section (`DiscordOutputSchema`) that controls what gets displayed:

```yaml
chat:
  discord:
    bot_token_env: MY_TOKEN
    output:
      tool_results: true          # Show tool result embeds for oversized outputs (default: true)
      tool_result_max_length: 900 # Threshold before output becomes embed + .txt file (default: 900, max: 1000)
      system_status: true         # Show system status updates on the run card (default: true)
      result_summary: false       # Show task completion embed (default: false)
      errors: true                # Show error embeds (default: true)
      typing_indicator: true      # Show typing indicator while processing (default: true)
      acknowledge_emoji: "👀"     # Reaction added on receipt; "" to disable (default: "👀")
      assistant_messages: answers # "answers" (final turns without tool use) | "all" (every turn + delta streaming)
      progress_indicator: true    # Show the live-updating run-card embed (default: true)
    guilds:
      - id: "123456789"
        channels:
          - id: "987654321"
            mode: mention
```

## Voice Message Transcription

When a user sends a Discord voice message (an audio recording in a text channel), the connector detects it via the `MessageFlags.IsVoiceMessage` flag and includes the audio attachment URL in the message event metadata. If `voice.enabled` is set, the manager:

1. Downloads the audio attachment (30s timeout).
2. Transcribes it with `transcribeAudio()` (`voice-transcriber.ts`), which posts the buffer to the OpenAI Whisper API (`/v1/audio/transcriptions`) using native `fetch` + `FormData` -- no extra dependencies.
3. Echoes the transcription back to the channel as a grey embed so everyone can read the voice message.
4. Uses `[Voice message transcription]: <text>` as the agent prompt.

If voice is not enabled or the API key env var is missing, the user gets an explanatory reply instead. Configuration lives in `DiscordVoiceSchema`:

```yaml
chat:
  discord:
    voice:
      enabled: true              # default: false
      provider: openai           # only "openai" currently
      api_key_env: OPENAI_API_KEY
      model: whisper-1
      language: en               # optional ISO 639-1 hint
```

## File Attachments

Non-voice attachments (images, PDFs, text/code files) are handled when `attachments.enabled` is set. The connector categorizes each attachment by MIME type (`image`, `pdf`, `text`, or `unsupported`) and passes the list in the message event. The manager's `processAttachments()` then, per attachment (after enforcing `allowed_types`, `max_file_size_mb`, and `max_files_per_message`):

- **Text/code files** are downloaded and inlined directly into the prompt (truncated at 50,000 characters).
- **Images and PDFs** are downloaded to `<working_directory>/<download_dir>/<uuid>/` and referenced in the prompt as paths the agent can open with its Read tool. When the agent runs in Docker, host paths are rewritten to `/workspace` container paths.

The assembled sections are prepended to the user's message as an attachment block. Downloaded files are deleted after the job finishes unless `cleanup_after_processing: false`. Configuration lives in `DiscordAttachmentsSchema`:

```yaml
chat:
  discord:
    attachments:
      enabled: true                      # default: false
      max_file_size_mb: 10               # default: 10
      max_files_per_message: 5           # default: 5
      allowed_types:                     # wildcards supported (defaults shown)
        - "image/*"
        - "application/pdf"
        - "text/*"
      download_dir: ".discord-attachments"  # relative to working_directory
      cleanup_after_processing: true     # default: true
```

## File-Sender MCP

Agents can send files back to Discord through an injected MCP (Model Context Protocol) server. For each message, if the agent has a `working_directory`, the manager creates a `FileSenderContext` and wraps it with `createFileSenderDef()` from `@herdctl/core`, passing the resulting server definition to `FleetManager.trigger()` via `injectedMcpServers`.

Unlike the Slack connector (which uploads immediately), the Discord implementation **buffers** uploaded files: when the agent calls the file-sender tool, the file is queued in memory, and the streaming responder attaches all pending files to the *next answer message* so they appear below the text rather than as standalone messages above it. Any files still buffered when the job ends are sent as a standalone message.

`DiscordConnector.uploadFile()` also exists on the connector API for direct uploads -- it fetches the channel and sends the buffer via discord.js `AttachmentBuilder`.

## CommandManager

The `CommandManager` handles Discord slash command registration and interaction routing. Each agent's bot registers its own set of commands via the Discord REST API.

### Registration

On connector startup (after the `ClientReady` event), the manager builds `SlashCommandBuilder` payloads for all built-in commands and sends them to Discord using the REST API. Registration includes retry logic with exponential backoff (up to 3 attempts) to handle rate limits and transient network failures.

Registration scope is configurable via `command_registration` (`DiscordCommandRegistrationSchema`): the default `scope: global` registers through `Routes.applicationCommands()` (available in every server the bot joins, but slow to propagate), while `scope: guild` with a `guild_id` registers through `Routes.applicationGuildCommands()` (propagates immediately -- useful for development):

```yaml
chat:
  discord:
    command_registration:
      scope: guild        # global (default) | guild
      guild_id: "123456789012345678"  # required when scope: guild
```

### Built-in Commands

Fourteen commands are registered per bot (`getBuiltInCommands()` in `commands/command-manager.ts`):

| Command | Description |
|---------|------------|
| `/help` | Show available commands |
| `/ping` | Quick health check |
| `/config` | Show runtime-relevant agent configuration (runtime, model, permission mode, working directory) |
| `/tools` | Show allowed/denied tools and MCP integration status |
| `/usage` | Show usage stats: last run and cumulative totals (cost, tokens, duration) |
| `/skills` | List discovered skills for this agent |
| `/skill` | Trigger a skill in this channel (skill name has autocomplete) |
| `/status` | Show agent status and session info |
| `/session` | Show current session and run state for this channel |
| `/reset` | Clear conversation context (start fresh session) |
| `/new` | Start a fresh conversation (clear current session) |
| `/stop` | Stop the active run in this channel |
| `/cancel` | Alias for `/stop` |
| `/retry` | Retry the last prompt in this channel |

All commands respond ephemerally (only visible to the user who invoked them). Manager-backed commands (`/stop`, `/cancel`, `/retry`, `/skill`, `/skills`, `/usage`, `/config`, `/tools`, `/session`) call back into `DiscordManager` through a `CommandActions` interface wired up at connector creation; `/skill` and `/skills` use skill discovery that prefers an explicit `chat.discord.skills` list and otherwise scans the agent working directory (`.claude/skills`, `.codex/skills`, `skills`) for `SKILL.md` files. `/retry` and `/skill` re-enter the normal message pipeline via a synthetic message event.

### Interaction Handling

When an `InteractionCreate` event fires, the connector delegates chat-input commands to `CommandManager.handleInteraction()` and autocomplete interactions to `CommandManager.handleAutocomplete()`. The manager looks up the command by name, builds a `CommandContext` (containing the interaction, client, agent name, session manager, connector state, and command actions), and calls the command's `execute()` (or `autocomplete()`) function. Errors are caught and surfaced as user-friendly ephemeral replies.

## MentionHandler

The mention handler provides utilities for detecting bot mentions, stripping them from message text, and building conversation context from channel history.

### Mention Detection

`isBotMentioned()` checks two sources:

1. **Direct user mentions** -- `message.mentions.users.has(botUserId)` checks if the bot is directly `@mentioned`.
2. **Role mentions** -- iterates `message.mentions.roles` and checks if the bot is a member of any mentioned role. This handles the common case where Discord auto-creates a managed role for bots and users mention the role instead of the user directly.

### Mention Stripping

Three functions handle mention removal from message content:

| Function | Behavior |
|----------|----------|
| `stripBotMention()` | Removes `<@botUserId>` and `<@!botUserId>` patterns |
| `stripBotRoleMentions()` | Removes `<@&roleId>` patterns where the bot is a member of that role |
| `stripMentions()` | Convenience wrapper that strips bot mentions or all user mentions |

### Conversation Context Building

`buildConversationContext()` fetches recent message history from the channel and processes it into a `ConversationContext` suitable for Claude:

1. Fetches messages before the trigger message (up to `2 * maxMessages` if user message prioritization is enabled).
2. Processes each message: strips bot mentions, records author info, timestamps, and bot status.
3. Filters out empty messages and optionally bot messages.
4. When `prioritizeUserMessages` is true, selects user messages first and fills remaining slots with bot messages, then re-sorts chronologically.
5. Returns the processed messages, the clean prompt (with mentions stripped), and whether the bot was mentioned.

`formatContextForPrompt()` converts the context into a text format suitable for including in a Claude prompt, with each message labeled with author name and timestamp.

## AutoModeHandler

The auto mode handler resolves channel configuration from Discord's guild/channel hierarchy and determines how each channel should be processed.

### Channel Resolution

`resolveChannelConfig()` takes a channel ID, guild ID, the agent's guild configuration, and DM config, then returns a `ResolvedChannelConfig`:

| Scenario | Resolution |
|----------|-----------|
| **DM (no guild ID)** | Checks if DMs are enabled in config. If enabled, returns the configured `dm.mode` (default: `auto`) with default 10 context messages. |
| **Listed guild channel** | Finds the guild by ID, then the channel within that guild. Returns the channel's configured mode and context message count. |
| **Unlisted channel in a configured guild** | Falls back to the guild's `default_channel_mode` when set (e.g., respond to `@mention`s in any channel of the server); otherwise returns `null` and the message is ignored. |
| **Unknown guild** | Returns `null`, causing the message to be ignored. |

### DM Filtering

DM filtering wraps the shared `@herdctl/chat` utilities (`isDMEnabled`, `getDMMode`, `checkDMUserFilter`). The filtering rules are:

1. If DMs are disabled, all DM messages are rejected.
2. If a blocklist is defined and the user is on it, the message is rejected.
3. If an allowlist is defined, only users on it are allowed.
4. If neither list is defined, all users are allowed.
5. The blocklist takes precedence over the allowlist.

## ErrorHandler

The Discord error handler classifies errors into categories and provides appropriate user-facing messages.

### Error Classification

`classifyError()` examines an error and returns a `ClassifiedError` with category, user message, retry recommendation, and suggested delay:

| Error type | Category | Retryable | User message |
|-----------|----------|-----------|-------------|
| `DISCORD_RATE_LIMITED` | `rate_limit` | Yes (5s) | "I'm receiving too many requests..." |
| `DISCORD_CONNECTION_FAILED`, `DISCORD_GATEWAY_ERROR` | `transient` | Yes (2s) | "I'm having trouble connecting..." |
| `DISCORD_INVALID_TOKEN`, `DISCORD_MISSING_TOKEN` | `configuration` | No | "Sorry, I encountered an error..." |
| `DISCORD_ALREADY_CONNECTED`, `DISCORD_NOT_CONNECTED` | `permanent` | No | "Sorry, I encountered an error..." |
| Session manager errors | `transient` | Yes (1s) | "I'm having trouble with your conversation session..." |
| Network errors (`ECONNRESET`, `ETIMEDOUT`, etc.) | `transient` | Yes (1s) | "I'm having trouble connecting..." |
| Timeout errors | `transient` | Yes (2s) | "The request took too long..." |
| All other errors | `unknown` | No | "Sorry, I encountered an error..." |

### Error Codes

The `DiscordErrorCode` enum defines seven Discord-specific error codes: `CONNECTION_FAILED`, `ALREADY_CONNECTED`, `NOT_CONNECTED`, `INVALID_TOKEN`, `MISSING_TOKEN`, `GATEWAY_ERROR`, and `RATE_LIMITED`. Each error class (`DiscordConnectionError`, `AlreadyConnectedError`, `InvalidTokenError`, `MissingTokenError`) extends the base `DiscordConnectorError` and includes the appropriate code and agent name.

### Retry and ErrorHandler Class

`withRetry()` executes an async operation with exponential backoff, using `classifyError()` to determine whether each failure should be retried. The `ErrorHandler` class wraps classification and logging into a single entry point -- `handleError(error, context)` logs detailed error information (including stack traces) and returns a user-friendly message suitable for sending to Discord. It also tracks error counts by category for monitoring.

## Formatting Utilities

### Typing Indicator

`startTypingIndicator()` sends an initial typing indicator to a channel and sets up a refresh interval (default: 5 seconds). Discord typing indicators expire after approximately 10 seconds, so the refresh keeps the indicator visible while the agent is processing. The function returns a `TypingController` with a `stop()` method.

The connector uses a slightly different approach inline -- it refreshes every 8 seconds and returns a plain stop function rather than a `TypingController` object.

### Message Splitting

`sendSplitMessage()` uses the shared `splitMessage()` from `@herdctl/chat` with Discord's 2,000-character limit. Messages are split at natural boundaries (paragraph breaks, sentence ends, word boundaries) with a configurable delay between sends (default: 500ms from `DEFAULT_MESSAGE_DELAY_MS`).

### Markdown Escaping

`escapeMarkdown()` escapes Discord markdown characters (`*`, `_`, `~`, `` ` ``, `|`, `\`) by prefixing them with backslashes. This prevents user-supplied text from being interpreted as formatting.

## Logging

The `DiscordLogger` class provides per-agent configurable logging with three levels:

| Level | What is logged |
|-------|---------------|
| `minimal` | Errors and warnings only |
| `standard` | Connection events, message counts, session operations, rate limit occurrences (default) |
| `verbose` | All of the above plus debug messages, discord.js debug events |

In verbose mode, sensitive data (message content, prompts, tokens) is automatically redacted in log output using key-based detection. The redactable keys include `content`, `message`, `prompt`, `text`, `body`, `token`, `secret`, and `password`.

The log level is configured per-agent in the YAML configuration:

```yaml
chat:
  discord:
    log_level: verbose  # minimal | standard | verbose
```

## Dynamic Loading

FleetManager does not have a compile-time dependency on `@herdctl/discord`. During initialization, it inspects agent configurations for `chat.discord` entries and dynamically imports the package:

```typescript
if (hasDiscordAgents) {
  const mod = await import("@herdctl/discord");
  const manager = new mod.DiscordManager(this);
  await manager.initialize();
}
```

If `@herdctl/discord` is not installed, FleetManager logs a warning and skips Discord integration. This makes the Discord package an optional dependency -- users who only need the CLI or web dashboard do not need `discord.js` in their dependency tree.

## Configuration Schema

The Discord configuration is defined in `@herdctl/core` using Zod schemas (`AgentChatDiscordSchema` and friends in `packages/core/src/config/schema.ts`). The full agent chat configuration:

```yaml
name: support
description: "Handles support questions"

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN     # Env var containing the bot token
    session_expiry_hours: 24                  # Session timeout (default: 24)
    log_level: standard                       # minimal | standard | verbose
    output:                                   # DiscordOutputSchema
      tool_results: true
      tool_result_max_length: 900
      system_status: true
      result_summary: false
      errors: true
      typing_indicator: true
      acknowledge_emoji: "👀"
      assistant_messages: answers             # answers | all
      progress_indicator: true
    presence:                                 # DiscordPresenceSchema
      activity_type: watching                 # playing | watching | listening | competing
      activity_message: "for support requests"
    dm:                                       # ChatDMSchema
      enabled: true
      mode: auto                              # mention | auto (default: auto)
      allowlist: []
      blocklist: []
    voice:                                    # DiscordVoiceSchema
      enabled: false
      provider: openai
      api_key_env: OPENAI_API_KEY
      model: whisper-1
      language: en
    attachments:                              # DiscordAttachmentsSchema
      enabled: false
      max_file_size_mb: 10
      max_files_per_message: 5
      allowed_types: ["image/*", "application/pdf", "text/*"]
      download_dir: ".discord-attachments"
      cleanup_after_processing: true
    command_registration:                     # DiscordCommandRegistrationSchema
      scope: global                           # global | guild
      # guild_id: "..."                       # required when scope: guild
    skills:                                   # DiscordSkillSchema[] — explicit /skill list
      - name: deploy
        description: "Deploy the app"
    guilds:                                   # DiscordGuildSchema[]
      - id: "123456789012345678"
        default_channel_mode: mention         # optional fallback for unlisted channels
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention
            context_messages: 10
          - id: "111222333444555666"
            name: "#general"
            mode: mention
```

The `bot_token_env` field references an environment variable name, not a token value. At startup, `DiscordManager` reads `process.env[bot_token_env]` and passes the resolved token to the connector.

`DiscordGuildSchema` also accepts a per-guild `dm` block, though the runtime DM path (connector filtering and `resolveChannelConfig()`) currently reads the agent-level `dm` config. The `output` block uses a `prefault` so an omitted `output:` still applies all nested defaults.

## Message Flow

<img src="/diagrams/chat-message-flow.svg" alt="Chat message flow diagram showing user message through platform layer, shared layer, core execution, and reply path" width="100%" />

The end-to-end flow for a Discord message:

1. **User sends message** -- e.g., `@support-bot how do I reset my password?`
2. **discord.js fires `MessageCreate`** -- The connector receives the raw Discord message.
3. **Bot message filter** -- Messages from bots (including self) are discarded.
4. **DM filtering** -- For DMs, allowlist/blocklist is checked.
5. **Channel resolution** -- `resolveChannelConfig()` determines the mode (mention or auto) and context message count, falling back to the guild's `default_channel_mode` for unlisted channels.
6. **Mode check** -- In mention mode, `shouldProcessMessage()` verifies the bot was mentioned. In auto mode, all non-bot messages pass.
7. **Context building and attachment detection** -- `buildConversationContext()` fetches channel history, strips mentions, and produces a `ConversationContext`. The connector also flags voice messages and extracts supported file attachments into the metadata.
8. **Connector emits `message` event** -- Payload includes the clean prompt, context, metadata, reply/replyWithRef functions, typing start function, and reaction functions.
9. **Manager handles message** -- `DiscordManager.handleMessage()` looks up the session, injects the file-sender MCP, creates a `StreamingResponder`, adds the acknowledgement reaction, starts typing, transcribes voice / processes attachments if present, and calls `FleetManager.trigger()`.
10. **Agent executes** -- The [Runner](/architecture/runner/) executes the Claude agent. SDK messages stream back via `onMessage` and are normalized by `normalizeDiscordMessage()`.
11. **Streaming response** -- Answer text is sent incrementally (or delta-streamed into a live-edited message with `assistant_messages: all`); a run-card embed tracks tool activity in place; oversized tool outputs become embed + `.txt` attachments.
12. **Session stored** -- The SDK session ID is persisted for future conversation continuity in this channel.

## Source Code Layout

```text
packages/discord/
  src/
    index.ts                            # Package exports
    discord-connector.ts                # DiscordConnector class
    manager.ts                          # DiscordManager (IChatManager impl), attachment processing
    message-normalizer.ts               # normalizeDiscordMessage(): SDK messages -> display events
    embeds.ts                           # Run card, tool result, result summary, status, error embeds
    voice-transcriber.ts                # transcribeAudio() via OpenAI Whisper API
    mention-handler.ts                  # Mention detection, stripping, context building
    auto-mode-handler.ts                # Channel config resolution, DM filtering
    error-handler.ts                    # Error classification, retry, ErrorHandler class
    errors.ts                           # DiscordConnectorError hierarchy
    logger.ts                           # DiscordLogger with level filtering
    types.ts                            # Connector options, state, event map, reply types
    commands/
      index.ts                          # Command module exports
      command-manager.ts                # CommandManager class, built-in command registry
      types.ts                          # CommandContext, CommandActions, SlashCommand, ICommandManager
      help.ts ping.ts config.ts         # Info commands
      tools.ts usage.ts status.ts       # Inspection commands
      session.ts skills.ts skill.ts     # Session/skill commands
      reset.ts new.ts                   # Session-clearing commands
      stop.ts cancel.ts retry.ts        # Run-control commands
    utils/
      index.ts                          # Utility module exports
      formatting.ts                     # escapeMarkdown, typing indicator, sendSplitMessage
    __tests__/
      attachments.test.ts
      auto-mode-handler.test.ts
      discord-connector.test.ts
      embeds.test.ts
      error-handler.test.ts
      errors.test.ts
      logger.test.ts
      manager.test.ts
      mention-handler.test.ts
      message-normalizer.test.ts
      runtime-parity.test.ts
    commands/__tests__/
      command-manager.test.ts
      extended-commands.test.ts
      help.test.ts
      reset.test.ts
      status.test.ts
    utils/__tests__/
      formatting.test.ts
  package.json
  tsconfig.json
```

## Related Pages

- [Shared Chat Layer](/architecture/chat-infrastructure/) -- Session management, streaming responder, message splitting, and other shared infrastructure
- [Chat Architecture](/architecture/chat-infrastructure/) -- Shared chat infrastructure design
- [System Architecture Overview](/architecture/overview/) -- Package dependency graph and FleetManager orchestration
- [Agent Execution Engine](/architecture/runner/) -- How the Runner executes agents and streams output
- [Discord Setup](/integrations/discord/) -- Discord bot configuration and usage guide
- [Slack Connector](/architecture/slack/) -- Slack counterpart using Bolt and Socket Mode
