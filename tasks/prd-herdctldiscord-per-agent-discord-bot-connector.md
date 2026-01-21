# PRD: @herdctl/discord - Per-Agent Discord Bot Connector

## Overview

`@herdctl/discord` is a Discord connector package for herdctl that enables each agent to have its own Discord bot presence. Unlike traditional bot architectures with a single bot routing messages, each chat-enabled agent connects to Discord as an independent bot with its own identity, avatar, and presence.

## Goals

1. Enable natural Discord interactions where users @mention specific agents
2. Maintain conversation context through per-agent session management
3. Provide a simple, well-documented setup process for creating Discord bots
4. Integrate seamlessly with FleetManager's agent lifecycle

## Non-Goals

- Voice channel support
- Thread support (future enhancement)
- Reaction/emoji responses
- Automated Discord Application creation
- Fleet-level bot or message routing between agents
- Web dashboard for Discord management

## Architecture

### Per-Agent Bot Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Server                            │
│                                                              │
│  Members:                                                    │
│  ├─ @alice (human)                                          │
│  ├─ @bob (human)                                            │
│  ├─ @bragdoc-support (bot) ← Agent: support                 │
│  ├─ @bragdoc-marketer (bot) ← Agent: marketer               │
│  └─ @turtle-writer (bot) ← Agent: turtle-content            │
│                                                              │
│  Each bot has its own avatar, status, and presence          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       FleetManager                           │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │   Agent: support    │  │   Agent: marketer   │          │
│  │                     │  │                     │          │
│  │  ┌───────────────┐  │  │  ┌───────────────┐  │          │
│  │  │DiscordConnect│  │  │  │DiscordConnect│  │          │
│  │  │ (own token)   │  │  │  │ (own token)   │  │          │
│  │  └───────────────┘  │  │  └───────────────┘  │          │
│  │                     │  │                     │          │
│  │  SessionManager     │  │  SessionManager     │          │
│  └─────────────────────┘  └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

```
packages/discord/
├── src/
│   ├── index.ts              # Package exports
│   ├── connector.ts          # DiscordConnector class
│   ├── session-manager.ts    # Per-agent session management
│   ├── message-handler.ts    # Message event handler
│   ├── commands/
│   │   ├── index.ts          # Command registration
│   │   ├── help.ts           # /help command
│   │   ├── reset.ts          # /reset command
│   │   └── status.ts         # /status command
│   └── utils/
│       ├── discord.ts        # Discord utilities
│       └── formatting.ts     # Message formatting
├── __tests__/
│   ├── connector.test.ts
│   ├── session-manager.test.ts
│   └── commands.test.ts
├── package.json
└── tsconfig.json
```

## User Stories

### US-1: Discord Connector Class
**As a** developer using herdctl
**I want** a DiscordConnector class that connects an agent to Discord
**So that** each agent can have its own Discord bot presence

**Acceptance Criteria:**
- DiscordConnector class accepts agent config, bot token, and FleetManager reference
- Uses discord.js v14 to connect to Discord gateway
- Handles connection events (ready, disconnect, error, reconnect)
- Auto-reconnects with exponential backoff on connection loss (discord.js default)
- Graceful shutdown on stop signal
- One instance per agent (not shared)

**Class Interface:**
```typescript
export class DiscordConnector {
  constructor(
    private agent: Agent,
    private token: string,
    private fleetManager: FleetManager
  ) {}

  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  isConnected(): boolean;
}
```

---

### US-2: Agent Chat Configuration
**As a** developer configuring agents
**I want** to specify Discord settings per-agent
**So that** each agent has its own bot identity

**Acceptance Criteria:**
- Add `AgentChatDiscordSchema` to core config validation
- Bot token comes from environment variable (never in config file)
- Guilds/channels define where this bot participates
- Mode determines response behavior (mention vs auto)
- Session expiry is configurable per-agent (default 24 hours)
- Bot presence/status is configurable per-agent
- Log level is configurable per-agent

**Configuration Schema:**
```yaml
# agents/support.yaml
name: support
description: "Handles support questions"

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN
    session_expiry_hours: 24  # Optional, default 24
    log_level: standard       # Optional: minimal | standard | verbose
    presence:                 # Optional
      activity_type: watching # playing | watching | listening | competing
      activity_message: "for support requests"
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention
            context_messages: 10  # Optional, default 10
          - id: "111222333444555666"
            name: "#general"
            mode: mention
        dm:
          enabled: true
          mode: auto
          allowlist: []        # Optional: user IDs that can DM
          blocklist: []        # Optional: user IDs to ignore
```

