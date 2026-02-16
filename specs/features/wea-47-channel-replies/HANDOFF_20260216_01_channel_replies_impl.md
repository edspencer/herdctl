# Handoff: WEA-47 — Slack Channel Replies (Discord Parity)

## Summary

Refactored the entire Slack integration from thread-based to channel-based conversations. Sessions are now keyed by `channelId` instead of `threadTs`, replies go directly in the channel (no `thread_ts`), and the `activeThreads` tracking map was removed. All 13 files modified, typecheck/tests/build all green.

## What Was Done

### Session Manager (`packages/slack/src/session-manager/`)
- **types.ts**: `ThreadSession` → `ChannelSession`, `ThreadSessionSchema` → `ChannelSessionSchema`, removed `channelId` field from session (it's now the key), schema version `1` → `2`, `threads` map → `channels` map
- **session-manager.ts**: All methods re-keyed from `threadTs` to `channelId`, `getOrCreateSession(threadTs, channelId)` → `getOrCreateSession(channelId)`, `setSession(threadTs, sessionId, channelId)` → `setSession(channelId, sessionId)`
- **index.ts**: Updated exports to match new names

### Slack Connector (`packages/slack/src/`)
- **slack-connector.ts**: Removed `activeThreads: Map<string, string>` entirely, removed `thread_ts` from `say()` calls (replies now go in-channel), simplified `message` event handler (no more thread→agent recovery logic), removed `threadTs` from `buildMessageEvent()`, `tryExecuteCommand()`, and `uploadFile()` params
- **types.ts**: Removed `threadTs` from `SlackMessageEvent.metadata` and `SlackFileUploadParams`
- **index.ts**: Updated re-exports (`ThreadSession` → `ChannelSession`, etc.)

### Commands (`packages/slack/src/commands/`)
- **command-handler.ts**: Removed `threadTs` from `CommandContext`, reply function no longer uses `thread_ts`
- **reset.ts**: Uses `channelId` for `clearSession()`
- **status.ts**: Uses `channelId` for `getSession()`

### Core (`packages/core/src/fleet-manager/`)
- **slack-manager.ts**: Updated `SlackMessageEvent` and `ISlackConnector` interfaces, session lookup uses `channelId`, file upload no longer passes `threadTs`, removed `threadTs` from all emitted events (`slack:session:lifecycle`, `slack:message:handled`, `slack:message:error`)

### Tests (4 files updated)
- **session-manager.test.ts**: All thread-keyed tests → channel-keyed
- **slack-connector.test.ts**: Removed thread-specific test cases (thread recovery, activeThreads tracking), simplified to channel-based routing assertions
- **command-handler.test.ts**: Removed `threadTs` from `CommandContext` fixtures
- **slack-manager.test.ts**: Updated mock interfaces and event assertions

## What Worked

- Clean, mechanical refactor — no architectural surprises
- All existing test patterns transferred directly from thread→channel keying
- Removing `activeThreads` map simplified the connector significantly (the thread recovery logic was the most complex part of the message handler)

## What Didn't Work / Issues Found

- None — the refactor was straightforward

## Key Learnings

- Channel-based sessions are simpler than thread-based: no need for thread recovery after restarts, no `activeThreads` tracking map, no dual lookup (memory + session manager)

## Current State

### Build Status
- `pnpm typecheck`: **PASSES**
- `pnpm test`: **PASSES**
- `pnpm build`: **PASSES**

### Git State
- **Branch**: `features/wea-17-file-sending`
- **All WEA-47 changes are unstaged** — no commit yet
- 13 modified files + 1 updated handoff from previous session

### Linear Status

| Issue | Title | Status |
|-------|-------|--------|
| WEA-17 | File sending from agents | Done |
| WEA-47 | Slack: reply in channel instead of threads | In Progress (code complete, not committed) |

## Next Steps

1. **Build & deploy locally** — `deploy-herdctl` (builds all packages, packs tarballs, copies to devops dir, rebuilds Docker image, restarts container via `start-herdctl.sh`)
2. **E2E test in Slack** — verify channel-based replies work (messages go in-channel, not threads), test `!status`, `!reset`, file sending still works
3. **Commit WEA-47 changes** — stage the 13 modified files and commit
4. **Push branch** — `git push`
5. **Close WEA-47** in Linear
6. **Create PR** — branch has both WEA-17 (file sending) and WEA-47 (channel replies); suggest PR text first, then create

### Deploy command

```bash
deploy-herdctl          # full build + deploy
deploy-herdctl --skip-build  # if already built, just pack + deploy
```

Script location: `~/bin/deploy-herdctl`. It builds → packs tarballs → copies to `~/hetzner-dev-box-config/herdctl/tarballs/` → rebuilds Docker image → restarts via `start-herdctl.sh`. Logs: `docker logs --tail=50 herdctl`.

### E2E test checklist

- [ ] Bot replies in-channel (no thread creation)
- [ ] Follow-up messages in same channel continue the session
- [ ] `!status` shows session info (keyed by channelId)
- [ ] `!reset` clears the channel session
- [ ] File sending still works (WEA-17)
- [ ] No errors in `docker logs herdctl`

## Relevant Files

### Modified (WEA-47)
- `packages/slack/src/session-manager/types.ts` — schema & type definitions
- `packages/slack/src/session-manager/session-manager.ts` — session CRUD
- `packages/slack/src/slack-connector.ts` — main event routing & replies
- `packages/slack/src/types.ts` — event types
- `packages/slack/src/commands/command-handler.ts` — command context
- `packages/slack/src/commands/reset.ts` — reset command
- `packages/slack/src/commands/status.ts` — status command
- `packages/core/src/fleet-manager/slack-manager.ts` — core integration

### Reference
- `specs/features/wea-47-channel-replies/PRD.md` — implementation plan
