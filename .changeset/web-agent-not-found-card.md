---
"@herdctl/web": patch
---

Fix the agent detail page showing a generic, retryable error panel for a
non-existent agent. A 404 now renders the dedicated "Agent Not Found" card (with
a "Back to Dashboard" link) instead of an error box with a misleading "Retry"
button that could only ever 404 again. Fixes #268.
