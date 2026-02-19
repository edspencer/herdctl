/**
 * Work Source Manager Interface
 *
 * Defines the contract between work sources and the scheduler/runner.
 * The scheduler uses this interface to fetch work, report outcomes,
 * and manage work source instances per agent.
 *
 * This module defines ONLY the interface - no scheduler logic is implemented here.
 * The scheduler implementation will import and use this interface.
 *
 * @example Scheduler Usage Pattern
 * ```typescript
 * // The scheduler will use the manager like this:
 * const manager: WorkSourceManager = getWorkSourceManager();
 *
 * // 1. Get next available work for an agent
 * const workItem = await manager.getNextWorkItem(agent);
 * if (!workItem) {
 *   // No work available, scheduler may check other agents or wait
 *   return;
 * }
 *
 * // 2. Work item is already claimed by getNextWorkItem()
 * // Build prompt from work item and execute job
 * const prompt = buildPromptFromWorkItem(workItem);
 * const result = await executeJob({ agent, prompt, ... });
 *
 * // 3. Report outcome to update external system
 * await manager.reportOutcome(workItem.id, {
 *   outcome: result.success ? 'success' : 'failure',
 *   summary: result.summary ?? 'Job completed',
 *   error: result.error?.message,
 * });
 * ```
 *
 * @example Error Handling Pattern
 * ```typescript
 * try {
 *   const workItem = await manager.getNextWorkItem(agent);
 *   // ... execute work ...
 *   await manager.reportOutcome(workItem.id, { outcome: 'success', summary: '...' });
 * } catch (error) {
 *   // On unexpected error, release the work item back to available pool
 *   if (workItem) {
 *     await manager.releaseWorkItem(workItem.id, `Unexpected error: ${error.message}`);
 *   }
 * }
 * ```
 *
 * @example Multiple Agents Pattern
 * ```typescript
 * // Manager caches adapters per agent to avoid repeated instantiation
 * for (const agent of agents) {
 *   // Each call uses cached adapter for the agent's work source
 *   const workItem = await manager.getNextWorkItem(agent);
 *   // ...
 * }
 * ```
 */

import type { ResolvedAgent } from "../config/loader.js";
import type {
  WorkItem,
  WorkResult,
  ClaimResult,
  ReleaseResult,
  ReleaseOptions,
  FetchOptions,
} from "./types.js";
import type { WorkSourceAdapter } from "./index.js";

// =============================================================================
// Manager Types
// =============================================================================

/**
 * Options for fetching the next work item
 *
 * Allows the scheduler to customize work item selection beyond
 * what's configured in the agent's work source.
 */
export interface GetNextWorkItemOptions {
  /**
   * Additional labels to filter by (combined with agent's configured labels)
   */
  labels?: string[];

  /**
   * Whether to automatically claim the work item
   * Defaults to true - the scheduler typically wants to claim immediately
   */
  autoClaim?: boolean;

  /**
   * Custom fetch options to pass to the adapter
   * These override the default options for this specific fetch
   */
  fetchOptions?: Partial<FetchOptions>;
}

/**
 * Result of getting the next work item
 *
 * Includes both the work item (if found) and claim status (if autoClaim was true).
 * This allows the scheduler to handle various scenarios:
 * - No work available (item is null)
 * - Work found and claimed successfully
 * - Work found but claim failed (race condition with another agent)
 */
export interface GetNextWorkItemResult {
  /**
   * The work item, or null if no work is available
   */
  item: WorkItem | null;

  /**
   * Whether the work item was claimed
   * Only relevant when autoClaim is true and item is not null
   */
  claimed: boolean;

  /**
   * Claim result details if claiming was attempted
   * Contains failure reason if claimed is false
   */
  claimResult?: ClaimResult;
}

/**
 * Options for releasing a work item
 */
export interface ReleaseWorkItemOptions extends ReleaseOptions {
  /**
   * The agent that claimed the work item
   * Used to resolve the correct adapter for the release operation
   */
  agent: ResolvedAgent;
}

