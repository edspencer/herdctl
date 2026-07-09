---
"@herdctl/core": minor
---

Wire the session reaper + wake registry into the fleet end-to-end (part 2 of edspencer/herdctl#307).

Builds on the `session/` mechanism to make idle-session reaping and wake re-triggering actually run inside a `FleetManager`:

- **`SessionLifecycleManager`** — assembles the `WakeRegistry` + `SessionReaper` + persistence + cron resolution + the resume-and-inject fire path into one facade. Firing a due wake resumes its session via `openChatSession({ resume, prompt, manageLifecycle: true })` and either hands the live session to a registered consumer or drains it headlessly so recurring wakeups keep firing.
- **`FleetManager`** now constructs a `SessionLifecycleManager` and passes `onTick: () => dispatchDue()` to the `Scheduler`, so due wakes fire on the existing scheduler loop. New surface: `getSessionLifecycle()` and `setSessionWakeHandler()` (the consumer hook for delivering woken turns onto a hub/attribution path).
- **`ChatSessionOptions.manageLifecycle`** — opt a streaming session into herdctl-managed lifecycle. `JobControl.openChatSession` wires the session's `onLifecycleSignal` to the reaper (`manage()`), so the session is reaped when it goes idle and its `session_crons` are captured for re-triggering.

Behavior is unchanged unless a caller opts in via `manageLifecycle` (or a consumer registers a wake handler): existing `openChatSession` callers keep owning `close()`.
