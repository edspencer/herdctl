/**
 * WebSocket connection handler for @herdctl/web
 *
 * Manages connected WebSocket clients, handles incoming messages,
 * and provides broadcast functions for the fleet bridge.
 */

import { createLogger, type FleetManager } from "@herdctl/core";
import type { RawData, WebSocket } from "ws";
import type { WebChatManager } from "../chat/index.js";
import {
  type ChatSendMessage,
  type ClientMessage,
  isClientMessage,
  type ServerMessage,
} from "./types.js";

const logger = createLogger("web:ws");

/**
 * Represents a connected WebSocket client with its subscriptions
 */
export interface WebSocketClient {
  /** The WebSocket connection */
  socket: WebSocket;
  /** Set of agent qualified names this client is subscribed to for output events */
  subscriptions: Set<string>;
  /** Unique client ID for logging */
  clientId: string;
}

/**
 * WebSocket handler manages all connected clients and message routing
 */
export class WebSocketHandler {
  /** All connected clients */
  private clients: Set<WebSocketClient> = new Set();
  /** Counter for generating unique client IDs */
  private clientIdCounter = 0;
  /** FleetManager for getting initial status */
  private fleetManager: FleetManager;
  /** WebChatManager for handling chat messages */
  private chatManager: WebChatManager | null = null;

  constructor(fleetManager: FleetManager) {
    this.fleetManager = fleetManager;
  }

  /**
   * Set the chat manager for handling chat messages
   *
   * @param chatManager - WebChatManager instance
   */
  setChatManager(chatManager: WebChatManager): void {
    this.chatManager = chatManager;
  }

  /**
   * Handle a new WebSocket connection
   *
   * @param socket - The WebSocket connection
   */
  async handleConnection(socket: WebSocket): Promise<void> {
    const clientId = `client-${++this.clientIdCounter}`;
    const client: WebSocketClient = {
      socket,
      subscriptions: new Set(),
      clientId,
    };

    this.clients.add(client);
    logger.info(`WebSocket client connected: ${clientId} (total: ${this.clients.size})`);

    // Send initial fleet status snapshot
    try {
      const status = await this.fleetManager.getFleetStatus();
      this.sendToClient(client, { type: "fleet:status", payload: status });
    } catch (error) {
      logger.warn(
        `Failed to send initial fleet status to ${clientId}: ${(error as Error).message}`,
      );
    }

    // Handle incoming messages
    socket.on("message", (data: RawData) => {
      this.handleMessage(client, data);
    });

    // Handle disconnect
    socket.on("close", () => {
      this.handleDisconnect(client);
    });

    // Handle errors
    socket.on("error", (error: Error) => {
      logger.warn(`WebSocket error for ${clientId}: ${error.message}`);
    });
  }

  /**
   * Handle an incoming message from a client
   */
  private handleMessage(client: WebSocketClient, data: RawData): void {
    try {
      // Parse the message
      let message: unknown;
      if (typeof data === "string") {
        message = JSON.parse(data);
      } else if (Buffer.isBuffer(data)) {
        message = JSON.parse(data.toString("utf-8"));
      } else {
        logger.debug(`Received non-string/buffer message from ${client.clientId}`);
        return;
      }

      // Validate the message
      if (!isClientMessage(message)) {
        logger.debug(`Invalid message from ${client.clientId}: ${JSON.stringify(message)}`);
        return;
      }

      // Handle based on message type
      this.processClientMessage(client, message);
    } catch (error) {
      logger.debug(`Failed to parse message from ${client.clientId}: ${(error as Error).message}`);
    }
  }

  /**
   * Process a validated client message
   */
  private processClientMessage(client: WebSocketClient, message: ClientMessage): void {
    switch (message.type) {
      case "subscribe": {
        const { agentName } = message.payload;
        client.subscriptions.add(agentName);
        logger.debug(`${client.clientId} subscribed to agent: ${agentName}`);
        break;
      }

      case "unsubscribe": {
        const { agentName } = message.payload;
        client.subscriptions.delete(agentName);
        logger.debug(`${client.clientId} unsubscribed from agent: ${agentName}`);
        break;
      }

      case "ping": {
        this.sendToClient(client, { type: "pong" });
        break;
      }

      case "chat:send": {
        this.handleChatSend(client, message).catch((error) => {
          logger.error(`Error handling chat:send: ${(error as Error).message}`);
        });
        break;
      }
    }
  }

