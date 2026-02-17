# WEA-47: Slack Channel Replies (Discord Parity)

## Problem

The Slack connector currently replies inside threads (`thread_ts`), using the thread timestamp as the session key. Discord replies directly in-channel. This creates an inconsistent UX: Slack conversations get buried in threads, while Discord conversations are visible to everyone.

For parity — and because in-channel replies are a better UX for most use cases — Slack should reply directly in the channel, using `channelId` as the session key.

## Current Architecture

### Session Management (`packages/slack/src/session-manager/`)

- **Session key**: `threadTs` (Slack thread timestamp)
- **State schema**: `{ version, agentName, threads: Record<threadTs, { sessionId, lastMessageAt, channelId }> }`
- **File**: `.herdctl/slack-sessions/<agent-name>.yaml`
- Methods all take `threadTs` as the primary key: `getOrCreateSession(threadTs, channelId)`, `getSession(threadTs)`, `setSession(threadTs, ...)`, `clearSession(threadTs)`, `touchSession(threadTs)`

### Message Reply (`packages/slack/src/slack-connector.ts`)

- **`say()` always passes `thread_ts`** — 3 call sites:
  - `buildMessageEvent()` reply closure (line ~558): `say({ text, thread_ts: threadTs })`
  - `tryExecuteCommand()` reply closure (line ~518): `say({ text, thread_ts: threadTs })`
  - `uploadFile()` (line ~250): `files.uploadV2({ ..., thread_ts: params.threadTs })`

### Thread Tracking (`packages/slack/src/slack-connector.ts`)

- **`activeThreads`**: in-memory `Map<threadTs, agentName>` for fast routing
- **`threadTs` resolution**: `event.thread_ts ?? event.ts` — every message gets a thread anchor
- Agent routing in `message` events uses `activeThreads.get(event.thread_ts)` to find which agent owns a thread

### File Sending (`packages/core/src/fleet-manager/slack-manager.ts`)

- `SlackManager.handleMessage()` creates `FileSenderContext` with `channelId` and `threadTs` captured from the incoming event (line ~590)
- `connector.uploadFile()` passes both `channelId` and `threadTs` to `files.uploadV2()`

### Commands (`packages/slack/src/commands/`)

- `CommandContext` includes `threadTs` — used by `!reset` (calls `clearSession(threadTs)`) and `!status` (calls `getSession(threadTs)`)

## Proposed Changes

### 1. Session Manager — Re-key from `threadTs` to `channelId`

**File**: `packages/slack/src/session-manager/session-manager.ts`, `types.ts`

