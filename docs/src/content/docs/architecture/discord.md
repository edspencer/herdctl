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
| `@herdctl/chat` | `ChatSessionManager`, `StreamingResponder`, message splitting, tool parsing, error utilities |
| `@herdctl/core` | `AgentChatDiscord` config types, `FleetManager`, `IChatManager` interface |

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
| **DiscordConnector** | `discord-connector.ts` | discord.js client lifecycle, gateway intents, event handler registration, message routing |
| **DiscordManager** | `manager.ts` | Multiple connector management, message pipeline, tool embeds, `IChatManager` implementation |
| **CommandManager** | `commands/command-manager.ts` | Slash command registration via Discord REST API, interaction routing |
| **MentionHandler** | `mention-handler.ts` | Bot mention detection via `message.mentions`, role mention handling, conversation context building from channel history |
| **AutoModeHandler** | `auto-mode-handler.ts` | Guild-based channel resolution, DM channel configuration, mode determination |
| **ErrorHandler** | `error-handler.ts` | Error classification (gateway, rate limit, network, timeout), retry with exponential backoff, user-friendly error messages |
| **DiscordLogger** | `logger.ts` | Configurable per-agent log levels (minimal/standard/verbose) with content redaction |
| **Formatting** | `utils/formatting.ts` | `escapeMarkdown()`, typing indicator management, `sendSplitMessage()` |
| **Errors** | `errors.ts` | `DiscordConnectorError` hierarchy with typed error codes |
| **Types** | `types.ts` | Connector options, state, event map, reply payload types |
| **Slash commands** | `commands/help.ts`, `reset.ts`, `status.ts` | Individual `/help`, `/reset`, `/status` command implementations |

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
| `MessageCreate` | Routes to `_handleMessage()` for mention/mode/config resolution |
| `InteractionCreate` | Routes slash commands to `CommandManager` |

### Connector Event Map

The connector emits a typed event map (`DiscordConnectorEventMap`) with the following events:

| Event | Payload | When emitted |
|-------|---------|-------------|
| `ready` | `{ agentName, botUser }` | Connection established and ready |
| `disconnect` | `{ agentName, code, reason }` | Connection lost |
| `error` | `{ agentName, error }` | Client error |
| `reconnecting` | `{ agentName, attempt }` | Auto-reconnect in progress |
| `reconnected` | `{ agentName }` | Successfully reconnected |
| `message` | `{ agentName, prompt, context, metadata, reply, startTyping }` | Processable message received |
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

2. **Streaming responder** -- Creates a `StreamingResponder` (from `@herdctl/chat`) configured with Discord's 2,000-character message limit and a 1,500-character buffer size.

3. **Typing indicator** -- Starts a typing indicator that refreshes every 8 seconds until the agent completes execution.

4. **Agent execution** -- Calls `FleetManagerContext.trigger()` with the prompt and an `onMessage` streaming callback. The callback handles different message types:

   | SDK message type | Behavior |
   |-----------------|----------|
   | `assistant` | Extracts text content via `extractMessageContent()`, sends immediately through the streamer |
   | `user` (tool results) | Builds Discord embeds showing tool name, input summary, duration, and truncated output |
   | `system` | Shows system status embeds (e.g., "Compacting context...") |
   | `result` | Shows task summary embed with duration, turns, cost, and token counts |
   | `error` | Shows error embed with the error message |

5. **Session storage** -- After successful execution, stores the returned SDK session ID for future conversation continuity. Failed jobs do not update the session.

6. **Fallback** -- If no messages were sent during streaming (neither text nor embeds), sends a fallback message indicating completion or error.

### Tool Embeds

The manager builds Discord embeds for tool call results using `buildToolEmbed()`. Each embed includes:

- A title with a tool-specific emoji (from `TOOL_EMOJIS` in `@herdctl/chat`) and the tool name
- A description with the input summary (e.g., the bash command, the file path)
- Inline fields for duration and output size
- A result or error field with truncated output in a code block

Output is truncated to a configurable maximum (default: 900 characters) to stay within Discord's embed field limits.

### Output Configuration

Each agent's Discord config includes an `output` section that controls which message types are displayed:

```yaml
chat:
  discord:
    bot_token_env: MY_TOKEN
    output:
      tool_results: true          # Show tool call embeds (default: true)
      tool_result_max_length: 900 # Max chars for tool output (default: 900)
      system_status: true         # Show system status embeds (default: true)
      result_summary: false       # Show task completion embed (default: false)
      errors: true                # Show error embeds (default: true)
    guilds:
      - id: "123456789"
        channels:
          - id: "987654321"
            mode: mention
```

## CommandManager

The `CommandManager` handles Discord slash command registration and interaction routing. Each agent's bot registers its own set of commands via the Discord REST API.

### Registration

