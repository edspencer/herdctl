---
"@herdctl/core": patch
---

Fix shell escaping in Docker CLI runtime to prevent `$` and backtick characters in prompts from being interpreted by the shell. Previously, prompts containing dollar signs (e.g., "$1234") would have `$1` consumed by shell variable expansion, silently corrupting the prompt sent to the agent.
