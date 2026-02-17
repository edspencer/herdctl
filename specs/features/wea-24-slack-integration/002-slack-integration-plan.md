# Slack Integration for herdctl — Implementation Plan

## Context

herdctl already has a Discord integration (`packages/discord/` + core's `discord-manager.ts`). We're building an equivalent Slack integration as `packages/slack/`, following the same plugin architecture but adapted for Slack's single-app model.

**Key architectural difference from Discord:** Slack uses ONE Bolt App instance shared across all agents (one bot token per workspace), while Discord uses N connectors (one per agent with separate bot tokens). This changes the connector/manager design significantly.

**Decisions made:**
- **Threads** — each conversation = a Slack thread (keeps channels clean, enables parallel conversations)
- **One token per workspace** — single Slack App, channel→agent routing in config
- **Socket Mode** — no public URL needed, simpler for MVP
- **Context indicator** — footer text on message attachments ("Context: 45% remaining")
- **Commands** — message prefix commands (`!reset`, `!status`, `!help`) for MVP simplicity

---

## Phase 1: Package Scaffolding

Create `packages/slack/` with the following structure (workspace already includes `packages/*`):

```
packages/slack/
├── package.json          # mirror discord's, deps: @slack/bolt, @slack/web-api, @herdctl/core, yaml, zod
├── tsconfig.json         # extends ../../tsconfig.json, outDir: dist, rootDir: src
└── src/
    ├── index.ts
    ├── types.ts
    ├── slack-connector.ts
    ├── errors.ts
    ├── error-handler.ts
    ├── logger.ts
    ├── message-handler.ts
    ├── formatting.ts
    ├── session-manager/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── session-manager.ts
    │   └── errors.ts
    └── commands/
        ├── index.ts
        ├── command-handler.ts
        ├── reset.ts
        ├── status.ts
        └── help.ts
```

**Pattern reference:** `packages/discord/package.json`, `packages/discord/tsconfig.json`

---

## Phase 2: Config Schema

**File:** `packages/core/src/config/schema.ts` (around line 608)

Add schemas:
```typescript
const SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const AgentChatSlackSchema = z.object({
  bot_token_env: z.string().default("SLACK_BOT_TOKEN"),
  app_token_env: z.string().default("SLACK_APP_TOKEN"),
  session_expiry_hours: z.number().int().positive().default(24),
  log_level: z.enum(["minimal", "standard", "verbose"]).default("standard"),
  channels: z.array(SlackChannelSchema),
});
```

Update `AgentChatSchema` — uncomment the Slack placeholder:
```typescript
export const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  slack: AgentChatSlackSchema.optional(),  // uncomment and wire up
});
```

Export types: `SlackChannel`, `AgentChatSlack`

**Also update:** `packages/core/src/config/index.ts` — add exports

---

## Phase 3: Slack Connector (`packages/slack/src/slack-connector.ts`)

Single Bolt App instance with channel→agent routing.

**Key design:**
- Constructor takes `channelAgentMap: Map<string, string>`, `sessionManagers: Map<string, ISessionManager>`
- Registers `app_mention` event — triggers when bot is @mentioned in a channel
- Registers `message` event — handles thread replies in conversations the bot is already in
- Builds routing: `event.channel` → lookup agent name → emit `"message"` event with agent context

**Thread flow:**
1. User @mentions bot → `app_mention` event → create thread reply → new session keyed by `thread_ts`
2. User replies in thread → `message` event with `thread_ts` → lookup session → resume

**Typing indicator alternative:** Slack Socket Mode doesn't support typing indicators. Use `:hourglass:` emoji reaction on the message while processing, remove when done.

**Pattern reference:** `packages/discord/src/discord-connector.ts` (EventEmitter, connect/disconnect/getState)

---

## Phase 4: Session Manager (`packages/slack/src/session-manager/`)

Almost identical to Discord's, keyed by `threadTs` instead of `channelId`.

**Storage:** `.herdctl/slack-sessions/<agent-name>.yaml`
```yaml
version: 1
agentName: my-agent
threads:
  "1707930000.123456":
    sessionId: "slack-my-agent-uuid-here"
    lastMessageAt: "2026-02-15T10:30:00.000Z"
    channelId: "C0123456789"
```

**Interface:** same as Discord's `ISessionManager` but with `threadTs` as key and extra `channelId` param on create/set.

**Pattern reference:** `packages/discord/src/session-manager/session-manager.ts` (YAML, atomic writes, expiry)

---

## Phase 5: Message Formatting (`packages/slack/src/formatting.ts`)

Markdown → mrkdwn converter:
- `**text**` → `*text*` (bold)
- `_text_` stays `_text_` (italic — same in mrkdwn)
- `[text](url)` → `<url|text>` (links)
- Code blocks: backticks work the same
- Max practical message length: ~4,000 chars (Slack hard limit is ~40K)

Context footer via Slack attachments:
```typescript
{
  attachments: [{
    footer: "Context: 45% remaining",
    color: contextPercent < 20 ? "#ff0000" : "#36a64f",
  }]
}
```

---

## Phase 6: Commands (`packages/slack/src/commands/`)

Message prefix commands (simpler than Slack slash commands for MVP):
- `!reset` — clear session for current thread
- `!status` — show agent info and connection status
- `!help` — list available commands

Detected by `CommandHandler.isCommand(text)` checking for `!` prefix.

**Pattern reference:** `packages/discord/src/commands/`

---

## Phase 7: Core Integration — SlackManager

**New file:** `packages/core/src/fleet-manager/slack-manager.ts`

Mirrors `discord-manager.ts` but manages ONE connector (not N):

```
SlackManager
  ├── importSlackPackage()         # dynamic import, returns null if not installed
  ├── initialize()                 # find slack agents, build channel map, create single connector
  ├── start()                      # connect Bolt App, subscribe to events
  ├── stop()                       # disconnect
  ├── handleMessage()              # session → trigger → stream response → store session
  └── StreamingResponder           # buffer + send, adapted for mrkdwn
```

**Critical difference from DiscordManager:**
- `DiscordManager` has `Map<string, IDiscordConnector>` (N connectors)
- `SlackManager` has `ISlackConnector | null` (1 connector) + `Map<string, string>` (channel→agent routing)

Token resolution: all agents reference the same env vars. SlackManager validates they match and takes the first agent's config.

**Pattern reference:** `packages/core/src/fleet-manager/discord-manager.ts`

---

## Phase 8: Wire into FleetManager

**File:** `packages/core/src/fleet-manager/fleet-manager.ts`

Add alongside Discord:
- Field: `private slackManager!: SlackManager;`
- `initializeModules()`: `this.slackManager = new SlackManager(this);`
- `initialize()`: `await this.slackManager.initialize();`
- `start()`: `await this.slackManager.start();`
- `stop()`: `await this.slackManager.stop();`
- Add `getSlackManager()` method

**File:** `packages/core/src/fleet-manager/context.ts`
- Add `getSlackManager?(): unknown;`

**File:** `packages/core/src/fleet-manager/types.ts`
- Add `AgentSlackStatus` interface (mirrors `AgentDiscordStatus`)
- Add `slack?: AgentSlackStatus` to `AgentInfo`

**File:** `packages/core/src/fleet-manager/event-types.ts`
- Add `slack:connector:connected`, `slack:connector:disconnected`, `slack:connector:error` events

---

## Phase 9: Schedule Output to Slack

Add `slack` hook type to the existing hooks system (mirrors existing `discord` hook type at `schema.ts:670`):

```typescript
const SlackHookConfigSchema = BaseHookConfigSchema.extend({
  type: z.literal("slack"),
  channel_id: z.string().min(1),
  bot_token_env: z.string().min(1).default("SLACK_BOT_TOKEN"),
});
```

When a scheduled task completes, the hook posts results to the specified Slack channel.

---

## Phase 10: Testing + Example

- Unit tests for all `packages/slack/src/` modules (vitest, mock Bolt)
- Unit tests for `slack-manager.ts` in core
- Example config at `examples/slack-chat-bot/` with `herdctl.yaml` + agent YAML

---

## Implementation Order

| # | What | Package | Blocked by |
|---|------|---------|------------|
| 1 | Package scaffolding (package.json, tsconfig) | slack | — |
| 2 | Config schema (SlackChannelSchema, AgentChatSlackSchema) | core | — |
| 3 | Session manager (types, errors, session-manager) | slack | 1 |
| 4 | Errors, logger | slack | 1 |
| 5 | Formatting (mrkdwn converter, message splitting) | slack | 1 |
| 6 | Message handler (mention detection) | slack | 1 |
| 7 | Types (connector options, state, events) | slack | 1 |
| 8 | SlackConnector (Bolt App, Socket Mode, routing) | slack | 3–7 |
| 9 | Commands (reset, status, help) | slack | 3, 7 |
| 10 | index.ts (exports) | slack | 3–9 |
| 11 | AgentSlackStatus + AgentInfo update | core | 2 |
| 12 | SlackManager (dynamic import, handleMessage, StreamingResponder) | core | 10, 11 |
| 13 | Wire into FleetManager lifecycle | core | 12 |
| 14 | Context, event-types updates | core | 12 |
| 15 | Slack hook type for schedule results | core | 12 |
| 16 | Tests | both | all |
| 17 | Example config + changeset | — | all |

---

## Key Differences from Discord (Reference Table)

| Aspect | Discord | Slack |
|--------|---------|-------|
| Connectors | N (one per agent) | 1 (shared Bolt App) |
| Tokens | Per-agent bot tokens | Workspace-wide bot + app tokens |
| Session key | channelId | threadTs |
| Message format | Discord markdown | Slack mrkdwn |
| Max message length | 2,000 chars | ~4,000 chars practical |
| Typing indicator | `sendTyping()` every 8s | Emoji reaction (:hourglass:) |
| Commands | Discord API slash commands | Message prefix (`!reset`) |
| Context indicator | Not implemented | Attachment footer |

---

## Example Agent Config

```yaml
name: frontend-agent
description: Frontend development agent with Slack chat

chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    session_expiry_hours: 48
    channels:
      - id: "C0123456789"
        name: "#frontend-dev"

schedules:
  daily-review:
    type: cron
    expression: "0 9 * * 1-5"

hooks:
  after_run:
    - type: slack
      bot_token_env: SLACK_BOT_TOKEN
      channel_id: "C0123456789"
      when: "metadata.shouldNotify"
```

---

## Verification

1. `pnpm install` — package resolves in workspace
2. `pnpm build` — all packages compile
3. `pnpm typecheck` — no type errors
4. `pnpm test` — all tests pass with coverage thresholds
5. Manual test: create Slack App with Socket Mode, set env vars, run `herdctl start`, send @mention in configured channel, verify thread creation and response
6. Verify `herdctl status` shows Slack connection info
