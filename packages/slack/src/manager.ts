/**
 * Slack Manager Module
 *
 * Manages Slack connectors for agents that have `chat.slack` configured.
 * This module is responsible for:
 * - Creating one SlackConnector instance per Slack-enabled agent
 * - Managing connector lifecycle (start/stop)
 * - Providing access to connectors for status queries
 *
 * @module manager
 */

import type {
  FleetManagerContext,
  IChatManager,
  ChatManagerConnectorState,
  TriggerOptions,
  TriggerResult,
  ResolvedAgent,
  InjectedMcpServerDef,
} from "@herdctl/core";
import {
  createFileSenderDef,
  type FileSenderContext,
} from "@herdctl/core";
import {
  StreamingResponder,
  extractMessageContent,
  splitMessage,
  ChatSessionManager,
  type ChatConnectorLogger,
} from "@herdctl/chat";

import { SlackConnector } from "./slack-connector.js";
import { markdownToMrkdwn } from "./formatting.js";
import type {
  SlackConnectorState,
  SlackMessageEvent,
  SlackConnectorEventMap,
} from "./types.js";

// =============================================================================
// Slack Manager
// =============================================================================

/**
 * Message event payload from SlackConnector
 */
type SlackMessageEventType = SlackConnectorEventMap["message"];

/**
 * Error event payload from SlackConnector
 */
type SlackErrorEvent = SlackConnectorEventMap["error"];

/**
 * SlackManager handles Slack connections for agents
 *
 * This class encapsulates the creation and lifecycle management of
 * SlackConnector instances for agents that have Slack chat configured.
 *
 * Implements IChatManager so FleetManager can interact with it through
 * the generic chat manager interface.
 */
export class SlackManager implements IChatManager {
  private connectors: Map<string, SlackConnector> = new Map();
  private initialized: boolean = false;

  constructor(private ctx: FleetManagerContext) {}

