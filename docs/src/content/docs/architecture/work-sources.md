---
title: Work Source System
description: How herdctl discovers and manages work items from external systems through its extensible adapter architecture
---

The work source system decouples **what agents work on** from **when they run**. The [scheduler](/architecture/scheduler/) decides when an agent should check for work; the work source provides the actual task. This separation allows the same scheduling infrastructure to drive agents that pull work from GitHub Issues, and in the future from other task-tracking systems, without any changes to the scheduler or [runner](/architecture/runner/).

For the user-facing perspective on configuring work sources, see [Work Sources](/concepts/work-sources/). For how work sources integrate with scheduling, see the [Schedule System](/architecture/scheduler/).

![Work item lifecycle state machine showing transitions between available, claimed, completed, and released states](/diagrams/work-item-lifecycle.svg)

## Module Structure

The work source module lives in `packages/core/src/work-sources/` and is organized into focused files:

| File | Purpose |
|------|---------|
| `index.ts` | Public exports and `WorkSourceAdapter` interface definition |
| `types.ts` | `WorkItem`, `FetchOptions`, `FetchResult`, `ClaimResult`, `WorkResult`, `ReleaseResult` |
| `registry.ts` | Adapter registration and resolution (singleton registry) |
| `manager.ts` | `WorkSourceManager` interface for scheduler integration |
| `errors.ts` | Error hierarchy (`WorkSourceError`, `UnknownWorkSourceError`, `DuplicateWorkSourceError`) |
| `adapters/index.ts` | Built-in adapter exports and auto-registration |
| `adapters/github.ts` | `GitHubWorkSourceAdapter` implementation |

## Core Concepts

### WorkItem

Every work source adapter normalizes external items into a common `WorkItem` structure. This allows the scheduler and runner to handle work items uniformly regardless of their origin.

```typescript
interface WorkItem {
  id: string;             // Source-prefixed ID (e.g., "github-42")
  source: string;         // Adapter type ("github")
  externalId: string;     // ID in the external system ("42")
  title: string;          // Human-readable title
  description: string;    // Full body/description
  priority: WorkItemPriority;  // "critical" | "high" | "medium" | "low"
  labels: string[];       // Labels/tags from the source
  metadata: Record<string, unknown>;  // Source-specific data
  url: string;            // URL to view in the external system
  createdAt: Date;
  updatedAt: Date;
}
```

The `id` field uses a source-prefixed format (`github-42`) to ensure uniqueness across work sources. The `metadata` field carries source-specific information -- for GitHub, this includes assignee, milestone, and author.

### WorkSourceAdapter Interface

All work source adapters implement the `WorkSourceAdapter` interface, which defines five operations covering the full work item lifecycle:

```typescript
interface WorkSourceAdapter {
  readonly type: string;

  fetchAvailableWork(options?: FetchOptions): Promise<FetchResult>;
  claimWork(workItemId: string): Promise<ClaimResult>;
  completeWork(workItemId: string, result: WorkResult): Promise<void>;
  releaseWork(workItemId: string, options?: ReleaseOptions): Promise<ReleaseResult>;
  getWork(workItemId: string): Promise<WorkItem | undefined>;
}
```

The interface uses generic lifecycle verbs -- fetch, claim, complete, release -- that map naturally to both label-based workflows (GitHub Issues) and status-based workflows in other systems.

![WorkSourceAdapter interface showing the adapter pattern with GitHub Issues implementation and extensibility for future sources](/diagrams/work-source-adapter.svg)

## Work Item Lifecycle

A work item moves through four phases during processing:

```text
Available  -->  Claimed  -->  Completed
                   |
                   +-------->  Released (back to Available)
```

### 1. Fetch

The scheduler calls `fetchAvailableWork()` to discover items that are ready for processing. Fetch supports filtering and pagination:

```typescript
interface FetchOptions {
  labels?: string[];              // Items must have ALL specified labels
  priority?: WorkItemPriority[];  // Items must match ONE of these priorities
  limit?: number;                 // Maximum items to return
  cursor?: string;                // Opaque pagination cursor
  includeClaimed?: boolean;       // Include already-claimed items
}

interface FetchResult {
  items: WorkItem[];
  nextCursor?: string;  // Cursor for next page
  totalCount?: number;  // Total matching items (if available)
}
```

### 2. Claim

