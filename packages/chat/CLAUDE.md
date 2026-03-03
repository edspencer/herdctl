# @herdctl/chat

Shared chat infrastructure used by the Discord and Slack connectors. All platform-agnostic chat logic lives here; platform-specific connectors import from this package.

## What It Provides

- **Session management** (`session-manager/`) -- per-channel conversation context preservation with expiry, stored as YAML in `.herdctl/<platform>-sessions/`
- **Error handling** (`errors.ts`, `error-handler.ts`) -- typed `ChatConnectorError` hierarchy with `ChatErrorCode` enum, type guards, retry/safe-execute helpers, and error classification by category
- **Message processing** (`message-splitting.ts`, `message-extraction.ts`) -- split long responses for chat platform limits, extract text from SDK content blocks
- **Tool parsing** (`tool-parsing.ts`) -- extract tool-use blocks and results from SDK messages
- **Streaming** (`streaming-responder.ts`) -- stream Claude responses incrementally to chat platforms
- **DM filtering** (`dm-filter.ts`) -- control which users can interact via direct messages
- **Status formatting** (`status-formatting.ts`) -- format durations, costs, counts for display

## Package Structure

```
src/
  index.ts                  # Public API (re-exports everything)
  types.ts                  # Shared interfaces (IChatConnector, events, state)
  errors.ts                 # ChatErrorCode enum, error classes, type guards
  error-handler.ts          # withRetry, safeExecute, error classification
  message-splitting.ts      # Split messages for platform character limits
  message-extraction.ts     # Extract text from SDK content blocks
  tool-parsing.ts           # Parse tool-use blocks from SDK messages
  streaming-responder.ts    # Incremental response streaming
  dm-filter.ts              # DM allow/deny filtering
  status-formatting.ts      # Display formatting utilities
  session-manager/          # Session persistence (types, errors, manager class)
  __tests__/                # One test file per module
```

## Key Conventions

- **Dependency-injected logger** -- Pass a `SessionManagerLogger` / `ChatConnectorLogger` interface to components. Never import a logger directly. Never use raw `console.log`.
- **Typed errors with type guards** -- use `ChatErrorCode` enum and `isChatConnectorError()` / `isAlreadyConnectedError()` etc. for error discrimination.
- **Zod schemas** -- session state is validated at read/write boundaries with `ChatSessionStateSchema`.

## Development

```bash
pnpm test              # Run tests with coverage (vitest)
pnpm typecheck         # Type-check without emitting
pnpm build             # Compile TypeScript
pnpm lint              # Biome check
```
