# Discord Bot PRD Prompt Draft

Use this prompt with ralph-tui to generate the Discord Bot PRD.

---

## Prompt

Create a PRD for `herdctl-discord` - a Discord connector that allows each agent to have its own Discord bot presence.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The core library (`@herdctl/core`) provides FleetManager for orchestration. The Discord connector (`@herdctl/discord`) enables chat-based interaction with agents via Discord.

**Key Architecture Decision**: Each chat-enabled agent has its **own Discord bot**. This means:
- Each agent appears as a distinct "person" in Discord (own name, avatar, presence)
- Users interact naturally: `@bragdoc-support help me with...`
- No fleet-level bot or message routing between agents
- Each agent manages its own sessions for its channels

### Package Location

The package exists at `packages/discord/` (currently empty `.gitkeep`).

### Per-Agent Bot Architecture

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

### User Stories

#### US-1: Discord Connector Class
**As a** developer using herdctl
**I want** a DiscordConnector class that connects an agent to Discord
**So that** each agent can have its own Discord bot presence

**Implementation**:
- Create `DiscordConnector` class in `packages/discord/`
- Constructor takes agent config and bot token
- Uses discord.js to connect to Discord gateway
- Handles connection events (ready, disconnect, error, reconnect)
- Graceful shutdown on stop signal
- One instance per agent (not shared)

**Class interface**:
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

#### US-2: Agent Chat Configuration
**As a** developer configuring agents
**I want** to specify Discord settings per-agent
**So that** each agent has its own bot identity

**Agent configuration**:
```yaml
# agents/support.yaml
name: support
description: "Handles support questions"

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention
          - id: "111222333444555666"
            name: "#general"
            mode: mention
        dm:
          enabled: true
          mode: auto
```

**Implementation**:
- Add `AgentChatDiscordSchema` to config validation
- Bot token comes from environment variable (never in config file)
- Guilds/channels define where this bot participates
- Mode determines response behavior (mention vs auto)

#### US-3: Mention Mode (Group Channels)
**As a** Discord server admin
**I want** the bot to only respond when @mentioned
**So that** it doesn't interrupt normal conversations

**Implementation**:
- Check if bot is mentioned in message
- If not mentioned and mode is "mention", ignore
- When mentioned, strip the mention from prompt
- Read recent message history for context (configurable, default 10 messages)
- Respond in the same channel

**Behavior**:
```
User: @bragdoc-support what's the status of issue #123?
Bot: Let me check... [Claude response]
```

#### US-4: Auto Mode (DMs and Dedicated Channels)
**As a** Discord user
**I want** the bot to respond to all my DMs
**So that** I don't have to @mention it every time

**Implementation**:
- DMs default to auto mode
- Channels can be configured as auto mode
- No mention required in auto mode
- Full conversation context maintained

#### US-5: Per-Channel Session Management
**As a** user chatting with an agent
**I want** my conversation context preserved
**So that** the agent remembers what we discussed

**Implementation**:
- Create `SessionManager` class (per-agent, not shared)
- Store session ID per channel/DM
- Resume existing session when user sends message
- Persist session mappings to `.herdctl/discord-sessions/<agent-name>.yaml`
- Handle session expiry gracefully (create new if expired)

**State structure**:
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

#### US-6: Slash Commands
**As a** Discord user
**I want** slash commands to control the bot
**So that** I can reset context or check status

**Commands**:
```
/help     - Show available commands
/reset    - Clear conversation context (start fresh session)
/status   - Show agent status and session info
```

**Implementation**:
- Register slash commands with Discord (per-bot, not global)
- Handle command interactions
- Respond ephemerally (only visible to user) for status/help
- Confirm reset action

**Note**: Commands are registered per-bot, so each agent's bot has its own `/help`, `/reset`, `/status`.

#### US-7: Response Streaming
**As a** Discord user
**I want** to see the bot "typing" while it thinks
**So that** I know it's processing my message

**Implementation**:
- Send typing indicator while Claude is processing
- Handle Discord message length limits (2000 chars)
- Split long responses into multiple messages if needed
- Edit message incrementally for long responses (optional enhancement)

#### US-8: Error Handling
**As a** Discord user
**I want** friendly error messages
**So that** I know when something goes wrong

**Implementation**:
- Catch and handle common errors
- User-friendly error messages (not stack traces)
- Log detailed errors for debugging
- Retry transient failures (rate limits, network)

**Error responses**:
```
"Sorry, I encountered an error processing your request. Please try again."
"I'm having trouble connecting right now. Please try again in a moment."
```

#### US-9: Documentation
**As a** user setting up Discord integration
**I want** clear documentation
**So that** I can configure everything correctly