  /**
   * Initialize Slack connectors for all configured agents
   *
   * This method:
   * 1. Iterates through agents to find those with Slack configured
   * 2. Creates a SlackConnector for each Slack-enabled agent
   *
   * Should be called during FleetManager initialization.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const logger = this.ctx.getLogger();
    const config = this.ctx.getConfig();

    if (!config) {
      logger.debug("No config available, skipping Slack initialization");
      return;
    }

    const stateDir = this.ctx.getStateDir();

    // Find agents with Slack configured
    const slackAgents = config.agents.filter(
      (agent): agent is ResolvedAgent & { chat: { slack: NonNullable<ResolvedAgent["chat"]>["slack"] } } =>
        agent.chat?.slack !== undefined
    );

    if (slackAgents.length === 0) {
      logger.debug("No agents with Slack configured");
      this.initialized = true;
      return;
    }

    logger.debug(`Initializing Slack connectors for ${slackAgents.length} agent(s)`);

    for (const agent of slackAgents) {
      try {
        const slackConfig = agent.chat.slack;
        if (!slackConfig) continue;

        // Get bot token from environment variable
        const botToken = process.env[slackConfig.bot_token_env];
        if (!botToken) {
          logger.warn(
            `Slack bot token not found in environment variable '${slackConfig.bot_token_env}' for agent '${agent.name}'`
          );
          continue;
        }

        // Get app token from environment variable
        const appToken = process.env[slackConfig.app_token_env];
        if (!appToken) {
          logger.warn(
            `Slack app token not found in environment variable '${slackConfig.app_token_env}' for agent '${agent.name}'`
          );
          continue;
        }

        // Create logger adapter for this agent
        const createAgentLogger = (prefix: string): ChatConnectorLogger => ({
          debug: (msg: string, data?: Record<string, unknown>) =>
            logger.debug(`${prefix} ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          info: (msg: string, data?: Record<string, unknown>) =>
            logger.info(`${prefix} ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          warn: (msg: string, data?: Record<string, unknown>) =>
            logger.warn(`${prefix} ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          error: (msg: string, data?: Record<string, unknown>) =>
            logger.error(`${prefix} ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
        });

        // Create session manager for this agent
        const sessionManager = new ChatSessionManager({
          platform: "slack",
          agentName: agent.name,
          stateDir,
          sessionExpiryHours: slackConfig.session_expiry_hours,
          logger: createAgentLogger(`[slack:${agent.name}:session]`),
        });

        // Create the connector
        const connector = new SlackConnector({
          agentName: agent.name,
          botToken,
          appToken,
          channels: slackConfig.channels.map((ch) => ({ id: ch.id, mode: ch.mode })),
          dm: slackConfig.dm,
          sessionManager,
          logger: createAgentLogger(`[slack:${agent.name}]`),
        });

        this.connectors.set(agent.name, connector);
        logger.debug(`Created Slack connector for agent '${agent.name}'`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create Slack connector for agent '${agent.name}': ${errorMessage}`);
        // Continue with other agents - don't fail the whole initialization
      }
    }

    this.initialized = true;
    logger.debug(`Slack manager initialized with ${this.connectors.size} connector(s)`);
  }

  /**
   * Connect all Slack connectors
   *
   * Connects each connector to Slack via Socket Mode and subscribes to events.
   * Errors are logged but don't stop other connectors from connecting.
   */
  async start(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (this.connectors.size === 0) {
      logger.debug("No Slack connectors to start");
      return;
    }

    logger.debug(`Starting ${this.connectors.size} Slack connector(s)...`);

    const connectPromises: Promise<void>[] = [];

    for (const [agentName, connector] of this.connectors) {
      // Subscribe to connector events before connecting
      connector.on("message", (event: SlackMessageEventType) => {
        this.handleMessage(agentName, event).catch((error: unknown) => {
          this.handleError(agentName, error);
        });
      });

      connector.on("error", (event: SlackErrorEvent) => {
        this.handleError(event.agentName, event.error);
      });

      connectPromises.push(
        connector.connect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to connect Slack for agent '${agentName}': ${errorMessage}`);
          // Don't re-throw - we want to continue connecting other agents
        })
      );
    }

    await Promise.all(connectPromises);

    const connectedCount = Array.from(this.connectors.values()).filter((c) =>
      c.isConnected()
    ).length;
    logger.info(`Slack connectors started: ${connectedCount}/${this.connectors.size} connected`);
  }

  /**
   * Disconnect all Slack connectors gracefully
   *
   * Sessions are automatically persisted to disk on every update,
   * so they survive bot restarts. This method logs session state
   * before disconnecting for monitoring purposes.
   *
   * Errors are logged but don't prevent other connectors from disconnecting.
   */
  async stop(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (this.connectors.size === 0) {
      logger.debug("No Slack connectors to stop");
      return;
    }

    logger.debug(`Stopping ${this.connectors.size} Slack connector(s)...`);

    // Log session state before shutdown (sessions are already persisted to disk)
    for (const [agentName, connector] of this.connectors) {
      try {
        const activeSessionCount = await connector.sessionManager.getActiveSessionCount();
        if (activeSessionCount > 0) {
          logger.debug(`Preserving ${activeSessionCount} active Slack session(s) for agent '${agentName}'`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get Slack session count for agent '${agentName}': ${errorMessage}`);
        // Continue with shutdown - this is just informational logging
      }
    }

    const disconnectPromises: Promise<void>[] = [];

