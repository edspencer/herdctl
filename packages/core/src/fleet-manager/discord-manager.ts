/**
 * Discord Manager Module
 *
 * Manages Discord connectors for agents that have `chat.discord` configured.
 * This module is responsible for:
 * - Creating one DiscordConnector instance per Discord-enabled agent
 * - Managing connector lifecycle (start/stop)
 * - Providing access to connectors for status queries
 *
 * Note: This module dynamically imports @herdctl/discord at runtime to avoid
 * a hard dependency. The @herdctl/core package can be used without Discord support.
 *
 * @module discord-manager
 */

import type { FleetManagerContext } from "./context.js";
import type { ResolvedAgent } from "../config/index.js";

// =============================================================================
// Local Type Definitions
// =============================================================================

/**
 * Discord connection status (mirrors @herdctl/discord types)
 */
export type DiscordConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

/**
 * Discord connector state (mirrors @herdctl/discord types)
 */
export interface DiscordConnectorState {
  status: DiscordConnectionStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  botUser: {
    id: string;
    username: string;
    discriminator: string;
  } | null;
  rateLimits: {
    totalCount: number;
    lastRateLimitAt: string | null;
    isRateLimited: boolean;
    currentResetTime: number;
  };
  messageStats: {
    received: number;
    sent: number;
    ignored: number;
  };
}

/**
 * Message event payload from DiscordConnector
 */
export interface DiscordMessageEvent {
  agentName: string;
  /** The processed prompt (with mention stripped) */
  prompt: string;
  /** Conversation context including recent message history */
  context: {
    messages: Array<{
      author: string;
      content: string;
      isBot: boolean;
      timestamp: string;
    }>;
    wasMentioned: boolean;
    prompt: string;
  };
  /** Discord-specific metadata */
  metadata: {
    /** ID of the guild (server), null for DMs */
    guildId: string | null;
    /** ID of the channel */
    channelId: string;
    /** ID of the message */
    messageId: string;
    /** ID of the user who sent the message */
    userId: string;
    /** Username of the user who sent the message */
    username: string;
    /** Whether this was triggered by a mention */
    wasMentioned: boolean;
    /** Channel mode that was applied */
    mode: "mention" | "auto";
  };
  /** Function to send a reply in the same channel */
  reply: (content: string) => Promise<void>;
  /** Start typing indicator, returns stop function */
  startTyping: () => () => void;
}

/**
 * Error event payload from DiscordConnector
 */
export interface DiscordErrorEvent {
  agentName: string;
  error: Error;
}

/**
 * Minimal interface for a Discord connector
 */