Before processing, `claimWork()` marks the item as in-progress in the external system. This prevents other agents from picking up the same work:

```typescript
interface ClaimResult {
  success: boolean;
  workItem?: WorkItem;         // Updated item (if claimed)
  reason?: ClaimFailureReason; // Why it failed
  message?: string;            // Human-readable explanation
}

type ClaimFailureReason =
  | "already_claimed"    // Another agent got there first
  | "not_found"          // Item was deleted or moved
  | "permission_denied"  // Insufficient permissions
  | "source_error"       // External system error
  | "invalid_state";     // Item is closed or otherwise unavailable
```

### 3. Complete

After the agent finishes processing, `completeWork()` reports the outcome back to the external system:

```typescript
interface WorkResult {
  outcome: "success" | "failure" | "partial";
  summary: string;
  details?: string;
  artifacts?: string[];  // PR URLs, commit SHAs, file paths
  error?: string;        // Error message for failure/partial outcomes
}
```

For successful outcomes, the adapter typically closes the issue and posts a summary comment. For failures, it posts the error details without closing.

### 4. Release

If an agent cannot complete work -- due to a timeout, error, or shutdown -- `releaseWork()` returns the item to the available pool:

```typescript
interface ReleaseOptions {
  reason?: string;
  addComment?: boolean;  // Post an explanatory comment
}
```

Release reverses the claim operation so that another agent can pick up the work item. Whether the ready label is re-added depends on the `cleanup_on_failure` configuration option.

## Adapter Registry

The registry is a module-level singleton `Map` that stores factory functions keyed by adapter type. This pattern allows new adapters to be added without modifying any core code.

### Registration

```typescript
import { registerWorkSource } from "@herdctl/core";

registerWorkSource("github", (config) => new GitHubWorkSourceAdapter(config));
```

Built-in adapters are registered automatically when the work sources module is imported. The auto-registration checks whether the type is already registered first, allowing tests to pre-register mocks before the module loads.

### Resolution

```typescript
import { getWorkSource } from "@herdctl/core";

const adapter = getWorkSource({
  type: "github",
  owner: "my-org",
  repo: "my-repo",
});
```

If no factory is registered for the requested type, `getWorkSource` throws `UnknownWorkSourceError` with a list of available types. Registering a type that already exists throws `DuplicateWorkSourceError`.

### Registry Functions

| Function | Purpose |
|----------|---------|
| `registerWorkSource(type, factory)` | Register a new adapter factory |
| `getWorkSource(config)` | Create an adapter instance from config |
| `isWorkSourceRegistered(type)` | Check if a type is registered |
| `getRegisteredTypes()` | List all registered type identifiers |
| `unregisterWorkSource(type)` | Remove a registration (primarily for testing) |
| `clearWorkSourceRegistry()` | Remove all registrations (primarily for testing) |

## WorkSourceManager

The `WorkSourceManager` interface defines the contract between work sources and the scheduler. It provides a higher-level API than the raw adapter, handling adapter instantiation, caching, and the fetch-claim-report lifecycle.

```typescript
interface WorkSourceManager {
  getNextWorkItem(
    agent: ResolvedAgent,
    options?: GetNextWorkItemOptions,
  ): Promise<GetNextWorkItemResult>;

  reportOutcome(
    taskId: string,
    result: WorkResult,
    options: ReportOutcomeOptions,
  ): Promise<void>;

  releaseWorkItem(
    taskId: string,
    options: ReleaseWorkItemOptions,
  ): Promise<ReleaseResult>;

  getAdapter(agent: ResolvedAgent): Promise<WorkSourceAdapter | null>;

  clearCache(): void;
}
```

### getNextWorkItem

This is the primary method called by the scheduler. It fetches the highest-priority available work item from the agent's configured work source and, by default, claims it atomically to prevent race conditions:

```typescript
const { item, claimed, claimResult } = await manager.getNextWorkItem(agent);

if (!item) {
  // No work available
  return;
}

if (!claimed) {
  // Another agent claimed it first (race condition)
  return;
}

// Safe to process the work item
```

The `autoClaim` option (default: `true`) controls whether `getNextWorkItem` claims the item before returning it. When `autoClaim` is `false`, the caller is responsible for calling `claimWork` on the adapter directly.

### Adapter Caching

