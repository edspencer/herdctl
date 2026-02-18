---
"@herdctl/chat": minor
"@herdctl/core": major
"@herdctl/discord": major
"@herdctl/slack": major
"herdctl": patch
---

Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

- New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
- `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
- `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
- `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
- `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
- FleetManager dynamically imports platform packages at runtime
