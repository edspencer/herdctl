---
"@herdctl/discord": patch
"@herdctl/core": patch
---

Fix Discord PDF attachment handling, revert result_summary default, and improve attachment diagnostics

- Guess MIME type from file extension when Discord returns null contentType (fixes PDF uploads in DMs)
- Revert result_summary default from true back to false (unintentional change in PR 194)
- Upgrade attachment skip/ignore logging from debug to warn for easier troubleshooting
- Add warn log when message has attachments but attachments.enabled is false
