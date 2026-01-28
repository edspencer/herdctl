---
"@herdctl/core": patch
"herdctl": patch
---

Fix system prompt not being passed to Claude SDK correctly. Custom system prompts were being ignored because we passed `{ type: 'custom', content: '...' }` but the SDK expects a plain string for custom prompts.