---

### US-3: Mention Mode (Group Channels)
**As a** Discord server admin
**I want** the bot to only respond when @mentioned
**So that** it doesn't interrupt normal conversations

**Acceptance Criteria:**
- Check if bot is mentioned in message
- If not mentioned and mode is "mention", ignore message
- When mentioned, strip the mention from prompt before sending to Claude
- Read recent message history for context (configurable, default 10 messages)
- Include all messages but prioritize user's messages in context
- Respond in the same channel

**Behavior Example:**
```
User: @bragdoc-support what's the status of issue #123?
Bot: Let me check... [Claude response]
```

---

### US-4: Auto Mode (DMs and Dedicated Channels)
**As a** Discord user
**I want** the bot to respond to all my DMs
**So that** I don't have to @mention it every time

**Acceptance Criteria:**
- DMs default to auto mode
- Channels can be configured as auto mode
- No mention required in auto mode
- Full conversation context maintained
- DM allowlist/blocklist filtering supported

---

### US-5: Per-Channel Session Management
**As a** user chatting with an agent
**I want** my conversation context preserved
**So that** the agent remembers what we discussed

**Acceptance Criteria:**
- SessionManager class created per-agent (not shared)
- Store session ID per channel/DM
- Resume existing session when user sends message
- Persist session mappings to `.herdctl/discord-sessions/<agent-name>.yaml`
- Sessions expire based on configurable timeout (default 24 hours of inactivity)
- Cleanup expired sessions on connector startup
- Handle session expiry gracefully (create new if expired)

**State Structure:**
```yaml
# .herdctl/discord-sessions/support.yaml
sessions:
  "guild:123456789:channel:987654321":
    sessionId: "session-abc123"
    lastMessageAt: "2024-01-15T10:30:00Z"
  "dm:user:111222333":
    sessionId: "session-def456"
    lastMessageAt: "2024-01-15T11:00:00Z"
```

---

### US-6: Slash Commands
**As a** Discord user
**I want** slash commands to control the bot
**So that** I can reset context or check status

**Commands:**
- `/help` - Show available commands
- `/reset` - Clear conversation context (start fresh session)
- `/status` - Show agent status and session info

**Acceptance Criteria:**
- Register slash commands with Discord (per-bot, not global)
- Handle command interactions
- Respond ephemerally (only visible to user) for status/help
- Confirm reset action
- Commands are registered per-bot (each agent's bot has its own commands)

---

### US-7: Response Streaming & Formatting
**As a** Discord user
**I want** to see the bot "typing" while it thinks
**So that** I know it's processing my message

**Acceptance Criteria:**
- Send typing indicator while Claude is processing
- Handle Discord message length limit (2000 chars)
- Split long responses into multiple messages with brief delay between each
- Maintain message coherence when splitting (don't break mid-sentence if possible)

---

### US-8: Rate Limit Handling
**As a** developer
**I want** the connector to handle Discord rate limits gracefully
**So that** messages aren't lost and the system remains stable

**Acceptance Criteria:**
- Let discord.js handle rate limits automatically (queue and retry)
- Emit events when rate limited so FleetManager can track status
- Log rate limit occurrences at standard log level

---

### US-9: Error Handling
**As a** Discord user
**I want** friendly error messages
**So that** I know when something goes wrong

**Acceptance Criteria:**
- Catch and handle common errors
- User-friendly error messages (not stack traces)
- Log detailed errors for debugging
- Retry transient failures (rate limits, network)

**Error Responses:**
```
"Sorry, I encountered an error processing your request. Please try again."
"I'm having trouble connecting right now. Please try again in a moment."
```

---

### US-10: Logging & Observability
**As a** developer operating herdctl
**I want** configurable logging for Discord connectors
**So that** I can debug issues without excessive noise

**Log Levels:**
- `minimal` - Only errors and critical state changes
- `standard` - Connection events, message counts, session operations (default)
- `verbose` - All messages logged with content redaction option

**Acceptance Criteria:**
- Log level configurable per-agent in config
- Standard level logs: connect/disconnect, message received/sent counts, session create/resume/expire
- Emit events for FleetManager to consume (rate limits, errors, connection state)

---

### US-11: Documentation
**As a** user setting up Discord integration
**I want** clear documentation
**So that** I can configure everything correctly

**Documentation Location:** `docs/src/content/docs/integrations/discord.mdx`

**Sections:**
1. **Overview** - Per-agent bot architecture explanation
2. **Prerequisites** - Discord account, server admin permissions
3. **Creating a Discord Application** - Step-by-step Developer Portal guide
4. **Bot Permissions & Intents** - Required intents and permissions
5. **Inviting the Bot** - OAuth2 URL generation
6. **Agent Configuration** - Config file setup with examples
7. **Environment Variables** - Token naming convention
8. **Getting Discord IDs** - Developer Mode instructions
9. **Testing the Integration** - Verification steps
10. **Multiple Agents in Same Server** - Setup guidance
11. **Troubleshooting** - Common errors and solutions

**Acceptance Criteria:**
- Documentation is complete for all sections
- Includes screenshots or diagrams where helpful
- Documentation builds successfully with `pnpm build` in docs/
- Tested with a real Discord server setup

---

## Technical Specifications

### Dependencies

```json
{
  "name": "@herdctl/discord",
  "version": "0.1.0",
  "dependencies": {
    "@herdctl/core": "workspace:*",
    "discord.js": "^14"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

### Configuration Schema (Core Package Update)

```typescript
const DiscordPresenceSchema = z.object({
  activity_type: z.enum(["playing", "watching", "listening", "competing"]).optional(),
  activity_message: z.string().optional(),
});

const DiscordDMSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["mention", "auto"]).default("auto"),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
});

const DiscordChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mode: z.enum(["mention", "auto"]).default("mention"),
  context_messages: z.number().default(10),
});

const DiscordGuildSchema = z.object({
  id: z.string(),
  channels: z.array(DiscordChannelSchema).optional(),
  dm: DiscordDMSchema.optional(),
});

const AgentChatDiscordSchema = z.object({
  bot_token_env: z.string(),
  session_expiry_hours: z.number().default(24),
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  presence: DiscordPresenceSchema.optional(),
  guilds: z.array(DiscordGuildSchema),
});

const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  // slack: AgentChatSlackSchema.optional(), // Future
});
```

### FleetManager Integration

```typescript
// In FleetManager or AgentRunner
async startAgent(agent: Agent) {
  // ... existing agent startup ...

  if (agent.config.chat?.discord) {
    const token = process.env[agent.config.chat.discord.bot_token_env];
    if (!token) {
      throw new Error(`Missing Discord token: ${agent.config.chat.discord.bot_token_env}`);
    }

    const connector = new DiscordConnector(agent, token, this);
    await connector.connect();
    this.discordConnectors.set(agent.name, connector);
  }
}

async stopAgent(agent: Agent) {
  // ... existing agent shutdown ...

  const connector = this.discordConnectors.get(agent.name);
  if (connector) {
    await connector.disconnect();
    this.discordConnectors.delete(agent.name);
  }
}
```

### Environment Variables

Each agent requires its own Discord bot token:

```bash
SUPPORT_DISCORD_TOKEN=your-support-bot-token
MARKETER_DISCORD_TOKEN=your-marketer-bot-token
WRITER_DISCORD_TOKEN=your-writer-bot-token
```

---

## Quality Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes with coverage thresholds (85% lines/functions/statements, 65% branches)
- [ ] `pnpm build` succeeds
- [ ] Manual testing with real Discord server completed
- [ ] Each bot connects independently
- [ ] Bot responds to messages in configured channels
- [ ] Session persistence works across restarts
- [ ] Slash commands work per-bot
- [ ] Documentation is complete and builds successfully

## Testing Strategy

### Unit Tests (Mocked)
- DiscordConnector connection/disconnection lifecycle
- SessionManager create/resume/expire/cleanup
- Command handlers (help, reset, status)
- Message handling logic (mention detection, context building)
- Configuration validation

### Integration Tests (Manual)
- Create test Discord server
- Add multiple agent bots
- Verify each responds independently
- Test mention mode in group channels
- Test auto mode in DMs
- Test session persistence across restarts
- Test slash commands for each bot
- Test rate limit handling
- Test reconnection on network disruption

---

## Constraints

- Use discord.js v14 (latest stable)
- Messages limited to 2000 characters (Discord limit)
- Rate limiting handled by discord.js with event emission
- Bot tokens NEVER logged or stored in config files
- Each agent = one Discord Application (manual Developer Portal setup required)

## Out of Scope

- Voice channel support
- Reactions/emoji responses
- Thread support
- Automated Discord Application creation
- Fleet-level bot or message routing
- Web dashboard for Discord management