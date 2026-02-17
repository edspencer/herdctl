# Feature: Slack Integration for herdctl

## Status: DEPLOYED (live on dev server, bugs found — see DEPLOYMENT_NOTES.md)

## Context

herdctl (github.com/edspencer/herdctl, MIT) is a TypeScript monorepo for orchestrating autonomous Claude Code agents. It already has a Discord integration (`packages/discord/`). We're building an equivalent Slack integration as `packages/slack/`.

**Fork:** github.com/ikido/herdctl

## Requirements

### Core (MVP)
- Multiple Slack channels, each connected to a Claude Code agent working in a specific directory
- Send messages to agent via Slack, get responses back
- Agent can send files, links, deploy, commit from its working directory
- **Context indicator** — agent responses in Slack should include how much context remains, so user can trigger handoff in time
- **Commands support** — slash commands or message commands (e.g. `/reset`, `/status`, `/handoff`)
- **Scheduled tasks** — user can ask agent "do X tomorrow" or "do X every day" — agent runs on schedule (one-time or recurring) and posts results/reports back to the Slack channel
- Each scheduled run creates a new separate session
- **Terminal access to sessions** — ability to enter the agent's working directory from terminal and see/resume sessions that were created from Slack

### Out of Scope (Future)
- Inter-agent communication (agent-mail)
- Telegram integration
- Linear integration / PM agent that assigns tasks from Linear
- These should be noted in architecture but NOT implemented now

## Architecture Overview (from codebase analysis)

### Monorepo Structure
```
packages/
  core/       — @herdctl/core (fleet manager, scheduler, config, job control)
  discord/    — @herdctl/discord (Discord integration, plugin pattern)
  cli/        — herdctl CLI
```

### Key Pattern: Plugin Architecture
- Core has NO hard dependency on Discord (or Slack)
- Discord is dynamically imported at runtime via `importDiscordPackage()` in `discord-manager.ts`
- If `@herdctl/discord` isn't installed, core works without it
- **Same pattern must be followed for Slack**

### Discord Integration Pattern (to mirror)

**Package level (`packages/discord/src/`):**
- `discord-connector.ts` — EventEmitter, one instance per agent, handles connection lifecycle
- `session-manager/` — YAML-based per-channel session storage at `.herdctl/discord-sessions/<agent>.yaml`
- `mention-handler.ts` — @mention detection, conversation context building
- `auto-mode-handler.ts` — channel/DM mode handling (mention vs auto)
- `commands/` — slash commands (/help, /reset, /status)
- `error-handler.ts`, `logger.ts`, `utils/` — supporting modules

**Core level (`packages/core/src/fleet-manager/`):**
- `discord-manager.ts` — creates connectors, handles message→trigger→response flow
- `StreamingResponder` class — buffers output, sends to Discord respecting rate limits
- Dynamic import of `@herdctl/discord` to avoid hard dependency

### Message Flow (Discord, to replicate for Slack)
```
User message in channel
  → DiscordConnector emits "message" event
  → DiscordManager.handleMessage()
  → Get/create session for channel (SessionManager)
  → fleetManager.trigger(agentName, undefined, {
      prompt, resume: existingSessionId,
      onMessage: (msg) => streamer.addMessageAndSend(content)
    })
  → Store session ID for next message
  → Send response back to channel
```

### Config Schema
In `packages/core/src/config/schema.ts` line ~615:
```typescript
export const AgentChatSchema = z.object({
  discord: AgentChatDiscordSchema.optional(),
  // slack: AgentChatSlackSchema.optional(), // Future  ← PLACEHOLDER EXISTS
});
```

Discord per-agent config includes:
- `bot_token_env` — env var name for token
- `session_expiry_hours` — default 24
- `log_level` — minimal/standard/verbose
- `guilds` with channel configs (id, mode: mention|auto, context_messages)
- `dm` config (enabled, allowlist/blocklist)
- `presence` config

### Scheduler (already built)
- Supports `interval` and `cron` schedule types
- Schedule type `"chat"` exists but is skipped by scheduler (event-driven)
- Each schedule can have a `prompt`, `resume_session`, `outputToFile`
- Scheduler calls `onTrigger` callback → FleetManager.trigger()

### Session Manager Pattern
- YAML file at `.herdctl/<platform>-sessions/<agent-name>.yaml`
- Maps channel_id → { sessionId, lastMessageAt }
- Expiry-based cleanup
- Atomic writes (temp file + rename)
- In-memory cache

## What Needs to Be Analyzed Next (in the herdctl project session)

1. **`packages/discord/package.json`** — dependencies, build config, exports
2. **`packages/discord/tsconfig.json`** — TypeScript config
3. **`packages/discord/src/types.ts`** — all type definitions and event maps
4. **`packages/discord/src/index.ts`** — what's exported from the package
5. **`packages/core/src/fleet-manager/context.ts`** — FleetManagerContext interface (need to extend for Slack)
6. **`packages/core/src/fleet-manager/fleet-manager.ts`** full file — see how Discord is wired in lifecycle (initialize, start, stop)
7. **`packages/core/src/fleet-manager/types.ts`** — TriggerResult, TriggerOptions
8. **`packages/cli/`** — how Discord is referenced in CLI, templates for `herdctl init`
9. **Root `package.json`** and `pnpm-workspace.yaml` — workspace config
10. **Example fleet YAML configs** — understand config format for agents

## Implementation Plan (draft, to be refined after analysis)

### Phase 1: Package Setup
- Create `packages/slack/` with package.json, tsconfig, build config
- Add to pnpm workspace
- Dependencies: `@slack/bolt`, `@slack/web-api`, `zod`

### Phase 2: Slack Connector
- `slack-connector.ts` — @slack/bolt App in Socket Mode, EventEmitter
- `session-manager/` — reuse exact pattern from Discord (just change path to `.herdctl/slack-sessions/`)
- `mention-handler.ts` — @mention detection for Slack
- `commands/` — Slack slash commands or app commands
- Message formatting utils (Slack mrkdwn vs Discord markdown)

### Phase 3: Core Integration
- Add `AgentChatSlackSchema` to config schema
- Create `SlackManager` in fleet-manager (mirror DiscordManager)
- Dynamic import pattern
- Wire into FleetManager lifecycle

### Phase 4: Slack-Specific Features
- Context remaining indicator in responses
- File sharing via Slack API
- Thread-based conversations (optional — use threads or flat channel messages?)

### Phase 5: Schedule Integration
- Ensure scheduled tasks post results to configured Slack channel
- New session per scheduled run

### Phase 6: Terminal Session Access
- Ensure sessions created from Slack are visible via `herdctl sessions`
- Allow `herdctl` CLI to resume Slack-originated sessions

## Decisions to Make
- **Socket Mode vs HTTP?** — Socket Mode is simpler (no public URL needed), recommended for MVP
- **Threads vs flat messages?** — Slack threads would be natural for sessions (each conversation = thread)
- **One bot token or per-agent tokens?** — Discord uses per-agent tokens; Slack apps are typically workspace-wide with one token
- **Message format** — Slack uses mrkdwn (different from Discord markdown), need converter
- **Context indicator format** — e.g. footer text "Context: 45% remaining" or emoji-based

## References
- `ideas/2026-02-15-herdctl-research-and-architecture.md` — full research document
- `ideas/2026-02-15-handoff-2.md` — previous session handoff
- `ideas/2026-02-15-handoff.md` — first session handoff
