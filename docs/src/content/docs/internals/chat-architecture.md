---
title: Chat Architecture
description: How @herdctl/chat provides shared infrastructure for Discord and Slack connectors
---

This page describes the internal architecture of herdctl's chat integration layer -- how the `@herdctl/chat` package provides shared infrastructure that both `@herdctl/discord` and `@herdctl/slack` build on. If you are building a new chat connector or contributing to the existing ones, start here.

## Architecture Overview

The chat system follows a **shared abstraction** pattern. Common logic lives in `@herdctl/chat`, platform connectors implement the platform-specific parts, and `@herdctl/core` orchestrates everything through a minimal interface.

```mermaid
flowchart TD
  FM["FleetManager
  @herdctl/core"]

  ICM["IChatManager Interface
  initialize · start · stop
  getState · getConnectedCount"]

  CHAT["@herdctl/chat
  Shared Chat Infrastructure"]

  DM["DiscordManager
  @herdctl/discord"]
  SM["SlackManager
  @herdctl/slack"]

  DC["DiscordConnector
  discord.js · Gateway · Slash Commands"]
  SC["SlackConnector
  Bolt · Socket Mode · Prefix Commands"]

  DAPI(["Discord API"])
  SAPI(["Slack API"])

  AGENT["Claude Agent
  via FleetManager.trigger()"]

  FM -->|"dynamic import"| ICM
  ICM --- DM
  ICM --- SM

  DM -->|"imports shared utilities"| CHAT
  SM -->|"imports shared utilities"| CHAT

  DM --> DC
  SM --> SC

  DC --> DAPI
  SC --> SAPI

  DM -->|"trigger()"| AGENT
  SM -->|"trigger()"| AGENT

  style FM fill:#4f46e5,color:#fff,stroke:#3730a3
  style ICM fill:#7c3aed,color:#fff,stroke:#6d28d9
  style CHAT fill:#1e40af,color:#fff,stroke:#1e3a8a
  style DM fill:#7c3aed,color:#fff,stroke:#6d28d9
  style SM fill:#7c3aed,color:#fff,stroke:#6d28d9
  style DC fill:#059669,color:#fff,stroke:#047857
  style SC fill:#059669,color:#fff,stroke:#047857
  style DAPI fill:#d97706,color:#fff,stroke:#b45309
  style SAPI fill:#d97706,color:#fff,stroke:#b45309
  style AGENT fill:#64748b,color:#fff,stroke:#475569
```

## Package Dependency Graph

The dependency flow is strictly one-directional. Platform packages depend on the shared chat package, which depends on core. Core never depends on any chat package -- it discovers managers at runtime via dynamic imports.

```mermaid
flowchart LR
  CORE["@herdctl/core"]
  CHAT["@herdctl/chat"]
  DISCORD["@herdctl/discord"]
  SLACK["@herdctl/slack"]
  DJS(["discord.js"])
  BOLT(["@slack/bolt"])

  DISCORD --> CHAT
  DISCORD --> CORE
  DISCORD --> DJS

  SLACK --> CHAT
  SLACK --> CORE
  SLACK --> BOLT

  CHAT --> CORE

  style CORE fill:#4f46e5,color:#fff,stroke:#3730a3
  style CHAT fill:#1e40af,color:#fff,stroke:#1e3a8a
  style DISCORD fill:#059669,color:#fff,stroke:#047857
  style SLACK fill:#059669,color:#fff,stroke:#047857
  style DJS fill:#d97706,color:#fff,stroke:#b45309
  style BOLT fill:#d97706,color:#fff,stroke:#b45309
```

## What Lives Where

### `@herdctl/chat` -- Shared Infrastructure

The chat package contains everything that was duplicated between Discord and Slack (roughly 70-80% of the code). No platform-specific SDK imports live here.

