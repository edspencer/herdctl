---
"@herdctl/core": minor
"@herdctl/slack": minor
---

feat: add Slack integration for agent chat

Adds `@herdctl/slack` package and integrates it into `@herdctl/core`:

- New `@herdctl/slack` package with SlackConnector (Bolt/Socket Mode), SessionManager, CommandHandler, error handling, and mrkdwn formatting
- Config schema: `AgentChatSlackSchema` and `SlackHookConfigSchema` for agent chat and hook configuration
- Core: `SlackManager` for single-connector-per-workspace lifecycle management with channel-to-agent routing
- Core: `SlackHookRunner` for posting schedule results to Slack channels
- Core: FleetManager wiring (initialize/start/stop), status queries, and event types for Slack connector
- Example: `examples/slack-chat-bot/` with setup instructions
