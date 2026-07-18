---
"@herdctl/core": minor
"@herdctl/web": minor
---

Add `spawned` trigger type (#377)

Extend `TriggerTypeSchema` with an explicit `spawned` value so a host (e.g. paddock)
can persist run provenance for agent-spawned jobs as a first-class enum rather than
inferring it. Additive and backward-compatible — existing headless fleets are
unchanged.

- **core:** `spawned` added to `TriggerTypeSchema` (and therefore the `TriggerType`
  type). `schedule` already covers scheduled runs, so no separate `scheduled` value
  is introduced.
- **web:** the job-history trigger-type icon/label map renders `spawned` with a
  `Bot` icon labelled "Spawned".

Supports paddock#267 (provenance badges).