/**
 * Options for reporting work outcome
 */
export interface ReportOutcomeOptions {
  /**
   * The agent that processed the work item
   * Used to resolve the correct adapter for the completion operation
   */
  agent: ResolvedAgent;
}

// =============================================================================
// WorkSourceManager Interface
// =============================================================================

/**
 * Interface for managing work sources and coordinating with the scheduler
 *
 * The WorkSourceManager provides a high-level interface for the scheduler to:
 * 1. Fetch available work items for agents
 * 2. Claim work items to prevent race conditions
 * 3. Report outcomes after job completion
 * 4. Release work items on error/timeout
 *
 * The manager handles:
 * - Work source adapter instantiation and caching per agent
 * - Resolving work source configuration from agent configs
 * - Coordinating claim/release lifecycle
 *
 * Implementation Notes for Scheduler Authors:
 * - Call getNextWorkItem() with autoClaim=true (default) for atomic fetch+claim
 * - Always call reportOutcome() or releaseWorkItem() after processing
 * - The manager caches adapters, so repeated calls are efficient
 * - If an agent has no work_source configured, getNextWorkItem returns { item: null }
 *
 * @example Basic Scheduler Loop
 * ```typescript
 * async function processAgent(manager: WorkSourceManager, agent: ResolvedAgent) {
 *   // Check if we can run more instances
 *   if (activeJobs[agent.name] >= (agent.instances?.max_concurrent ?? 1)) {
 *     return; // Already at capacity
 *   }
 *
 *   // Try to get work
 *   const { item, claimed, claimResult } = await manager.getNextWorkItem(agent);
 *
 *   if (!item) {
 *     return; // No work available
 *   }
 *
 *   if (!claimed) {
 *     // Someone else claimed it first (race condition)
 *     console.log(`Work ${item.id} claimed by another agent: ${claimResult?.reason}`);
 *     return;
 *   }
 *
 *   // Execute the job
 *   try {
 *     const result = await executeJob(agent, item);
 *     await manager.reportOutcome(item.id, result, { agent });
 *   } catch (error) {
 *     await manager.releaseWorkItem(item.id, {
 *       agent,
 *       reason: error.message,
 *       addComment: true,
 *     });
 *   }
 * }
 * ```
 */
export interface WorkSourceManager {
  /**
   * Get the next available work item for an agent
   *
   * Fetches the highest priority available work item from the agent's
   * configured work source. By default, also claims the item atomically
   * to prevent race conditions with other agents.
   *
   * @param agent - The resolved agent configuration
   * @param options - Options for fetching and claiming
   * @returns Result containing the work item (if any) and claim status
   *
   * @remarks
   * - Returns { item: null, claimed: false } if agent has no work_source
   * - Returns { item: null, claimed: false } if no work is available
   * - With autoClaim=true, claimed=false means another agent claimed it first
   * - The scheduler should handle claim failures by retrying or moving on
   *
   * @example
   * ```typescript
   * const result = await manager.getNextWorkItem(agent);
   *
   * if (!result.item) {
   *   console.log('No work available for agent:', agent.name);
   *   return;
   * }
   *
   * if (!result.claimed) {
   *   console.log('Work was claimed by another agent');
   *   return;
   * }
   *
   * // Safe to process the work item
   * console.log('Processing:', result.item.title);
   * ```
   */
  getNextWorkItem(
    agent: ResolvedAgent,
    options?: GetNextWorkItemOptions,
  ): Promise<GetNextWorkItemResult>;

