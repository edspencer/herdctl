/**
 * React hook for job output subscription
 *
 * Manages WebSocket subscription/unsubscription for an agent's output stream.
 * Subscribes when mounted with an agent name, unsubscribes when unmounted.
 */

import { useEffect, useRef } from "react";
import { useStore, useJobOutput as useJobOutputSelector } from "../store";

// =============================================================================
// Types
// =============================================================================

interface UseJobOutputOptions {
  /** Agent qualified name to subscribe to */
  agentName: string | null;
  /** Current job ID to display output for */
  jobId: string | null;
}

interface UseJobOutputResult {
  /** Output messages for the current job */
  messages: ReturnType<typeof useJobOutputSelector>;
  /** Whether currently subscribed to the agent */
  isSubscribed: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to manage job output subscription and retrieval
 *
 * @param options - Agent name and job ID
 * @returns Output messages and subscription status
 *
 * @example
 * ```tsx
 * function OutputViewer({ agent }: { agent: AgentInfo }) {
 *   const { messages, isSubscribed } = useJobOutput({
 *     agentName: agent.name,
 *     jobId: agent.currentJobId,
 *   });
 *
 *   return (
 *     <div>
 *       {messages.map((msg) => (
 *         <div key={msg.id}>{msg.data}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useJobOutput({ agentName, jobId }: UseJobOutputOptions): UseJobOutputResult {
  // Track subscription state
  const subscribedAgentRef = useRef<string | null>(null);

  // Get output messages for the job
  const messages = useJobOutputSelector(jobId);

  // Get subscribe/unsubscribe from the WebSocket hook via store access
  // Note: The actual WebSocket client is managed by useWebSocket in App.tsx
  // We access the subscription functions through a global reference
  const setActiveJobView = useStore((state) => state.setActiveJobView);

  // Subscribe/unsubscribe when agent name changes
  useEffect(() => {
    // Get the WebSocket client from the global reference
    const wsClient = (
      window as unknown as {
        __herdWsClient?: { subscribe: (name: string) => void; unsubscribe: (name: string) => void };
      }
    ).__herdWsClient;

    if (agentName && wsClient) {
      // Unsubscribe from previous agent if different
      if (subscribedAgentRef.current && subscribedAgentRef.current !== agentName) {
        wsClient.unsubscribe(subscribedAgentRef.current);
      }

      // Subscribe to new agent
      wsClient.subscribe(agentName);
      subscribedAgentRef.current = agentName;
    }

    // Cleanup: unsubscribe when unmounting or agent changes to null
    return () => {
      if (subscribedAgentRef.current && wsClient) {
        wsClient.unsubscribe(subscribedAgentRef.current);
        subscribedAgentRef.current = null;
      }
    };
  }, [agentName]);

  // Track active job view for the store
  useEffect(() => {
    if (jobId) {
      setActiveJobView(jobId, true);
    }

    return () => {
      if (jobId) {
        setActiveJobView(jobId, false);
      }
    };
  }, [jobId]);

  return {
    messages,
    isSubscribed: subscribedAgentRef.current === agentName && agentName !== null,
  };
}
