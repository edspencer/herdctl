# Slack Integration — Deployment Notes

## Status: LIVE (2026-02-15)

Infrastructure set up by devops (WEA-11). herdctl is running and responding to Slack @mentions.

---

## What's Deployed

- **herdctl container** on `herdctl-net` bridge network, connected to Slack
- **MCP servers** (perplexity + slack-mcp) attached to `herdctl-net` — agents reach them by service name
- **Agent runtime image** `herdctl/runtime:latest` built from repo Dockerfile

---

## Issues Encountered During Deployment

### 1. Rootless Docker

The dev box runs rootless Docker. The socket path differs from the standard `/var/run/docker.sock`. Docker Compose and volume mounts need to reference the correct socket path for your environment.

### 2. `@herdctl/slack` not published to npm

The package isn't on npm yet, so it can't be `npm install -g`'d in the herdctl container. Devops worked around this by building tarballs with `pnpm pack` and installing from the local `.tgz` files in the Dockerfile.

**Action**: Publish `@herdctl/slack` to npm (will happen automatically via changesets once PR is merged).

### 3. Network schema only accepts `none`/`bridge`/`host`

The `network` field in `packages/core/src/config/schema.ts` (line 142) validates against a hardcoded enum of `none`, `bridge`, and `host`. Docker's `NetworkMode` supports any named network (e.g., `herdctl-net`), but herdctl rejects it.

**Workaround**: Pass the custom network name via `host_config.NetworkMode`:

```yaml
defaults:
  docker:
    network: bridge                    # passes schema validation
    host_config:
      NetworkMode: herdctl-net         # actual network override
```

**Action**: Update the schema to accept custom network names. The validation should allow any string, not just the three Docker defaults. See WEA-11 comment for details.

### 4. Sibling container path mapping

herdctl spawns agent containers via Docker socket (sibling container pattern, not Docker-in-Docker). This means **all paths must be real host paths**, not container-internal paths:

- `working_directory` in agent config must be the **host path** (e.g., `/home/dev/projects/herdctl`), not a path inside the herdctl container (e.g., `/workspace`)
- State dir must use `--state` with a host path, mounted at the same path in the container
- Docker named volumes don't work for state because Docker interprets the mount source as a host path

This is a fundamental constraint of the sibling container pattern — the Docker daemon resolves paths relative to the host, not relative to the container making the API call.

---

## Secrets Management

Required environment variables for the herdctl container:

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack App-Level Token for Socket Mode (`xapp-...`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude OAuth access token |
| `CLAUDE_REFRESH_TOKEN` | Claude OAuth refresh token |
| `CLAUDE_EXPIRES_AT` | Claude OAuth expiration timestamp |

How secrets are injected is environment-specific (e.g., `.env` file, secret manager, CI/CD). See the devops config for the production setup.

---

## Known Bugs Found During Testing

### WEA-12: Bot only responds to @mentions, not channel messages

The Slack connector only listens to `app_mention` events (`slack-connector.ts:202`). In a dedicated bot channel, users expect to just type messages without @mentioning. Need to add a `message` event handler with bot-message filtering.

**Status**: Backlog, unassigned.

### WEA-13: Bot doesn't respond to follow-up thread replies

The bot creates a thread and replies on the initial @mention, but ignores follow-up replies in the same thread. Thread replies are `message` events with a `thread_ts` field — the connector doesn't handle them because it only listens for `app_mention` events.

The session manager already tracks sessions by `thread_ts` and the lookup works, but the events never reach it.

**Status**: Backlog, unassigned.

---

## Architecture Confirmed

The testing guide's architecture diagram is accurate. The deployed setup matches:

```
herdctl-net (bridge network)
├── perplexity-mcp  → http://perplexity:8080/mcp
├── slack-mcp       → http://slack-mcp:8081/mcp
├── herdctl         → orchestrator (Slack Socket Mode + Docker socket)
└── agent containers → spawned by herdctl, join same network
```

Auth flow confirmed: `.env` → herdctl container → `buildContainerEnv()` → agent container → Claude API.

---

## Action Items for herdctl Development

1. **Fix network schema** — Accept custom network names in `packages/core/src/config/schema.ts` (line 142)
2. **Fix WEA-13** — Handle `message` events with `thread_ts` to support thread replies
3. **Fix WEA-12** — Handle `message` events in configured channels (not just @mentions)
4. **Publish `@herdctl/slack`** — Merge PR so changesets publish to npm
5. **Document sibling container path constraint** — Add to TESTING_GUIDE.md troubleshooting section
