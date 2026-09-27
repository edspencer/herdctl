---
"@herdctl/core": patch
---

Raise the `@anthropic-ai/claude-agent-sdk` floor from `^0.3.215` to `^0.3.283`, so the SDK runtime (and every streaming chat session) runs a bundled Claude Code of at least 2.1.283.

The SDK runs its own bundled `claude` binary, not the one on `PATH`. The old floor let consumers resolve SDK 0.3.215, whose binary (2.1.215) predates Claude Opus 5.5, which needs Claude Code 2.1.280 or newer. With it, every turn using `claude-opus-5-5` failed with `API Error: 400 Claude Code 2.1.216 does not support this model`. Consumers that already lock a newer SDK are unaffected.
