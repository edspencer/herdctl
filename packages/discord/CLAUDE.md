# @herdctl/discord

Discord bot connector for herdctl fleets. Lets agents join Discord servers, respond to mentions, and process slash commands.

## Dependencies

- **@herdctl/chat** -- shared chat infrastructure (session management, message splitting, shared types). Import shared utilities from `@herdctl/chat`, not from this package.
- **@herdctl/core** -- fleet management types and config schemas (`AgentChatDiscord`, `FleetManager`).
- **discord.js** -- Discord API client.

## Package Structure

| Module | Purpose |
|---|---|
| `discord-connector.ts` | `DiscordConnector` -- per-agent bot lifecycle (connect, disconnect, event handling) |
| `manager.ts` | `DiscordManager` -- manages multiple `DiscordConnector` instances across a fleet |
| `commands/` | Slash command system: `CommandManager`, built-in `/help`, `/reset`, `/status` |
| `mention-handler.ts` | Detects mentions, builds conversation context from channel history |
| `auto-mode-handler.ts` | Resolves channel-specific config (guild hierarchy, DM vs channel) |
| `error-handler.ts` | Classifies Discord API errors for retry/reporting |
| `errors.ts` | Typed error hierarchy with `DiscordErrorCode` enum |
| `logger.ts` | `DiscordLogger` with level filtering (minimal/standard/verbose) and content redaction |
| `utils/` | Discord-specific formatting: message splitting, typing indicators, markdown escaping |

## Conventions

- **Errors**: All errors extend `DiscordConnectorError` with a `DiscordErrorCode` enum and `agentName`. Use `isDiscordConnectorError()` type guard for discrimination.
- **Logging**: Use `DiscordLogger` (not `createLogger` from core). It supports three levels (`minimal`, `standard`, `verbose`) and auto-redacts sensitive fields in verbose mode.
- **Exports**: Everything public goes through `src/index.ts`. Keep types and implementations co-exported.

## Commands

```
pnpm test              # run tests with coverage
pnpm build             # compile TypeScript
pnpm typecheck         # type-check without emitting
pnpm lint              # biome check
```

Tests live in `__tests__/` directories adjacent to source files. Mock discord.js clients and channels in tests.
