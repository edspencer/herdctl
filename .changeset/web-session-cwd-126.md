---
"@herdctl/web": patch
---

Clear the stale SDK session mapping when a web-chat resume fails because the
session can no longer be found (issue #126).

When an agent's `working_directory` config changes, Claude Code keys its session
files by the spawn-time cwd, so a session created under the old cwd becomes
invisible under the new one and every resume of it fails. `WebChatManager` kept
the now-dead session attributed, so the web chat would keep trying to resume it.
On a session-not-found failure, the stored mapping for the resumed session is now
cleared (best-effort — clearing never masks the original error), complementing the
core retry shipped in #264.
