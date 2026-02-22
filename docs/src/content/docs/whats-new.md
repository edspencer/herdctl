---
title: What's New
description: Recent features, improvements, and releases across the herdctl ecosystem
---

A summary of notable changes across the herdctl packages. For the full technical details of every release, see the CHANGELOG.md in each package directory.

---

### Chat Session Management Improvements
**February 22, 2026** · `@herdctl/web@0.6.0` · `@herdctl/core@5.5.0` · `herdctl@1.3.8`

The web dashboard now includes comprehensive chat session management features. Delete chat sessions directly from the sidebar by hovering over a chat to reveal trash and pencil icons. Deleted sessions are removed immediately with a confirmation step. Additionally, you can now configure how agent messages are displayed: choose between "separate" mode (each assistant turn as its own bubble) or "grouped" mode (consecutive turns merged into one). The preference is saved in your browser and can be toggled via a new chat settings control. Also includes a critical fix for session cross-contamination when SDK session mappings were missing, ensuring each web chat always starts with the correct conversation context.

---

### Inline Chat Session Renaming and Dashboard Improvements
**February 21, 2026** · `@herdctl/web@0.5.0` · `@herdctl/core@5.4.3` · `herdctl@1.3.7`

Chat sessions in the web dashboard sidebar can now be renamed inline. Click the pencil icon (visible on hover) to edit the session name, press Enter to save or Escape to cancel. Custom names take precedence over auto-generated previews. This release also fixes agent link navigation issues (jobs now store qualified names like `herdctl.engineer` for correct routing) and renames the schedule `expression` field to the more intuitive `cron` field (the old name still works for backward compatibility). Misconfigured schedules now log warnings only once instead of spamming every scheduler tick. The dashboard's "Recent Jobs" section no longer appears empty when no jobs have run in the last 24 hours.

---

### Shell Escaping Fix for Docker CLI Runtime
**February 21, 2026** · `@herdctl/core@5.5.0`

Fixed a critical bug where special characters in prompts (`$` and backticks) were being interpreted by the shell instead of passed literally to agents running in Docker CLI mode. Previously, prompts containing dollar signs (e.g., "Analyze $1234 in sales data") would have `$1` consumed by shell variable expansion, silently corrupting the agent's input. All prompts are now properly escaped before being passed to Docker containers.

---

### Pre-commit Hooks and iOS Safari Fix
**February 21, 2026** · `@herdctl/web@0.4.0`

Added pre-commit hooks to enforce code quality checks before commits. Fixed an iOS Safari issue where focusing on the chat input field would trigger aggressive auto-zoom, making the interface difficult to use on mobile devices. The input field now uses a 16px font size to prevent Safari's zoom behavior.

---

### Software Engineer Agent and Documentation Diagrams
**February 20, 2026** · `@herdctl/core@5.4.0`

Introduced a new built-in software engineer agent with persistent conversation state for multi-turn development workflows. The agent maintains context across sessions, making it ideal for iterative code reviews, debugging, and implementation tasks. Additionally, the documentation site now includes comprehensive Mermaid diagrams across multiple pages, visualizing architecture, data flows, and system interactions.

---

### Code Quality Tooling
**February 19, 2026** · `@herdctl/core@5.4.1` · `herdctl@1.3.4`

Added Biome for linting and formatting across all packages, replacing the previous linting setup. The new tooling provides faster, more consistent code formatting and better integration with modern development workflows. Also removed dead code identified by a knip audit, reducing bundle size and maintenance surface area.

---

### Tool Call Visibility for Slack and Web
**February 19, 2026** · `@herdctl/slack@1.2.0` · `@herdctl/web@0.2.0` · `@herdctl/chat@0.3.0` · `@herdctl/core@5.3.0`

Slack and Web chat integrations now display tool calls and results, matching Discord's existing functionality. When agents use tools like Bash, Read, Write, or Grep during conversations, the results appear as formatted messages (Slack) or collapsible UI components (Web) showing the tool name, input summary, execution duration, and output preview. Shared tool parsing utilities (`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`, `TOOL_EMOJIS`) are now in `@herdctl/chat` for reuse across all platforms. Slack adds a configurable `output` block (matching Discord) with `tool_results`, `tool_result_max_length`, `system_status`, and `errors` settings.

---

### Web Dashboard
**February 18, 2026** · `herdctl@1.2.0` · `@herdctl/web@0.1.0` · `@herdctl/core@5.2.0`

A brand-new web dashboard for monitoring and interacting with your fleet in the browser.
Start it with `herdctl start --web` (optionally `--web-port <port>`) and get real-time
fleet status via WebSocket, live agent output streaming, interactive chat with any agent,
schedule management with trigger/enable/disable controls, and job management including
cancel and fork. Supports dark, light, and system themes.

