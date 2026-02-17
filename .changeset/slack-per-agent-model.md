---
"@herdctl/slack": minor
"@herdctl/core": minor
---

feat(slack): align SlackConnector to per-agent model matching Discord

Restructured the Slack integration from a single shared connector with channel-agent routing to one connector per agent, matching Discord's per-agent architecture.

- SlackConnector now takes per-agent options (agentName, channels, sessionManager)
- SlackManager creates Map<string, ISlackConnector> instead of single connector  
- Event payloads (ready, disconnect, error) now include agentName
- Added getConnectorNames() and getConnectedCount() to SlackManager
- Removed getChannelAgentMap() from SlackManager
