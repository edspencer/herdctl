---
"@herdctl/core": patch
---

Fix cron schedules never firing after first trigger

The scheduler's cron check logic incorrectly skipped to the next future occurrence
when the scheduled time arrived, instead of recognizing it as due. This caused cron
schedules to never trigger after the initial run because `calculateNextCronTrigger(expression, now)`
always returns a time in the future.

The fix simplifies the logic to use `calculateNextCronTrigger(expression, lastRunAt)` directly,
letting `isScheduleDue()` determine if it's time to trigger. After triggering, `last_run_at`
updates to the current time, naturally advancing the schedule to the next occurrence.
