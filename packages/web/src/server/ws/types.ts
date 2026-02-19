/**
 * WebSocket protocol types for @herdctl/web
 *
 * Defines the message types exchanged between the WebSocket server and clients.
 * The server broadcasts FleetManager events to connected clients, and clients
 * can subscribe to specific agents for high-volume output events.
 */

import type {
  FleetStatus,
  AgentStartedPayload,
  AgentStoppedPayload,
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
  JobCancelledPayload,
  ScheduleTriggeredPayload,
} from "@herdctl/core";

// =============================================================================
// Client Messages (sent from browser to server)
// =============================================================================

/**
 * Subscribe to an agent's output events
 *
 * The server will only forward `job:output` events for the specified agent
 * to this client. This is used for the live output streaming feature to avoid
 * overwhelming clients with output from agents they're not viewing.
 */
export interface SubscribeMessage {
  type: "subscribe";
  payload: {
    /** Name of the agent to subscribe to */
    agentName: string;
  };
}

/**
 * Unsubscribe from an agent's output events
 *
 * Stop receiving `job:output` events for the specified agent.
 */
export interface UnsubscribeMessage {
  type: "unsubscribe";
  payload: {
    /** Name of the agent to unsubscribe from */
    agentName: string;
  };
}

/**
 * Ping message for keepalive
 *
 * The client sends this periodically to keep the connection alive.
 * The server responds with a `pong` message.
 */
export interface PingMessage {
  type: "ping";
}

/**
 * Chat send message
 *
 * Client sends this to send a message to an agent in a chat session.
 * The response streams back via `chat:response` messages.
 */
export interface ChatSendMessage {
  type: "chat:send";
  payload: {
    /** Name of the agent to chat with */
    agentName: string;
    /** Session ID for the chat conversation */
    sessionId: string;
    /** User message content */
    message: string;
  };
}

/**
 * Union type of all messages that clients can send to the server
 */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage | ChatSendMessage;

// =============================================================================
// Server Messages (sent from server to browser)
// =============================================================================

/**
 * Full fleet status snapshot
 *
 * Sent to a client immediately upon connection, and can be requested
 * by the client at any time to resync state.
 */
export interface FleetStatusMessage {
  type: "fleet:status";
  payload: FleetStatus;
}

/**
 * Agent started or stopped event
 *
 * Broadcasts when an agent's lifecycle state changes.
 */
export interface AgentUpdatedMessage {
  type: "agent:updated";
  payload: AgentStartedPayload | AgentStoppedPayload;
}

/**
 * Job created event
 *
 * Broadcast to all clients when a new job is created.
 */
export interface JobCreatedMessage {
  type: "job:created";
  payload: JobCreatedPayload;
}

/**
 * Job output event
 *
 * Sent only to clients that have subscribed to the relevant agent.
 * This is the high-volume event used for live output streaming.
 */
export interface JobOutputMessage {
  type: "job:output";
  payload: JobOutputPayload;
}

/**
 * Job completed event
 *
 * Broadcast to all clients when a job completes successfully.
 */
export interface JobCompletedMessage {
  type: "job:completed";
  payload: JobCompletedPayload;
}

/**
 * Job failed event
 *
 * Broadcast to all clients when a job fails.
 */
export interface JobFailedMessage {
  type: "job:failed";
  payload: JobFailedPayload;
}

/**
 * Job cancelled event
 *
 * Broadcast to all clients when a job is cancelled.
 */
export interface JobCancelledMessage {
  type: "job:cancelled";
  payload: JobCancelledPayload;
}

/**
 * Schedule triggered event
 *
 * Broadcast to all clients when a schedule triggers an agent run.
 */
export interface ScheduleTriggeredMessage {
  type: "schedule:triggered";
  payload: ScheduleTriggeredPayload;
}

/**
 * Pong response to ping keepalive
 */
export interface PongMessage {
  type: "pong";
}

/**
 * Chat response chunk
 *
 * Server sends this as streaming response chunks during chat.
 */
export interface ChatResponseMessage {
  type: "chat:response";
  payload: {
    /** Name of the agent */
    agentName: string;
    /** Session ID for the chat conversation */
    sessionId: string;
    /** Job ID for tracking the execution */
    jobId: string;
    /** Response chunk content */
    chunk: string;
  };
}

/**
 * Chat complete message
 *
 * Server sends this when chat response is complete.
 */
export interface ChatCompleteMessage {
  type: "chat:complete";
  payload: {
    /** Name of the agent */
    agentName: string;
    /** Session ID for the chat conversation */
    sessionId: string;
    /** Job ID for tracking the execution */
    jobId: string;
  };
}

/**
 * Chat error message
 *
 * Server sends this when a chat error occurs.
 */
export interface ChatErrorMessage {
  type: "chat:error";
  payload: {
    /** Name of the agent */
    agentName: string;
    /** Session ID for the chat conversation */
    sessionId: string;
    /** Error message */
    error: string;
  };
}

/**
 * Union type of all messages that the server can send to clients
 */
export type ServerMessage =
  | FleetStatusMessage
  | AgentUpdatedMessage
  | JobCreatedMessage
  | JobOutputMessage
  | JobCompletedMessage
  | JobFailedMessage
  | JobCancelledMessage
  | ScheduleTriggeredMessage
  | PongMessage
  | ChatResponseMessage
  | ChatCompleteMessage
  | ChatErrorMessage;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is a valid ClientMessage
 */
export function isClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg.type !== "string") {
    return false;
  }

  switch (msg.type) {
    case "subscribe":
    case "unsubscribe":
      return (
        typeof msg.payload === "object" &&
        msg.payload !== null &&
        typeof (msg.payload as Record<string, unknown>).agentName === "string"
      );
    case "ping":
      return true;
    case "chat:send":
      return isChatSendMessage(msg);
    default:
      return false;
  }
}

/**
 * Check if a message is a valid ChatSendMessage
 */
export function isChatSendMessage(data: unknown): data is ChatSendMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (msg.type !== "chat:send") {
    return false;
  }

  const payload = msg.payload as Record<string, unknown> | null | undefined;
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  return (
    typeof payload.agentName === "string" &&
    typeof payload.sessionId === "string" &&
    typeof payload.message === "string"
  );
}

/**
 * Type guard to check if a payload is AgentStartedPayload
 */
export function isAgentStartedPayload(
  payload: AgentStartedPayload | AgentStoppedPayload
): payload is AgentStartedPayload {
  return "agent" in payload;
}

/**
 * Type guard to check if a payload is AgentStoppedPayload
 */
export function isAgentStoppedPayload(
  payload: AgentStartedPayload | AgentStoppedPayload
): payload is AgentStoppedPayload {
  return "agentName" in payload && !("agent" in payload);
}
