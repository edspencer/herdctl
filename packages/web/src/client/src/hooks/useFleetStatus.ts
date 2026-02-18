/**
 * React hook for fetching initial fleet status
 *
 * Fetches fleet status and agents via REST API on mount.
 * Data is stored in the Zustand store and kept up-to-date by WebSocket.
 */

import { useEffect, useState } from "react";
import { fetchFleetStatus, fetchAgents } from "../lib/api";
import { useStore } from "../store";

// =============================================================================
// Types
// =============================================================================

export interface UseFleetStatusResult {
  /** Whether initial data is still loading */
  loading: boolean;
  /** Error message if initial fetch failed */
  error: string | null;
  /** Retry the initial fetch */
  retry: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to fetch initial fleet status and agents
 *
 * - Fetches fleet status and agents on mount
 * - Stores data in Zustand store
 * - Returns loading/error states
 *
 * Data is kept up-to-date by WebSocket events after initial load.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { loading, error, retry } = useFleetStatus();
 *   const { fleetStatus, agents } = useFleet();
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} onRetry={retry} />;
 *
 *   return <FleetDashboard status={fleetStatus} agents={agents} />;
 * }
 * ```
 */
export function useFleetStatus(): UseFleetStatusResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const setFleetStatus = useStore((state) => state.setFleetStatus);
  const setAgents = useStore((state) => state.setAgents);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        // Fetch fleet status and agents in parallel
        const [status, agents] = await Promise.all([
          fetchFleetStatus(),
          fetchAgents(),
        ]);

        if (cancelled) return;

        // Update store
        setFleetStatus(status);
        setAgents(agents);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;

        const message = err instanceof Error ? err.message : "Failed to fetch fleet data";
        setError(message);
        setLoading(false);
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  const retry = (): void => {
    setRetryCount((c) => c + 1);
  };

  return {
    loading,
    error,
    retry,
  };
}
