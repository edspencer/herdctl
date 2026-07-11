---
"@herdctl/web": patch
---

Fix `web.session_expiry_hours` config not being honored by the web chat manager (edspencer/herdctl#326).

The value was already plumbed from fleet config into `WebChatManager.initialize()`, but `initialize()` never captured it and `createSessionManagerForAgent()` hardcoded `sessionExpiryHours: 24` when constructing each agent's `ChatSessionManager`. The configured value is now stored on the manager and forwarded to every `ChatSessionManager`, matching how the Discord and Slack connectors already handle it.