  /**
   * Report the outcome of processing a work item
   *
   * Updates the external system (GitHub, Linear, etc.) with the job result.
   * This typically involves:
   * - Adding a comment with the summary
   * - Closing the issue/task if successful
   * - Removing in-progress labels
   * - Adding completion labels
   *
   * @param taskId - The work item ID (from WorkItem.id)
   * @param result - The outcome of the work
   * @param options - Options including the agent that processed the item
   *
   * @remarks
   * - Must be called after job completion (success or failure)
   * - For failures, use result.outcome='failure' and include result.error
   * - The external system behavior depends on the adapter implementation
   *
   * @example
   * ```typescript
   * // Success case
   * await manager.reportOutcome(
   *   workItem.id,
   *   {
   *     outcome: 'success',
   *     summary: 'Fixed the authentication bug',
   *     details: 'Updated the JWT validation logic...',
   *     artifacts: ['https://github.com/org/repo/pull/123'],
   *   },
   *   { agent }
   * );
   *
   * // Failure case
   * await manager.reportOutcome(
   *   workItem.id,
   *   {
   *     outcome: 'failure',
   *     summary: 'Unable to reproduce the issue',
   *     error: 'Tests pass on all environments',
   *   },
   *   { agent }
   * );
   * ```
   */
  reportOutcome(taskId: string, result: WorkResult, options: ReportOutcomeOptions): Promise<void>;

  /**
   * Release a claimed work item without completing it
   *
   * Returns the work item to the available pool so other agents can claim it.
   * Use this when:
   * - Job times out
   * - Unexpected error prevents completion
   * - Agent is shutting down mid-task
   * - Manual intervention is needed
   *
   * @param taskId - The work item ID (from WorkItem.id)
   * @param options - Release options including reason and agent
   * @returns Result indicating if the release was successful
   *
   * @remarks
   * - Always call this or reportOutcome after claiming work
   * - If addComment is true, posts a comment explaining the release
   * - The work item becomes available for other agents to claim
   *
   * @example
   * ```typescript
   * // On timeout
   * await manager.releaseWorkItem(workItem.id, {
   *   agent,
   *   reason: 'Job timed out after 30 minutes',
   *   addComment: true,
   * });
   *
   * // On error
   * await manager.releaseWorkItem(workItem.id, {
   *   agent,
   *   reason: `Unexpected error: ${error.message}`,
   *   addComment: true,
   * });
   * ```
   */
  releaseWorkItem(taskId: string, options: ReleaseWorkItemOptions): Promise<ReleaseResult>;

  /**
   * Get the work source adapter for an agent
   *
   * Returns the cached adapter instance for the agent's work source,
   * or null if the agent has no work source configured.
   *
   * This is useful for:
   * - Direct adapter operations not covered by the manager
   * - Inspecting adapter state or configuration
   * - Testing and debugging
   *
   * @param agent - The resolved agent configuration
   * @returns The adapter instance or null
   *
   * @remarks
   * - Adapters are cached per agent (by agent name + work source type)
   * - Creating new adapters is cheap but caching improves consistency
   * - The adapter is created lazily on first access
   *
   * @example
   * ```typescript
   * const adapter = await manager.getAdapter(agent);
   *
   * if (!adapter) {
   *   console.log('Agent has no work source configured');
   *   return;
   * }
   *
   * // Direct adapter operations
   * const workItem = await adapter.getWork('github:12345');
   * ```
   */
  getAdapter(agent: ResolvedAgent): Promise<WorkSourceAdapter | null>;

  /**
   * Clear the adapter cache
   *
   * Removes all cached adapter instances. Use this when:
   * - Configuration has changed and adapters need to be recreated
   * - Testing requires fresh adapter instances
   * - Memory cleanup is needed
   *
   * @remarks
   * - Subsequent getAdapter/getNextWorkItem calls will create new adapters
   * - In-flight operations on old adapters are not affected
   * - Does not affect external system state
   */
  clearCache(): void;
}

// =============================================================================
// Factory Function Type
// =============================================================================

/**
 * Factory function for creating WorkSourceManager instances
 *
 * The scheduler will use this to get a manager instance. The default
 * implementation is provided by the work-sources module, but this can
 * be customized for testing or advanced use cases.
 *
 * @example
 * ```typescript
 * // Default usage
 * const manager = createWorkSourceManager();
 *
 * // With custom options (future extension point)
 * const manager = createWorkSourceManager({ cache: customCache });
 * ```
 */
export type WorkSourceManagerFactory = () => WorkSourceManager;
