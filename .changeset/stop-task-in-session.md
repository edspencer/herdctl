---
"@herdctl/core": minor
---

feat(core): stop a single background task in a live session

A consumer could not stop **one** background task in a session — two gaps, both
of which had to close.

**`RuntimeSession.stopTask(taskId)`** forwards the SDK's `stop_task` control
request. The SDK `Query` was a `const` captured in `SDKRuntime.openSession`'s
closure: never assigned to `this`, never returned, with no generic passthrough,
so `stopTask` was unreachable from outside. (`session.messages` is the `Query`
behind a cast, but any caller passing `onLifecycleSignal` — the interesting
case — gets a wrapper generator that forwards nothing.)

**`FleetManager.stopTaskInSession(sessionId, taskId)`** (and
`SessionReaper.stopTaskInSession` beneath it) addresses that stop by session id
instead of by handle. That is the half that actually bites: background shells,
subagents and monitors routinely outlive the turn that started them, while a
consumer holds its `RuntimeSession` only until the turn's result lands. A
handle-scoped stop therefore works only while a turn happens to be in flight and
goes inert over exactly the long tail where something is still running and the
user is asking why. Consumers cannot hold the handle longer, because they do not
own the session's lifetime — the reaper does, and already keeps the session past
the turn. This is the door onto that state, mirroring `reapChatSession` /
`forceReap`.

Semantics carried over from the CLI's own handler: idempotent (`not_found` /
`not_running` are successes, so stopping a task that just finished is fine — and
no liveness pre-check is added that would reintroduce that race); not
ownership-gated, so an out-of-band actor such as a UI stop button can stop any
task in the session; and self-notifying, since the SDK emits the terminal
`task_notification{status:"stopped"}` on the session's own stream.

`stopTaskInSession` returns `false` only for a session that is not live, matching
`reapChatSession`. A runtime refusal propagates rather than being translated into
a silent success — notably `monitor_mcp` tasks, which the CLI has no kill
strategy for and rejects with `unsupported_type`; a consumer needs to know the
button did nothing. A live session whose handle carries no `stopTask` at all
throws the new `SessionTaskControlUnsupportedError` for the same reason.