```mermaid
flowchart TD
  CHAT["@herdctl/chat"]

  subgraph types ["Shared Types & Interfaces"]
    IChatConnector["IChatConnector
    connect · disconnect · isConnected · getState"]
    IChatSession["IChatSessionManager
    getOrCreateSession · touchSession · clearSession"]
    ChatEvent["ChatConnectorEventMap
    ready · disconnect · error · message
    messageIgnored · commandExecuted · sessionLifecycle"]
    ChatMsg["ChatMessageEvent
    agentName · prompt · metadata
    reply() · startProcessingIndicator()"]
  end

  subgraph utilities ["Shared Utilities"]
    SessionMgr["ChatSessionManager
    Per-channel session persistence
    YAML state files · Expiry · Cleanup"]
    Streaming["StreamingResponder
    Message buffering · Rate limiting
    Auto-splitting for platform limits"]
    Splitting["Message Splitting
    findSplitPoint · splitMessage
    Paragraph/sentence/word boundaries"]
    Extract["Message Extraction
    extractMessageContent
    Claude SDK message parsing"]
    ToolParse["Tool Parsing
    extractToolUseBlocks · extractToolResults
    Tool input summaries · Emoji mapping"]
  end

  subgraph safety ["Error Handling & Filtering"]
    Errors["ChatConnectorError Hierarchy
    ConnectionError · AlreadyConnectedError
    InvalidTokenError · MissingTokenError"]
    ErrHandler["Error Handler
    withRetry · safeExecute · ErrorCategory
    Exponential backoff · Classification"]
    DMFilter["DM Filtering
    Allowlist/blocklist · Mode detection
    shouldProcessInMode"]
  end

  subgraph formatting ["Formatting"]
    StatusFmt["Status Formatting
    formatTimestamp · formatDuration
    getStatusEmoji · formatCost"]
  end

  CHAT --> types
  CHAT --> utilities
  CHAT --> safety
  CHAT --> formatting

  style CHAT fill:#1e40af,color:#fff,stroke:#1e3a8a
  style types fill:#7c3aed,color:#fff,stroke:#6d28d9
  style utilities fill:#7c3aed,color:#fff,stroke:#6d28d9
  style safety fill:#7c3aed,color:#fff,stroke:#6d28d9
  style formatting fill:#7c3aed,color:#fff,stroke:#6d28d9
  style IChatConnector fill:#059669,color:#fff,stroke:#047857
  style IChatSession fill:#059669,color:#fff,stroke:#047857
  style ChatEvent fill:#059669,color:#fff,stroke:#047857
  style ChatMsg fill:#059669,color:#fff,stroke:#047857
  style SessionMgr fill:#059669,color:#fff,stroke:#047857
  style Streaming fill:#059669,color:#fff,stroke:#047857
  style Splitting fill:#059669,color:#fff,stroke:#047857
  style Extract fill:#059669,color:#fff,stroke:#047857
  style ToolParse fill:#059669,color:#fff,stroke:#047857
  style Errors fill:#059669,color:#fff,stroke:#047857
  style ErrHandler fill:#059669,color:#fff,stroke:#047857
  style DMFilter fill:#059669,color:#fff,stroke:#047857
  style StatusFmt fill:#059669,color:#fff,stroke:#047857
```

### `@herdctl/discord` -- Platform-Specific

The Discord package keeps only what requires discord.js or is unique to Discord's interaction model:

| Component | Purpose |
|-----------|---------|
| **DiscordConnector** | discord.js client, gateway intents, event handler registration |
| **DiscordManager** | Manages multiple connectors, handles message pipeline with tool embeds |
| **CommandManager** | Slash command registration via Discord REST API (`/help`, `/reset`, `/status`) |
| **MentionHandler** | Discord-specific mention detection (`message.mentions`), conversation context building from channel history |
| **AutoModeHandler** | Guild-based channel resolution, DM channel config |
| **ErrorHandler** | Discord-specific error classification (gateway errors, REST rate limits) |
| **Formatting** | `escapeMarkdown()`, typing indicator management |

### `@herdctl/slack` -- Platform-Specific

The Slack package keeps only what requires `@slack/bolt` or is unique to Slack:

