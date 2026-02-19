/**
 * GitHub Work Source Adapter
 *
 * Provides work items from GitHub Issues. Uses labels to identify
 * work that is ready for agents and to track in-progress work.
 *
 * Includes robust handling of GitHub API edge cases:
 * - Exponential backoff for rate limit errors (HTTP 403 with X-RateLimit-Remaining: 0)
 * - Rate limit status detection and surfacing
 * - Network error retries (max 3 attempts)
 * - Graceful handling of 404 errors (issue deleted/moved)
 * - PAT scope validation
 * - Warnings for approaching rate limit (< 100 remaining)
 */

import type { WorkSourceAdapter } from "../index.js";
import type {
  FetchOptions,
  FetchResult,
  ClaimResult,
  WorkResult,
  ReleaseOptions,
  ReleaseResult,
  WorkItem,
  WorkItemPriority,
} from "../types.js";
import type { WorkSourceConfig } from "../registry.js";
import { WorkSourceError } from "../errors.js";

// =============================================================================
// Rate Limit Types
// =============================================================================

/**
 * GitHub API rate limit information extracted from response headers
 */
export interface RateLimitInfo {
  /** Maximum number of requests allowed per hour */
  limit: number;
  /** Number of requests remaining in current window */
  remaining: number;
  /** Unix timestamp when rate limit resets */
  reset: number;
  /** Resource type (core, search, graphql, etc.) */
  resource: string;
}

/**
 * Options for rate limit warning callback
 */
export interface RateLimitWarningOptions {
  /** Threshold below which warnings are triggered (default: 100) */
  warningThreshold?: number;
  /** Callback invoked when rate limit is approaching */
  onWarning?: (info: RateLimitInfo) => void;
}

// =============================================================================
// Retry Configuration
// =============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor (0-1) to randomize delays (default: 0.1) */
  jitterFactor?: number;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration specific to GitHub work source
 */
export interface GitHubWorkSourceConfig extends WorkSourceConfig {
  type: "github";
  /** GitHub repository owner */
  owner?: string;
  /** GitHub repository name */
  repo?: string;
  /** GitHub API token (defaults to GITHUB_TOKEN env var) */
  token?: string;
  /** GitHub API base URL (defaults to https://api.github.com) */
  apiBaseUrl?: string;
  /** Label configuration for work item states */
  labels?: {
    /** Label that marks issues as ready for agent work (default: "ready") */
    ready?: string;
    /** Label applied when an agent claims the issue (default: "agent-working") */
    in_progress?: string;
  };
  /** Labels to exclude from fetched issues (default: ["blocked", "wip"]) */
  exclude_labels?: string[];
  /** Re-add ready label when releasing work on failure (default: true) */
  cleanup_on_failure?: boolean;
  /** Retry configuration for handling transient failures */
  retry?: RetryOptions;
  /** Rate limit warning configuration */
  rateLimitWarning?: RateLimitWarningOptions;
}

/**
 * GitHub API issue response structure
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  assignee: { login: string } | null;
  assignees: Array<{ login: string }>;
  milestone: { title: string; number: number } | null;
  user: { login: string } | null;
}

/**
 * GitHub API error response
 */
