---
"@herdctl/core": patch
---

fix(core): shutdown bulk-cancel now actually cancels in-flight jobs

`FleetManager.stop({ cancelOnTimeout: true })` was a guaranteed no-op: on a
shutdown timeout it read jobs from a `current_job` fleet-state field that nothing
ever wrote, so no jobs were ever cancelled. Manual and scheduled jobs that stalled
shutdown kept running.

In-flight jobs are now tracked in a single shared AbortController registry that
both manual triggers (`JobControl.trigger`) and scheduled jobs
(`ScheduleExecutor`) register into. Shutdown bulk-cancel iterates that registry and
genuinely aborts each live run (killing the CLI subprocess / aborting the SDK
query). The registry is keyed by job id, so it is concurrency-safe under
`instances.max_concurrent > 1`. This is an internal, non-breaking change.

Refs edspencer/herdctl#324.
