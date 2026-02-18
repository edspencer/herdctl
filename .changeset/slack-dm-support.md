---
"@herdctl/core": minor
"@herdctl/slack": minor
"@herdctl/discord": patch
---

Add Slack DM support with enabled/allowlist/blocklist (matching Discord).

- Rename `DiscordDMSchema` to `ChatDMSchema` (shared between platforms)
- Add `dm` field to `AgentChatSlackSchema` for DM configuration
- Implement DM detection and filtering in `SlackConnector` (channel IDs starting with `D`)
- Add `isDM` flag to `SlackMessageEvent` metadata
- Add `dm_disabled` and `dm_filtered` message ignored reasons
