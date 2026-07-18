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
  per state file (no lost sibling updates); a removed schedule with an in-flight run is
  tombstoned so that run's trailing write can't resurrect deleted state; and the
  in-flight run's running-set entry is retained (only warn-once bookkeeping is cleared)
  so a same-name re-add can't start a second concurrent execution. The tombstone is
  coordinated with the active execution generation so it is neither left set nor cleared
  too early: `setAgents` lifts it for a re-armed schedule **only when no run for that key
  is in flight** — so `reload()` / `addAgent({replace})` / `setAgentSchedule` re-arm a
  removed name cleanly (no runaway per-tick firing from a stuck tombstone) while a still
  in-flight removed generation's trailing `next_run_at`/`last_error` write stays
  suppressed (can't contaminate the freshly re-added schedule); the tombstone is then
  lifted by that run's own `executeJob` finally on completion, or immediately by the
  remover when no run is in flight. `removeAgentSchedule` is in-memory-only (like
  `addAgent`/`removeAgent`): it does not rewrite `herdctl.yaml`, so a later `reload()`
  legitimately brings the schedule back.
- **Mutation gate:** a new `allowScheduleMutation` FleetManager option (default
  `false`) gates the two mutation methods; when disabled they throw the new
  `ScheduleMutationDisabledError`. Enable/disable of existing schedules stays ungated.