On connector startup (after the `ClientReady` event), the manager builds `SlashCommandBuilder` payloads for all built-in commands and sends them to Discord using the REST API's `Routes.applicationCommands()` endpoint. Registration includes retry logic with exponential backoff (up to 3 attempts) to handle rate limits and transient network failures.

Commands are registered as global application commands (not guild-specific), so they are available in all servers the bot has joined.

### Built-in Commands

| Command | Description | Response type |
|---------|------------|---------------|
| `/help` | Lists available commands and interaction instructions | Ephemeral |
| `/reset` | Clears the conversation session for the current channel | Ephemeral |
| `/status` | Shows agent connection status, bot info, uptime, and session details | Ephemeral |

All commands respond ephemerally (only visible to the user who invoked them).

### Interaction Handling

When an `InteractionCreate` event fires, the connector delegates to `CommandManager.handleInteraction()`. The manager looks up the command by name, builds a `CommandContext` (containing the interaction, client, agent name, session manager, and connector state), and calls the command's `execute()` function. Errors are caught and surfaced as user-friendly ephemeral replies.

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
| **DM (no guild ID)** | Checks if DMs are enabled in config. If enabled, returns auto mode with default 10 context messages. |
| **Guild channel** | Finds the guild by ID, then the channel within that guild. Returns the channel's configured mode and context message count. |
| **Unknown channel** | Returns `null`, causing the message to be ignored. |

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

The Discord configuration is defined in `@herdctl/core` using Zod schemas. The full agent chat configuration:

```yaml
name: support
description: "Handles support questions"

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN     # Env var containing the bot token
    session_expiry_hours: 24                  # Session timeout (default: 24)
    log_level: standard                       # minimal | standard | verbose
    output:
      tool_results: true
      tool_result_max_length: 900
      system_status: true
      result_summary: false
      errors: true
    presence:
      activity_type: watching                 # playing | watching | listening | competing
      activity_message: "for support requests"
    dm:
      enabled: true
      mode: auto
      allowlist: []
      blocklist: []
    guilds:
      - id: "123456789012345678"
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

## Message Flow

<img src="/diagrams/chat-message-flow.svg" alt="Chat message flow diagram showing user message through platform layer, shared layer, core execution, and reply path" width="100%" />

The end-to-end flow for a Discord message:

1. **User sends message** -- e.g., `@support-bot how do I reset my password?`
2. **discord.js fires `MessageCreate`** -- The connector receives the raw Discord message.
3. **Bot message filter** -- Messages from bots (including self) are discarded.
4. **DM filtering** -- For DMs, allowlist/blocklist is checked.
5. **Channel resolution** -- `resolveChannelConfig()` determines the mode (mention or auto) and context message count.
6. **Mode check** -- In mention mode, `shouldProcessMessage()` verifies the bot was mentioned. In auto mode, all non-bot messages pass.
7. **Context building** -- `buildConversationContext()` fetches channel history, strips mentions, and produces a `ConversationContext`.
8. **Connector emits `message` event** -- Payload includes the clean prompt, context, metadata, reply function, and typing start function.
9. **Manager handles message** -- `DiscordManager.handleMessage()` looks up the session, creates a `StreamingResponder`, starts typing, and calls `FleetManager.trigger()`.
10. **Agent executes** -- The [Runner](/architecture/runner/) executes the Claude agent. SDK messages stream back via `onMessage`.
11. **Streaming response** -- Text is sent incrementally; tool results become embeds; system messages become status embeds.
12. **Session stored** -- The SDK session ID is persisted for future conversation continuity in this channel.

## Source Code Layout

```text
packages/discord/
  src/
    index.ts                            # Package exports
    discord-connector.ts                # DiscordConnector class
    manager.ts                          # DiscordManager (IChatManager impl)
    mention-handler.ts                  # Mention detection, stripping, context building
    auto-mode-handler.ts                # Channel config resolution, DM filtering
    error-handler.ts                    # Error classification, retry, ErrorHandler class
    errors.ts                           # DiscordConnectorError hierarchy
    logger.ts                           # DiscordLogger with level filtering
    types.ts                            # Connector options, state, event map, reply types
    commands/
      index.ts                          # Command module exports
      command-manager.ts                # CommandManager class
      types.ts                          # CommandContext, SlashCommand, ICommandManager
      help.ts                           # /help command
      reset.ts                          # /reset command
      status.ts                         # /status command
    utils/
      index.ts                          # Utility module exports
      formatting.ts                     # escapeMarkdown, typing indicator, sendSplitMessage
    __tests__/
      discord-connector.test.ts
      manager.test.ts
      mention-handler.test.ts
      auto-mode-handler.test.ts
      error-handler.test.ts
      errors.test.ts
      logger.test.ts
    commands/__tests__/
      command-manager.test.ts
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