The manager caches adapter instances per agent. When `getNextWorkItem` is called for the same agent repeatedly, the same adapter instance is reused. This avoids repeated instantiation and ensures consistent state (e.g., rate limit tracking in the GitHub adapter). The cache can be cleared with `clearCache()` when configuration changes.

### Scheduler Integration Pattern

The schedule runner uses the manager in a structured flow:

```typescript
// 1. Fetch and claim work
const { item, claimed } = await workSourceManager.getNextWorkItem(agent);

// 2. Build prompt from schedule config + work item
const prompt = buildSchedulePrompt(schedule, item);

// 3. Execute the agent
const result = await jobExecutor.execute({ agent, prompt });

// 4. Report outcome
await workSourceManager.reportOutcome(item.id, {
  outcome: result.success ? "success" : "failure",
  summary: result.summary,
}, { agent });
```

On unexpected errors, the schedule runner releases the work item so it returns to the available pool:

```typescript
catch (error) {
  if (workItem) {
    await workSourceManager.releaseWorkItem(workItem.id, {
      agent,
      reason: error.message,
      addComment: true,
    });
  }
}
```

## Prompt Building

When a schedule triggers and a work item is fetched, the `buildSchedulePrompt` function (in the [scheduler module](/architecture/scheduler/)) combines the schedule's configured prompt with the work item details:

```typescript
const prompt = buildSchedulePrompt(schedule, workItem);
```

Without a work item, the function returns the schedule's prompt string (or a default). With a work item, it appends a formatted section:

```text
Process this issue:

## Work Item: Fix authentication bug

Users are unable to log in when using SSO.

- **Source:** github
- **ID:** 42
- **Priority:** high
- **Labels:** bug, authentication
- **URL:** https://github.com/org/repo/issues/42
```

This format gives the agent structured context about the task while allowing the schedule prompt to provide high-level instructions.

## GitHub Issues Adapter

The `GitHubWorkSourceAdapter` is the built-in adapter that uses GitHub Issues as a work source. It uses a label-based workflow: issues with a "ready" label are available for agents, and claiming an issue swaps that label for an "in-progress" label.

### Label-Based Workflow

The adapter manages work item state through GitHub issue labels:

| State | Label Applied | Label Removed |
|-------|---------------|---------------|
| Available | `ready` (configurable) | -- |
| Claimed | `agent-working` (configurable) | `ready` |
| Completed | -- | `agent-working` |
| Released | `ready` (if `cleanup_on_failure`) | `agent-working` |

The default labels are `ready` for available work and `agent-working` for claimed work. Both are configurable per agent.

### Fetch Behavior

`fetchAvailableWork` queries open issues that have the ready label, then applies client-side filters:

1. **Exclude labels** -- issues with any label in `exclude_labels` (default: `["blocked", "wip"]`) are skipped
2. **In-progress filter** -- issues with the in-progress label are excluded unless `includeClaimed` is set
3. **Additional label filters** -- if `FetchOptions.labels` is specified, issues must have all listed labels
4. **Priority filter** -- if `FetchOptions.priority` is specified, items must match one of the listed priorities

Issues are sorted by creation date (oldest first) for FIFO ordering. Pagination uses GitHub's Link header, with the `cursor` field mapping to page numbers.

### Priority Inference

The adapter infers priority from issue labels using keyword matching:

| Priority | Label Keywords |
|----------|----------------|
| `critical` | `critical`, `p0`, `urgent` |
| `high` | `high`, `p1`, `important` |
| `low` | `low`, `p3` |
| `medium` | Default when no priority keywords match |

Matching is case-insensitive and uses substring matching, so labels like `priority:high` or `P1-bug` are recognized.

### Claim Flow

When claiming an issue, the adapter:

1. Fetches the current issue to verify it exists and is open
2. Checks whether the in-progress label is already present (returns `already_claimed` if so)
3. Adds the in-progress label
4. Removes the ready label
5. Fetches the updated issue and returns it as a `WorkItem`

If another agent claims the same issue between the check and the label update, the GitHub API handles this gracefully -- the second agent's label operations are idempotent but the `already_claimed` check prevents duplicate processing.

### Completion Flow

On completion, the adapter:

1. Posts a comment with the outcome (success/failure/partial), summary, details, artifacts, and error information
2. Removes the in-progress label
3. Closes the issue if the outcome is `success` (with `state_reason: "completed"`)