  /**
   * Handle a chat:send message from a client
   */
  private async handleChatSend(client: WebSocketClient, message: ChatSendMessage): Promise<void> {
    const { agentName, sessionId, message: userMessage } = message.payload;

    if (!this.chatManager) {
      this.sendToClient(client, {
        type: "chat:error",
        payload: {
          agentName,
          sessionId,
          error: "Chat manager not available",
        },
      });
      return;
    }

    logger.debug(`${client.clientId} sending chat message`, { agentName, sessionId });

    let jobId = "";

    try {
      const result = await this.chatManager.sendMessage(
        agentName,
        sessionId,
        userMessage,
        async (chunk) => {
          // Stream chunks back to the client
          this.sendToClient(client, {
            type: "chat:response",
            payload: {
              agentName,
              sessionId,
              jobId,
              chunk,
            },
          });
        },
        async (toolCall) => {
          // Stream tool call results back to the client
          this.sendToClient(client, {
            type: "chat:tool_call",
            payload: {
              agentName,
              sessionId,
              jobId,
              toolName: toolCall.toolName,
              inputSummary: toolCall.inputSummary,
              output: toolCall.output,
              isError: toolCall.isError,
              durationMs: toolCall.durationMs,
            },
          });
        },
        async () => {
          // Signal a message boundary between distinct assistant turns
          this.sendToClient(client, {
            type: "chat:message_boundary",
            payload: {
              agentName,
              sessionId,
              jobId,
            },
          });
        },
      );

      jobId = result.jobId;

      if (result.success) {
        // Send completion message
        this.sendToClient(client, {
          type: "chat:complete",
          payload: {
            agentName,
            sessionId,
            jobId: result.jobId,
          },
        });
      } else {
        // Send error message
        this.sendToClient(client, {
          type: "chat:error",
          payload: {
            agentName,
            sessionId,
            error: result.error ?? "Unknown error",
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Chat send failed`, { agentName, sessionId, error: errorMessage });

      this.sendToClient(client, {
        type: "chat:error",
        payload: {
          agentName,
          sessionId,
          error: errorMessage,
        },
      });
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(client: WebSocketClient): void {
    this.clients.delete(client);
    logger.info(
      `WebSocket client disconnected: ${client.clientId} (remaining: ${this.clients.size})`,
    );
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(client: WebSocketClient, message: ServerMessage): void {
    if (client.socket.readyState === client.socket.OPEN) {
      try {
        client.socket.send(JSON.stringify(message));
      } catch (error) {
        logger.warn(`Failed to send message to ${client.clientId}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Broadcast a message to ALL connected clients
   *
   * Use this for low-volume events like job:created, job:completed, etc.
   */
  broadcast(message: ServerMessage): void {
    for (const client of this.clients) {
      this.sendToClient(client, message);
    }
  }

  /**
   * Broadcast a message only to clients subscribed to a specific agent
   *
   * Use this for high-volume events like job:output to avoid overwhelming
   * clients that aren't viewing that agent.
   */
  broadcastToSubscribers(agentName: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.subscriptions.has(agentName)) {
        this.sendToClient(client, message);
      }
    }
  }

  /**
   * Get the number of connected clients
   */
  getConnectedCount(): number {
    return this.clients.size;
  }

  /**
   * Get the number of clients subscribed to a specific agent
   */
  getSubscriberCount(agentName: string): number {
    let count = 0;
    for (const client of this.clients) {
      if (client.subscriptions.has(agentName)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Close all connections (for shutdown)
   */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.socket.close(1000, "Server shutting down");
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.clients.clear();
  }
}
