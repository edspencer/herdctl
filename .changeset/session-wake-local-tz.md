---
"@herdctl/core": patch
---

Fix session `ScheduleWakeup` resolving ~24h late when the host timezone is behind UTC (edspencer/herdctl#311).

The SDK/native harness serializes a relative one-shot `ScheduleWakeup` (and `CronCreate` schedules) as a wall-clock cron expression in the **host's local timezone** — e.g. a "+60s" wake at 19:08 local becomes `"10 19 * * *"`. The session reaper's default wake resolver, however, resolved that cron in **UTC**. On a host behind UTC, the local wall-clock minute/hour has often already passed in UTC, so `nextRunAt` rolled to *tomorrow* and the wake sat idle for ~24h instead of firing in a minute.

`SessionLifecycleManager`'s default `resolveNextRun` now resolves session-cron schedules in the host's system timezone (via `calculateNextCronTrigger`), matching both the timezone the harness serialized them in and how the rest of the scheduler (`scheduler.ts`, `schedule-runner.ts`) already resolves fleet crons. Consumers that inject a custom `resolveNextRun` are unaffected.
