---
"@herdctl/core": minor
---

Add Discord chat integration via DiscordManager module

- DiscordManager manages lifecycle of Discord connectors per agent
- Messages routed to FleetManager.trigger() for Claude execution
- Responses delivered back to Discord channels with automatic splitting
- Session persistence across restarts via SessionManager
- New events: discord:message:handled, discord:message:error, discord:error
- New status queries: getDiscordStatus(), getDiscordConnectorStatus()