interface GitHubErrorResponse {
  message: string;
  documentation_url?: string;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown when GitHub API requests fail
 */
export class GitHubAPIError extends WorkSourceError {
  /** HTTP status code from the API response */
  public readonly statusCode?: number;
  /** The API endpoint that was called */
  public readonly endpoint?: string;
  /** Rate limit information if available */
  public readonly rateLimitInfo?: RateLimitInfo;
  /** Whether this error was caused by rate limiting */
  public readonly isRateLimitError: boolean;
  /** Timestamp when rate limit resets (for rate limit errors) */
  public readonly rateLimitResetAt?: Date;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      statusCode?: number;
      endpoint?: string;
      rateLimitInfo?: RateLimitInfo;
      isRateLimitError?: boolean;
    },
  ) {
    super(message, options);
    this.name = "GitHubAPIError";
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
    this.rateLimitInfo = options?.rateLimitInfo;
    this.isRateLimitError = options?.isRateLimitError ?? false;
    if (options?.rateLimitInfo?.reset) {
      this.rateLimitResetAt = new Date(options.rateLimitInfo.reset * 1000);
    }
  }

  /**
   * Check if this error is retryable (rate limit or network error)
   */
  isRetryable(): boolean {
    // Rate limit errors are retryable after waiting
    if (this.isRateLimitError) {
      return true;
    }
    // Network errors (no status code) are retryable
    if (this.statusCode === undefined) {
      return true;
    }
    // Server errors (5xx) are retryable
    if (this.statusCode >= 500 && this.statusCode < 600) {
      return true;
    }
    // 408 Request Timeout is retryable
    if (this.statusCode === 408) {
      return true;
    }
    return false;
  }

  /**
   * Check if this is a not found error (404)
   */
  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /**
   * Check if this is a permission error (403 without rate limit)
   */
  isPermissionDenied(): boolean {
    return this.statusCode === 403 && !this.isRateLimitError;
  }

  /**
   * Get time in milliseconds until rate limit resets
   */
  getTimeUntilReset(): number | undefined {
    if (!this.rateLimitResetAt) {
      return undefined;
    }
    const now = Date.now();
    const resetTime = this.rateLimitResetAt.getTime();
    return Math.max(0, resetTime - now);
  }
}

/**
 * Error thrown when PAT validation fails
 */
export class GitHubAuthError extends WorkSourceError {
  /** The scopes that were found */
  public readonly foundScopes: string[];
  /** The scopes that were required */
  public readonly requiredScopes: string[];
  /** The missing scopes */
  public readonly missingScopes: string[];

  constructor(
    message: string,
    options: {
      cause?: Error;
      foundScopes: string[];
      requiredScopes: string[];
    },
  ) {
    super(message, options);
    this.name = "GitHubAuthError";
    this.foundScopes = options.foundScopes;
    this.requiredScopes = options.requiredScopes;
    this.missingScopes = options.requiredScopes.filter((s) => !options.foundScopes.includes(s));
  }
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_LABELS = {
  ready: "ready",
  in_progress: "agent-working",
};

const DEFAULT_EXCLUDE_LABELS = ["blocked", "wip"];

const DEFAULT_API_BASE_URL = "https://api.github.com";

/** Default retry options */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.1,
};

/** Default rate limit warning threshold */
const DEFAULT_RATE_LIMIT_WARNING_THRESHOLD = 100;

/** Required scopes for full GitHub adapter functionality */
const REQUIRED_SCOPES = ["repo"] as const;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract rate limit information from GitHub API response headers
 */
export function extractRateLimitInfo(headers: Headers): RateLimitInfo | undefined {
  const remaining = headers.get("X-RateLimit-Remaining");
  const limit = headers.get("X-RateLimit-Limit");
  const reset = headers.get("X-RateLimit-Reset");
  const resource = headers.get("X-RateLimit-Resource");

  if (remaining === null || limit === null || reset === null) {
    return undefined;
  }

  return {
    remaining: parseInt(remaining, 10),
    limit: parseInt(limit, 10),
    reset: parseInt(reset, 10),
    resource: resource ?? "core",
  };
}

/**
 * Check if a response indicates rate limiting
 */
