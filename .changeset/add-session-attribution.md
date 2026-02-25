---
"@herdctl/core": minor
---

Add session attribution module for determining session origins (web, discord, slack, schedule, native) by cross-referencing job metadata and platform session YAML files. Exports `buildAttributionIndex()` which returns an `AttributionIndex` for looking up `SessionAttribution` by session ID.
