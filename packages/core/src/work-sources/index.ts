/**
 * Work Sources Module
 *
 * Provides a common interface for fetching and managing work items
 * from various sources (GitHub Issues, Linear, etc.).
 *
 * All work source adapters implement the WorkSource interface to ensure
 * consistent behavior across different backends.
 *
 * The registry allows dynamic registration of adapter factories,
 * enabling extensibility without modifying core code.
 *
 * The WorkSourceManager interface defines the contract between work sources
 * and the scheduler/runner, allowing clean integration without coupling.
 */

// Re-export built-in adapters (also triggers auto-registration)
export * from "./adapters/index.js";

// Re-export errors
export * from "./errors.js";

// Re-export manager interface and types
export type {
  GetNextWorkItemOptions,
  GetNextWorkItemResult,
  ReleaseWorkItemOptions,
  ReportOutcomeOptions,
  WorkSourceManager,
  WorkSourceManagerFactory,
} from "./manager.js";
export type { WorkSourceConfig, WorkSourceFactory } from "./registry.js";
// Re-export registry functions and types
export {
  clearWorkSourceRegistry,
  getRegisteredTypes,
  getWorkSource,
  isWorkSourceRegistered,
  registerWorkSource,
  unregisterWorkSource,
} from "./registry.js";
// Re-export all types
export * from "./types.js";

// Import types for interface definition
import type {
  ClaimResult,
  FetchOptions,
  FetchResult,
  ReleaseOptions,
  ReleaseResult,
  WorkItem,
  WorkResult,
} from "./types.js";

// =============================================================================
// WorkSourceAdapter Interface
// =============================================================================

/**
 * Common interface for all work source adapters
 *
 * Work sources provide work items from external systems (GitHub, Linear, etc.)
 * and handle the lifecycle of claiming, completing, and releasing work.
 *
 * @example
 * ```typescript
 * const github = new GitHubWorkSourceAdapter({ owner: 'org', repo: 'repo' });
 *
 * // Fetch available work
 * const { items } = await github.fetchAvailableWork({ labels: ['agent-ready'] });
 *
 * // Claim a work item
 * const claim = await github.claimWork(items[0].id);
 * if (claim.success) {
 *   // Do work...
 *   await github.completeWork(items[0].id, { outcome: 'success', summary: 'Fixed the bug' });
 * }
 * ```
 */
export interface WorkSourceAdapter {
  /**
   * The type identifier for this work source (e.g., 'github', 'linear')
   *
   * Used to prefix work item IDs and identify the source in logs/state.
   */
  readonly type: string;

  /**
   * Fetch available work items from the source
   *
   * Returns work items that match the specified filters and are available
   * to be claimed (not already in progress by another agent).
   *
   * @param options - Filtering and pagination options
   * @returns Promise resolving to fetched items with pagination info
   */
  fetchAvailableWork(options?: FetchOptions): Promise<FetchResult>;

  /**
   * Claim a work item for processing
   *
   * Marks the work item as in-progress in the external system to prevent
   * other agents from picking it up. The exact mechanism depends on the
   * source (e.g., adding a label, assigning to a bot user).
   *
   * @param workItemId - The ID of the work item to claim
   * @returns Promise resolving to the claim result
   */
  claimWork(workItemId: string): Promise<ClaimResult>;

  /**
   * Complete a work item with the given result
   *
   * Updates the external system to reflect completion (e.g., closing an issue,
   * adding a comment with the summary). The work item is released from claim.
   *
   * @param workItemId - The ID of the work item to complete
   * @param result - The outcome and details of the work
   * @returns Promise resolving when the completion is recorded
   */
  completeWork(workItemId: string, result: WorkResult): Promise<void>;

  /**
   * Release a claimed work item without completing it
   *
   * Returns the work item to available status so other agents can claim it.
   * Use this when an agent cannot complete the work (e.g., timeout, error).
   *
   * @param workItemId - The ID of the work item to release
   * @param options - Options for the release (reason, add comment, etc.)
   * @returns Promise resolving to the release result
   */
  releaseWork(workItemId: string, options?: ReleaseOptions): Promise<ReleaseResult>;

  /**
   * Get a specific work item by ID
   *
   * Fetches the current state of a work item from the source.
   * Returns undefined if the work item doesn't exist.
   *
   * @param workItemId - The ID of the work item to fetch
   * @returns Promise resolving to the work item or undefined
   */
  getWork(workItemId: string): Promise<WorkItem | undefined>;
}
