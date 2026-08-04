---
"@herdctl/core": minor
---

feat(core): `FleetManager.reapChatSession` — close a managed session that the reap policy will never release

`decideReap` keeps a streaming session alive for exactly as long as it holds
live background work, with — by its own header comment — "no idle timer, no
max-lifetime backstop, no idle-concurrency cap". That is the right default:
reaping a session with work in flight kills the work. But it left consumers with
no way out when a session becomes permanently unreapable, and there are at least
two ordinary ways that happens:

- A background task never exits (a model-authored `until` loop whose sentinel
  never arrives), so `backgroundTasks` never drains.
- A re-invocation turn dies without firing a Stop hook — on a subscription usage
  limit, say. `activity` has already cleared `awaitingTasks`, so every later
  `background_tasks_changed` returns early at the guard, and only a `turn_end`
  could re-arm it or reap. None comes. The session is stranded live with no
  pending reap.

In both cases the session's message stream never ends, so a consumer rendering
that stream shows the chat as running until the process restarts. There was no
API to end it.

**`SessionReaper.forceReap(sessionId)`** closes a live managed session
regardless of what it is holding, and **`FleetManager.reapChatSession(sessionId)`**
exposes it (the lifecycle manager is private on the fleet). Both are idempotent
and return `false` for an unknown, unmanaged or already-reaped id.

This belongs on the reaper rather than being a `close()` the consumer calls on
the `RuntimeSession` it already holds. Closing the query directly goes behind the
reaper's bookkeeping: `liveById` keeps a stale entry, so `whenSessionReaped`
never resolves — a later resume of that id stalls until its 5-minute ceiling
(#403) — and `WakeRegistry` skips that session's wakes forever. `forceReap`
routes through the same private `reap` the policy uses, so the id is
unregistered, reap waiters drain, and the consumer observes an ordinary
end-of-stream and unwinds through its ordinary path. No new teardown contract.

The reap log line now carries a reason (`Reaping idle session …` is unchanged;
a forced one reads `Reaping force-reaped on request session …`).

Policy is untouched: nothing reaps on its own that didn't before. This only adds
a door that can be opened deliberately, so a consumer can honour a user's "stop
this now". Note that `interrupt()` is not that door — it targets an in-flight
model turn, and a session held open purely for background work has none.

Unblocks [paddock#528](https://github.com/edspencer/paddock/issues/528), where a
chat wedges "running" with a Stop button that cannot do anything.