    for (const [agentName, connector] of this.connectors) {
      disconnectPromises.push(
        connector.disconnect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error disconnecting Slack for agent '${agentName}': ${errorMessage}`);
          // Don't re-throw - graceful shutdown should continue
        })
      );
    }

    await Promise.all(disconnectPromises);
    logger.debug("All Slack connectors stopped");
  }

  /**
   * Get a connector for a specific agent
   *
   * @param agentName - Name of the agent
   * @returns The SlackConnector instance, or undefined if not found
   */
  getConnector(agentName: string): SlackConnector | undefined {
    return this.connectors.get(agentName);
  }

  /**
   * Get all connector names
   *
   * @returns Array of agent names that have Slack connectors
   */
  getConnectorNames(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Get the number of active connectors
   *
   * @returns Number of connectors that are currently connected
   */
  getConnectedCount(): number {
    return Array.from(this.connectors.values()).filter((c) =>
      c.isConnected()
    ).length;
  }

  /**
   * Check if the manager has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if a specific agent has a Slack connector
   *
   * @param agentName - Name of the agent
   * @returns true if the agent has a Slack connector
   */
  hasConnector(agentName: string): boolean {
    return this.connectors.has(agentName);
  }

  /**
   * Check if a specific agent has a connector (alias for hasConnector)
   *
   * @param agentName - Name of the agent
   * @returns true if the agent has a connector
   */
  hasAgent(agentName: string): boolean {
    return this.connectors.has(agentName);
  }

  /**
   * Get the state of a connector for a specific agent
   *
   * @param agentName - Name of the agent
   * @returns The connector state, or undefined if not found
   */
  getState(agentName: string): ChatManagerConnectorState | undefined {
    const connector = this.connectors.get(agentName);
    if (!connector) return undefined;

    const state = connector.getState();
    return {
      status: state.status,
      connectedAt: state.connectedAt,
      disconnectedAt: state.disconnectedAt,
      reconnectAttempts: state.reconnectAttempts,
      lastError: state.lastError,
      botUser: state.botUser ? { id: state.botUser.id, username: state.botUser.username } : null,
      messageStats: state.messageStats,
    };
  }

  // ===========================================================================
  // Message Handling Pipeline
  // ===========================================================================

  /**
   * Handle an incoming Slack message
   *
   * This method:
   * 1. Gets or creates a session for the channel
   * 2. Builds job context from the message
   * 3. Executes the job via trigger
   * 4. Sends the response back to Slack
   *
   * @param agentName - Name of the agent handling the message
   * @param event - The Slack message event
   */
  private async handleMessage(
    agentName: string,
    event: SlackMessageEvent
  ): Promise<void> {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    logger.info(`Slack message for agent '${agentName}': ${event.prompt.substring(0, 50)}...`);

    // Get the agent configuration
    const config = this.ctx.getConfig();
    const agent = config?.agents.find((a) => a.name === agentName);

    if (!agent) {
      logger.error(`Agent '${agentName}' not found in configuration`);
      try {
        await event.reply("Sorry, I'm not properly configured. Please contact an administrator.");
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }
      return;
    }

    // Get existing session for this channel (for conversation continuity)
    const connector = this.connectors.get(agentName);
    let existingSessionId: string | null = null;
    if (connector) {
      try {
        const existingSession = await connector.sessionManager.getSession(event.metadata.channelId);
        if (existingSession) {
          existingSessionId = existingSession.sessionId;
          logger.debug(`Resuming session for channel ${event.metadata.channelId}: ${existingSessionId}`);
          emitter.emit("slack:session:lifecycle", {
            agentName,
            event: "resumed",
            channelId: event.metadata.channelId,
            sessionId: existingSessionId,
          });
        } else {
          logger.debug(`No existing session for channel ${event.metadata.channelId}, starting new conversation`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get session: ${errorMessage}`);
        // Continue processing - session failure shouldn't block message handling
      }
    }

    // Create file sender definition for this message context
    let injectedMcpServers: Record<string, InjectedMcpServerDef> | undefined;
    const workingDir = this.resolveWorkingDirectory(agent);
    if (connector && workingDir) {
      const agentConnector = connector;
      const fileSenderContext: FileSenderContext = {
        workingDirectory: workingDir,
        uploadFile: async (params) => {
          return agentConnector.uploadFile({
            channelId: event.metadata.channelId,
            fileBuffer: params.fileBuffer,
            filename: params.filename,
            message: params.message,
          });
        },
      };
      const fileSenderDef = createFileSenderDef(fileSenderContext);
      injectedMcpServers = { [fileSenderDef.name]: fileSenderDef };
    }

    // Create streaming responder for incremental message delivery
    const streamer = new StreamingResponder({
      reply: (content: string) => event.reply(markdownToMrkdwn(content)),
      logger: logger as ChatConnectorLogger,
      agentName,
      maxMessageLength: 4000, // Slack's limit
      maxBufferSize: 3500,
      platformName: "Slack",
    });

    // Start processing indicator (hourglass emoji)
    const stopProcessing = event.startProcessingIndicator();
    let processingStopped = false;

    try {
      // Execute job via FleetManager.trigger() through the context
      // Pass resume option for conversation continuity
      // The onMessage callback streams output incrementally to Slack
      const result = await this.ctx.trigger(agentName, undefined, {
        prompt: event.prompt,
        resume: existingSessionId,
        injectedMcpServers,
        onMessage: async (message) => {
          // Extract text content from assistant messages and stream to Slack
          if (message.type === "assistant") {
            // Cast to the SDKMessage shape expected by extractMessageContent
            const sdkMessage = message as unknown as Parameters<typeof extractMessageContent>[0];
            const content = extractMessageContent(sdkMessage);
            if (content) {
              // Each assistant message is a complete turn - send immediately
              await streamer.addMessageAndSend(content);
            }
          }
        },
      } as TriggerOptions);

      // Stop processing indicator immediately after SDK execution completes
      if (!processingStopped) {
        stopProcessing();
        processingStopped = true;
      }

      // Flush any remaining buffered content
      await streamer.flush();

      logger.info(`Slack job completed: ${result.jobId} for agent '${agentName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`);

      // If no messages were sent, send an appropriate fallback
      if (!streamer.hasSentMessages()) {
        if (result.success) {
          await event.reply("I've completed the task, but I don't have a specific response to share.");
        } else {
          // Job failed without streaming any messages - send error details
          const errorMessage = result.errorDetails?.message ?? result.error?.message ?? "An unknown error occurred";
          await event.reply(`*Error:* ${errorMessage}\n\nThe task could not be completed. Please check the logs for more details.`);
        }

        // Stop processing after sending fallback message (if not already stopped)
        if (!processingStopped) {
          stopProcessing();
          processingStopped = true;
        }
      }

      // Store the SDK session ID for future conversation continuity
      // Only store if the job succeeded - failed jobs may return invalid session IDs
      if (connector && result.sessionId && result.success) {
        const isNewSession = existingSessionId === null;
        try {
          await connector.sessionManager.setSession(event.metadata.channelId, result.sessionId);
          logger.debug(`Stored session ${result.sessionId} for channel ${event.metadata.channelId}`);

          if (isNewSession) {
            emitter.emit("slack:session:lifecycle", {
              agentName,
              event: "created",
              channelId: event.metadata.channelId,
              sessionId: result.sessionId,
            });
          }
        } catch (sessionError) {
          const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
          logger.warn(`Failed to store session: ${errorMessage}`);
          // Don't fail the message handling for session storage failure
        }
      } else if (connector && result.sessionId && !result.success) {
        logger.debug(`Not storing session ${result.sessionId} for channel ${event.metadata.channelId} - job failed`);
      }

      // Emit event for tracking
      emitter.emit("slack:message:handled", {
        agentName,
        channelId: event.metadata.channelId,
        messageTs: event.metadata.messageTs,
        jobId: result.jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Slack message handling failed for agent '${agentName}': ${err.message}`);

      // Send user-friendly error message
      try {
        await event.reply(this.formatErrorMessage(err));
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }

      // Emit error event for tracking
      emitter.emit("slack:message:error", {
        agentName,
        channelId: event.metadata.channelId,
        messageTs: event.metadata.messageTs,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      // Safety net: stop processing indicator if not already stopped
      if (!processingStopped) {
        stopProcessing();
      }
    }
  }

  /**
   * Handle errors from Slack connectors
   *
   * Logs errors without crashing the connector
   *
   * @param agentName - Name of the agent that encountered the error
   * @param error - The error that occurred
   */
  private handleError(agentName: string, error: unknown): void {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Slack connector error for agent '${agentName}': ${errorMessage}`);

    // Emit error event for monitoring
    emitter.emit("slack:error", {
      agentName,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // ===========================================================================
  // Response Formatting and Splitting
  // ===========================================================================

  /** Slack's maximum message length */
  private static readonly MAX_MESSAGE_LENGTH = 4000;

  /**
   * Format an error message for Slack display
   *
   * Creates a user-friendly error message with guidance on how to proceed.
   *
   * @param error - The error that occurred
   * @returns Formatted error message string
   */
  formatErrorMessage(error: Error): string {
    return `*Error:* ${error.message}\n\nPlease try again or use \`!reset\` to start a new session.`;
  }

  /**
   * Split a response into chunks that fit Slack's 4000 character limit
   *
   * Uses the shared splitMessage utility from @herdctl/chat.
   *
   * @param text - The text to split
   * @returns Array of text chunks, each under 4000 characters
   */
  splitResponse(text: string): string[] {
    const result = splitMessage(text, { maxLength: SlackManager.MAX_MESSAGE_LENGTH });
    return result.chunks;
  }

  /**
   * Send a response to Slack, splitting if necessary
   *
   * @param reply - The reply function from the message event
   * @param content - The content to send
   */
  async sendResponse(
    reply: (content: string) => Promise<void>,
    content: string
  ): Promise<void> {
    const chunks = this.splitResponse(content);

    for (const chunk of chunks) {
      await reply(chunk);
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Resolve the agent's working directory to an absolute path string
   *
   * @param agent - The resolved agent configuration
   * @returns Absolute path to working directory, or undefined if not configured
   */
  private resolveWorkingDirectory(agent: ResolvedAgent): string | undefined {
    if (!agent.working_directory) {
      return undefined;
    }

    if (typeof agent.working_directory === "string") {
      return agent.working_directory;
    }

    return agent.working_directory.root;
  }
}
