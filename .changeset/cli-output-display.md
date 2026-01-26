---
"herdctl": minor
---

Display agent output by default after trigger

- Trigger command now displays the agent's final output by default (no hook required)
- Output truncated at 20,000 characters with count of remaining characters shown
- Add `--quiet` / `-q` flag to suppress output display (just show job info)
