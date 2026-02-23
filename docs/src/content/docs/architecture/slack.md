---
title: Slack Connector
description: How @herdctl/slack integrates with Slack via Bolt and Socket Mode, providing channel-based agent conversations with a single-app model
---

The `@herdctl/slack` package connects herdctl agents to Slack workspaces using the [Bolt for JavaScript](https://slack.dev/bolt-js/) framework with Socket Mode. It provides channel-based conversation management, prefix commands, mrkdwn formatting, and file upload capabilities. The package is an optional peer dependency of `@herdctl/core` -- FleetManager discovers and loads it at runtime only when agents have Slack configured.

<img src="/diagrams/chat-architecture.svg" alt="Chat architecture diagram showing FleetManager, IChatManager, Discord and Slack managers, connectors, and external APIs" width="100%" />

## Single-App Model

The Slack connector uses a fundamentally different connectivity model than the [Discord connector](/architecture/discord/). Where Discord creates one connector per agent (each with its own bot token), Slack creates **one connector per agent** but all connectors share the same Slack App credentials (one bot token and one app token per workspace). This reflects how Slack apps work: a single Slack App is installed once into a workspace, and channel-to-agent routing is handled via configuration.

| Aspect | Discord | Slack |
|--------|---------|-------|
| Bot tokens | One per agent | Shared per workspace |
| Connectors | One per agent, separate bots | One per agent, same app |
| Channel routing | Guild/channel config per bot | Channel config per agent |
| Connection protocol | Discord Gateway (WebSocket) | Slack Socket Mode (WebSocket) |
| Commands | Slash commands via REST API | Prefix commands (`!help`) |
| Typing indicator | `sendTyping()` on interval | Hourglass emoji reaction |
| Message format | Standard markdown | Slack mrkdwn |
| Max message length | 2,000 characters | 4,000 characters |
| Session key | Channel ID | Channel ID |

### Why Socket Mode

Socket Mode establishes a WebSocket connection from the herdctl process to Slack's servers. This avoids the need for a publicly accessible URL or HTTP endpoint, making deployment simpler -- the herdctl process connects outward to Slack rather than receiving inbound HTTP requests. Bolt manages the WebSocket lifecycle internally, including automatic reconnection. There are no accessible hooks for reconnection events, so the Slack connector does not emit `reconnecting` or `reconnected` events (unlike Discord, which exposes these from the gateway).

## Source Code Layout

```text
packages/slack/
├── package.json                 # @slack/bolt, slackify-markdown, @herdctl/chat, @herdctl/core
├── tsconfig.json
└── src/
    ├── index.ts                 # Public API exports
    ├── types.ts                 # Connector interfaces, event map, state types
    ├── slack-connector.ts       # SlackConnector class (Bolt App, event handlers)
    ├── manager.ts               # SlackManager (IChatManager, message pipeline)
    ├── message-handler.ts       # Mention detection, bot filtering, prompt extraction
    ├── formatting.ts            # markdownToMrkdwn(), escapeMrkdwn(), context attachments
    ├── error-handler.ts         # Slack-specific error classification
    ├── errors.ts                # SlackConnectorError hierarchy
    ├── logger.ts                # SlackLogLevel, logger factory
    ├── commands/
    │   ├── index.ts             # Re-exports
    │   ├── command-handler.ts   # CommandHandler class (prefix routing)
    │   ├── help.ts              # !help command
    │   ├── reset.ts             # !reset command
    │   └── status.ts            # !status command
    └── __tests__/
        ├── slack-connector.test.ts
        ├── command-handler.test.ts
        ├── manager.test.ts
        ├── message-handler.test.ts
        ├── formatting.test.ts
        ├── error-handler.test.ts
        ├── errors.test.ts
        └── logger.test.ts
```

### Package Dependencies

| Dependency | Purpose |
|-----------|---------|
| `@slack/bolt` | Bolt framework for Slack app development (Socket Mode, event handling) |
| `slackify-markdown` | AST-based markdown-to-mrkdwn conversion (Unified/Remark) |
| `@herdctl/chat` | Shared session manager, streaming responder, message splitting, error handling |
| `@herdctl/core` | FleetManager context, config types, logger, file sender MCP |

## SlackConnector

`SlackConnector` is the central class in the package. It extends `EventEmitter`, implements `ISlackConnector`, and manages a single Bolt App instance for one agent. Each Slack-enabled agent gets its own `SlackConnector`, but they share the same bot and app tokens.

### Connection Lifecycle

The `connect()` method performs the following steps in order:

1. **Dynamic Bolt import** -- `@slack/bolt` is imported dynamically so the package compiles without it installed.
2. **App creation** -- A new `App` instance is created with `socketMode: true`, the bot token, and the app token.
3. **Event handler registration** -- `app_mention` and `message` event listeners are attached to the Bolt App.
4. **App start** -- `app.start()` establishes the Socket Mode WebSocket connection.
5. **Bot identity retrieval** -- `auth.test()` resolves the bot's user ID and username.
6. **Presence update** -- Sets bot presence to `auto` (fails silently if `users:write` scope is missing).
7. **Command handler initialization** -- Creates a `CommandHandler` and registers the three built-in commands.
8. **Ready event** -- Emits a typed `ready` event with the bot user information.
9. **Session cleanup** -- Calls `cleanupExpiredSessions()` on the session manager to remove stale sessions from previous runs.

The `disconnect()` method stops the Bolt App, nulls the command handler, and emits a `disconnect` event with message statistics (received, sent, ignored counts).

### Constructor Options

```typescript
interface SlackConnectorOptions {
  agentName: string;                    // Qualified name of the agent
  botToken: string;                     // Slack Bot Token (xoxb-...)
  appToken: string;                     // Slack App Token for Socket Mode (xapp-...)
  channels: SlackChannelConfig[];       // Channels this agent listens to
  dm?: Partial<DMConfig>;               // DM configuration (allowlist, blocklist)
  sessionManager: IChatSessionManager;  // Session persistence (from @herdctl/chat)
  logger?: SlackConnectorLogger;        // Optional logger
}
```

The `channels` array is converted into a `Map<string, SlackChannelConfig>` keyed by channel ID for fast lookup during event routing.

### Connector State

`getState()` returns a snapshot of the connector's current status:

```typescript
interface SlackConnectorState {
  status: SlackConnectionStatus;     // "disconnected" | "connecting" | "connected" | ...
  connectedAt: string | null;        // ISO timestamp
  disconnectedAt: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  botUser: { id: string; username: string } | null;
  messageStats: {
    received: number;
    sent: number;
    ignored: number;
  };
}
```

## SlackManager

`SlackManager` implements the `IChatManager` interface from `@herdctl/core`, which FleetManager uses to manage chat platform integrations through a common lifecycle. It sits in `packages/slack/src/manager.ts` (not in core) and handles:

- Creating one `SlackConnector` per Slack-enabled agent during `initialize()`
- Connecting all connectors during `start()`
- Subscribing to connector events and routing messages through the execution pipeline
- Disconnecting connectors during `stop()`

### Initialization

During `initialize()`, SlackManager iterates all agents in the fleet config, filters for those with `chat.slack` defined, and creates a connector for each:

1. Resolves the bot token and app token from environment variables (`bot_token_env`, `app_token_env`).
2. Creates a `ChatSessionManager` from `@herdctl/chat` parameterized with `platform: "slack"`.
3. Creates a `SlackConnector` with the agent's channel config, DM config, and session manager.
4. Stores the connector in a `Map<string, SlackConnector>` keyed by the agent's qualified name.

If a token is missing, SlackManager logs a warning and skips that agent without failing the entire initialization.

### Message Handling Pipeline

When a connector emits a `message` event, SlackManager's `handleMessage()` processes it through the following pipeline:

1. **Session lookup** -- Checks the session manager for an existing session for this channel. If found, the session ID is passed as the `resume` parameter for conversation continuity.
2. **File sender MCP injection** -- If the agent has a working directory, creates a `FileSenderContext` that wraps `connector.uploadFile()` and injects it as an MCP server definition for the agent to use.
3. **Streaming responder creation** -- Creates a `StreamingResponder` from `@herdctl/chat` configured with Slack's 4,000-character limit and mrkdwn conversion in the reply function.
4. **Processing indicator** -- Calls `startProcessingIndicator()` to add an hourglass emoji reaction to the user's message.
5. **Agent execution** -- Calls `FleetManager.trigger()` with the prompt, resume session ID, injected MCP servers, and an `onMessage` callback that streams responses.
6. **Content extraction** -- The `onMessage` callback uses `extractMessageContent()` from `@herdctl/chat` to parse assistant messages and sends them through the streaming responder.
7. **Tool result display** -- When `outputConfig.tool_results` is enabled, tool use/result pairs are formatted with emoji, input summaries, duration, and truncated output.
8. **Session storage** -- After successful execution, stores the returned session ID for future messages in this channel.
9. **Event emission** -- Emits `slack:message:handled` and `slack:session:lifecycle` events through the FleetManager event bus.

### TriggerOptions.resume Semantics

The `resume` parameter in `TriggerOptions` uses three-state semantics to distinguish between conversation continuity scenarios:

| Value | Meaning | When Used |
|-------|---------|-----------|
| `string` | Resume this specific session ID | Existing session found for channel |
| `null` | Explicitly start fresh (no session) | No existing session; prevent agent-level fallback |
| `undefined` | Use agent-level fallback behavior | CLI and schedule triggers (not chat) |

This distinction exists because `JobControl.trigger()` has a fallback that auto-resumes the agent's last session when `resume` is `undefined`. For Slack, a message in a channel with no session should start fresh -- not inherit a session from a different channel. Passing `null` explicitly prevents this fallback.

## Event Handlers

SlackConnector registers two Bolt event listeners: `app_mention` and `message`. Together they handle all message routing.

### app_mention Handler

Fires when a user @mentions the bot (e.g., `@herdctl-bot what is the status?`). This handler:

1. Checks whether the message is a DM or from a configured channel.
2. For DMs, applies DM access filtering (enabled check, allowlist/blocklist).
3. For channels, verifies the channel is in the connector's channel config.
4. Extracts the prompt by stripping the `<@BOTID>` mention from the message text.
5. Checks for prefix commands (`!help`, `!reset`, `!status`) before treating as a message.
6. Builds a `SlackMessageEvent` and emits it with `wasMentioned: true`.

### message Handler

Fires for all messages in channels the bot has access to (requires `message.channels` event subscription). This handler has a more complex routing flow:

1. **Bot filtering** -- Skips messages from bots (`bot_id` present, `bot_message` subtype) and from the bot itself.
2. **Mention deduplication** -- Skips messages containing `<@BOTID>` because those are already handled by the `app_mention` handler. Without this check, a single @mention would trigger both handlers.
3. **DM routing** -- For DM channels (IDs starting with `D`), applies DM access filtering and mode checking.
4. **Channel config check** -- For regular channels, verifies the channel is configured for this agent.
5. **Channel mode filtering** -- For top-level messages (no `thread_ts`), checks the channel's `mode` setting:
   - `mention` mode (default): Ignores top-level messages without a mention. Only @mentions trigger responses.
   - `auto` mode: Processes all messages in the channel.
   - Thread replies bypass mode filtering entirely -- once a conversation is active, replies always reach the agent.
6. **Prompt extraction and command check** -- Same as the `app_mention` handler.
7. **Message event emission** -- Builds and emits a `SlackMessageEvent` with `wasMentioned: false`.

### Processing Indicator

Instead of Discord's typing indicator (`sendTyping()` called on an interval), Slack uses emoji reactions as a visual processing indicator:

- When a message starts processing, the connector adds an `:hourglass_flowing_sand:` reaction to the user's message.
- When processing completes (or fails), it removes the reaction.
- Reaction failures are silently caught -- they are not critical to message handling.

The `startProcessingIndicator()` method returns a cleanup function, following the same pattern as Discord's typing indicator.

## Type-Safe Event Emitter

SlackConnector overrides the `emit`, `on`, `once`, and `off` methods from Node.js `EventEmitter` with generic type constraints. This provides compile-time checking of event names and payload shapes, matching the pattern used by DiscordConnector.

```typescript
override emit<K extends SlackConnectorEventName>(
  event: K,
  payload: SlackConnectorEventMap[K],
): boolean {
  return super.emit(event, payload);
}
```

### Event Map

The `SlackConnectorEventMap` defines all events the connector emits:

| Event | Payload | When Emitted |
|-------|---------|-------------|
| `ready` | `{ agentName, botUser: { id, username } }` | Connection established and bot identity resolved |
| `disconnect` | `{ agentName, reason }` | Connector disconnected (intentional or error) |
| `error` | `{ agentName, error }` | Connection or runtime error |
| `message` | `SlackMessageEvent` | Processable user message received |
| `messageIgnored` | `{ agentName, reason, channelId, messageTs }` | Message filtered out (bot, unconfigured, empty, DM filtered) |
| `commandExecuted` | `{ agentName, commandName, userId, channelId }` | Prefix command executed successfully |
| `sessionLifecycle` | `{ agentName, event, channelId, sessionId }` | Session created, resumed, expired, or cleared |

The `messageIgnored` event includes a typed `reason` field with values: `not_configured`, `bot_message`, `no_agent_resolved`, `empty_prompt`, `dm_disabled`, `dm_filtered`.

## CommandHandler

The `CommandHandler` class manages prefix commands -- messages starting with `!`. This approach was chosen over Slack slash commands because slash commands require URL verification infrastructure, while prefix commands work immediately with Socket Mode.

### How It Works

1. On `connect()`, the connector creates a `CommandHandler` and registers three built-in commands.
2. Before emitting a `message` event, both the `app_mention` and `message` handlers call `tryExecuteCommand()`.
3. `CommandHandler.isCommand()` checks if the message starts with `!` and matches a registered command name.
4. If matched, `executeCommand()` runs the command with a `CommandContext` containing the session manager, connector state, and a reply function.
5. After execution, the connector emits a `commandExecuted` event.

### Built-in Commands

| Command | Description | Implementation |
|---------|------------|----------------|
| `!help` | Lists available commands and usage instructions | Sends a static mrkdwn-formatted help message |
| `!reset` | Clears the conversation session for the current channel | Calls `sessionManager.clearSession(channelId)` |
| `!status` | Shows agent status, connection info, and session details | Reads `connectorState` and `sessionManager.getSession(channelId)` |

### CommandContext

```typescript
interface CommandContext {
  agentName: string;
  channelId: string;
  userId: string;
  reply: (content: string) => Promise<void>;
  sessionManager: IChatSessionManager;
  connectorState: SlackConnectorState;
}
```

The `reply` function sends responses directly to the channel without `thread_ts`, matching the channel-based conversation model.

## MessageHandler

The `message-handler.ts` module provides stateless utility functions for processing Slack messages. These are used by `SlackConnector` in its event handlers.

| Function | Purpose |
|----------|---------|
| `isBotMentioned(text, botUserId)` | Checks for `<@USERID>` pattern in message text |
| `stripBotMention(text, botUserId)` | Removes `<@USERID>` and trims whitespace |
| `stripMentions(text)` | Removes all `<@...>` patterns |
| `shouldProcessMessage(event, botUserId)` | Returns `false` for bot messages, `bot_message` subtypes, and self-messages |
| `processMessage(text, botUserId)` | Strips bot mention and returns the cleaned prompt |

Slack represents mentions as `<@U1234567890>` in message text (unlike Discord which uses a `message.mentions` API). The mention detection is a simple string inclusion check, and stripping uses a global regex replacement.

## Channel-Based Sessions

Sessions are keyed by `channelId`, meaning each Slack channel has one active conversation session at a time. This matches Discord's per-channel session model and provides consistent behavior across platforms.

### History

The session model was initially thread-based (`threadTs` as the session key), where each Slack thread had its own isolated session. This was refactored to channel-based sessions for several reasons:

- **Consistency with Discord** -- Discord uses channel-based sessions, and maintaining a unified model simplifies the shared chat infrastructure.
- **Simpler routing** -- Channel-based sessions eliminate the need for thread tracking maps and thread recovery logic after restarts.
- **Shared context** -- All messages in a channel contribute to the same conversation context, which is the expected behavior for an agent dedicated to a channel.

### Session State

Sessions are persisted as YAML files by the shared `ChatSessionManager` from `@herdctl/chat`:

**Storage path:** `.herdctl/slack-sessions/<agent-name>.yaml`

```yaml
version: 2
agentName: my-fleet.assistant
channels:
  "C0123456789":
    sessionId: "slack-my-fleet.assistant-a1b2c3d4-..."
    lastMessageAt: "2026-02-20T14:30:00.000Z"
  "C9876543210":
    sessionId: "slack-my-fleet.assistant-e5f6g7h8-..."
    lastMessageAt: "2026-02-20T15:45:00.000Z"
```

The session manager uses atomic writes (temp file + rename) to prevent corruption, and validates state files against a Zod schema on load. Corrupted files are treated as empty state rather than causing a crash. Sessions expire after a configurable number of hours (default: 24), and expired sessions are cleaned up on connector startup.

For more detail on session management, see the [Shared Chat Layer](/architecture/chat-infrastructure/) documentation.

## Formatting

### markdownToMrkdwn Conversion

Slack uses its own text formatting syntax called "mrkdwn" which differs from standard markdown in several ways. Since Claude agents produce standard markdown output, the Slack connector converts it before sending.

The conversion uses `slackify-markdown` (an AST-based library built on Unified/Remark) with post-processing:

```typescript
export function markdownToMrkdwn(text: string): string {
  if (!text) return text;
  return (
    slackifyMarkdown(text)
      .replace(/\u200B/g, "")       // Strip zero-width spaces
      .replace(/^\*\*\*$/gm, "\u2E3B")  // Replace *** horizontal rules
      .trimEnd()
  );
}
```

The post-processing addresses two known issues with `slackify-markdown`:

1. **Zero-width spaces** -- The library inserts `\u200B` around formatting markers to prevent collision. Slack's mrkdwn parser does not handle these, resulting in raw asterisks instead of rendered bold text.
2. **Horizontal rules** -- The library converts `---` to `***`. Slack has no horizontal rule support, so `***` renders as literal asterisks or gets misinterpreted as bold markers. The post-processor replaces it with a two-em dash character.

### Conversion Reference

| Standard Markdown | Slack mrkdwn | Notes |
|-------------------|-------------|-------|
| `**bold**` | `*bold*` | |
| `*italic*` | `_italic_` | |
| `~~strike~~` | `~strike~` | |
| `[text](url)` | `<url\|text>` | |
| `![alt](url)` | `<url\|alt>` | Images become links |
| `# Header` | `*Header*` | All H1-H6 levels |
| `` `code` `` | `` `code` `` | Same in both |
| ` ```block``` ` | ` ```block``` ` | Same in both |
| `> quote` | `> quote` | Same in both |
| `* item` | `\u2022 item` | Bullet conversion |
| `---` | `\u2E3B` | Post-processed |

### Integration Point

The `markdownToMrkdwn()` function is called in two places:

1. **`SlackConnector.buildMessageEvent()`** -- The `reply` closure wraps outbound content with `markdownToMrkdwn()` before passing it to Bolt's `say()`.
2. **`SlackManager.handleMessage()`** -- The `StreamingResponder`'s reply function also applies `markdownToMrkdwn()` to streamed content.

The agent's system prompt instructs it to use standard markdown formatting, since the conversion pipeline handles the translation automatically. This avoids a double-conversion problem where the agent outputs Slack-native `*bold*` and the converter treats it as markdown italic.

### Other Formatting Utilities

| Function | Purpose |
|----------|---------|
| `escapeMrkdwn(text)` | Escapes mrkdwn special characters (`*`, `_`, `~`, `` ` ``, `\|`, `<`, `>`) |
| `createContextAttachment(percent)` | Creates a color-coded footer attachment showing context usage (red below 20%, green above) |

## Error Handling

### Error Hierarchy

The `errors.ts` module defines a typed error hierarchy for Slack-specific failures:

| Error Class | Code | When Thrown |
|------------|------|------------|
| `SlackConnectorError` | (base class) | Base for all Slack errors |
| `SlackConnectionError` | `SLACK_CONNECTION_FAILED` | Bolt App fails to start or Socket Mode connection fails |
| `AlreadyConnectedError` | `SLACK_ALREADY_CONNECTED` | `connect()` called while already connected |
| `MissingTokenError` | `SLACK_MISSING_TOKEN` | Bot or app token environment variable is not set |
| `InvalidTokenError` | `SLACK_INVALID_TOKEN` | Token rejected by Slack API |

The `isSlackConnectorError()` type guard allows callers to discriminate Slack-specific errors from general errors.

### Error Classification

The `error-handler.ts` module provides Slack-specific error classification that builds on the shared `ErrorCategory` system from `@herdctl/chat`. The `classifyError()` function examines error messages for Slack-specific patterns:

| Pattern | Category | Retryable | User Message |
|---------|----------|-----------|-------------|
| `invalid_auth`, `token_revoked`, `not_authed` | AUTH | No | Authentication error |
| `rate_limit`, `ratelimited` | RATE_LIMIT | Yes (5s delay) | Rate limited |
| `econnrefused`, `enotfound`, `timeout` | NETWORK | Yes | Connection error |
| `slack`, `api` | API | Yes | API error |
| (other) | UNKNOWN | No | Unknown error |

The `safeExecuteWithReply()` wrapper catches errors, classifies them, logs the details, and sends a user-friendly message back to the Slack channel.

## File Sender MCP

The Slack connector supports agent-initiated file uploads through an injected MCP (Model Context Protocol) server. When SlackManager processes a message, it creates a `FileSenderContext` that wraps the connector's `uploadFile()` method and injects it as the `herdctl_send_file` MCP tool available to the agent during execution.

### How It Works

1. SlackManager checks if the agent has a `working_directory` configured.
2. If so, it creates a `FileSenderContext` with the working directory path and an `uploadFile` function that delegates to `connector.uploadFile()`.
3. `createFileSenderDef()` from `@herdctl/core` wraps this context into an `InjectedMcpServerDef`.
4. The injected MCP server is passed to `FleetManager.trigger()` via the `injectedMcpServers` option.
5. During execution, the agent can call the `herdctl_send_file` tool to upload files from its working directory to the Slack channel.

### Upload Mechanism

`SlackConnector.uploadFile()` uses Slack's `files.uploadV2()` API:

```typescript
async uploadFile(params: SlackFileUploadParams): Promise<{ fileId: string }> {
  const response = await this.app.client.files.uploadV2({
    channel_id: params.channelId,
    file: params.fileBuffer,
    filename: params.filename,
    initial_comment: params.message ?? "",
  });
  return { fileId: response.files?.[0]?.id ?? "unknown" };
}
```

Files are uploaded to the same channel as the conversation. The `SlackFileUploadParams` interface accepts a `Buffer`, filename, channel ID, and optional message.

## Configuration

### Agent YAML

Each agent that uses Slack includes a `chat.slack` section in its configuration:

```yaml
name: assistant
description: Development assistant with Slack integration

chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN     # Environment variable for xoxb-... token
    app_token_env: SLACK_APP_TOKEN     # Environment variable for xapp-... token
    session_expiry_hours: 24           # Session timeout (default: 24)
    log_level: standard                # minimal | standard | verbose
    channels:
      - id: "C0123456789"
        name: "#dev-support"           # Optional, for documentation
        mode: mention                  # mention (default) | auto
        context_messages: 10           # Future use (default: 10)
    dm:                                # Optional DM configuration
      enabled: true
      mode: auto
      allowlist: ["U111", "U222"]
    output:                            # Optional output configuration
      tool_results: true
      tool_result_max_length: 900
      system_status: true
      errors: true
```

### Config Schema (Zod)

The configuration is validated by Zod schemas in `@herdctl/core`:

```typescript
const SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().int().positive().default(10),
});

