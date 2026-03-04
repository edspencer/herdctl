---
"@herdctl/core": patch
---

fix: harden session ID path helpers against path traversal

Add validation to `getDockerSessionFile()` and `getCliSessionFile()` functions in cli-session-path.ts to reject session IDs containing path traversal sequences or invalid characters. Session IDs must now contain only alphanumeric characters and hyphens.