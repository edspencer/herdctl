---
title: GitHub Issues Work Source
description: Configure agents to work on GitHub Issues with label-based workflows
---

The GitHub Issues work source adapter allows agents to automatically fetch, claim, and complete tasks from GitHub Issues. It uses a **label-based workflow** to track issue state and prevent multiple agents from working on the same issue.

## Quick Start

```yaml
# agents/my-coder.yaml
name: my-coder
description: "Implements features from GitHub issues"

workspace: my-project
repo: myorg/my-project

work_source:
  type: github
  repo: myorg/my-project
  labels:
    ready: ready
    in_progress: agent-working
  auth:
    token_env: GITHUB_TOKEN

schedules:
  issue-check:
    type: interval
    interval: 5m
    prompt: |
      Check for ready issues and implement the oldest one.
```

## Configuration Reference

### Complete Schema

```yaml
work_source:
  # Required: Adapter type
  type: github

  # Required: Repository in "owner/repo" format
  repo: myorg/my-project

  # Optional: Label configuration
  labels:
    # Label that marks issues as ready for agent work
    ready: ready                    # default: "ready"
    # Label applied when an agent claims the issue
    in_progress: agent-working      # default: "agent-working"

  # Optional: Labels to exclude from processing
  exclude_labels:                   # default: ["blocked", "wip"]
    - blocked
    - needs-design
    - wip

  # Optional: Re-add ready label when releasing work on failure
  cleanup_on_failure: true          # default: true

  # Optional: Authentication configuration
  auth:
    # Environment variable containing the GitHub token
    token_env: GITHUB_TOKEN         # default: "GITHUB_TOKEN"
```

### Field Details

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | — | Must be `"github"` |
| `repo` | string | — | Repository in `owner/repo` format |
| `labels.ready` | string | `"ready"` | Label marking issues available for work |
| `labels.in_progress` | string | `"agent-working"` | Label applied when claiming |
| `exclude_labels` | string[] | `["blocked", "wip"]` | Issues with these labels are skipped |
| `cleanup_on_failure` | boolean | `true` | Re-add ready label on release |
| `auth.token_env` | string | `"GITHUB_TOKEN"` | Env var containing PAT |

---

## Label-Based Workflow

The GitHub adapter uses labels to manage work item state. This approach is:

- **Visible**: Anyone can see issue status in the GitHub UI
- **Auditable**: Label changes are tracked in issue history
- **Compatible**: Works with existing GitHub workflows and automation

### Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GITHUB LABEL-BASED WORKFLOW                       │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                         ISSUE CREATED                          │  │
│  │                    (no workflow labels)                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                     │
│                          Human adds                                  │
│                        "ready" label                                 │
│                                │                                     │
│                                ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     READY FOR AGENT                            │  │
│  │                                                                │  │
│  │  Labels: [ready]                                               │  │
│  │  State:  Open                                                  │  │
│  │                                                                │  │
│  │  Agent can now claim this issue                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                     │
│                         Agent calls                                  │
│                         claimWork()                                  │
│                                │                                     │
│                                ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    CLAIMED BY AGENT                            │  │
│  │                                                                │  │
│  │  Labels: [agent-working]                                       │  │
│  │  State:  Open                                                  │  │
│  │                                                                │  │
│  │  - "ready" label removed                                       │  │
│  │  - "agent-working" label added                                 │  │
│  │  - Other agents will skip this issue                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                     │
│              ┌─────────────────┴─────────────────┐                  │
│              │                                   │                   │
│       Work succeeds                        Work fails                │
│      completeWork()                      releaseWork()               │
│              │                                   │                   │
│              ▼                                   ▼                   │
│  ┌─────────────────────┐           ┌─────────────────────────────┐  │
│  │     COMPLETED       │           │     RELEASED                 │  │
│  │                     │           │                              │  │
│  │  Labels: []         │           │  Labels: [ready]             │  │
│  │  State:  Closed     │           │  State:  Open                │  │
│  │                     │           │                              │  │
│  │  - Comment posted   │           │  - "agent-working" removed   │  │
│  │  - Issue closed     │           │  - "ready" label re-added    │  │
│  │                     │           │  - Comment posted (optional) │  │
│  └─────────────────────┘           └─────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Label State Transitions

| State | Labels | Agent Action | Result |
|-------|--------|--------------|--------|
| Available | `[ready]` | `claimWork()` | Adds `agent-working`, removes `ready` |
| Claimed | `[agent-working]` | `completeWork()` | Removes `agent-working`, closes issue (on success) |
| Claimed | `[agent-working]` | `releaseWork()` | Removes `agent-working`, re-adds `ready` |

### Completion Comments

When an agent completes work, it posts a structured comment:

**Success:**
```markdown
## ✅ Work Completed

**Outcome:** success

**Summary:** Implemented user authentication feature

### Details

Added JWT-based authentication with refresh tokens.
Updated middleware to validate tokens on protected routes.

### Artifacts

- src/auth/jwt.ts
- src/middleware/auth.ts
- Pull request: #42
```

**Failure:**
```markdown
## ❌ Work Completed

**Outcome:** failure

**Summary:** Could not implement feature due to unclear requirements

### Error

```
Missing database schema for user sessions
```
```

---

## Authentication

### Personal Access Token (PAT) Requirements

The GitHub adapter requires a Personal Access Token with the **`repo`** scope.

#### Required Scopes

| Scope | Purpose |
|-------|---------|
| `repo` | Full access to repositories (read/write issues, labels, comments) |

#### Creating a PAT

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Select the `repo` scope
4. Set an appropriate expiration
5. Generate and copy the token

#### Fine-Grained Tokens (Recommended)

For better security, use a fine-grained PAT with minimal permissions:

1. Go to [GitHub Settings → Developer settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Set **Repository access** to "Only select repositories"
4. Select the target repository
5. Under **Permissions**, set:
   - **Issues**: Read and write
   - **Metadata**: Read-only (automatically selected)
6. Generate and copy the token

#### Token Configuration

Set the token as an environment variable:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

Or specify a custom environment variable:

```yaml
work_source:
  type: github
  repo: myorg/my-project
  auth:
    token_env: MY_GITHUB_PAT  # Uses $MY_GITHUB_PAT instead
```

#### Token Validation

The adapter validates the token on first use:

- Checks that the token is valid (not expired/revoked)
- Verifies required scopes are present
- Provides clear error messages if validation fails

```
GitHubAuthError: GitHub token is missing required scopes.
Found: [public_repo], Required: [repo]
```

---

## Rate Limiting

GitHub's API enforces rate limits to prevent abuse. The adapter includes robust handling for these limits.

### GitHub Rate Limits

| Resource | Authenticated | Unauthenticated |
|----------|--------------|-----------------|
| Core API | 5,000/hour | 60/hour |
| Search API | 30/minute | 10/minute |

### How the Adapter Handles Rate Limits

#### 1. Automatic Detection

The adapter detects rate limiting from:
- HTTP 403 with `X-RateLimit-Remaining: 0`
- HTTP 429 (Too Many Requests)

#### 2. Exponential Backoff

When rate limited, the adapter automatically retries with exponential backoff:

```
Attempt 1: Wait 1 second
Attempt 2: Wait 2 seconds
Attempt 3: Wait 4 seconds
...
Maximum:   Wait 30 seconds (configurable)
```

If the rate limit reset time is known, the adapter waits until then instead.

#### 3. Rate Limit Warnings

Configure a callback to be notified when rate limits are approaching:

```typescript
// In advanced usage
const adapter = new GitHubWorkSourceAdapter({
  type: "github",
  owner: "myorg",
  repo: "my-project",
  rateLimitWarning: {
    warningThreshold: 100,  // Warn when < 100 requests remaining
    onWarning: (info) => {
      console.warn(`Rate limit warning: ${info.remaining}/${info.limit} remaining`);
      console.warn(`Resets at: ${new Date(info.reset * 1000)}`);
    }
  }
});
```

### Best Practices for Rate Limits

#### 1. Use Reasonable Polling Intervals

Don't poll too frequently. For most use cases, 5-minute intervals are sufficient:

```yaml
schedules:
  issue-check:
    type: interval
    interval: 5m  # Good: 12 requests/hour
    # interval: 30s  # Bad: 120 requests/hour
```

#### 2. Minimize API Calls per Job

Structure your agent prompts to batch operations:

```yaml
prompt: |
  Check for ready issues.
  If found, work on ONE issue (the oldest).
  Don't check for more issues until this one is complete.
```

#### 3. Monitor Rate Limit Status

The adapter exposes rate limit info after each request:

```typescript
const result = await adapter.fetchAvailableWork();
const rateLimit = adapter.lastRateLimitInfo;
// { limit: 5000, remaining: 4850, reset: 1699999999, resource: "core" }
```

#### 4. Handle Rate Limit Errors Gracefully

If you hit rate limits despite retries, the agent can wait and retry on the next schedule:

```yaml
schedules:
  issue-check:
    type: interval
    interval: 5m
    prompt: |
      Check for ready issues.
      If you encounter rate limiting, report it and wait for the next run.
```

#### 5. Use Conditional Requests (Future)

GitHub supports conditional requests with `If-None-Match` headers that don't count against rate limits when content hasn't changed. This is planned for future adapter versions.

### Rate Limit Error Reference

| Error | Cause | Resolution |
|-------|-------|------------|
| `GitHubAPIError: rate limit exceeded` | Too many requests | Wait for reset, reduce polling frequency |
| `GitHubAPIError: secondary rate limit` | Aggressive concurrent requests | Add delays between requests |

---

## Advanced Configuration

### Multiple Agents, Same Repository

When multiple agents work on the same repository, use specific labels to partition work:

```yaml
# agents/frontend-coder.yaml
name: frontend-coder
work_source:
  type: github
  repo: myorg/my-project
  labels:
    ready: frontend-ready
    in_progress: frontend-working

# agents/backend-coder.yaml
name: backend-coder
work_source:
  type: github
  repo: myorg/my-project
  labels:
    ready: backend-ready
    in_progress: backend-working
```

### Priority-Based Processing

Use GitHub labels to set priority, then have agents process high-priority issues first:

```yaml
prompt: |
  Fetch all ready issues.
  Work on issues in this order:
  1. Issues labeled "critical" or "p0"
  2. Issues labeled "high" or "p1"
  3. All other issues (oldest first)
```

The adapter automatically infers priority from labels:

| Labels | Inferred Priority |
|--------|-------------------|
| `critical`, `p0`, `urgent` | `critical` |
| `high`, `p1`, `important` | `high` |
| `low`, `p3` | `low` |
| (none of above) | `medium` |

### GitHub Enterprise

:::note[Not Yet Available in YAML]
GitHub Enterprise support (custom API base URL) is supported in the TypeScript API but is not yet exposed in the YAML configuration schema. This feature is planned for a future release.
:::

### Cleanup Behavior

Control what happens when work is released:

```yaml
work_source:
  type: github
  repo: myorg/my-project
  # When agent fails/times out, should the issue go back to "ready"?
  cleanup_on_failure: true   # default: re-adds "ready" label
  # cleanup_on_failure: false  # leaves issue without "ready" label
```

---

## Troubleshooting

### Common Issues

#### "No GitHub token configured"

**Cause**: The `GITHUB_TOKEN` environment variable is not set.

**Solution**: Export the token before running herdctl:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
herdctl run
```

#### "GitHub token is missing required scopes"

**Cause**: The PAT doesn't have the `repo` scope.

**Solution**: Generate a new token with the `repo` scope, or use a fine-grained token with Issues read/write permission.

#### "Issue is already claimed"

**Cause**: Another agent (or process) claimed the issue first.

**Solution**: This is normal in multi-agent setups. The adapter returns `already_claimed` and the scheduler can try the next available issue.

#### "Permission denied for issue"

**Cause**: The token doesn't have access to the repository.

**Solution**: Ensure the token has access to the target repository. For fine-grained tokens, check repository access settings.

#### Rate limit errors persist

**Cause**: Polling too frequently or too many agents sharing limits.

**Solutions**:
1. Increase polling interval (e.g., 5m → 15m)
2. Use different tokens for different agents
3. Reduce the number of concurrent agents

---

## Complete Example

Here's a full agent configuration for a production setup:

```yaml
# agents/issue-worker.yaml
name: issue-worker
description: "Implements features and fixes bugs from GitHub issues"

workspace: my-project
repo: myorg/my-project

# Identity
identity:
  name: "Issue Worker"
  role: "Software Engineer"
  personality: "Methodical, writes tested code"

system_prompt: |
  You are a software engineer working on this project.

  When implementing an issue:
  1. Read the issue description carefully
  2. Explore the relevant code
  3. Implement the solution
  4. Write tests
  5. Create a pull request
  6. Report your results

# Work source configuration
work_source:
  type: github
  repo: myorg/my-project
  labels:
    ready: ready-for-dev
    in_progress: agent-working
  exclude_labels:
    - blocked
    - needs-design
    - question
  cleanup_on_failure: true
  auth:
    token_env: GITHUB_TOKEN

# Schedule
schedules:
  continuous:
    type: interval
    interval: 5m
    prompt: |
      Check for GitHub issues labeled "ready-for-dev".

      If issues are available:
      1. Claim the oldest issue
      2. Implement the solution
      3. Create a PR linking to the issue
      4. Report success with the PR URL

      If no issues are available, report "No issues ready for work."

# Session settings
session:
  max_turns: 100
  timeout: 4h
  model: claude-sonnet-4-20250514

# Permissions
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

---

## Related Pages

- [Work Sources](/concepts/work-sources/) — Understanding the adapter pattern
- [Agent Configuration](/configuration/agent-config/) — Full YAML reference
- [Schedules](/concepts/schedules/) — When agents run
- [Permissions](/configuration/permissions/) — Tool access control