interface IDiscordConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): DiscordConnectorState;
  readonly agentName: string;
  readonly sessionManager: ISessionManager;
  // EventEmitter methods for event subscription
  on(event: "message", listener: (payload: DiscordMessageEvent) => void): this;
  on(event: "error", listener: (payload: DiscordErrorEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Logger interface for Discord operations
 */
interface DiscordLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Session manager interface (minimal for our needs)
 */
interface ISessionManager {
  readonly agentName: string;
  getOrCreateSession(channelId: string): Promise<{ sessionId: string; isNew: boolean }>;
  getSession(channelId: string): Promise<{ sessionId: string; lastMessageAt: string } | null>;
  setSession(channelId: string, sessionId: string): Promise<void>;
  touchSession(channelId: string): Promise<void>;
  clearSession(channelId: string): Promise<boolean>;
  cleanupExpiredSessions(): Promise<number>;
  getActiveSessionCount(): Promise<number>;
}

/**
 * Dynamically imported Discord module structure
 */
interface DiscordModule {
  DiscordConnector: new (options: {
    agentConfig: ResolvedAgent;
    discordConfig: NonNullable<ResolvedAgent["chat"]>["discord"];
    botToken: string;
    fleetManager: unknown;
    sessionManager: ISessionManager;
    stateDir?: string;
    logger?: DiscordLogger;
  }) => IDiscordConnector;
  SessionManager: new (options: {
    agentName: string;
    stateDir: string;
    sessionExpiryHours?: number;
    logger?: DiscordLogger;
  }) => ISessionManager;
}

/**
 * Lazy import the Discord package to avoid hard dependency
 * This allows @herdctl/core to be used without @herdctl/discord installed
 */
async function importDiscordPackage(): Promise<DiscordModule | null> {
  try {
    // Dynamic import - will be resolved at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = (await import("@herdctl/discord" as string)) as unknown as DiscordModule;
    return pkg;
  } catch {
    return null;
  }
}

/**
 * DiscordManager handles Discord connections for agents
 *
 * This class encapsulates the creation and lifecycle management of
 * DiscordConnector instances for agents that have Discord chat configured.
 */
export class DiscordManager {
  private connectors: Map<string, IDiscordConnector> = new Map();
  private initialized: boolean = false;

  constructor(private ctx: FleetManagerContext) {}

  /**
   * Initialize Discord connectors for all configured agents
   *
   * This method:
   * 1. Checks if @herdctl/discord package is available
   * 2. Iterates through agents to find those with Discord configured
   * 3. Creates a DiscordConnector for each Discord-enabled agent
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
      logger.debug("No config available, skipping Discord initialization");
      return;
    }

    // Try to import the discord package
    const discordPkg = await importDiscordPackage();
    if (!discordPkg) {
      logger.debug("@herdctl/discord not installed, skipping Discord connectors");
      return;
    }

    const { DiscordConnector, SessionManager } = discordPkg;
    const stateDir = this.ctx.getStateDir();

    // Find agents with Discord configured
    const discordAgents = config.agents.filter(
      (agent): agent is ResolvedAgent & { chat: { discord: NonNullable<ResolvedAgent["chat"]>["discord"] } } =>
        agent.chat?.discord !== undefined
    );

    if (discordAgents.length === 0) {
      logger.debug("No agents with Discord configured");
      this.initialized = true;
      return;
    }

    logger.info(`Initializing Discord connectors for ${discordAgents.length} agent(s)`);

    for (const agent of discordAgents) {
      try {
        const discordConfig = agent.chat.discord;
        if (!discordConfig) continue;

        // Get bot token from environment variable
        const botToken = process.env[discordConfig.bot_token_env];
        if (!botToken) {
          logger.warn(
            `Discord bot token not found in environment variable '${discordConfig.bot_token_env}' for agent '${agent.name}'`
          );
          continue;
        }

        // Create logger adapter for this agent
        const createAgentLogger = (prefix: string): DiscordLogger => ({
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
        const sessionManager = new SessionManager({
          agentName: agent.name,
          stateDir,
          sessionExpiryHours: discordConfig.session_expiry_hours,
          logger: createAgentLogger(`[discord:${agent.name}:session]`),
        });

        // Create the connector
        // Note: FleetManager is passed via ctx.getEmitter() which returns the FleetManager instance
        const connector = new DiscordConnector({
          agentConfig: agent,
          discordConfig,
          botToken,
          // The context's getEmitter() returns the FleetManager instance (which extends EventEmitter)
          fleetManager: this.ctx.getEmitter(),
          sessionManager,
          stateDir,
          logger: createAgentLogger(`[discord:${agent.name}]`),
        });

        this.connectors.set(agent.name, connector);
        logger.debug(`Created Discord connector for agent '${agent.name}'`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create Discord connector for agent '${agent.name}': ${errorMessage}`);
        // Continue with other agents - don't fail the whole initialization
      }
    }

    this.initialized = true;
    logger.info(`Discord manager initialized with ${this.connectors.size} connector(s)`);
  }

  /**
   * Connect all Discord connectors
   *
   * Connects each connector to the Discord gateway and subscribes to events.
   * Errors are logged but don't stop other connectors from connecting.
   */
  async start(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (this.connectors.size === 0) {
      logger.debug("No Discord connectors to start");
      return;
    }

    logger.info(`Starting ${this.connectors.size} Discord connector(s)...`);

    const connectPromises: Promise<void>[] = [];

    for (const [agentName, connector] of this.connectors) {
      // Subscribe to connector events before connecting
      connector.on("message", (event: DiscordMessageEvent) => {
        this.handleMessage(agentName, event).catch((error: unknown) => {
          this.handleError(agentName, error);
        });
      });

      connector.on("error", (event: DiscordErrorEvent) => {
        this.handleError(agentName, event.error);
      });

      connectPromises.push(
        connector.connect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to connect Discord for agent '${agentName}': ${errorMessage}`);
          // Don't re-throw - we want to continue connecting other agents
        })
      );
    }

    await Promise.all(connectPromises);

    const connectedCount = Array.from(this.connectors.values()).filter((c) =>
      c.isConnected()
    ).length;
    logger.info(`Discord connectors started: ${connectedCount}/${this.connectors.size} connected`);
  }

  /**
   * Disconnect all Discord connectors gracefully
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
      logger.debug("No Discord connectors to stop");
      return;
    }

    logger.info(`Stopping ${this.connectors.size} Discord connector(s)...`);

    // Log session state before shutdown (sessions are already persisted to disk)
    for (const [agentName, connector] of this.connectors) {
      try {
        const activeSessionCount = await connector.sessionManager.getActiveSessionCount();
        if (activeSessionCount > 0) {
          logger.info(`Preserving ${activeSessionCount} active session(s) for agent '${agentName}'`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get session count for agent '${agentName}': ${errorMessage}`);
        // Continue with shutdown - this is just informational logging
      }
    }

    const disconnectPromises: Promise<void>[] = [];

    for (const [agentName, connector] of this.connectors) {
      disconnectPromises.push(
        connector.disconnect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error disconnecting Discord for agent '${agentName}': ${errorMessage}`);
          // Don't re-throw - graceful shutdown should continue
        })
      );
    }

    await Promise.all(disconnectPromises);
    logger.info("All Discord connectors stopped");
  }

  /**
   * Get a connector for a specific agent
   *
   * @param agentName - Name of the agent
   * @returns The DiscordConnector instance, or undefined if not found
   */
  getConnector(agentName: string): IDiscordConnector | undefined {
    return this.connectors.get(agentName);
  }

  /**
   * Get all connector names
   *
   * @returns Array of agent names that have Discord connectors
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
   * Check if a specific agent has a Discord connector
   *
   * @param agentName - Name of the agent
   * @returns true if the agent has a Discord connector
   */
  hasConnector(agentName: string): boolean {
    return this.connectors.has(agentName);
  }

  // ===========================================================================
  // Message Handling Pipeline
  // ===========================================================================

  /**
   * Handle an incoming Discord message
   *
   * This method:
   * 1. Gets or creates a session for the channel
   * 2. Builds job context from the message
   * 3. Executes the job via trigger
   * 4. Sends the response back to Discord
   *
   * @param agentName - Name of the agent handling the message
   * @param event - The Discord message event
   */
  private async handleMessage(
    agentName: string,
    event: DiscordMessageEvent
  ): Promise<void> {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    logger.info(`Discord message for agent '${agentName}': ${event.prompt.substring(0, 50)}...`);

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
    let existingSessionId: string | undefined;
    if (connector) {
      try {
        const existingSession = await connector.sessionManager.getSession(event.metadata.channelId);
        if (existingSession) {
          existingSessionId = existingSession.sessionId;
          logger.debug(`Resuming session for channel ${event.metadata.channelId}: ${existingSessionId}`);
        } else {
          logger.debug(`No existing session for channel ${event.metadata.channelId}, starting new conversation`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get session: ${errorMessage}`);
        // Continue processing - session failure shouldn't block message handling
      }
    }

    // Collect all response chunks as the job executes
    const responseChunks: string[] = [];

    // Start typing indicator while processing
    const stopTyping = event.startTyping();

    try {
      // Import FleetManager dynamically to avoid circular dependency
      // The context's getEmitter() returns the FleetManager instance
      const fleetManager = emitter as unknown as {
        trigger: (
          agentName: string,
          scheduleName?: string,
          options?: {
            prompt?: string;
            resume?: string;
            onMessage?: (message: { type: string; content?: string; message?: { content?: unknown } }) => void | Promise<void>;
          }
        ) => Promise<{ jobId: string; success: boolean; sessionId?: string }>;
      };

      // Execute job via FleetManager.trigger()
      // Pass resume option for conversation continuity
      // The onMessage callback collects streaming output
      const result = await fleetManager.trigger(agentName, undefined, {
        prompt: event.prompt,
        resume: existingSessionId,
        onMessage: (message) => {
          // Extract text content from assistant messages
          if (message.type === "assistant") {
            const content = this.extractMessageContent(message);
            if (content) {
              responseChunks.push(content);
            }
          }
        },
      });

      logger.info(`Discord job completed: ${result.jobId} for agent '${agentName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`);

      // Combine all response chunks
      const fullResponse = responseChunks.join("");

      // Send response to Discord channel (handles splitting if needed)
      if (fullResponse) {
        await this.sendResponse(event.reply, fullResponse);
      } else {
        await event.reply("I've completed the task, but I don't have a specific response to share.");
      }

      // Store the SDK session ID for future conversation continuity
      // Only store if the job succeeded - failed jobs may return invalid session IDs
      if (connector && result.sessionId && result.success) {
        try {
          await connector.sessionManager.setSession(event.metadata.channelId, result.sessionId);
          logger.debug(`Stored session ${result.sessionId} for channel ${event.metadata.channelId}`);
        } catch (sessionError) {
          const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
          logger.warn(`Failed to store session: ${errorMessage}`);
          // Don't fail the message handling for session storage failure
        }
      } else if (connector && result.sessionId && !result.success) {
        logger.debug(`Not storing session ${result.sessionId} for channel ${event.metadata.channelId} - job failed`);
      }

      // Emit event for tracking
      emitter.emit("discord:message:handled", {
        agentName,
        channelId: event.metadata.channelId,
        messageId: event.metadata.messageId,
        jobId: result.jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Discord message handling failed for agent '${agentName}': ${err.message}`);

      // Send user-friendly error message using the formatted error method
      try {
        await event.reply(this.formatErrorMessage(err));
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }

      // Emit error event for tracking
      emitter.emit("discord:message:error", {
        agentName,
        channelId: event.metadata.channelId,
        messageId: event.metadata.messageId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      // Always stop typing indicator when done
      stopTyping();
    }
  }

  /**
   * Extract text content from an SDK message
   *
   * Handles various message formats from the Claude Agent SDK
   */
  private extractMessageContent(message: {
    type: string;
    content?: string;
    message?: { content?: unknown };
  }): string | undefined {
    // Check for direct content
    if (typeof message.content === "string" && message.content) {
      return message.content;
    }

    // Check for nested message content (SDK structure)
    const apiMessage = message.message as { content?: unknown } | undefined;
    const content = apiMessage?.content;

    if (!content) return undefined;

    // If it's a string, return directly
    if (typeof content === "string") {
      return content;
    }

    // If it's an array of content blocks, extract text
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const block of content) {
        if (block && typeof block === "object" && "type" in block) {
          if (block.type === "text" && "text" in block && typeof block.text === "string") {
            textParts.push(block.text);
          }
        }
      }
      return textParts.length > 0 ? textParts.join("") : undefined;
    }

    return undefined;
  }

  /**
   * Handle errors from Discord connectors
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
    logger.error(`Discord connector error for agent '${agentName}': ${errorMessage}`);

    // Emit error event for monitoring
    emitter.emit("discord:error", {
      agentName,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // ===========================================================================
  // Response Formatting and Splitting
  // ===========================================================================

  /** Discord's maximum message length */
  private static readonly MAX_MESSAGE_LENGTH = 2000;

  /**
   * Format an error message for Discord display
   *
   * Creates a user-friendly error message with guidance on how to proceed.
   *
   * @param error - The error that occurred
   * @returns Formatted error message string
   */
  formatErrorMessage(error: Error): string {
    return `❌ **Error**: ${error.message}\n\nPlease try again or use \`/reset\` to start a new session.`;
  }

  /**
   * Split a response into chunks that fit Discord's 2000 character limit
   *
   * This method intelligently splits text:
   * - Preserves code blocks when possible (closing and reopening across chunks)
   * - Splits at natural boundaries (newlines, then spaces)
   * - Never splits mid-word
   *
   * @param text - The text to split
   * @returns Array of text chunks, each under 2000 characters
   */
  splitResponse(text: string): string[] {
    const MAX_LENGTH = DiscordManager.MAX_MESSAGE_LENGTH;

    // If text fits in one message, return as-is
    if (text.length <= MAX_LENGTH) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Find the best split point
      const { chunk, rest } = this.findSplitPoint(remaining, MAX_LENGTH);
      chunks.push(chunk);
      remaining = rest;
    }

    return chunks;
  }

  /**
   * Find the best point to split text, preserving code blocks
   *
   * @param text - Text to split
   * @param maxLength - Maximum chunk length
   * @returns Object with the chunk and remaining text
   */
  private findSplitPoint(
    text: string,
    maxLength: number
  ): { chunk: string; rest: string } {
    // Check if we're inside a code block at the split point
    const codeBlockState = this.analyzeCodeBlocks(text.substring(0, maxLength));

    // If inside a code block, we need to close it and reopen in the next chunk
    if (codeBlockState.insideBlock) {
      // Find a good split point before maxLength
      const splitIndex = this.findNaturalBreak(text, maxLength);
      const chunkText = text.substring(0, splitIndex);

      // Re-analyze the actual chunk
      const actualState = this.analyzeCodeBlocks(chunkText);

      if (actualState.insideBlock) {
        // Close the code block in this chunk
        const closedChunk = chunkText + "\n```";
        // Reopen with the same language in the next chunk
        const continuation = "```" + (actualState.language || "") + "\n" + text.substring(splitIndex);
        return { chunk: closedChunk, rest: continuation };
      }

      return {
        chunk: chunkText,
        rest: text.substring(splitIndex),
      };
    }

    // Not inside a code block - find natural break point
    const splitIndex = this.findNaturalBreak(text, maxLength);
    return {
      chunk: text.substring(0, splitIndex),
      rest: text.substring(splitIndex),
    };
  }

  /**
   * Analyze text to determine if it ends inside a code block
   *
   * @param text - Text to analyze
   * @returns Object indicating if inside a block and the language if so
   */
  private analyzeCodeBlocks(text: string): {
    insideBlock: boolean;
    language: string | null;
  } {
    // Find all code block markers (```)
    const codeBlockRegex = /```(\w*)?/g;
    let match: RegExpExecArray | null;
    let insideBlock = false;
    let language: string | null = null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (insideBlock) {
        // This closes a block
        insideBlock = false;
        language = null;
      } else {
        // This opens a block
        insideBlock = true;
        language = match[1] || null;
      }
    }

    return { insideBlock, language };
  }

  /**
   * Find a natural break point in text (newline or space)
   *
   * Prefers breaking at:
   * 1. Double newlines (paragraph breaks)
   * 2. Single newlines
   * 3. Spaces
   *
   * @param text - Text to search
   * @param maxLength - Maximum position to search
   * @returns Index of the best split point
   */
  private findNaturalBreak(text: string, maxLength: number): number {
    // Don't search beyond the text length
    const searchEnd = Math.min(maxLength, text.length);

    // First, try to find a double newline (paragraph break)
    const doubleNewline = text.lastIndexOf("\n\n", searchEnd);
    if (doubleNewline > 0 && doubleNewline > searchEnd - 500) {
      // Found a paragraph break within the last 500 chars
      return doubleNewline + 2; // Include the newlines
    }

    // Try to find a single newline
    const singleNewline = text.lastIndexOf("\n", searchEnd);
    if (singleNewline > 0 && singleNewline > searchEnd - 200) {
      // Found a newline within the last 200 chars
      return singleNewline + 1; // Include the newline
    }

    // Try to find a space (avoid splitting mid-word)
    const space = text.lastIndexOf(" ", searchEnd);
    if (space > 0 && space > searchEnd - 100) {
      // Found a space within the last 100 chars
      return space + 1; // Include the space
    }

    // Last resort: hard cut at maxLength
    return searchEnd;
  }

  /**
   * Send a response to Discord, splitting if necessary
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
}
