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
  registered agent without a whole-agent `addAgent(replace)`. `setAgentSchedule` also
  normalizes a lingering persisted `disabled` status to `idle` (via the new
  `armScheduleState` helper) so a set-after-disable is actually eligible to fire.
  Removal prunes persisted state via the new `deleteScheduleState` helper.
- **Concurrency-safe mutation:** schedule-state read-modify-writes are now serialized
  per state file (no lost sibling updates), `deleteScheduleState` tombstones the key so
  an in-flight run's trailing write can't resurrect deleted state, and an in-flight
  run's running-set entry is retained (only warn-once bookkeeping is cleared) so a
  same-name re-add can't start a second concurrent execution. Full generation-fencing
  of an old run's completion write after a same-name re-add is deferred (documented);
  the residual is bounded, non-resurrecting, and self-correcting.
- **Mutation gate:** a new `allowScheduleMutation` FleetManager option (default
  `false`) gates the two mutation methods; when disabled they throw the new
  `ScheduleMutationDisabledError`. Enable/disable of existing schedules stays ungated.
