# External Integrations

**Analysis Date:** 2026-01-24

## APIs & External Services

**Claude Agent SDK (Anthropic):**
- Service: Anthropic Claude Agent API
- What it's used for: Core agent execution with streaming message support
  - Instantiate agents, stream responses in real-time
  - Power all autonomous Claude Code agent tasks
  - Handles tool use, resumable sessions, error messages
- SDK/Client: @anthropic-ai/claude-agent-sdk ^0.1.0
- Implementation: `packages/core/src/runner/job-executor.ts` (JobExecutor class)
- Auth: ANTHROPIC_API_KEY environment variable
- Message Types: Stream messages including assistant, tool_use, tool_result, system, error
- Error Handling: Typed error classes in `packages/core/src/runner/errors.ts`

**GitHub API:**
- Service: GitHub REST API v3
- What it's used for: Work source - fetching and managing GitHub Issues as work items
  - List issues by labels (ready, in_progress)
  - Apply/remove labels for workflow tracking
  - Claim and release issues during agent execution
  - Support for repository filtering and excluded labels
- Client: Native fetch (Node.js built-in), no external HTTP library
- Implementation: `packages/core/src/work-sources/adapters/github.ts`
- Auth: GITHUB_TOKEN environment variable (GitHub Personal Access Token)
  - Config: auth.token_env defaults to "GITHUB_TOKEN"
  - Configurable per agent in schema
- Rate Limiting:
  - X-RateLimit headers parsed and exposed
  - Exponential backoff for rate limit errors (HTTP 403)
  - Warning threshold: approaching 100 remaining requests
  - Max retry attempts: 3 with exponential backoff
- Endpoints:
  - GET /repos/{owner}/{repo}/issues - Fetch issues
  - POST /repos/{owner}/{repo}/issues/{issue_number}/labels - Add labels
  - DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{label_name} - Remove labels
- Error Handling: GitHubAPIError class with statusCode, rateLimitInfo, endpoint context

**Discord API:**
- Service: Discord gateway (WebSocket) + REST API
- What it's used for: Per-agent Discord bot connection for agent interaction
  - Connect per-agent bots to Discord servers/DMs
  - Handle messages and interactions
  - Manage sessions per agent
  - Command responses from agents
- SDK/Client: discord.js ^14.16.0, @discordjs/rest ^2.6.0
- Implementation: `packages/discord/src/discord-connector.ts` (DiscordConnector class)
- Auth: Per-agent bot token via environment (configured in agent config)
  - Format: botToken passed to DiscordConnector constructor
  - No default env var - must be explicitly configured
- Features:
  - Per-agent bot identity (each agent has own discord.js Client)
  - Gateway intents: GatewayIntentBits configuration (see ClientOptions)
  - Message handling via mention-handler module
  - Command management via CommandManager
  - Session persistence per agent
  - DM filtering and auto-mode handler support

## Data Storage

**Databases:**
- None - not applicable

**File Storage:**
- Local filesystem only (.herdctl/ directory structure)
  - State Format: JSON, YAML, JSONL files
  - Paths managed by `packages/core/src/state/`
  - Structure: jobs/, sessions/, state.yaml, agent logs
  - No cloud storage integration

**Caching:**
- None - not implemented

## Authentication & Identity

**Auth Provider:**
- Custom environment variable approach (no centralized auth service)
  - ANTHROPIC_API_KEY for Claude API
  - GITHUB_TOKEN for GitHub API
  - Per-agent Discord bot tokens
- No OAuth, OIDC, or external identity provider

**Implementation Details:**
- Config validation via Zod schemas that reference env var names
- `packages/core/src/config/schema.ts` - GitHubAuthSchema defines token_env field
- Environment interpolation in config files (${VAR_NAME} syntax)
- Runtime validation ensures required env vars are set before use

## Monitoring & Observability

**Error Tracking:**
- None - not integrated
- Local error logging via internal logger interface
- Error context preserved in job output and state files

**Logs:**
- File-based: Job output logs in .herdctl/jobs/{job-id}/
- Logger abstraction in `packages/core/src/runner/job-executor.ts` (JobExecutorLogger interface)
- Streaming to job output via appendJobOutput() in real-time
- Types: assistant, tool_use, tool_result, system, error

**Debugging:**
- Fleet manager logger interface
- Debug-level logging in schedule executor
- Message streaming enables live monitoring

## CI/CD & Deployment

**Hosting:**
- npm registry only (no hosted service)
- Packages published as npm modules

**CI Pipeline:**
- GitHub Actions (.github/workflows/)
- Workflows: ci.yml (test/build), release.yml (changesets publishing)
- Node.js 22 for CI builds
- OIDC trusted publishing to npm (no NPM_TOKEN secret needed)
- Steps: checkout, setup pnpm, npm install, build, test, release

**Release Process:**
- Changesets-based versioning and publishing
- Uses @changesets/cli ^2.29.8
- Commands: `pnpm changeset`, `pnpm version`, `pnpm release`
- Automatic PR creation for version bumps
- OIDC authentication to npm registry
- GitHub Action: changesets/action@v1

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` - Claude SDK authentication (mandatory for any agent execution)
- `GITHUB_TOKEN` - GitHub API PAT (required only if using GitHub work source)
- Per-agent Discord bot tokens (required only if using Discord integration)

**Optional env vars:**
- `GITHUB_TOKEN` environment variable name is configurable (auth.token_env in config)
- Discord bot tokens are per-agent configuration, no global defaults

**Secrets location:**
- .env files (not tracked in git, manually managed in development)
- GitHub Secrets for Actions (GITHUB_TOKEN built-in, NPM_TOKEN deprecated)
- OIDC tokens automatic in GitHub Actions (no secrets needed for npm publish)
- Env vars passed to child processes executing agents

**Config File Interpolation:**
- YAML files support ${VAR_NAME} syntax
- Interpolated at load time via `packages/core/src/config/interpolate.ts`
- Example: `token: ${GITHUB_TOKEN}` in herdctl.yaml

## Webhooks & Callbacks

**Incoming:**
- Discord webhooks/messages - handled by DiscordConnector
  - Gateway connection receives Discord messages
  - Mention handler determines if message should trigger agent
  - Session-based conversation context
- GitHub webhooks - not currently implemented (polling-based via labels instead)

**Outgoing:**
- None to external services
- Event emission internal to FleetManager (EventEmitter pattern)
- Job completion events trigger downstream actions within fleet

**Discord Bot Architecture:**
- Per-agent bot identity: each agent gets its own bot token and discord.js Client
- Connection lifecycle: connect/disconnect methods in DiscordConnector
- State tracking: connection status, reconnect attempts, last error
- Auto-mode: can auto-respond in specific channels/DMs based on config

## Integration Points Summary

| Integration | Type | Required | Authentication | Status |
|------------|------|----------|-----------------|--------|
| Claude SDK | API | Always | ANTHROPIC_API_KEY | Core |
| GitHub | API/Work Source | Optional | GITHUB_TOKEN | Active |
| Discord | Webhook/API | Optional | Per-agent token | Active (v0.0.1) |

---

*Integration audit: 2026-01-24*