Failed work items are not closed, allowing manual review or re-processing.

### Release Flow

On release, the adapter:

1. Posts a comment explaining the release reason (if `addComment` is `true`)
2. Removes the in-progress label
3. Re-adds the ready label if `cleanup_on_failure` is `true` (the default)

Setting `cleanup_on_failure` to `false` leaves the issue without the ready label, requiring manual intervention to re-queue it.

### WorkItem ID Format

GitHub work item IDs use the format `github-{issueNumber}` (e.g., `github-42`). The adapter parses this format when performing operations on specific items.

## Configuration

Work source configuration is defined in the agent's YAML file under the `work_source` key. See [Configuration](/architecture/configuration/) for the full configuration reference.

### GitHub Work Source Schema

```yaml
work_source:
  type: github
  repo: owner/repo-name          # Required: owner/repo format
  labels:
    ready: ready                  # Label marking issues as available (default: "ready")
    in_progress: agent-working    # Label applied when claimed (default: "agent-working")
  exclude_labels:                 # Labels that disqualify issues (default: [])
    - blocked
    - wip
  cleanup_on_failure: true        # Re-add ready label on release (default: true)
  auth:
    token_env: GITHUB_TOKEN       # Env var for PAT (default: "GITHUB_TOKEN")
```

The `repo` field is required and must be in `owner/repo` format. All other fields have sensible defaults and can be omitted.

### Defaults Inheritance

Work source configuration can be set at the fleet level under `defaults.work_source`. Agent-level configuration overrides fleet defaults. This allows a common label scheme to be defined once and shared across agents:

```yaml
# herdctl.yaml
defaults:
  work_source:
    type: github
    labels:
      ready: "ready"
      in_progress: "in-progress"

agents:
  - name: coder
    work_source:
      type: github
      repo: my-org/my-repo    # Agent-specific repo
      # Inherits labels from defaults
```

### Zod Validation

The configuration schema is validated using Zod. The `WorkSourceSchema` is a union of `GitHubWorkSourceSchema` (full GitHub-specific validation) and `BaseWorkSourceSchema` (minimal configuration for backwards compatibility):

```typescript
const GitHubWorkSourceSchema = z.object({
  type: z.literal("github"),
  repo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
    "Repository must be in 'owner/repo' format"),
  labels: z.object({
    ready: z.string().optional().default("ready"),
    in_progress: z.string().optional().default("agent-working"),
  }).optional().default({}),
  exclude_labels: z.array(z.string()).optional().default([]),
  cleanup_on_failure: z.boolean().optional().default(true),
  auth: z.object({
    token_env: z.string().optional().default("GITHUB_TOKEN"),
  }).optional().default({}),
});
```

## GitHub API Handling

The GitHub adapter includes robust handling of API edge cases, built into its internal `apiRequest` method.

### Authentication

The adapter reads a GitHub Personal Access Token (PAT) from the environment variable specified by `auth.token_env` (default: `GITHUB_TOKEN`). The `validateToken()` method checks that the token has the required `repo` scope by inspecting the `X-OAuth-Scopes` response header.

If the token is missing, expired, or lacks required scopes, the adapter throws `GitHubAuthError` with details about the found and required scopes.

### Rate Limiting

Every API response's `X-RateLimit-Remaining`, `X-RateLimit-Limit`, and `X-RateLimit-Reset` headers are tracked. The adapter handles rate limiting in two ways:

1. **Automatic retry with backoff** -- when a request returns HTTP 403 with `X-RateLimit-Remaining: 0` (or HTTP 429), the adapter waits until the reset time plus a one-second buffer, then retries. The wait is capped at `maxDelayMs` (default: 30 seconds).

2. **Proactive warnings** -- when remaining requests drop below the warning threshold (default: 100), the adapter invokes an optional `onWarning` callback. This allows operators to be alerted before hitting the limit.

```typescript
interface RateLimitInfo {
  limit: number;      // Maximum requests per hour
  remaining: number;  // Requests remaining in current window
  reset: number;      // Unix timestamp when the limit resets
  resource: string;   // API resource category
}
```

### Retry Logic

The adapter retries requests that fail due to transient errors:

