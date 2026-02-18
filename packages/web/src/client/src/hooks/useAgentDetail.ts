/**
 * React hook for fetching a single agent's details
 *
 * Fetches agent data via REST API on mount or when name changes.
 * Combines REST data with WebSocket-updated store data.
 */

import { useEffect, useState, useCallback } from "react";
import { fetchAgent } from "../lib/api";
import { useStore, useAgent } from "../store";
import type { AgentInfo } from "../lib/types";

// =============================================================================
// Types
// =============================================================================

export interface UseAgentDetailResult {
  /** The agent data (from store, kept up-to-date by WebSocket) */
  agent: AgentInfo | null;
  /** Whether initial data is still loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Retry the fetch */
  retry: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to fetch a single agent's details
 *
 * - Fetches agent via REST API on mount
 * - Updates the store with fresh data
 * - Returns agent from store (kept up-to-date by WebSocket)
 *
 * @param name - The agent name from route params
 *
 * @example
 * ```tsx
 * function AgentPage() {
 *   const { name } = useParams<{ name: string }>();
 *   const { agent, loading, error, retry } = useAgentDetail(name ?? null);
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} onRetry={retry} />;
 *   if (!agent) return <NotFound />;
 *
 *   return <AgentDetail agent={agent} />;
 * }
 * ```
 */
export function useAgentDetail(name: string | null): UseAgentDetailResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Get agent from store (kept up-to-date by WebSocket)
  const agent = useAgent(name);

  // Get store update action
  const updateAgent = useStore((state) => state.updateAgent);

  useEffect(() => {
    if (!name) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadAgent(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const agentData = await fetchAgent(name!);

        if (cancelled) return;

        // Update store with fresh data
        // Wrap agent data in AgentStartedPayload format
        updateAgent({ agent: agentData });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;

        const message =
          err instanceof Error ? err.message : "Failed to fetch agent";
        setError(message);
        setLoading(false);
      }
    }

    loadAgent();

    return () => {
      cancelled = true;
    };
  }, [name, retryCount]);

  const retry = useCallback((): void => {
    setRetryCount((c) => c + 1);
  }, []);

  return {
    agent,
    loading,
    error,
    retry,
  };
}
