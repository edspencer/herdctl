# Discord Bot PRD Prompt

Create a PRD for `herdctl-discord` - a Discord connector where each agent has its own bot.

**For full details**: See `tasks/discord-prd-draft-full.md`

## Key Architecture

Each chat-enabled agent has its **own Discord bot** (one Discord Application per agent). Agents appear as distinct "colleagues" in Discord with their own name, avatar, and presence. No fleet-level bot or message routing.

```
Discord Server Members:
├─ @alice (human)
├─ @bragdoc-support (bot) ← Agent: support
├─ @bragdoc-marketer (bot) ← Agent: marketer
└─ @turtle-writer (bot) ← Agent: turtle-content
```

## Agent Configuration

```yaml
# agents/support.yaml
name: support
chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN  # Per-agent token
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention  # or "auto"
        dm:
          enabled: true
          mode: auto
```

## User Stories

1. **DiscordConnector class** - Connects one agent to Discord with its own token
2. **Agent chat config** - `bot_token_env` and guild/channel settings per-agent
3. **Mention mode** - Bot responds only when @mentioned in channels
4. **Auto mode** - Bot responds to all messages (DMs, dedicated channels)
5. **Session management** - Per-channel sessions stored in `.herdctl/discord-sessions/<agent>.yaml`
6. **Slash commands** - `/help`, `/reset`, `/status` (per-bot, not global)
7. **Response streaming** - Typing indicator, split long messages
8. **Error handling** - Friendly messages, retry transient failures
9. **Documentation** - Full setup guide for Discord Developer Portal

## Package Structure

```
packages/discord/
├── src/
│   ├── index.ts
│   ├── connector.ts          # DiscordConnector class
│   ├── session-manager.ts    # Per-agent sessions
│   ├── message-handler.ts
│   └── commands/
│       ├── help.ts
│       ├── reset.ts
│       └── status.ts
├── __tests__/
└── package.json
```

## Dependencies

- `@herdctl/core`: workspace:*
- `discord.js`: ^14

## FleetManager Integration

```typescript
// FleetManager starts connector per chat-enabled agent
if (agent.config.chat?.discord) {
  const token = process.env[agent.config.chat.discord.bot_token_env];
  const connector = new DiscordConnector(agent, token, this);
  await connector.connect();
}
```

## Documentation Requirements

Create `docs/src/content/docs/integrations/discord.mdx` covering:
1. Per-agent bot architecture overview
2. Creating Discord Application (per agent)
3. Bot permissions & intents
4. Inviting the bot
5. Agent configuration with `bot_token_env`
6. Environment variable naming: `<AGENT>_DISCORD_TOKEN`
7. Getting Discord IDs (Developer Mode)
8. Testing and troubleshooting

## Quality Gates

- `pnpm typecheck` and `pnpm test` pass
- Manual test: multiple agent bots in same server respond independently
- Session persistence works across restarts
- Documentation builds successfully

## Constraints

- discord.js v14
- 2000 char message limit
- Bot tokens never in config files
- Manual Discord app creation required (no automation API)

## Out of Scope

- Voice channels, reactions, threads
- Fleet-level bot or message routing
- Automated Discord Application creation
