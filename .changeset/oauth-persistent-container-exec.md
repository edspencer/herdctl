---
"@herdctl/core": patch
---

fix(core): inject refreshed OAuth credentials into reused persistent containers

Docker credentials were only ever applied to a container's env at creation
time. For persistent agents (`docker.ephemeral: false`) the same container is
reused across executions, so a token refreshed by `buildContainerEnv()` never
reached the already-running container — on token-expiry retry the `docker exec`
still inherited the stale creation-time token and the agent looped on expired
credentials. Each execution now re-injects the current credential env
(`CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_REFRESH_TOKEN` / `CLAUDE_EXPIRES_AT` /
`ANTHROPIC_API_KEY`) into every exec (SDK `exec` `Env`, CLI `docker exec -e`
args), so reused persistent containers always run with fresh credentials.
Ephemeral containers were unaffected. Fixes edspencer/herdctl#327.
