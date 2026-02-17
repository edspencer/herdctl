---
"@herdctl/core": patch
"@herdctl/slack": patch
---

Fix symlink bypass in file-sender-mcp path validation, narrow Slack error classification, add missing event types, and correct help text

- **Security**: Use `realpath()` before path containment check in file-sender-mcp to prevent symlink bypass
- **Bug fix**: Narrow `classifyError()` token matching from broad `"token"` substring to specific Slack API error codes (`token_revoked`, `token_expired`, `not_authed`)
- **Types**: Add typed `FleetManagerEventMap` entries for four Slack manager events (`slack:message:handled`, `slack:message:error`, `slack:error`, `slack:session:lifecycle`)
- **Docs**: Fix help text to reflect channel-based sessions instead of thread-based
