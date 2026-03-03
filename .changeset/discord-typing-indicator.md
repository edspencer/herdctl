---
"@herdctl/core": patch
"@herdctl/discord": minor
---

Add configurable typing_indicator option for Discord output

Users can now disable the Discord typing indicator via `output.typing_indicator: false` in their agent's Discord config. This prevents spurious "An unknown error occurred" messages caused by Discord rate-limiting the typing indicator on long-running agent jobs. The default remains `true` to preserve existing behavior.
