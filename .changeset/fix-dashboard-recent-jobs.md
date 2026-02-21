---
"@herdctl/web": patch
---

Fix dashboard showing empty "Recent Jobs" section

Removed the 24-hour client-side filter that was discarding all jobs when none had run recently. The section already limits to the 50 most recent jobs via the store, so the time-based cutoff was unnecessary and caused the dashboard to appear broken.
