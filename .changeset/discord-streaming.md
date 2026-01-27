---
"@herdctl/core": minor
---

Stream Discord messages incrementally instead of batching

Previously, Discord chat would show "typing" for the entire duration of agent execution, then send all messages at once when complete. This could mean minutes of waiting with no feedback.

Now messages are streamed incrementally to Discord as the agent generates them:
- Messages sent at natural paragraph breaks (double newlines)
- Rate limiting respected (1 second minimum between sends)
- Large content automatically split at Discord's 2000 character limit
- Typing indicator continues between message sends

This provides a much more responsive chat experience, similar to how the CLI streams output.
