---
"@herdctl/core": patch
---

Retire durable session wakes when the agent runs `CronDelete` (#409).

A recurring session wake (`CronCreate` / `/loop` / `ScheduleWakeup`) captured
into herdctl's durable wake set could not be cancelled from within the session:
`CronDelete` deleted the harness's in-memory cron (so `CronList` reported no
jobs) but herdctl kept firing the persisted wake on schedule until the 7-day
prune. `reconcile` deliberately keeps recurring wakes that are absent from a
turn's `session_crons` report — on a herdctl-resumed turn the session-only cron
is never re-armed, so its absence is indistinguishable from a delete — which
left `WakeRegistry.remove` (the intended "gap 4b" retirement path) with no
callers.

The session lifecycle now watches for `CronDelete` via a `PostToolUse` hook and
emits a `cron_deleted` signal carrying the deleted id, which the session-reaper
routes to `WakeRegistry.remove`. This works on both live and resumed turns
because it captures the delete explicitly rather than inferring it from the cron
snapshot.
