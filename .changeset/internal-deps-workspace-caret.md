---
"@herdctl/chat": patch
"@herdctl/discord": patch
"@herdctl/slack": patch
"@herdctl/web": patch
"herdctl": patch
---

Publish internal `@herdctl/*` dependencies as caret ranges instead of exact pins (edspencer/herdctl#315).

Every internal dependency was declared as `workspace:*`, which pnpm rewrites to the **exact** current version on publish. A published package therefore pinned its herdctl siblings to a single version, so any downstream that installed two herdctl packages cut at different times got **duplicate copies** of the shared package(s) — most importantly a second nested `@herdctl/core` that `npm dedupe` could not collapse.

Internal deps are now `workspace:^`, which publishes as `^x.y.z` while still resolving to the local workspace package in dev. A downstream depending on `@herdctl/core@^5.18.x` alongside a herdctl package now dedupes to a single `@herdctl/core`. No API changes — only the published dependency ranges are relaxed. `@herdctl/core` itself is unchanged (it has no internal dependencies); this patch republishes the packages that declare internal deps so the corrected ranges reach npm.