**Documentation to create** (`docs/src/content/docs/integrations/discord.mdx`):

1. **Overview**
   - Per-agent bot architecture explanation
   - Each agent = one Discord Application

2. **Prerequisites**
   - Discord account
   - Discord server with admin permissions

3. **Creating a Discord Application** (per agent)
   - Go to Discord Developer Portal
   - Create new application (name it after your agent)
   - Upload avatar for the agent's identity
   - Add bot to application
   - Copy bot token

4. **Bot Permissions & Intents**
   - Required intents: Message Content, Guild Messages, Direct Messages
   - Required permissions: Send Messages, Read Message History, View Channels
   - Privileged intents setup

5. **Inviting the Bot**
   - OAuth2 URL generator
   - Required scopes: `bot`, `applications.commands`
   - Required permissions
   - Invite link generation

6. **Agent Configuration**
   - Setting `bot_token_env` in agent config
   - Configuring guilds and channels
   - Mode settings (mention vs auto)
   - DM configuration

7. **Environment Variables**
   - Naming convention: `<AGENT>_DISCORD_TOKEN`
   - Example: `SUPPORT_DISCORD_TOKEN`, `MARKETER_DISCORD_TOKEN`

8. **Getting Discord IDs**
   - Enable Developer Mode
   - Copy server/channel/user IDs

9. **Testing the Integration**
   - Start herdctl
   - Verify bot comes online
   - Send test message
   - Verify response

10. **Multiple Agents in Same Server**
    - Each agent is a separate bot/member
    - Different channels for different agents
    - Or same channel with different @mentions

11. **Troubleshooting**
    - Common errors and solutions
    - Debug logging
    - Token issues
    - Permission issues

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

### Dependencies

```json
{
  "name": "@herdctl/discord",
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

### Configuration Schema Updates

**Agent chat schema** (add to core config):
```typescript
const AgentChatDiscordSchema = z.object({
  bot_token_env: z.string(), // Required - env var name for bot token
  guilds: z.array(z.object({
    id: z.string(),
    channels: z.array(z.object({
      id: z.string(),
      name: z.string().optional(),
      mode: z.enum(["mention", "auto"]).default("mention"),
    })).optional(),
    dm: z.object({
      enabled: z.boolean().default(true),
      mode: z.enum(["mention", "auto"]).default("auto"),
    }).optional(),
  })),
});

const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  slack: AgentChatSlackSchema.optional(), // Future
});
```

### Integration with FleetManager

The FleetManager (or AgentRunner) is responsible for creating DiscordConnector instances:

```typescript
// In FleetManager or AgentRunner
async startAgent(agent: Agent) {
  // ... existing agent startup ...

  // Start Discord connector if configured
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

  // Disconnect Discord if connected
  const connector = this.discordConnectors.get(agent.name);
  if (connector) {
    await connector.disconnect();
    this.discordConnectors.delete(agent.name);
  }
}
```

### Quality Gates

- `pnpm typecheck` passes
- `pnpm test` passes (mock discord.js for unit tests)
- Manual testing with real Discord server
- Each bot connects independently
- Bot responds to messages in configured channels
- Session persistence works across restarts
- Slash commands work per-bot
- Documentation is complete and accurate
- Documentation builds successfully

### Testing Strategy

**Unit tests** (mocked):
- DiscordConnector connection/disconnection
- Session manager
- Command handlers
- Message handling logic

**Integration test** (manual):
- Create test Discord server
- Add multiple agent bots
- Verify each responds independently
- Test session persistence
- Test slash commands

### Environment Variables

Each agent needs its own Discord bot token:

```bash
SUPPORT_DISCORD_TOKEN=your-support-bot-token
MARKETER_DISCORD_TOKEN=your-marketer-bot-token
WRITER_DISCORD_TOKEN=your-writer-bot-token
```

### Constraints

- Use discord.js v14 (latest stable)
- Messages limited to 2000 characters (Discord limit)
- Rate limiting handled by discord.js
- Bot tokens NEVER logged or stored in config files
- Each agent = one Discord Application (manual setup required)

### Out of Scope

- Voice channel support
- Reactions/emoji responses
- Threads support (future enhancement)
- Automated Discord Application creation (requires manual Developer Portal setup)
- Fleet-level bot or message routing between agents

---

## Notes for PRD Generation

- This is a new package, not modifying existing code much
- Key insight: one bot per agent, not one bot for fleet
- Session management is per-agent (simpler than shared)
- Documentation is critical - users need to create Discord apps manually
- Error messages should be helpful, not technical
- Consider rate limits and Discord's API constraints
