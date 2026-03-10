---
"@herdctl/core": minor
"@herdctl/discord": minor
---

feat(discord): support file attachments (images, PDFs, text/code files) in Discord messages

When users upload files alongside a Discord message, the connector now detects and processes them:
- Text/code files are downloaded and inlined directly into the agent's prompt
- Images and PDFs are saved to the agent's working directory with a file path reference so the agent can use its Read tool to view them
- Configurable via `chat.discord.attachments` with options for file size limits, allowed types, and automatic cleanup