export function isRateLimitResponse(response: Response): boolean {
  // GitHub returns 403 with X-RateLimit-Remaining: 0 for rate limits
  // Also check for 429 which some GitHub endpoints may return
  if (response.status !== 403 && response.status !== 429) {
    return false;
  }

  const remaining = response.headers.get("X-RateLimit-Remaining");
  if (remaining === null) {
    return response.status === 429;
  }

  return parseInt(remaining, 10) === 0;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  options: Required<RetryOptions>,
  rateLimitResetMs?: number,
): number {
  // If we have rate limit reset info, use that as the delay
  if (rateLimitResetMs !== undefined && rateLimitResetMs > 0) {
    // Add a small buffer (1 second) to ensure the limit has reset
    return Math.min(rateLimitResetMs + 1000, options.maxDelayMs);
  }

  // Calculate exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * options.jitterFactor * Math.random();

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// GitHub Adapter Implementation
// =============================================================================

/**
 * Work source adapter for GitHub Issues
 *
 * Fetches issues with a specific label and allows claiming/completing them.
 * Uses the GitHub REST API to manage issue labels and comments.
 */
export class GitHubWorkSourceAdapter implements WorkSourceAdapter {
  public readonly type = "github" as const;

  private readonly config: GitHubWorkSourceConfig;
  private readonly labels: { ready: string; in_progress: string };
  private readonly excludeLabels: string[];
  private readonly apiBaseUrl: string;
  private readonly retryOptions: Required<RetryOptions>;
  private readonly rateLimitWarningThreshold: number;
  private readonly onRateLimitWarning?: (info: RateLimitInfo) => void;

  /** Last known rate limit info, updated after each request */
  private _lastRateLimitInfo?: RateLimitInfo;

  constructor(config: GitHubWorkSourceConfig) {
    this.config = config;
    this.labels = {
      ready: config.labels?.ready ?? DEFAULT_LABELS.ready,
      in_progress: config.labels?.in_progress ?? DEFAULT_LABELS.in_progress,
    };
    this.excludeLabels = config.exclude_labels ?? DEFAULT_EXCLUDE_LABELS;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...config.retry,
    };
    this.rateLimitWarningThreshold =
      config.rateLimitWarning?.warningThreshold ?? DEFAULT_RATE_LIMIT_WARNING_THRESHOLD;
    this.onRateLimitWarning = config.rateLimitWarning?.onWarning;
  }

  /**
   * Get the last known rate limit information
   */
  get lastRateLimitInfo(): RateLimitInfo | undefined {
    return this._lastRateLimitInfo;
  }

  /**
   * Get the GitHub API token from config or environment
   */
  private getToken(): string | undefined {
    return this.config.token ?? process.env.GITHUB_TOKEN;
  }

  /**
   * Get required owner and repo from config
   */
  private getOwnerRepo(): { owner: string; repo: string } {
    const { owner, repo } = this.config;
    if (!owner || !repo) {
      throw new GitHubAPIError("GitHub adapter requires 'owner' and 'repo' configuration");
    }
    return { owner, repo };
  }

  /**
   * Validate PAT has required scopes for GitHub adapter functionality
   *
   * Makes a request to check the token scopes and verifies
   * that the required scopes (repo) are present.
   *
   * @throws GitHubAuthError if required scopes are missing
   * @throws GitHubAPIError if the validation request fails
   */
  async validateToken(): Promise<{ scopes: string[]; valid: boolean }> {
    const token = this.getToken();

    if (!token) {
      throw new GitHubAuthError(
        "No GitHub token configured. Set GITHUB_TOKEN environment variable or provide token in config.",
        {
          foundScopes: [],
          requiredScopes: [...REQUIRED_SCOPES],
        },
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    };

    const url = `${this.apiBaseUrl}/user`;

    try {
      const response = await fetch(url, { method: "GET", headers });

      // Extract scopes from response header
      const scopesHeader = response.headers.get("X-OAuth-Scopes");
      const scopes = scopesHeader
        ? scopesHeader
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

      // Update rate limit info
      const rateLimitInfo = extractRateLimitInfo(response.headers);
      if (rateLimitInfo) {
        this._lastRateLimitInfo = rateLimitInfo;
        this.checkRateLimitWarning(rateLimitInfo);
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new GitHubAuthError("Invalid GitHub token. The token may be expired or revoked.", {
            foundScopes: scopes,
            requiredScopes: [...REQUIRED_SCOPES],
          });
        }
        throw new GitHubAPIError(`GitHub API error: ${response.status} ${response.statusText}`, {
          statusCode: response.status,
          endpoint: "/user",
        });
      }

      // Check for required scopes
      const hasRequiredScopes = REQUIRED_SCOPES.every((required) =>
        scopes.some((scope) => scope === required || scope.startsWith(`${required}:`)),
      );

      if (!hasRequiredScopes) {
        throw new GitHubAuthError(
          `GitHub token is missing required scopes. Found: [${scopes.join(", ")}], Required: [${REQUIRED_SCOPES.join(", ")}]`,
          {
            foundScopes: scopes,
            requiredScopes: [...REQUIRED_SCOPES],
          },
        );
      }

      return { scopes, valid: true };
    } catch (error) {
      if (error instanceof GitHubAuthError || error instanceof GitHubAPIError) {
        throw error;
      }
      throw new GitHubAPIError(
        `Failed to validate GitHub token: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined, endpoint: "/user" },
      );
    }
  }

  /**
   * Check rate limit and invoke warning callback if below threshold
   */
  private checkRateLimitWarning(info: RateLimitInfo): void {
    if (info.remaining < this.rateLimitWarningThreshold && this.onRateLimitWarning) {
      this.onRateLimitWarning(info);
    }
  }

  /**
   * Make an authenticated request to the GitHub API with retry logic
   *
   * Implements:
   * - Exponential backoff for rate limit errors (HTTP 403 with X-RateLimit-Remaining: 0)
   * - Network error retries (max 3 attempts by default)
   * - Rate limit status tracking and warnings
   */
  private async apiRequest<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const url = `${this.apiBaseUrl}${endpoint}`;
    let lastError: GitHubAPIError | undefined;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        // Extract and store rate limit info from every response
        const rateLimitInfo = extractRateLimitInfo(response.headers);
        if (rateLimitInfo) {
          this._lastRateLimitInfo = rateLimitInfo;
          this.checkRateLimitWarning(rateLimitInfo);
        }

        if (!response.ok) {
          // Check for rate limiting
          const isRateLimit = isRateLimitResponse(response);

          let errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
          try {
            const errorBody = (await response.json()) as GitHubErrorResponse;
            if (errorBody.message) {
              errorMessage = `GitHub API error: ${errorBody.message}`;
            }
          } catch {
            // Ignore JSON parse errors
          }

          const error = new GitHubAPIError(errorMessage, {
            statusCode: response.status,
            endpoint,
            rateLimitInfo,
            isRateLimitError: isRateLimit,
          });

          // Only retry on retryable errors
          if (error.isRetryable() && attempt < this.retryOptions.maxRetries) {
            lastError = error;
            const delay = calculateBackoffDelay(
              attempt,
              this.retryOptions,
              error.getTimeUntilReset(),
            );
            await sleep(delay);
            continue;
          }

          throw error;
        }

        // Handle 204 No Content responses
        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        // Re-throw GitHubAPIError as-is (already handled above)
        if (error instanceof GitHubAPIError) {
          throw error;
        }

        // Network errors - wrap and potentially retry
        const networkError = new GitHubAPIError(
          `Failed to connect to GitHub API: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error instanceof Error ? error : undefined, endpoint },
        );

        if (networkError.isRetryable() && attempt < this.retryOptions.maxRetries) {
          lastError = networkError;
          const delay = calculateBackoffDelay(attempt, this.retryOptions);
          await sleep(delay);
          continue;
        }

        throw networkError;
      }
    }

    // Should not reach here, but throw last error if we do
    throw lastError ?? new GitHubAPIError("Unknown error during API request", { endpoint });
  }

  /**
   * Make an authenticated request to the GitHub API with retry logic, returning both data and headers
   *
   * This variant returns the response headers along with the data, useful for
   * pagination (Link header) and other response metadata.
   */
  private async apiRequestWithHeaders<T>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<{ data: T; headers: Headers }> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const url = `${this.apiBaseUrl}${endpoint}`;
    let lastError: GitHubAPIError | undefined;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        // Extract and store rate limit info from every response
        const rateLimitInfo = extractRateLimitInfo(response.headers);
        if (rateLimitInfo) {
          this._lastRateLimitInfo = rateLimitInfo;
          this.checkRateLimitWarning(rateLimitInfo);
        }

        if (!response.ok) {
          // Check for rate limiting
          const isRateLimit = isRateLimitResponse(response);

          let errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
          try {
            const errorBody = (await response.json()) as GitHubErrorResponse;
            if (errorBody.message) {
              errorMessage = `GitHub API error: ${errorBody.message}`;
            }
          } catch {
            // Ignore JSON parse errors
          }

          const error = new GitHubAPIError(errorMessage, {
            statusCode: response.status,
            endpoint,
            rateLimitInfo,
            isRateLimitError: isRateLimit,
          });

          // Only retry on retryable errors
          if (error.isRetryable() && attempt < this.retryOptions.maxRetries) {
            lastError = error;
            const delay = calculateBackoffDelay(
              attempt,
              this.retryOptions,
              error.getTimeUntilReset(),
            );
            await sleep(delay);
            continue;
          }

          throw error;
        }

        // Handle 204 No Content responses
        if (response.status === 204) {
          return { data: undefined as T, headers: response.headers };
        }

        const data = (await response.json()) as T;
        return { data, headers: response.headers };
      } catch (error) {
        // Re-throw GitHubAPIError as-is (already handled above)
        if (error instanceof GitHubAPIError) {
          throw error;
        }

        // Network errors - wrap and potentially retry
        const networkError = new GitHubAPIError(
          `Failed to connect to GitHub API: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error instanceof Error ? error : undefined, endpoint },
        );

        if (networkError.isRetryable() && attempt < this.retryOptions.maxRetries) {
          lastError = networkError;
          const delay = calculateBackoffDelay(attempt, this.retryOptions);
          await sleep(delay);
          continue;
        }

        throw networkError;
      }
    }

    // Should not reach here, but throw last error if we do
    throw lastError ?? new GitHubAPIError("Unknown error during API request", { endpoint });
  }

  /**
   * Extract the issue number from a work item ID
   */
  private parseWorkItemId(workItemId: string): number {
    // Work item IDs are formatted as "github-{issueNumber}"
    const match = workItemId.match(/^github-(\d+)$/);
    if (!match) {
      throw new GitHubAPIError(
        `Invalid work item ID format: "${workItemId}". Expected "github-{number}"`,
      );
    }
    return parseInt(match[1], 10);
  }

  /**
   * Convert a GitHub issue to a WorkItem
   */
  private issueToWorkItem(issue: GitHubIssue): WorkItem {
    const labelNames = issue.labels.map((l) => l.name);

    return {
      id: `github-${issue.number}`,
      source: "github",
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body ?? "",
      priority: this.inferPriority(labelNames),
      labels: labelNames,
      metadata: {
        state: issue.state,
        assignee: issue.assignee?.login ?? null,
        assignees: issue.assignees.map((a) => a.login),
        milestone: issue.milestone
          ? {
              title: issue.milestone.title,
              number: issue.milestone.number,
            }
          : null,
        author: issue.user?.login ?? null,
      },
      url: issue.html_url,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
    };
  }

  /**
   * Infer priority from issue labels
   */
  private inferPriority(labels: string[]): WorkItemPriority {
    const lowerLabels = labels.map((l) => l.toLowerCase());

    if (
      lowerLabels.some((l) => l.includes("critical") || l.includes("p0") || l.includes("urgent"))
    ) {
      return "critical";
    }
    if (
      lowerLabels.some((l) => l.includes("high") || l.includes("p1") || l.includes("important"))
    ) {
      return "high";
    }
    if (lowerLabels.some((l) => l.includes("low") || l.includes("p3"))) {
      return "low";
    }
    return "medium";
  }

  /**
   * Build the query string for fetching issues
   */
  private buildIssueQuery(options?: FetchOptions): string {
    const params = new URLSearchParams();

    // Always filter by ready label
    params.set("labels", this.labels.ready);

    // Sort by creation date (oldest first for FIFO)
    params.set("sort", "created");
    params.set("direction", "asc");

    // State filter - only open issues unless claimed are included
    params.set("state", "open");

    // Pagination
    if (options?.limit) {
      params.set("per_page", String(Math.min(options.limit, 100)));
    } else {
      params.set("per_page", "30");
    }

    if (options?.cursor) {
      params.set("page", options.cursor);
    }

    return params.toString();
  }

  /**
   * Extract pagination cursor from Link header
   */
  private extractNextPage(linkHeader: string | null): string | undefined {
    if (!linkHeader) return undefined;

    // Parse Link header format: <url>; rel="next", <url>; rel="last"
    const links = linkHeader.split(",");
    for (const link of links) {
      const match = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

  /**
   * Fetch available work items from GitHub Issues
   *
   * Queries issues with the ready label, excludes issues with blocked/wip labels,
   * and returns them sorted by creation date (oldest first).
   *
   * Includes retry logic for transient failures and rate limit handling.
   */
  async fetchAvailableWork(options?: FetchOptions): Promise<FetchResult> {
    const { owner, repo } = this.getOwnerRepo();
    const query = this.buildIssueQuery(options);
    const endpoint = `/repos/${owner}/${repo}/issues?${query}`;

    const { data: issues, headers } = await this.apiRequestWithHeaders<GitHubIssue[]>(
      "GET",
      endpoint,
    );

    // Filter out issues with excluded labels and issues that are already claimed
    const filteredIssues = issues.filter((issue) => {
      const labelNames = issue.labels.map((l) => l.name.toLowerCase());

      // Exclude issues with any of the exclude labels
      const hasExcludedLabel = this.excludeLabels.some((excluded) =>
        labelNames.includes(excluded.toLowerCase()),
      );
      if (hasExcludedLabel) return false;

      // Unless includeClaimed is true, exclude issues with in_progress label
      if (!options?.includeClaimed) {
        const hasInProgressLabel = labelNames.includes(this.labels.in_progress.toLowerCase());
        if (hasInProgressLabel) return false;
      }

      // Apply additional label filters if specified
      if (options?.labels && options.labels.length > 0) {
        const hasAllLabels = options.labels.every((required) =>
          labelNames.includes(required.toLowerCase()),
        );
        if (!hasAllLabels) return false;
      }

      return true;
    });

    // Filter by priority if specified
    let workItems = filteredIssues.map((issue) => this.issueToWorkItem(issue));
    if (options?.priority && options.priority.length > 0) {
      workItems = workItems.filter((item) => options.priority!.includes(item.priority));
    }

    // Extract pagination info from Link header
    const linkHeader = headers.get("Link");
    const nextCursor = this.extractNextPage(linkHeader);

    return {
      items: workItems,
      nextCursor,
    };
  }

  /**
   * Claim a work item by adding the in-progress label and removing the ready label
   */
  async claimWork(workItemId: string): Promise<ClaimResult> {
    const { owner, repo } = this.getOwnerRepo();
    const issueNumber = this.parseWorkItemId(workItemId);

    try {
      // First, get the current issue to verify it exists and is claimable
      const issue = await this.apiRequest<GitHubIssue>(
        "GET",
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
      );

      if (!issue) {
        return {
          success: false,
          reason: "not_found",
          message: `Issue #${issueNumber} not found`,
        };
      }

      if (issue.state === "closed") {
        return {
          success: false,
          reason: "invalid_state",
          message: `Issue #${issueNumber} is closed`,
        };
      }

      const labelNames = issue.labels.map((l) => l.name.toLowerCase());

      // Check if already claimed
      if (labelNames.includes(this.labels.in_progress.toLowerCase())) {
        return {
          success: false,
          reason: "already_claimed",
          message: `Issue #${issueNumber} is already claimed`,
        };
      }

      // Add the in-progress label
      await this.apiRequest<void>("POST", `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        labels: [this.labels.in_progress],
      });

      // Remove the ready label (if present)
      if (labelNames.includes(this.labels.ready.toLowerCase())) {
        try {
          await this.apiRequest<void>(
            "DELETE",
            `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(this.labels.ready)}`,
          );
        } catch {
          // Ignore errors removing the ready label - it might not exist
        }
      }

      // Fetch the updated issue
      const updatedIssue = await this.apiRequest<GitHubIssue>(
        "GET",
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
      );

      return {
        success: true,
        workItem: this.issueToWorkItem(updatedIssue),
      };
    } catch (error) {
      if (error instanceof GitHubAPIError) {
        if (error.statusCode === 404) {
          return {
            success: false,
            reason: "not_found",
            message: `Issue #${issueNumber} not found`,
          };
        }
        if (error.statusCode === 403) {
          return {
            success: false,
            reason: "permission_denied",
            message: `Permission denied for issue #${issueNumber}`,
          };
        }
        return {
          success: false,
          reason: "source_error",
          message: error.message,
        };
      }
      return {
        success: false,
        reason: "source_error",
        message: `Failed to claim issue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Complete a work item by posting a comment with the result and optionally closing the issue
   */
  async completeWork(workItemId: string, result: WorkResult): Promise<void> {
    const { owner, repo } = this.getOwnerRepo();
    const issueNumber = this.parseWorkItemId(workItemId);

    // Build the completion comment
    const outcomeEmoji =
      result.outcome === "success" ? "✅" : result.outcome === "partial" ? "⚠️" : "❌";

    let commentBody = `## ${outcomeEmoji} Work Completed\n\n`;
    commentBody += `**Outcome:** ${result.outcome}\n\n`;
    commentBody += `**Summary:** ${result.summary}\n`;

    if (result.details) {
      commentBody += `\n### Details\n\n${result.details}\n`;
    }

    if (result.artifacts && result.artifacts.length > 0) {
      commentBody += `\n### Artifacts\n\n`;
      for (const artifact of result.artifacts) {
        commentBody += `- ${artifact}\n`;
      }
    }

    if (result.error) {
      commentBody += `\n### Error\n\n\`\`\`\n${result.error}\n\`\`\`\n`;
    }

    // Post the comment
    await this.apiRequest<void>("POST", `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      body: commentBody,
    });

    // Remove the in-progress label
    try {
      await this.apiRequest<void>(
        "DELETE",
        `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(this.labels.in_progress)}`,
      );
    } catch {
      // Ignore errors removing the label
    }

    // Close the issue if the outcome was success
    if (result.outcome === "success") {
      await this.apiRequest<void>("PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, {
        state: "closed",
        state_reason: "completed",
      });
    }
  }

  /**
   * Release a claimed work item by removing in-progress label and re-adding ready label
   */
  async releaseWork(workItemId: string, options?: ReleaseOptions): Promise<ReleaseResult> {
    const { owner, repo } = this.getOwnerRepo();
    const issueNumber = this.parseWorkItemId(workItemId);

    try {
      // Add a comment if requested
      if (options?.addComment && options?.reason) {
        await this.apiRequest<void>(
          "POST",
          `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          { body: `⏸️ **Work Released**\n\nReason: ${options.reason}` },
        );
      }

      // Remove the in-progress label
      try {
        await this.apiRequest<void>(
          "DELETE",
          `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(this.labels.in_progress)}`,
        );
      } catch {
        // Ignore errors removing the label
      }

      // Re-add the ready label if cleanup_on_failure is true (default)
      if (this.config.cleanup_on_failure !== false) {
        await this.apiRequest<void>(
          "POST",
          `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
          { labels: [this.labels.ready] },
        );
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: `Failed to release issue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get a specific work item by ID
   */
  async getWork(workItemId: string): Promise<WorkItem | undefined> {
    const { owner, repo } = this.getOwnerRepo();
    const issueNumber = this.parseWorkItemId(workItemId);

    try {
      const issue = await this.apiRequest<GitHubIssue>(
        "GET",
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
      );

      return this.issueToWorkItem(issue);
    } catch (error) {
      if (error instanceof GitHubAPIError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }
}

/**
 * Factory function for creating GitHub adapters
 */
export function createGitHubAdapter(config: WorkSourceConfig): WorkSourceAdapter {
  return new GitHubWorkSourceAdapter(config as GitHubWorkSourceConfig);
}
