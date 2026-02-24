# @herdctl/slack

Slack bot connector for herdctl fleets. Connects agents to Slack workspaces via Socket Mode (no public URL needed), routing channel messages to the appropriate agent.

## Relationship to Other Packages

- **@herdctl/chat** provides shared chat infrastructure: session management, message splitting, streaming responders, tool emoji rendering. Import shared types and utilities from there, not from this package.
- **@herdctl/core** provides `FleetManager`, agent types, and `createLogger`. `SlackManager` implements the `IChatManager` interface from core.

## Package Structure

| File | Purpose |
|------|---------|
| `manager.ts` | `SlackManager` — lifecycle manager for Slack connectors, one per agent |
| `slack-connector.ts` | `SlackConnector` — single-agent Bolt App instance, channel-based routing |
| `commands/` | Prefix commands (`!help`, `!reset`, `!status`) via `CommandHandler` |
| `formatting.ts` | Markdown-to-mrkdwn conversion (`markdownToMrkdwn`), re-exports splitting utils from `@herdctl/chat` |
| `message-handler.ts` | Bot mention detection, message filtering and processing |
| `errors.ts` | Typed errors with `SlackErrorCode` enum and `SlackConnectorError` base class |
| `error-handler.ts` | Error classification (`classifyError`) and safe execution wrappers |
| `logger.ts` | Slack-specific logger adapter |
| `types.ts` | Slack-specific types (shared types live in `@herdctl/chat`) |

## Key Conventions

- **Typed errors**: All errors extend `SlackConnectorError` with a `SlackErrorCode`. Use `isSlackConnectorError()` type guard for discrimination.
- **Formatting**: Slack uses mrkdwn (not standard markdown). Use `markdownToMrkdwn()` via `slackify-markdown` before sending. Message splitting respects `SLACK_MAX_MESSAGE_LENGTH`.
- **Logging**: Use `createLogger` from `@herdctl/core`, never raw `console.*`.

## Development

```bash
pnpm test              # Run tests with coverage
pnpm typecheck         # Type-check without emitting
pnpm build             # Compile TypeScript
pnpm lint              # Biome linting
```

Tests live in `src/__tests__/` and cover every source module.