---

### Shared Chat Infrastructure (`@herdctl/chat`)
**February 17, 2026** · `@herdctl/chat@0.2.0` · `@herdctl/core@5.0.0` · `@herdctl/discord@1.0.0` · `@herdctl/slack@1.0.0`

Introduced the new `@herdctl/chat` package, extracting shared session management, streaming
response handling, message splitting, DM filtering, and error handling out of core and into
a dedicated library. Discord and Slack managers now live in their respective platform packages
(`@herdctl/discord` and `@herdctl/slack`) instead of in `@herdctl/core`, and FleetManager
dynamically imports platform packages at runtime. This is a breaking change for anyone importing
`DiscordManager` or `SlackManager` from `@herdctl/core` directly.

---

### Slack DM Support
**February 18, 2026** · `@herdctl/slack@1.1.0` · `@herdctl/core@5.1.0`

Slack bots can now respond to direct messages, not just channel mentions. DM support
uses the same `enabled`/`allowlist`/`blocklist` configuration model as Discord,
giving you fine-grained control over which users can DM your agents.

---

### Slack Integration
**February 17, 2026** · `@herdctl/slack@0.2.0` · `@herdctl/core@4.1.0`

Connect your agents to Slack channels. Users can @mention the bot to start conversations,
with replies continuing in-thread. Built on Bolt with Socket Mode, Slack agents support
per-agent connector architecture, file uploads via an injected `herdctl_send_file` MCP tool,
markdown-to-mrkdwn conversion, and channel-to-agent routing. Includes a full
`examples/slack-chat-bot/` to get started quickly.

---

### Verbose Logging and Colorized Output
**February 17, 2026** · `herdctl@1.1.0` · `@herdctl/core@4.1.1`

Added a `--verbose` / `-v` flag to `herdctl start` and the `HERDCTL_LOG_LEVEL` environment
variable (`debug` / `info` / `warn` / `error`). Log output in the terminal is now colorized
to match the style of `herdctl logs`, and internal debug messages are hidden by default,
significantly reducing noise during normal operation.

---

### Discord Tool Result Embeds
**February 16, 2026** · `@herdctl/discord@0.2.0` · `@herdctl/core@4.0.0`

When an agent uses tools like Bash, Read, or Write during a Discord conversation, the results
now appear as rich embeds with the tool name, input summary, duration, and truncated output.
System status messages and errors are also surfaced. All embed types are individually
configurable via the new `output` block in your agent's Discord chat config.

---

### Cron Schedule Fix
**February 11, 2026** · `@herdctl/core@3.0.2`

Fixed a bug where cron schedules would fire once and then never again. The scheduler was
incorrectly skipping to the next future occurrence when the scheduled time arrived. Cron
and interval schedules now trigger reliably on every configured occurrence.

---

### Security Audit Agent
**February 6--9, 2026** · `@herdctl/core@3.0.1`

Added path traversal protection to prevent agent names like `../../../etc/passwd` from
escaping the intended state directories. Agent names are now validated against a strict
pattern at both the config schema level and file path construction level. Also added a
built-in security audit agent with sub-agent orchestration for automated daily fleet
security reviews.

---

### Flattened Permissions Config
**February 4, 2026** · `herdctl@1.0.0` · `@herdctl/core@3.0.0`

**Breaking change.** The nested `permissions` object in agent and fleet YAML has been replaced
with flat, SDK-compatible fields: `permission_mode`, `allowed_tools`, and `denied_tools` at the
top level. Bash allow/deny commands now use `Bash(cmd *)` patterns in `allowed_tools` /
`denied_tools` instead of the old `permissions.bash.allowed_commands` syntax. This gives you
a 1:1 mapping to Claude Agents SDK options with no hidden transformation.

---

### Docker Container Runtime
**February 3, 2026** · `@herdctl/core@2.0.0`

Agents can now run inside Docker containers for full isolation, consistent environments,
and resource control. Configure `docker.enabled: true` in your agent or fleet YAML to use
it. Supports the `anthropics/claude-code` image, ephemeral containers, CPU/memory limits,
volume mounts, environment variable injection, automatic git auth when `GITHUB_TOKEN` is
provided, and both SDK and CLI runtimes. A tiered security model restricts dangerous options
(like `network`, `volumes`, and `host_config`) to fleet-level config only, preventing agents
from granting themselves elevated privileges.

Also introduced runtime selection between SDK and CLI: set `runtime: cli` to use `claude -p`
invocation and preserve your Claude Max subscription tokens, or keep the default `runtime: sdk`
for the Claude Agent SDK path.

---