| Component | Purpose |
|-----------|---------|
| **SlackConnector** | Bolt App, Socket Mode connection, event handler registration |
| **SlackManager** | Manages connectors, handles message pipeline with file sender MCP |
| **CommandHandler** | Prefix command detection and routing (`!help`, `!reset`, `!status`) |
| **MessageHandler** | Slack-specific mention detection (`<@USERID>` patterns) |
| **ErrorHandler** | Slack-specific error classification (Socket Mode, API errors) |
| **Formatting** | `markdownToMrkdwn()` conversion, `escapeMrkdwn()`, context attachments |

## Message Flow

When a user sends a message in Discord or Slack, it flows through the same pipeline -- with platform-specific entry and exit points but shared processing in between.

```mermaid
flowchart TD
  USER(["User sends message
  in Discord or Slack"])

  subgraph platform ["Platform Layer"]
    CONN["Platform Connector
    Receives raw platform event"]
    MENTION["Mention Detection
    Discord: message.mentions
    Slack: text pattern matching"]
    STRIP["Strip Bot Mention
    Extract clean prompt text"]
    INDICATOR["Start Processing Indicator
    Discord: typing indicator
    Slack: hourglass reaction"]
  end

  subgraph shared ["Shared Layer (@herdctl/chat)"]
    SESSION["Session Manager
    getOrCreateSession(channelId)
    Resume or create new session"]
    STREAM["Streaming Responder
    Buffer content · Rate limit
    Split for platform max length"]
    EXTRACT["Extract Message Content
    Parse Claude SDK response blocks
    Join text content"]
    TOOLS["Tool Parsing
    Extract tool_use and tool_result
    Build human-readable summaries"]
  end

  subgraph core ["Core Layer (@herdctl/core)"]
    TRIGGER["FleetManager.trigger()
    Execute agent with prompt
    Stream SDK messages back"]
  end

  subgraph reply ["Reply Path"]
    FORMAT["Platform Formatting
    Discord: embeds + markdown
    Slack: mrkdwn + threads"]
    SEND(["Send to User
    Split messages if needed"])
  end

  USER --> CONN
  CONN --> MENTION
  MENTION --> STRIP
  STRIP --> INDICATOR

  INDICATOR --> SESSION
  SESSION --> TRIGGER

  TRIGGER -->|"SDK messages"| EXTRACT
  TRIGGER -->|"tool events"| TOOLS
  EXTRACT --> STREAM
  TOOLS --> FORMAT
  STREAM --> FORMAT
  FORMAT --> SEND

  style USER fill:#64748b,color:#fff,stroke:#475569
  style platform fill:#059669,color:#fff,stroke:#047857
  style shared fill:#1e40af,color:#fff,stroke:#1e3a8a
  style core fill:#4f46e5,color:#fff,stroke:#3730a3
  style reply fill:#7c3aed,color:#fff,stroke:#6d28d9
  style CONN fill:#059669,color:#fff,stroke:#047857
  style MENTION fill:#059669,color:#fff,stroke:#047857
  style STRIP fill:#059669,color:#fff,stroke:#047857
  style INDICATOR fill:#059669,color:#fff,stroke:#047857
  style SESSION fill:#1e40af,color:#fff,stroke:#1e3a8a
  style STREAM fill:#1e40af,color:#fff,stroke:#1e3a8a
  style EXTRACT fill:#1e40af,color:#fff,stroke:#1e3a8a
  style TOOLS fill:#1e40af,color:#fff,stroke:#1e3a8a
  style TRIGGER fill:#4f46e5,color:#fff,stroke:#3730a3
  style FORMAT fill:#7c3aed,color:#fff,stroke:#6d28d9
  style SEND fill:#64748b,color:#fff,stroke:#475569
```

### Step-by-Step

1. **Message received** -- The platform connector (DiscordConnector or SlackConnector) receives a raw event from the chat platform's WebSocket connection.

2. **Mention detection** -- Platform-specific logic determines if the bot was mentioned. Discord uses the `message.mentions` API; Slack checks for `<@USERID>` text patterns.

3. **Prompt extraction** -- The bot mention is stripped from the message text, producing a clean prompt.

