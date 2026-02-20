/**
 * React hook for WebSocket connection
 *
 * Initializes WebSocket on mount, disconnects on unmount,
 * and dispatches incoming messages to the store.
 * Re-syncs data from REST API on reconnect.
 */

import { useEffect, useRef } from "react";
import { fetchAgents, fetchFleetStatus } from "../lib/api";
import type { ConnectionStatus, ServerMessage } from "../lib/types";
import { createWebSocketClient, type WebSocketClient } from "../lib/ws";
import { useStore } from "../store";

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to manage WebSocket connection lifecycle
 *
 * - Connects on mount
 * - Disconnects on unmount
 * - Dispatches incoming messages to the store
 *
 * @returns Current connection status
 *
 * @example
 * ```tsx
 * function App() {
 *   const { connectionStatus } = useWebSocket();
 *
 *   return (
 *     <div>
 *       Connection: {connectionStatus}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWebSocket() {
  const clientRef = useRef<WebSocketClient | null>(null);
  const prevStatusRef = useRef<ConnectionStatus>("disconnected");
  const hasConnectedOnceRef = useRef(false);

  // Get store actions
  const setFleetStatus = useStore((state) => state.setFleetStatus);
  const setAgents = useStore((state) => state.setAgents);
  const updateAgent = useStore((state) => state.updateAgent);
  const addJob = useStore((state) => state.addJob);
  const completeJob = useStore((state) => state.completeJob);
  const failJob = useStore((state) => state.failJob);
  const cancelJob = useStore((state) => state.cancelJob);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const appendOutput = useStore((state) => state.appendOutput);
  const appendStreamingChunk = useStore((state) => state.appendStreamingChunk);
  const completeStreaming = useStore((state) => state.completeStreaming);
  const addToolCallMessage = useStore((state) => state.addToolCallMessage);
  const setChatError = useStore((state) => state.setChatError);
  const updateScheduleFromWS = useStore((state) => state.updateScheduleFromWS);
  const addToast = useStore((state) => state.addToast);

  useEffect(() => {
    // Message handler that dispatches to store
    const handleMessage = (message: ServerMessage): void => {
      switch (message.type) {
        case "fleet:status":
          setFleetStatus(message.payload);
          break;

        case "agent:updated":
          updateAgent(message.payload);
          break;

        case "job:created":
          addJob(message.payload);
          break;

        case "job:completed":
          completeJob(message.payload);
          addToast({
            message: `Job completed for ${message.payload.agentName}`,
            type: "success",
          });
          break;

        case "job:failed":
          failJob(message.payload);
          addToast({
            message: `Job failed for ${message.payload.agentName}`,
            type: "error",
            duration: 5000,
          });
          break;

        case "job:cancelled":
          cancelJob(message.payload);
          break;

        case "schedule:triggered":
          // Refetch schedules to update runCount, lastRunAt, status, etc.
          updateScheduleFromWS();
          addToast({
            message: `Schedule triggered for ${message.payload.agentName}`,
            type: "info",
          });
          break;

        case "job:output": {
          // Dispatch output to the output slice
          const { jobId, agentName, data, stream } = message.payload;
          appendOutput(jobId, agentName, data, stream);
          break;
        }

        case "pong":
          // Pong is a keepalive response, no action needed
          break;

        case "chat:response": {
          const { sessionId, chunk } = message.payload;
          if (sessionId === useStore.getState().activeChatSessionId) {
            appendStreamingChunk(chunk);
          }
          break;
        }

        case "chat:complete": {
          const { sessionId } = message.payload;
          if (sessionId === useStore.getState().activeChatSessionId) {
            completeStreaming();
          }
          break;
        }

        case "chat:tool_call": {
          const { sessionId } = message.payload;
          if (sessionId === useStore.getState().activeChatSessionId) {
            addToolCallMessage({
              toolName: message.payload.toolName,
              inputSummary: message.payload.inputSummary,
              output: message.payload.output,
              isError: message.payload.isError,
              durationMs: message.payload.durationMs,
            });
          }
          break;
        }

        case "chat:error": {
          const { sessionId } = message.payload;
          if (sessionId === useStore.getState().activeChatSessionId) {
            setChatError(message.payload.error);
          }
          break;
        }
      }
    };

    // Status change handler that also resyncs on reconnect
    const handleStatusChange = (newStatus: ConnectionStatus): void => {
      const prevStatus = prevStatusRef.current;
      prevStatusRef.current = newStatus;
      setConnectionStatus(newStatus);

      // Resync data when reconnecting after a disconnect (not initial connection)
      if (
        newStatus === "connected" &&
        (prevStatus === "disconnected" || prevStatus === "reconnecting") &&
        hasConnectedOnceRef.current
      ) {
        // Re-fetch fleet status and agents to resync after disconnect
        void (async () => {
          try {
            const [status, agents] = await Promise.all([fetchFleetStatus(), fetchAgents()]);
            setFleetStatus(status);
            setAgents(agents);
          } catch {
            // Ignore errors - WebSocket will continue to provide updates
          }
        })();
      }

      // Mark that we've connected at least once
      if (newStatus === "connected") {
        hasConnectedOnceRef.current = true;
      }
    };

    // Create WebSocket client
    clientRef.current = createWebSocketClient({
      onMessage: handleMessage,
      onStatusChange: handleStatusChange,
    });

    // Expose client globally for useJobOutput hook to access
    (window as unknown as { __herdWsClient?: WebSocketClient }).__herdWsClient = clientRef.current;

    // Cleanup on unmount
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
      // Clean up global reference
      delete (window as unknown as { __herdWsClient?: WebSocketClient }).__herdWsClient;
    };
  }, [
    addJob,
    addToast,
    addToolCallMessage,
    appendOutput,
    appendStreamingChunk,
    cancelJob,
    completeJob,
    completeStreaming,
    failJob,
    setAgents,
    setChatError,
    setConnectionStatus,
    setFleetStatus,
    updateAgent, // Refetch schedules to update runCount, lastRunAt, status, etc.
    updateScheduleFromWS,
  ]);

  return {
    connectionStatus,
    /** Subscribe to an agent's output events */
    subscribe: (agentName: string) => clientRef.current?.subscribe(agentName),
    /** Unsubscribe from an agent's output events */
    unsubscribe: (agentName: string) => clientRef.current?.unsubscribe(agentName),
    /** Manually trigger reconnect */
    reconnect: () => clientRef.current?.reconnect(),
  };
}
