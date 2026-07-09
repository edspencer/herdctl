---
"@herdctl/core": minor
---

Add streaming-session lifecycle management: a session reaper and a wake registry (part 1 of edspencer/herdctl#307).

Long-lived chat sessions (`openChatSession` / `SDKRuntime.openSession`) now have the building blocks to be reaped the instant they go idle — rather than accumulating warm native `claude` processes at ~300 MB each — and to have their timer-class wakeups (`ScheduleWakeup` / `CronCreate`) re-triggered through herdctl's own scheduler after the reap.

New, additive surface under `@herdctl/core`:

- **`session/` module** — `decideReap` (the one-rule reap policy), `reconcileSessionWakes` + the wake-store helpers (reconcile SDK `session_crons` by id into durable wake entries with an absolute `nextRunAt`, one-shot vs recurring semantics, 7-day recurring expiry), `WakeRegistry` (async-locked, concurrency-limited, deadlock-free due-firing that skips still-live sessions), `SessionReaper` (drives reap vs keep-alive from turn-end / `background_tasks_changed` / activity signals), `buildLifecycleHooks` / `tapLifecycleStream`, and `FleetStateWakePersistence`.
- **`SDKRuntime.openSession`** now installs `Stop`/`SubagentStop` lifecycle hooks and taps the message stream when a new `onLifecycleSignal` execute-option is provided, and threads an `AbortController` into the query for clean teardown.
- **`Scheduler`** gains an `onTick` option so wake firing reuses the existing scheduler loop instead of a second timer.
- Fleet state gains an optional `session_wakes` slice.

No behavior changes to existing paths: sessions are only managed when a caller opts in via `onLifecycleSignal`, and the reaper/registry are not yet wired into `FleetManager.openChatSession` (that end-to-end wiring + consumer surface is part 2).
