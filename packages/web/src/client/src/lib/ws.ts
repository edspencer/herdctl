/**
 * WebSocket client for @herdctl/web
 *
 * Provides auto-reconnecting WebSocket connection with typed messages.
 * Dispatches incoming server messages to callback handlers.
 */

import type { ClientMessage, ConnectionStatus, ServerMessage } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Callback invoked when a server message is received
 */
export type MessageHandler = (message: ServerMessage) => void;

/**
 * Callback invoked when connection status changes
 */
export type ConnectionStatusHandler = (status: ConnectionStatus) => void;

/**
 * Options for creating a WebSocket client
 */
export interface WebSocketClientOptions {
  /** WebSocket URL. Defaults to ws://[current host]/ws */
  url?: string;
  /** Handler for incoming messages */
  onMessage?: MessageHandler;
  /** Handler for connection status changes */
  onStatusChange?: ConnectionStatusHandler;
  /** Initial reconnect delay in ms. Default: 1000 */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms. Default: 30000 */
  maxReconnectDelay?: number;
  /** Ping interval in ms. Default: 30000 */
  pingInterval?: number;
}

/**
 * WebSocket client control interface
 */
export interface WebSocketClient {
  /** Send a message to the server */
  send: (message: ClientMessage) => void;
  /** Subscribe to an agent's output events */
  subscribe: (agentName: string) => void;
  /** Unsubscribe from an agent's output events */
  unsubscribe: (agentName: string) => void;
  /** Get current connection status */
  getStatus: () => ConnectionStatus;
  /** Disconnect and clean up */
  disconnect: () => void;
  /** Manually trigger reconnect */
  reconnect: () => void;
}

// =============================================================================
// WebSocket Client Factory
// =============================================================================

/**
 * Create a WebSocket client with auto-reconnect and keepalive
 *
 * @example
 * ```ts
 * const ws = createWebSocketClient({
 *   onMessage: (msg) => console.log("Received:", msg),
 *   onStatusChange: (status) => console.log("Status:", status),
 * });
 *
 * // Subscribe to agent output
 * ws.subscribe("my-agent");
 *
 * // Clean up on unmount
 * ws.disconnect();
 * ```
 */
export function createWebSocketClient(options: WebSocketClientOptions = {}): WebSocketClient {
  const {
    url = getDefaultWebSocketUrl(),
    onMessage,
    onStatusChange,
    initialReconnectDelay = 1000,
    maxReconnectDelay = 30000,
    pingInterval = 30000,
  } = options;

  let socket: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";
  let reconnectAttempts = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let pingIntervalId: ReturnType<typeof setInterval> | null = null;
  let shouldReconnect = true;

  /**
   * Update connection status and notify handler
   */
  function setStatus(newStatus: ConnectionStatus): void {
    if (status !== newStatus) {
      status = newStatus;
      onStatusChange?.(status);
    }
  }

  /**
   * Calculate reconnect delay with exponential backoff
   */
  function getReconnectDelay(): number {
    const delay = initialReconnectDelay * 2 ** reconnectAttempts;
    return Math.min(delay, maxReconnectDelay);
  }

  /**
   * Start ping keepalive interval
   */
  function startPingInterval(): void {
    stopPingInterval();
    pingIntervalId = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        send({ type: "ping" });
      }
    }, pingInterval);
  }

  /**
   * Stop ping keepalive interval
   */
  function stopPingInterval(): void {
    if (pingIntervalId !== null) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }
  }

  /**
   * Schedule a reconnect attempt
   */
  function scheduleReconnect(): void {
    if (!shouldReconnect) return;

    const delay = getReconnectDelay();
    reconnectAttempts++;

    setStatus("reconnecting");

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, delay);
  }

  /**
   * Cancel any pending reconnect
   */
  function cancelReconnect(): void {
    if (reconnectTimeout !== null) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  /**
   * Connect to WebSocket server
   */
  function connect(): void {
    // Clean up existing socket
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }

    try {
      socket = new WebSocket(url);

      socket.onopen = (): void => {
        // Reset reconnect attempts on successful connection
        reconnectAttempts = 0;
        setStatus("connected");
        startPingInterval();
      };

      socket.onclose = (): void => {
        stopPingInterval();
        setStatus("disconnected");

        if (shouldReconnect) {
          scheduleReconnect();
        }
      };

      socket.onerror = (): void => {
        // Error event is always followed by close, so we just log here
        // The reconnect logic will be handled in onclose
      };

      socket.onmessage = (event: MessageEvent): void => {
        try {
          const message = JSON.parse(event.data as string) as ServerMessage;
          onMessage?.(message);
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      // Handle connection errors (e.g., invalid URL)
      setStatus("disconnected");
      if (shouldReconnect) {
        scheduleReconnect();
      }
    }
  }

  /**
   * Send a message to the server
   */
  function send(message: ClientMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Subscribe to an agent's output events
   */
  function subscribe(agentName: string): void {
    send({ type: "subscribe", payload: { agentName } });
  }

  /**
   * Unsubscribe from an agent's output events
   */
  function unsubscribe(agentName: string): void {
    send({ type: "unsubscribe", payload: { agentName } });
  }

  /**
   * Get current connection status
   */
  function getStatus(): ConnectionStatus {
    return status;
  }

  /**
   * Disconnect and clean up
   */
  function disconnect(): void {
    shouldReconnect = false;
    cancelReconnect();
    stopPingInterval();

    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      socket = null;
    }

    setStatus("disconnected");
  }

  /**
   * Manually trigger reconnect
   */
  function reconnect(): void {
    shouldReconnect = true;
    cancelReconnect();
    reconnectAttempts = 0;
    connect();
  }

  // Start connection immediately
  connect();

  return {
    send,
    subscribe,
    unsubscribe,
    getStatus,
    disconnect,
    reconnect,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get the default WebSocket URL based on current location
 */
function getDefaultWebSocketUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost:3000/ws";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