| Error Type | Retried | Strategy |
|------------|---------|----------|
| Rate limit (403/429) | Yes | Wait until reset time + 1 second |
| Network error (no response) | Yes | Exponential backoff |
| Server error (5xx) | Yes | Exponential backoff |
| Request timeout (408) | Yes | Exponential backoff |
| Not found (404) | No | Return immediately |
| Permission denied (403, not rate limit) | No | Return immediately |
| Other client errors (4xx) | No | Return immediately |

Retry configuration is per-adapter:

```typescript
interface RetryOptions {
  maxRetries?: number;     // Default: 3
  baseDelayMs?: number;    // Default: 1000
  maxDelayMs?: number;     // Default: 30000
  jitterFactor?: number;   // Default: 0.1 (10% randomization)
}
```

The backoff formula is `baseDelay * 2^attempt + jitter`, capped at `maxDelayMs`. The jitter factor adds randomization to prevent multiple agents from retrying in lockstep (thundering herd).

### 404 Handling

When an issue returns 404 (deleted, transferred, or visibility changed):

- `claimWork` returns `{ success: false, reason: "not_found" }`
- `getWork` returns `undefined`
- Other methods handle the error based on context

## Error Hierarchy

Work source errors form a typed hierarchy that callers can use for precise error handling:

```text
WorkSourceError (base)
├── UnknownWorkSourceError    -- Unregistered adapter type
├── DuplicateWorkSourceError  -- Type already registered
├── GitHubAPIError            -- GitHub API request failure
│   ├── .isRateLimitError     -- Rate limit exceeded
│   ├── .isRetryable()        -- Can be retried
│   ├── .isNotFound()         -- 404 response
│   └── .isPermissionDenied() -- 403 without rate limit
└── GitHubAuthError           -- Token missing or lacks required scopes
    ├── .foundScopes          -- Scopes the token has
    ├── .requiredScopes       -- Scopes needed
    └── .missingScopes        -- Scopes that are absent
```

`GitHubAPIError` carries contextual data including the HTTP status code, the API endpoint, rate limit information, and the reset timestamp. Its `isRetryable()`, `isNotFound()`, and `isPermissionDenied()` methods support structured error handling without string matching.

## Extensibility

The adapter pattern is designed for future work source integrations. Adding a new adapter requires three steps:

1. **Implement `WorkSourceAdapter`** -- create a class that handles fetch, claim, complete, release, and get operations for the target system.

2. **Register the adapter** -- call `registerWorkSource(type, factory)` to make it available.

3. **Extend the config schema** -- add a new entry to `WorkSourceSchema` with the adapter-specific configuration fields.

The interface intentionally uses generic lifecycle operations (claim, complete, release) rather than system-specific terminology (label, assign, close). These verbs map naturally to both label-based workflows (GitHub Issues) and status-based workflows (Linear, Jira) without forcing one paradigm on all adapters.

Currently, `github` is the only registered adapter type. The `WorkSourceTypeSchema` restricts the `type` field to `"github"` in the configuration validator.

## Public Exports

The work sources module exports everything needed for integration and extension:

```typescript
// From packages/core/src/work-sources/index.ts

// Adapter interface
export type { WorkSourceAdapter };

// Core types
export type {
  WorkItem, WorkItemPriority,
  FetchOptions, FetchResult,
  ClaimResult, ClaimFailureReason,
  WorkResult, WorkOutcome,
  ReleaseOptions, ReleaseResult,
};

// Registry
export {
  registerWorkSource, getWorkSource,
  isWorkSourceRegistered, getRegisteredTypes,
  unregisterWorkSource, clearWorkSourceRegistry,
};
export type { WorkSourceConfig, WorkSourceFactory };

// Manager
export type {
  WorkSourceManager, WorkSourceManagerFactory,
  GetNextWorkItemOptions, GetNextWorkItemResult,
  ReleaseWorkItemOptions, ReportOutcomeOptions,
};

// Errors
export { WorkSourceError, UnknownWorkSourceError, DuplicateWorkSourceError };

// GitHub adapter
export {
  GitHubWorkSourceAdapter, createGitHubAdapter,
  GitHubAPIError, GitHubAuthError,
  extractRateLimitInfo, isRateLimitResponse, calculateBackoffDelay,
};
export type {
  GitHubWorkSourceConfig, GitHubIssue,
  RateLimitInfo, RateLimitWarningOptions, RetryOptions,
};
```