- Rename state schema field `threads` to `channels`: `Record<channelId, ChannelSessionSchema>`
- `ChannelSessionSchema` replaces `ThreadSessionSchema`: `{ sessionId, lastMessageAt }`
  - Drop `channelId` from the session record (it's now the key itself)
- Update all public methods:
  - `getOrCreateSession(channelId)` (drop second param — `channelId` is now the key)
  - `getSession(channelId)`
  - `setSession(channelId, sessionId)`
  - `clearSession(channelId)`
  - `touchSession(channelId)`
- Update `ISlackSessionManager` interface accordingly
- Bump state `version` to `2` — no migration needed (pre-MVP, just ignore v1 files)

### 2. SlackConnector — Remove `thread_ts` from replies

**File**: `packages/slack/src/slack-connector.ts`

**Reply closures** — remove `thread_ts`:
- `buildMessageEvent()`: `say({ text: content })` (no `thread_ts`)
- `tryExecuteCommand()`: `say({ text: content })` (no `thread_ts`)

**`uploadFile()`** — remove `threadTs` param:
- `files.uploadV2({ channel_id, file, filename, initial_comment })` (no `thread_ts`)
- Update `UploadFileParams` type to drop `threadTs`

**Thread tracking → Channel tracking**:
- Rename `activeThreads: Map<threadTs, agentName>` to `activeChannels: Map<channelId, agentName>`
- This map is already mostly redundant with `channelAgentMap` from config. Consider removing it and relying solely on `channelAgentMap` + session manager for routing. However, `activeChannels` may still be useful for tracking whether a conversation is in-flight, so keep it for now.

**`threadTs` resolution** — remove:
- No longer need `const threadTs = event.thread_ts ?? event.ts`
- Route by `event.channel` (channelId) instead

**Event metadata**:
- `SlackMessageEvent.metadata` currently has `{ channelId, threadTs, messageTs, userId }`
- Remove `threadTs` from metadata
- Keep `messageTs` (used for processing indicator reactions)

### 3. Message Event Types

**File**: `packages/slack/src/types.ts`

- Remove `threadTs` from `SlackMessageMetadata`
- Remove `threadTs` from `UploadFileParams`
- Remove `threadTs` from `CommandContext`

### 4. Commands — Use `channelId` instead of `threadTs`

**File**: `packages/slack/src/commands/reset.ts`, `status.ts`

- `!reset`: Call `sessionManager.clearSession(channelId)` instead of `clearSession(threadTs)`
- `!status`: Call `sessionManager.getSession(channelId)` instead of `getSession(threadTs)`
- `CommandContext`: Replace `threadTs` with `channelId` (already has `channelId`, just drop `threadTs`)

### 5. SlackManager — Update file sender context

**File**: `packages/core/src/fleet-manager/slack-manager.ts`

- `FileSenderContext.uploadFile` closure: pass only `channelId`, drop `threadTs`
- Session manager calls: use `channelId` instead of `threadTs` for `getSession()`, `setSession()`, `touchSession()`

### 6. Agent Routing Simplification

Currently, for `message` events (non-mention), routing is:
1. Check `activeThreads.get(event.thread_ts)` — thread-based agent lookup
2. If not found, try session recovery via `sessionManager.getSession(thread_ts)`
3. If not found, check `channelAgentMap.get(event.channel)` for auto-mode channels

With channel-based sessions, this simplifies to:
1. Check `channelAgentMap.get(event.channel)` — channel config determines the agent
2. Session context (resume ID) comes from `sessionManager.getSession(channelId)`

Thread-in-thread messages (replies inside Slack threads) will also be handled: `event.channel` is always the channel regardless of whether the message is in a thread.

## Files to Modify

| File | Change |
|------|--------|
| `packages/slack/src/session-manager/types.ts` | Re-key schema from threadTs to channelId |
| `packages/slack/src/session-manager/session-manager.ts` | Update all methods to use channelId |
| `packages/slack/src/session-manager/errors.ts` | Update error messages (threadTs → channelId) |
| `packages/slack/src/slack-connector.ts` | Remove thread_ts from say(), uploadFile(), routing |
| `packages/slack/src/types.ts` | Remove threadTs from metadata/params types |
| `packages/slack/src/commands/reset.ts` | Use channelId for session clearing |
| `packages/slack/src/commands/status.ts` | Use channelId for session lookup |
| `packages/core/src/fleet-manager/slack-manager.ts` | Use channelId for sessions, drop threadTs from file sender |
| Tests for all of the above | Update to channel-based assertions |

## What NOT to Change

- **`app_mention` vs `message` event handling** — keep both event types, just remove thread-scoping
- **Channel modes (`mention` / `auto`)** — no change, still configured per-channel
- **Session expiry logic** — same mechanism, just keyed differently
- **Streaming/chunking** — `StreamingResponder` is unaffected
- **Processing indicator** (`hourglass` reaction) — still uses `messageTs`, unaffected
- **`message-handler.ts`** — mention detection, bot filtering unchanged
- **`formatting.ts`, `error-handler.ts`, `errors.ts`** — unchanged

## Edge Cases

### Multiple users in same channel
With thread-based sessions, each thread was isolated. With channel-based sessions, all users in a channel share one agent session. This is the intended behavior (matches Discord) — the agent maintains context across all messages in the channel.

### Thread replies from users
Users might still reply inside Slack threads (e.g., to a specific bot message). These should still be routed to the agent — `event.channel` is the same regardless. The bot's reply goes to the channel (not the thread), which is consistent.

### `!reset` scope
`!reset` now clears the entire channel session, not just a thread session. This is the correct behavior — there's only one session per channel.

## Testing Strategy

- Unit tests for session manager with channelId keys
- Unit tests for connector reply without thread_ts
- Unit tests for commands using channelId
- Integration test: message → reply appears in channel (not thread)
- E2E: deploy and verify in Slack
