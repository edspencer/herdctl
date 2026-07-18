---
"@herdctl/core": minor
---

Scheduler: host-execution seam + runtime schedule mutation (additive, backward-compatible)

Make the scheduler embeddable so a host can own execution and mutate schedules at
runtime. Existing headless fleets are unchanged — every new capability is opt-in.

- **Host-execution seam (#375):** `FleetManager.setScheduleTriggerHandler(handler)`
  mirrors `setSessionWakeHandler`. When set, a fired schedule routes to the host
  handler (which can resume/stream the turn on its own hub) instead of the built-in
  headless `ScheduleExecutor`; when unset, schedules run headless exactly as before.
  Cron/interval timing is untouched. Every scheduler-fired trigger — including a
  forced immediate fire — funnels through this seam.
- **Relative-wake timezone hardening (#311):** `resolveSystemTimeZone()` centralizes
  the host-timezone lookup used by `calculateNextCronTrigger`/
  `calculatePreviousCronTrigger`, falling back to `UTC` when an ICU-less runtime
  reports no timezone (which could otherwise revive the 24h-idle bug).
- **Runtime schedule mutation (#376):** `FleetManager.setAgentSchedule(agent, name,
  schedule)` and `removeAgentSchedule(agent, name)` add/remove a single schedule on a
  registered agent without a whole-agent `addAgent(replace)`. Removal prunes persisted
  state via the new `deleteScheduleState` helper and clears the scheduler's in-memory
  tracking (`Scheduler.clearScheduleTracking`), so a re-added name never inherits a
  stale `last_run_at`/`disabled` status.
- **Mutation gate:** a new `allowScheduleMutation` FleetManager option (default
  `false`) gates the two mutation methods; when disabled they throw the new
  `ScheduleMutationDisabledError`. Enable/disable of existing schedules stays ungated.
