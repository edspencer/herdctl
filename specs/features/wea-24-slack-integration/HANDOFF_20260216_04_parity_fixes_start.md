# Handoff: WEA-24 Slack Connector Discord Parity Fixes (Start)

## Summary

Created the PRD and Linear subtask structure for WEA-24 (Slack connector Discord parity fixes). Completed 3 of 7 subtasks: wired up dead CommandHandler code (WEA-27), added type-safe event emitter with aligned event map (WEA-28), and partially completed missing event emissions (WEA-29 -- in progress, `messageIgnored` and `commandExecuted` done in connector, `sessionLifecycle` in SlackManager not yet done).

## What Was Done

### Planning & Linear Setup
- Created PRD at `specs/issues/wea-24/prd.md` -- comprehensive analysis derived from 008/009 research PRDs on the `features/specs/features/002-architecture-research` branch
- Marked WEA-23 (alignment analysis) as Done since its findings are captured in WEA-24
- Created WEA-26 (low priority) for local fork workflow / branch management concern
- Created 7 Linear subtasks under WEA-24: WEA-27 through WEA-33
- Marked WEA-24 as In Progress

### WEA-27: Wire up CommandHandler (Done)
- `packages/slack/src/slack-connector.ts`:
  - Imported `CommandHandler`, `helpCommand`, `resetCommand`, `statusCommand`
  - Added `commandHandler` field, initialized in `connect()` after bot info retrieval
  - Added `tryExecuteCommand()` helper method that checks for `!` prefix commands
  - Both `app_mention` and `message` handlers now check commands before emitting message events
  - CommandHandler nulled on `disconnect()`

### WEA-28: Type-safe event emitter + event map alignment (Done)
- `packages/slack/src/types.ts`:
  - Replaced tuple-syntax event map (`message: [payload: SlackMessageEvent]`) with object-syntax (`message: SlackMessageEvent`) matching Discord pattern
  - Renamed events: `connected` -> `ready`, `disconnected` -> `disconnect`
  - Added new event types: `messageIgnored`, `commandExecuted`, `sessionLifecycle`
  - Updated `ISlackConnector` interface with type-safe `on`/`once`/`off` overrides
  - Simplified `SlackConnectorEventPayload` type (no more tuple unwrapping)
- `packages/slack/src/slack-connector.ts`:
  - Added `override emit/on/once/off` methods with generic type constraints (matching Discord's pattern exactly)
  - Updated `connect()` to emit `ready` event with payload `{ botUser: { id, username } }`
  - Updated `disconnect()` to emit `disconnect` event with payload `{ reason }` + log message stats

### WEA-29: Emit missing events (In Progress)
- `packages/slack/src/slack-connector.ts`:
  - Added `messageIgnored` emissions at all 5 `messagesIgnored++` sites with typed reasons: `not_configured`, `empty_prompt`, `bot_message`, `no_agent_resolved`
  - Added `commandExecuted` emission in `tryExecuteCommand()` after successful command execution
- **NOT YET DONE**: `sessionLifecycle` events in `packages/core/src/fleet-manager/slack-manager.ts`
- **NOT YET DONE**: Updated `ISlackConnector` interface in slack-manager.ts (partially done -- `error` event payload updated)

## What Worked

- **Incremental subtask approach** -- each task is small, testable, and independent (or clearly dependent)
- **Discord as reference** -- having the Discord connector as a mature pattern made each change straightforward
- **Type system catches issues** -- the type-safe event emitter immediately flagged mismatched event names/payloads

## What Didn't Work / Issues Found

- **Accidentally marked wrong Linear issue as In Progress** -- WEA-22 instead of WEA-27. Fixed immediately but worth noting the Linear API uses UUIDs, not identifiers.
- **PRDs on different branch** -- the 008/009 research PRDs live on `features/specs/features/002-architecture-research` branch, not the current branch. Used `git show` to read them.

## Key Learnings

- **Channel-based sessions (from 009 PRD) are wrong for Slack** -- the PRD proposed switching from thread-based to channel-based sessions to match Discord. After analysis, this would mean two threads sharing one Claude session context, which is confusing UX. Thread-based sessions are the correct Slack-native pattern. Documented this decision in the PRD.
- **No changesets during local dev** -- we build/deploy locally from tarballs to Docker, so changesets are only needed at PR time.
- **Slack connector's `error` event changed shape** -- removed `agentName` since the connector is shared across agents. The `SlackManager` in core needed its local `ISlackConnector` interface updated to match.

## Current State

- **Branch**: `features/specs/features/001-slack-integration`
- **Typecheck**: passes (`pnpm typecheck --filter @herdctl/slack`)
- **Tests**: all 330 pass (`pnpm test --filter @herdctl/slack`)
- **Not committed**: all changes are unstaged
- **Not deployed**: no Docker rebuild yet

### Linear Status
| Issue | Title | Status |
|-------|-------|--------|
| WEA-24 | Slack connector: Discord parity fixes | In Progress |
| WEA-27 | Wire up CommandHandler | Done |
| WEA-28 | Type-safe event emitter + event map | Done |
| WEA-29 | Emit missing events | In Progress |
| WEA-30 | Add mode/context_messages to config | Backlog |
| WEA-31 | Session cleanup on startup + fixes | Backlog |
| WEA-32 | Create bin/deploy-local.sh | Backlog |
| WEA-33 | Update tests | Backlog |

## Next Steps

1. **Finish WEA-29**: Add `sessionLifecycle` events in `packages/core/src/fleet-manager/slack-manager.ts` (emit when session created/resumed in `handleMessage()`)
2. **WEA-30**: Add `mode` and `context_messages` to `SlackChannelSchema` in `packages/core/src/config/schema.ts`, wire into connector for top-level message filtering
3. **WEA-31**: Add session cleanup on startup, fix `isConnected()`, log stats on disconnect
4. **WEA-32**: Create `bin/deploy-local.sh` script for Docker deployment workflow
5. **WEA-33**: Update tests for all changes
6. After all subtasks done: build, mark WEA-24 as "In Review", manual testing
7. If tests pass: mark WEA-24 as Done, move to next issue

## Relevant Files

### Modified in this session
- `packages/slack/src/slack-connector.ts` -- CommandHandler wiring, type-safe overrides, event emissions
- `packages/slack/src/types.ts` -- event map rewrite, ISlackConnector update
- `packages/core/src/fleet-manager/slack-manager.ts` -- ISlackConnector error event update (partial)

### Created in this session
- `specs/issues/wea-24/prd.md` -- full PRD for WEA-24

### Key reference files
- `packages/discord/src/discord-connector.ts` -- reference implementation for parity
- `packages/discord/src/types.ts` -- Discord event map (target pattern)
- `packages/core/src/fleet-manager/slack-manager.ts` -- where sessionLifecycle events need to go
- `packages/core/src/config/schema.ts` -- where mode/context_messages need to be added