### Docker Session Persistence Fix
**February 3, 2026** · `@herdctl/core@2.0.1`

Fixed Docker-based session resumption, which was watching the wrong file path (`~/.claude/...`
instead of `.herdctl/docker-sessions/`), causing conversation continuity to break in
containerized agents. Also improved Discord notification formatting by moving agent output
to the embed description field (4096 character limit) instead of a field value (1024
character limit).

---

### Init Template Fixes
**January 30, 2026** · `herdctl@0.4.3`

Fixed `herdctl init` templates that were generating invalid YAML (`workspace.path` instead
of `workspace: path`) and including a hardcoded default model. Templates now produce correct
config and let the SDK choose its own default model.

---

### System Prompt Fix
**January 27, 2026** · `herdctl@0.4.2` · `@herdctl/core@1.3.1`

Fixed custom system prompts being silently ignored. The SDK expects a plain string for custom
prompts, but herdctl was passing `{ type: 'custom', content: '...' }`. System prompts defined
in your agent YAML now work correctly.

---

### LLM-Friendly Documentation
**January 27, 2026** · `herdctl@0.4.2` · `@herdctl/core@1.3.1`

Added an `llms.txt` and `llms-full.txt` endpoint to herdctl.dev, plus a self-maintaining
example that uses herdctl agents to keep their own documentation up to date.

---

### `.env` File Support
**January 27, 2026** · `@herdctl/core@1.3.0`

The config loader now automatically loads a `.env` file from the same directory as your
`herdctl.yaml`. System environment variables take precedence over `.env` values. You can
also pass a custom path via the `envFile` option in `loadConfig()`. This makes it much
easier to manage secrets like `DISCORD_BOT_TOKEN` without exporting shell variables.

---

### Per-Agent Config Overrides
**January 27, 2026** · `@herdctl/core@1.3.0`

When referencing an agent in your fleet config, you can now add an `overrides` block to
customize schedules, hooks, permissions, or any other field for that specific fleet. Overrides
are deep-merged after fleet defaults, so you only specify what you want to change.

---

### Sessions Command
**January 27, 2026** · `herdctl@0.4.0` · `@herdctl/core@1.2.0`

New `herdctl sessions` command to discover and resume Claude Code sessions. When agents run
with session persistence, herdctl tracks session IDs so you can list them, filter by agent,
and resume any session with `herdctl sessions resume <id>`. Supports partial ID matching,
agent name lookup, JSON output, and verbose mode.

---

### Project-Embedded Agents and Discord Streaming
**January 27, 2026** · `@herdctl/core@1.1.0`

Agents that point at existing Claude Code projects (via the `workspace` field) now correctly
inherit the project's `CLAUDE.md`, skills, commands, and other configuration. A new
`setting_sources` option lets you control this explicitly. Discord messages are now streamed
incrementally at natural paragraph breaks instead of batched at the end, providing a much
more responsive chat experience.

---

### Discord Conversation Continuity
**January 27, 2026** · `@herdctl/core@1.0.0` · `@herdctl/discord@0.1.0`

Discord conversations now persist across messages using Claude Agent SDK session resumption.
When you chat with an agent in a Discord channel or DM, subsequent messages carry the same
session ID so Claude remembers the full conversation context. Session IDs from failed jobs
are not stored, preventing invalid session accumulation.

---

### Discord Chat Integration
**January 27, 2026** · `herdctl@0.3.0` · `@herdctl/core@0.3.0` · `@herdctl/discord@0.0.4`

Initial Discord bot integration. Connect agents to Discord channels where users can @mention
the bot to trigger conversations. Responses are streamed back to the channel with automatic
message splitting at Discord's 2000-character limit. The `@herdctl/discord` package is bundled
with the CLI, so `npx herdctl start` includes Discord support out of the box.

---

### Lifecycle Hooks
**January 26, 2026** · `@herdctl/core@0.2.0`

Added a hook system for agent job lifecycle events. Define `after_run` hooks in your agent
YAML to send Discord notifications, run cleanup scripts, or trigger follow-up actions
whenever an agent job completes or fails.

---

### Schema Validation
**January 26, 2026** · `@herdctl/core@0.1.0`

Agent and fleet configs now go through strict Zod-based schema validation. Unknown or
misplaced fields produce clear error messages instead of being silently ignored. Also
fixed the `herdctl trigger` command to actually execute jobs instead of just creating
metadata files.

---

### Initial Release
**January 26, 2026** · `herdctl@0.0.2` · `@herdctl/core@0.0.2` · `@herdctl/discord@0.0.2`

First public release of herdctl with core fleet management, agent configuration, scheduled
jobs, the `trigger` command, and the `@herdctl/discord` package.
