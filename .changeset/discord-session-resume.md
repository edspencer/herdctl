---
"@herdctl/core": minor
"@herdctl/discord": minor
---

Add Claude Agent SDK session resumption for Discord conversation continuity

- Add `resume` option to `TriggerOptions` to pass session ID for conversation continuity
- Add `sessionId` and `success` to `TriggerResult` to return job result and SDK session ID
- Update `JobControl.trigger()` to pass `resume` through and return `success` status
- Add `setSession()` method to Discord SessionManager for storing SDK session IDs
- Update `DiscordManager.handleMessage()` to:
  - Get existing session ID before triggering (via `getSession()`)
  - Pass session ID as `resume` option to `trigger()`
  - Only store SDK session ID after **successful** job completion (prevents invalid session accumulation)

This enables conversation continuity in Discord DMs and channels - Claude will remember
the context from previous messages in the conversation. Session IDs from failed jobs
are not stored, preventing the accumulation of invalid session references.
