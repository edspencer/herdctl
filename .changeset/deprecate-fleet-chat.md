---
"@herdctl/core": minor
---

Deprecate the never-used fleet-level `chat` config block (edspencer/herdctl#329).

- The fleet-level `chat: { discord: { enabled, token_env } }` block was accepted by `FleetConfigSchema` but was never read at runtime — chat is configured per-agent under each agent's `chat` key. Loading a fleet config that still has a top-level `chat` block now logs a deprecation warning and strips the key before strict parsing, so the config continues to load.
- `FleetConfigSchema` no longer has a `chat` field, and the `ChatSchema` / `DiscordChatSchema` schemas (along with the `Chat` / `DiscordChat` types) have been removed from `@herdctl/core`'s public exports. Per-agent chat config (`AgentChatSchema`, `AgentChatDiscordSchema`, `AgentChatSlackSchema`, etc.) is unaffected.
- Fed directly through the lower-level `parseFleetConfig`/`FleetConfigSchema` (which has no backward-compat handling), a fleet-level `chat` key is now rejected as an unrecognized key — only the higher-level config loader (`loadConfig`/`safeLoadConfig`) warns and strips it, mirroring how the existing `workspace` → `working_directory` deprecation is handled.
