# BragDoc Developer Agent Example

This example demonstrates **project-embedded agents** - herdctl agents that run inside an existing Claude Code project.

## What This Demonstrates

When you point a herdctl agent at an existing codebase:
- The agent runs as if you typed `claude` in that directory
- Your `CLAUDE.md` instructions are honored
- Local skills (`.claude/skills/`) are available
- Local agents (`.claude/agents/`) are available
- Local commands (`.claude/commands/`) are available
- MCP servers configured for the project work

This agent points at the BragDoc project, which has:
- A comprehensive `CLAUDE.md` with project-specific instructions
- Skills for corpus extraction and analysis
- Agents for blog writing and screenshots
- Commands for various workflows

## Setup

1. **Create a Discord Bot**
   - Go to https://discord.com/developers/applications
   - Create a new application
   - Add a bot to your application
   - Enable "Message Content Intent" in bot settings
   - Copy the bot token

2. **Set Environment Variable**
   ```bash
   export BRAGDOC_DISCORD_BOT_TOKEN="your-bot-token-here"
   ```

3. **Update Workspace Path**

   Edit `agents/developer.yaml` and update the `workspace` path to point to your local BragDoc clone:
   ```yaml
   workspace: /path/to/your/brag-ai
   ```

4. **Start the Agent**
   ```bash
   cd examples/bragdoc-developer
   herdctl start
   ```

5. **Test It**
   - DM your bot on Discord
   - Ask questions about the codebase:
     - "What skills are available in this project?"
     - "How is authentication implemented?"
     - "What does the /check-blog command do?"

## Verifying It Works

A successful test shows:
1. The agent can answer questions about BragDoc's codebase
2. The agent knows about the skills in `.claude/skills/`
3. The agent can reference commands from `.claude/commands/`
4. The agent follows instructions from `CLAUDE.md`

## Configuration Notes

- `workspace` - The path to an existing Claude Code project
- `chat.discord` - Enables Discord as a chat interface
- `session.persistence: agent` - Maintains one conversation per agent (context persists across messages)
- `permission_mode: bypassPermissions` - Gives full tool access (be careful with this in production)