4. **Processing indicator** -- The platform starts showing activity: Discord sends a typing indicator, Slack adds an hourglass emoji reaction.

5. **Session lookup** -- The shared `ChatSessionManager` looks up or creates a session for this channel. Sessions are stored as YAML files in `.herdctl/<platform>-sessions/` and expire after a configurable number of hours (default: 24).

6. **Agent execution** -- The manager calls `FleetManager.trigger()` with the prompt and session context. The Runner executes the Claude agent and streams SDK messages back.

7. **Content extraction** -- The shared `extractMessageContent()` function parses assistant messages from the Claude SDK, handling both direct string content and arrays of content blocks.

8. **Streaming response** -- The shared `StreamingResponder` buffers content, respects rate limits between sends, and automatically splits messages that exceed platform character limits (2,000 for Discord, 4,000 for Slack).

9. **Platform formatting** -- The reply is formatted for the target platform: Discord uses embeds and markdown; Slack converts to mrkdwn and posts in threads.

10. **Delivery** -- The formatted message is sent back to the user in the same channel or thread.

## Session Management

The `ChatSessionManager` is the strongest shared abstraction -- the Discord and Slack implementations were 95%+ identical before extraction. It is parameterized by platform name, which determines storage paths and session ID prefixes.

| Aspect | Discord | Slack |
|--------|---------|-------|
| Storage path | `.herdctl/discord-sessions/<agent>.yaml` | `.herdctl/slack-sessions/<agent>.yaml` |
| Session ID format | `discord-<agent>-<uuid>` | `slack-<agent>-<uuid>` |
| Expiry default | 24 hours | 24 hours |

Session state is persisted as YAML with atomic writes (write to temp file, then rename) for crash safety. The session manager handles creation, expiry checking, cleanup of stale sessions, and active session counting.

## Dynamic Loading

FleetManager does not have a hard dependency on any chat package. Instead, it discovers which platforms are configured by inspecting agent configs, then dynamically imports the matching package:

```typescript
// Simplified from FleetManager initialization
if (hasDiscordAgents) {
  const mod = await import("@herdctl/discord");
  const manager = new mod.DiscordManager(this);
  await manager.initialize();
}

if (hasSlackAgents) {
  const mod = await import("@herdctl/slack");
  const manager = new mod.SlackManager(this);
  await manager.initialize();
}
```

This means `@herdctl/discord` and `@herdctl/slack` are optional peer dependencies. If a user only needs Slack support, they do not need discord.js installed, and vice versa. The `IChatManager` interface in core defines the contract that both managers satisfy.

## Key Design Decisions

### Composition Over Inheritance

The platform managers use **composition** rather than a base class. Each manager imports and assembles shared utilities (`StreamingResponder`, `extractMessageContent`, message splitting, etc.) explicitly. This was chosen because the Discord and Slack pipelines differ enough -- Discord has tool embed support and rich presence; Slack has file sender MCP integration and mrkdwn conversion -- that a base class would need many template method hooks, making the code harder to follow than explicit composition.

### Platform Connectors Own Platform Code

All platform SDK interactions stay in the platform packages. The shared chat package never imports `discord.js` or `@slack/bolt`. This ensures that:

- Adding a new platform does not affect existing ones
- Platform SDK version upgrades are isolated
- The shared package has minimal dependencies (just `@herdctl/core`, `yaml`, `zod`)

### Session Manager is Parameterized, Not Subclassed

Rather than having `DiscordSessionManager extends ChatSessionManager`, both platforms use `ChatSessionManager` directly with a `platform` parameter. The only differences (storage path, session ID prefix) are handled by string interpolation, not inheritance.

## Related Pages

- [Core Architecture](/internals/architecture/) -- How FleetManager orchestrates all modules
- [Discord Integration](/integrations/discord/) -- Discord setup, configuration, and usage
- [Slack Integration](/integrations/slack/) -- Slack setup, configuration, and usage
- [Sessions](/concepts/sessions/) -- How conversation context works from a user perspective
