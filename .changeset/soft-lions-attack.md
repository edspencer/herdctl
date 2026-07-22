---
"@herdctl/core": minor
---

Fix double-resume interrupt class: `openChatSession` no longer spawns a second `claude` for a session that already has a live subprocess (edspencer/herdctl#403).

The `SessionReaper` deliberately keeps a session's subprocess alive across the turn boundary while background work runs (keepAlive) or during the ~15s re-invocation grace. Resuming that same session id in that window launched a competing `claude`, and the SDK resolved the collision by interrupting the in-flight turn (`[Request interrupted by user]`) — biting every downstream resume path (keeper auto-recovery, manual Continue, queued-message drain, and any unguarded wake).

`openChatSession` now consults `SessionReaper.isSessionLive(id)` before spawning — the same guard the wake registry already applied — and defers a real (non-fork) resume until the session is reaped, then spawns exactly as a normal fresh resume would. A bounded ceiling (`ChatSessionOptions.resumeDeferTimeoutMs`, default 5 min) keeps a leaked/never-reaped session from hanging the caller. Fresh (non-resume) sessions and the already-guarded wake path are unaffected. Adds `SessionReaper.whenSessionReaped(sessionId)`.
