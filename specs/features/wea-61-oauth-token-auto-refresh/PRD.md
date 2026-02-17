# WEA-61: Claude OAuth Token Auto-Refresh for Herdctl Agents

## Problem

Herdctl agents authenticate to Claude via OAuth tokens sourced from `~/.claude/.credentials.json`. Previously, `start-herdctl.sh` read the tokens once at startup and injected them as static environment variables into the herdctl Docker container. From there, `buildContainerEnv()` read `process.env` and passed the same static tokens to every agent container.

When the Claude OAuth access token expired (8-hour TTL), all agents failed with authentication errors. The only fix was to manually re-run `./start-herdctl.sh` to snapshot fresh tokens.

## Solution

### Layer 1: Proactive Refresh on Each Agent Spawn

`buildContainerEnv()` now reads the credentials file directly (mounted from the host) instead of using static `process.env` values. On every agent spawn:

1. Reads `~/.claude/.credentials.json` from the bind-mounted file
2. Checks if the access token expires within a 5-minute buffer
3. If expired or expiring, calls the Claude OAuth refresh endpoint
4. Writes the new tokens back to the credentials file (persists via bind mount)
5. Passes the fresh token as env vars to the agent container

### Layer 2: Reactive Retry on Mid-Session Expiry

If an agent session runs longer than 8 hours and the token expires mid-execution:

1. Claude Code fails with an authentication error
2. `isTokenExpiredError()` detects the error pattern in the job executor
3. The job is retried automatically (one retry)
4. The retry creates a new container, triggering `buildContainerEnv()` which refreshes the token
5. The agent resumes with a fresh token (new session)

## Architecture

```
~/.claude/.credentials.json (host)
  |
  +-- bind-mounted (rw) into herdctl container
  |     at /home/claude/.claude/.credentials.json
  |
  +-- on each agent spawn:
        buildContainerEnv()
          |-- reads file
          |-- token valid? --> pass as env vars to agent container
          +-- token expired? --> POST /v1/oauth/token
                                  |-- update file (persists to host)
                                  +-- pass fresh token to agent container
```

### Token Refresh Details

| Parameter | Value |
|-----------|-------|
| Endpoint | `POST https://console.anthropic.com/v1/oauth/token` |
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code CLI public client ID) |
| Grant type | `refresh_token` |
| Content-Type | `application/json` |
| Access token TTL | 8 hours (28800 seconds) |
| Refresh buffer | 5 minutes before expiry |
| Refresh token rotation | Each refresh returns a new refresh token; old one is invalidated |

### Error Detection Patterns

`isTokenExpiredError()` checks for:

- Error codes: `unauthorized`, `token_expired`, `invalid_token`, `auth_error`
- Message patterns: "token expired", "unauthorized", "401", "authentication failed", "login required", "re-authenticate"

## Changes

### herdctl core (`packages/core/`)

| File | Change |
|------|--------|
| `runner/runtime/container-manager.ts` | `buildContainerEnv()` is now `async`. Added `readCredentialsFile()`, `writeCredentialsFile()`, `refreshClaudeOAuthToken()`. Reads from file with env var fallback. |
| `runner/runtime/container-runner.ts` | `await` the now-async `buildContainerEnv()` |
| `runner/job-executor.ts` | Added token expiry retry block (mirrors existing `isSessionExpiredError` retry) |
| `state/session-validation.ts` | Added `isTokenExpiredError()` |
| `state/index.ts` | Exported `isTokenExpiredError` |
| `runner/runtime/__tests__/docker-security.test.ts` | Tests updated for async signature |

### hetzner-dev-box-config (infra, separate repo)

| File | Change |
|------|--------|
| `docker-compose.yml` | Added `~/.claude/.credentials.json` bind mount (rw); removed 3 `CLAUDE_*` env var passthroughs |
| `start-herdctl.sh` | Removed token snapshot logic (was 12 lines); now just `op run` + `docker compose up` |
| `.env.tpl` | Removed non-existent `linear-sync-agent`; fixed `MB Backend Coder Linear OAuth` item name |

## Backwards Compatibility

- If the credentials file is not available (no bind mount), `buildContainerEnv()` falls back to `process.env` values, preserving the old behavior.
- If `ANTHROPIC_API_KEY` is set, it continues to be passed through as before.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token valid | Read from file, pass as env vars. No refresh. |
| Token expired, refresh succeeds | Refresh, write back, pass fresh token. |
| Token expired, refresh fails | Pass the expired token anyway (agent will fail). Fall back to env vars if file unreadable. |
| Agent runs >8h, token expires mid-session | Auth error detected, job retried with fresh token. |
| Refresh token itself expired | Requires manual re-auth on host (`claude` interactive login), then restart herdctl. |
| Multiple concurrent agent spawns | Each reads the file independently. First to refresh writes back; others read the already-refreshed file. No locking needed since refresh is idempotent. |
