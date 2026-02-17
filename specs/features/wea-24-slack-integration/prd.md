# WEA-24: Slack Connector Discord Parity Fixes

**Date:** 2026-02-16
**Branch:** `features/specs/features/001-slack-integration`
**Linear:** [WEA-24](https://linear.app/wearevolt/issue/WEA-24)
**Depends on:** WEA-23 analysis (done), WEA-12/13/15 (done)

---

## Summary

Bring the Slack connector to structural parity with the Discord connector. The Slack connector works end-to-end (messages, threads, per-thread sessions), but has dead code, missing type safety, missing events, and architectural divergences from the Discord reference implementation.

This PRD is derived from the analysis in `specs/features/002-architecture-research/008-slack-discord-alignment.md` and the actionable plan in `009-slack-discord-parity-fixes.md`.

---

## Current State

### What works
- SlackConnector connects via Socket Mode, routes messages to agents via channelAgentMap
- @mentions start new threads, thread replies continue conversations (WEA-12/13)
- Per-thread Claude sessions are isolated (WEA-15)
- SessionManager persists thread->session mappings to YAML
- Commands exist (`!help`, `!reset`, `!status`) but are dead code
- Error handler exists but is not integrated into the connector
- Type-safe event map exists in types.ts but connector doesn't use it

### What's broken / missing
1. **CommandHandler is dead code** -- defined, exported, but never instantiated or called
2. **No type-safe event emitter** -- Discord has `override emit/on/once/off` with generics; Slack uses raw EventEmitter
3. **Missing events** -- Slack emits 4 events (`message`, `error`, `connected`, `disconnected`); Discord emits 9 (`ready`, `disconnect`, `error`, `message`, `messageIgnored`, `commandExecuted`, `sessionLifecycle`, `reconnecting`, `reconnected`, `rateLimit`)
4. **Event naming mismatch** -- Slack uses `connected`/`disconnected`; Discord uses `ready`/`disconnect`
5. **Event map uses tuple syntax** -- should use object syntax to match Discord and enable type-safe overrides
6. **No session cleanup on startup** -- Discord cleans expired sessions when ready; Slack doesn't
7. **No `mode`/`context_messages` in channel config** -- Discord supports per-channel `mention`/`auto` mode and configurable context window; Slack doesn't

### What intentionally differs (no change needed)
- **1 connector vs N connectors** -- Slack shares one connector; Discord has one per agent. Correct platform difference.
- **Thread-based conversations** -- Slack uses threads for conversation grouping. This is Slack UX convention.
- **No reconnecting/reconnected events** -- Bolt manages WebSocket reconnection internally. No accessible hooks.
- **No rateLimit events** -- Bolt handles rate limits internally.
- **No auto-mode handler file** -- Slack's `channelAgentMap` + `app_mention` event achieves the same result through platform-native mechanisms.
- **No DM support** -- Future enhancement, not a parity issue.
- **Prefix commands (!) vs slash commands (/)** -- Platform-appropriate choice for MVP.

---

## Implementation Plan

### Task 1: Wire up CommandHandler

**Files:** `packages/slack/src/slack-connector.ts`

The `CommandHandler` class and three commands (`!help`, `!reset`, `!status`) exist but are never used. Wire them in:

1. Import `CommandHandler`, `helpCommand`, `resetCommand`, `statusCommand` from `./commands/index.js`
2. Add `private commandHandler: CommandHandler | null = null` field
3. In `connect()`, after bot info is retrieved: instantiate CommandHandler, register built-in commands
4. In both event handlers (`app_mention` and `message`), after extracting prompt: check `commandHandler.isCommand(prompt)` -- if true, execute and return (don't emit `message` event)
5. In `disconnect()`: null out commandHandler

**Key detail:** Command context needs `sessionManager` and `connectorState`. Look up sessionManager from `this.sessionManagers.get(agentName)`. Get connectorState from `this.getState()`.

### Task 2: Type-safe event emitter + event map alignment

**Files:** `packages/slack/src/types.ts`, `packages/slack/src/slack-connector.ts`

1. Replace tuple-syntax event map with object-syntax (matching Discord):
   - `message: [payload: SlackMessageEvent]` -> `message: SlackMessageEvent`
   - Rename `connected` -> `ready` (with payload `{ botUser: { id, username } }`)
   - Rename `disconnected` -> `disconnect` (with payload `{ reason: string }`)
   - Add `messageIgnored`, `commandExecuted`, `sessionLifecycle` event types
2. Add type-safe `override emit/on/once/off` methods to SlackConnector (copy Discord pattern)
3. Update `ISlackConnector` interface with type-safe method signatures

### Task 3: Emit missing events

**Files:** `packages/slack/src/slack-connector.ts`, `packages/core/src/fleet-manager/slack-manager.ts`

1. **`ready`** -- replace `this.emit("connected")` in `connect()` with typed `ready` event payload
2. **`disconnect`** -- replace `this.emit("disconnected")` in `disconnect()` with typed payload
3. **`messageIgnored`** -- emit at every `this.messagesIgnored++` site (5 locations: unconfigured channel, empty prompt x2, bot message, no agent resolved)
4. **`commandExecuted`** -- emit after successful command execution (done as part of Task 1)
5. **`sessionLifecycle`** -- emit from `SlackManager.handleMessage()` when sessions are created/resumed
6. Update `SlackManager`'s `ISlackConnector` interface to accept new event names

### Task 4: Add `mode` and `context_messages` to Slack channel config

**Files:** `packages/core/src/config/schema.ts`, `packages/slack/src/slack-connector.ts`, `packages/core/src/fleet-manager/slack-manager.ts`

1. Add `mode: z.enum(["mention", "auto"]).default("mention")` to `SlackChannelSchema`
2. Add `context_messages: z.number().int().positive().default(10)` to `SlackChannelSchema`
3. Pass channel config through to connector (extend channelAgentMap or add separate config map)
4. In `message` event handler: for top-level (non-thread) messages, check channel mode. If `mention`, only process if bot was @mentioned. Current behavior is effectively `auto` for all channels.
5. The `app_mention` handler continues to work regardless of mode (mentions always work).

### Task 5: Session cleanup on startup + minor fixes

**Files:** `packages/slack/src/slack-connector.ts`

1. After connect(), iterate sessionManagers and call `cleanupExpiredSessions()` (matching Discord's ready handler)
2. Fix `isConnected()` to also check `this.app !== null`
3. Log message stats on disconnect (matching Discord)

### Task 6: Create `bin/deploy-local.sh` script

**Files:** `bin/deploy-local.sh` (new)

Create a script to rebuild and deploy herdctl packages to the local Docker environment without manual tarball + devops coordination:

1. Build all packages (`pnpm build`)
2. Pack tarballs (`pnpm pack` in each package dir)
3. Copy tarballs to the devops config directory
4. Restart the herdctl container

This replaces the manual workflow of creating tarballs and coordinating with the devops agent.

### Task 7: Update tests

**Files:** `packages/slack/src/__tests__/slack-connector.test.ts`, `packages/slack/src/__tests__/command-handler.test.ts`, `packages/slack/src/__tests__/session-manager.test.ts`

Update existing tests and add new ones for:
- CommandHandler integration (commands intercepted before message emission)
- Type-safe event emissions (ready, disconnect, messageIgnored, etc.)
- Channel mode filtering
- Session cleanup on startup

### Task 8: Create changeset

Create a changeset (`pnpm changeset`) for both `@herdctl/slack` and `@herdctl/core` changes.

---

## Out of Scope

- **Channel-based sessions** -- The 009 PRD proposes switching from thread-based to channel-based sessions. After analysis, this is a separate design decision with significant UX implications (two threads sharing one Claude session is confusing). Keeping thread-based sessions for now. Can revisit as a separate issue.
- **Conversation context building** -- Fetching thread history via Slack API for richer context. This is a feature enhancement (WEA-17 adjacent), not a parity fix.
- **ErrorHandler class with retry logic** -- Discord has a full `ErrorHandler` class. Slack's simpler approach is adequate for MVP.
- **Streaming response refactor** -- Both managers have near-identical StreamingResponder classes. Deduplication is a future cleanup task.

---

## Priority Order

1. **Task 1: Wire CommandHandler** -- dead code is the most embarrassing gap
2. **Task 2: Type-safe events** -- foundational for Tasks 3-4
3. **Task 3: Emit missing events** -- depends on Task 2
4. **Task 4: Channel config (mode/context_messages)** -- standalone, can parallelize with 3
5. **Task 5: Startup cleanup + minor fixes** -- quick wins
6. **Task 6: Deploy script** -- developer experience
7. **Task 7: Tests** -- should be done alongside each task, listed separately for tracking
8. **Task 8: Changeset** -- must be last

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep thread-based sessions | Channel-based sessions (from 009 PRD) would mean two threads share one Claude context, which is confusing UX. Thread isolation is the correct Slack pattern. |
| Skip reconnecting/reconnected events | Bolt handles reconnection internally with no accessible hooks. |
| Skip rateLimit events | Bolt handles rate limits internally. No per-request events available. |
| Use `"slack"` as agentName for connector-level events | Slack connector is shared, not per-agent. Events like `ready`/`disconnect` don't map to a specific agent. |
| Keep prefix commands (!) for MVP | Slash commands require URL verification infrastructure. Prefix commands work immediately with Socket Mode. |
