---
"@herdctl/core": patch
---

fix(session): a synchronous subagent finishing no longer reaps the parent session

`buildLifecycleHooks` mapped both `Stop` and `SubagentStop` to a `turn_end`
lifecycle signal. `SubagentStop` fires when a *synchronous* subagent (a
`Task`/`Agent` tool call) completes mid-parent-turn, so the session reaper —
which reaps on any `turn_end` that has no live background work — closed the
streaming session out from under the still-live parent turn. A keeper driving a
managed session (`openChatSession({ manageLifecycle: true })`, i.e. Paddock's
session drive-mode) then appeared to "stop" the instant a synchronous subagent
returned, never consuming its result. Only the main-agent `Stop` is a
reap-eligible turn boundary now; subagent-registered background tasks and crons
still surface via the `background_tasks_changed` stream and the parent `Stop`.
