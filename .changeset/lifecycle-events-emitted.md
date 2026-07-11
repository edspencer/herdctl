---
"@herdctl/core": minor
---

Emit `agent:started` / `agent:stopped` lifecycle events and remove the never-emitted `schedule:skipped` event (edspencer/herdctl#323).

- `agent:started` is now emitted for each configured agent when `FleetManager.start()` completes, and when an agent is registered at runtime via `addAgent()`.
- `agent:stopped` is now emitted for each agent during `FleetManager.stop()` (reason `"shutdown"`), and when an agent is unregistered via `removeAgent()` (reason `"removed"`). Both events were previously declared and documented but never fired.
- The `schedule:skipped` event has been removed from the FleetManager public event surface (`FleetManagerEventMap`), along with the `ScheduleSkippedPayload` type and the `emitScheduleSkipped` helper. It was never emitted, nothing subscribed to it, and its declared reason enum did not match the scheduler's actual skip reasons. The separate `JobQueue` class's own `schedule:skipped` event is unaffected.
