---
"@herdctl/web": patch
---

Fix agent jobs table showing empty when clicking into an agent. The JobHistory component's useEffect was missing dependencies on jobsFilter and jobsOffset, causing it to not re-fetch when the filter changed. This bug prevented agent-specific job lists from loading.