const AgentChatSlackSchema = z.object({
  bot_token_env: z.string().default("SLACK_BOT_TOKEN"),
  app_token_env: z.string().default("SLACK_APP_TOKEN"),
  session_expiry_hours: z.number().int().positive().default(24),
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  channels: z.array(SlackChannelSchema),
  dm: ChatDMSchema.optional(),
  output: ChatOutputSchema.optional(),
});
```

### Channel Modes

Each channel has a `mode` setting that controls when the bot responds to messages:

- **`mention` (default)** -- The bot only responds when explicitly @mentioned. Top-level messages without a mention are ignored. Thread replies are always processed regardless of mode.
- **`auto`** -- The bot responds to all messages in the channel, whether or not it is mentioned.

The `app_mention` event handler always processes mentions regardless of the channel mode. The mode filtering only applies to the `message` event handler for top-level (non-thread) messages.

### Required Slack App Configuration

The Slack App must be configured with the following scopes and event subscriptions:

**Bot Token Scopes:**
- `app_mentions:read` -- Receive @mention events
- `chat:write` -- Send messages
- `channels:history` -- Read channel message history
- `reactions:write` -- Add/remove emoji reactions (processing indicator)
- `files:write` -- Upload files

**Event Subscriptions (Bot Events):**
- `app_mention` -- Triggers when the bot is @mentioned
- `message.channels` -- Triggers for messages in channels the bot is a member of

**Socket Mode** must be enabled, and an App-Level Token with `connections:write` scope is required for the WebSocket connection.

## Dynamic Loading

FleetManager discovers and loads `@herdctl/slack` at runtime without any compile-time dependency. This is the same pattern used for Discord and all other platform connectors.

During `FleetManager.initializeChatManagers()`:

1. FleetManager checks if any agents have `chat.slack` configured.
2. If yes, it dynamically imports the package: `await import("@herdctl/slack" as string)`.
3. The `as string` cast prevents TypeScript from resolving types at compile time, allowing core to build without the Slack package installed.
4. If the import succeeds, it instantiates `new SlackManager(this)` and registers it in the `chatManagers` map under the `"slack"` key.
5. If the import fails (package not installed), FleetManager logs a warning and continues without Slack support.

```typescript
// In FleetManager.initializeChatManagers()
if (hasSlackAgents) {
  try {
    const mod = (await import("@herdctl/slack" as string)) as unknown as {
      SlackManager: new (ctx: FleetManagerContext) => IChatManager;
    };
    const manager = new mod.SlackManager(this);
    this.chatManagers.set("slack", manager);
  } catch {
    this.logger.warn(
      "@herdctl/slack not installed, skipping Slack integration"
    );
  }
}
```

This means `@herdctl/slack` is an optional peer dependency. Users who only need Discord support do not need to install Bolt or any Slack dependencies.

## Message Flow

<img src="/diagrams/chat-message-flow.svg" alt="Chat message flow diagram showing user message through platform layer, shared layer, core execution, and reply path" width="100%" />

A complete message flow for a Slack @mention:

1. User sends `@herdctl-bot what tests are failing?` in channel `#dev-support`.
2. Slack delivers an `app_mention` event via Socket Mode.
3. `SlackConnector` receives the event, verifies the channel is configured, strips the mention, and extracts the prompt: `what tests are failing?`.
4. Connector adds an `:hourglass_flowing_sand:` reaction to the message.
5. Connector builds a `SlackMessageEvent` and emits it.
6. `SlackManager.handleMessage()` receives the event.
7. Session manager looks up `C0123456789` and finds an existing session ID.
8. Manager creates a `StreamingResponder` and calls `FleetManager.trigger()` with the prompt, session ID, and `onMessage` callback.
9. As the agent produces output, the callback extracts text and sends it through the streamer, which applies `markdownToMrkdwn()` and calls Bolt's `say()`.
10. After execution completes, the manager stores the updated session ID, removes the hourglass reaction, and emits tracking events.

## Related Pages

- [Shared Chat Layer](/architecture/chat-infrastructure/) -- Session management, streaming responder, message splitting, and other shared infrastructure
- [Discord Connector](/architecture/discord/) -- Per-agent bot model, slash commands, discord.js integration
- [System Architecture Overview](/architecture/overview/) -- Package dependency graph and FleetManager orchestration
- [Agent Execution Engine](/architecture/runner/) -- How the Runner executes agents and streams output
- [Sessions](/concepts/sessions/) -- How conversation context works from a user perspective
- [Slack Setup](/integrations/slack/) -- Slack app configuration and usage guide
