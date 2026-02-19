/**
 * Work Source Registry
 *
 * Provides a singleton registry for work source adapters.
 * Allows registration of factory functions that create adapter instances
 * based on configuration.
 */

import type { WorkSourceAdapter } from "./index.js";
import type { WorkSourceLabels } from "../config/schema.js";
import { UnknownWorkSourceError, DuplicateWorkSourceError } from "./errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for a work source adapter
 *
 * This is a flexible configuration type that allows any work source type
 * to be registered. For type-safe configuration of known types, use the
 * specific config types (e.g., GitHubWorkSourceConfig).
 */
export interface WorkSourceConfig {
  /** The type identifier for this work source (e.g., 'github', 'linear') */
  type: string;
  /** Label configuration for work item states */
  labels?: WorkSourceLabels;
  /** Whether to clean up in-progress labels on startup */
  cleanup_in_progress?: boolean;
  /** Additional adapter-specific configuration */
  [key: string]: unknown;
}

/**
 * Factory function that creates a work source adapter instance
 *
 * @param config - The configuration for the work source
 * @returns A configured WorkSourceAdapter instance
 */
export type WorkSourceFactory = (config: WorkSourceConfig) => WorkSourceAdapter;

// =============================================================================
// Registry State (Module-level Singleton)
// =============================================================================

/**
 * Internal registry map storing factories by type
 */
const registry = new Map<string, WorkSourceFactory>();

// =============================================================================
// Registry Functions
// =============================================================================

/**
 * Register a work source adapter factory
 *
 * Registers a factory function that will be used to create adapter instances
 * for the specified type. The factory is called when `getWorkSource()` is
 * invoked with a matching type.
 *
 * @param type - The unique type identifier (e.g., 'github', 'linear')
 * @param factory - Factory function that creates adapter instances
 * @throws {DuplicateWorkSourceError} If the type is already registered
 *
 * @example
 * ```typescript
 * registerWorkSource('github', (config) => new GitHubAdapter(config));
 * registerWorkSource('linear', (config) => new LinearAdapter(config));
 * ```
 */
export function registerWorkSource(type: string, factory: WorkSourceFactory): void {
  if (registry.has(type)) {
    throw new DuplicateWorkSourceError(type);
  }
  registry.set(type, factory);
}

/**
 * Get a configured work source adapter instance
 *
 * Looks up the factory for the specified type and calls it with the
 * provided configuration to create an adapter instance.
 *
 * @param config - The work source configuration (must include `type`)
 * @returns A configured WorkSourceAdapter instance
 * @throws {UnknownWorkSourceError} If no factory is registered for the type
 *
 * @example
 * ```typescript
 * const adapter = getWorkSource({
 *   type: 'github',
 *   labels: { ready: 'agent-ready', in_progress: 'agent-working' }
 * });
 *
 * const { items } = await adapter.fetchAvailableWork();
 * ```
 */
export function getWorkSource(config: WorkSourceConfig): WorkSourceAdapter {
  const factory = registry.get(config.type);

  if (!factory) {
    throw new UnknownWorkSourceError(config.type, getRegisteredTypes());
  }

  return factory(config);
}

/**
 * Get a list of all registered work source types
 *
 * @returns Array of registered type identifiers
 *
 * @example
 * ```typescript
 * const types = getRegisteredTypes();
 * // ['github', 'linear', 'jira']
 * ```
 */
export function getRegisteredTypes(): string[] {
  return Array.from(registry.keys());
}

/**
 * Check if a work source type is registered
 *
 * @param type - The type identifier to check
 * @returns True if the type is registered
 *
 * @example
 * ```typescript
 * if (isWorkSourceRegistered('github')) {
 *   const adapter = getWorkSource({ type: 'github' });
 * }
 * ```
 */
export function isWorkSourceRegistered(type: string): boolean {
  return registry.has(type);
}

/**
 * Unregister a work source adapter factory
 *
 * Removes the factory for the specified type. Primarily useful for testing.
 *
 * @param type - The type identifier to unregister
 * @returns True if the type was registered and removed, false otherwise
 *
 * @example
 * ```typescript
 * // In tests
 * unregisterWorkSource('github');
 * registerWorkSource('github', mockFactory);
 * ```
 */
export function unregisterWorkSource(type: string): boolean {
  return registry.delete(type);
}

/**
 * Clear all registered work source factories
 *
 * Removes all registered factories. Primarily useful for testing.
 * Note: This will also clear built-in adapters.
 *
 * @example
 * ```typescript
 * // In test setup/teardown
 * clearWorkSourceRegistry();
 * ```
 */
export function clearWorkSourceRegistry(): void {
  registry.clear();
}
