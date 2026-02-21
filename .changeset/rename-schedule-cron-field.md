---
"@herdctl/core": patch
"@herdctl/web": patch
"herdctl": patch
---

Rename schedule `expression` field to `cron` and suppress repeated warnings

The `cron` field is now the canonical name for cron expressions in schedule config (e.g., `cron: "0 9 * * *"`). The old `expression` field is still accepted as a backward-compatible alias.

Misconfigured schedules now log their warning only once instead of every scheduler tick (~1/second).
