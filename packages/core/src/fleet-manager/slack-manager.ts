/**
 * Slack Manager Module
 *
 * Manages a single Slack connector shared across agents that have `chat.slack` configured.
 * This module is responsible for:
 * - Creating ONE SlackConnector instance for the workspace
 * - Building channel→agent routing from agent configs
 * - Managing connector lifecycle (start/stop)
 *
 * Key difference from Discord:
 * - DiscordManager has Map<string, IDiscordConnector> (N connectors, one per agent)
 * - SlackManager has one connector + Map<string, string> (channel→agent routing)
 *
 * Note: This module dynamically imports @herdctl/slack at runtime to avoid
 * a hard dependency. The @herdctl/core package can be used without Slack support.
 *
 * @module slack-manager
 */

import type { FleetManagerContext } from "./context.js";
import type { ResolvedAgent } from "../config/index.js";
import { createFileSenderDef, type FileSenderContext } from "../runner/file-sender-mcp.js";
import type { InjectedMcpServerDef } from "../runner/types.js";
import { resolveWorkingDirectory } from "./working-directory-helper.js";

// =============================================================================
// Local Type Definitions
// =============================================================================

/**
 * Slack connection status (mirrors @herdctl/slack types)
 */
export type SlackConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

/**
 * Slack connector state (mirrors @herdctl/slack types)
 */
export interface SlackConnectorState {
  status: SlackConnectionStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  botUser: {
    id: string;
    username: string;
  } | null;
  messageStats: {
    received: number;
    sent: number;
    ignored: number;
  };
}

/**
 * Message event payload from SlackConnector
 */
export interface SlackMessageEvent {
  agentName: string;
  prompt: string;
  metadata: {
    channelId: string;
    messageTs: string;
    userId: string;
    wasMentioned: boolean;
  };
  reply: (content: string) => Promise<void>;
  startProcessingIndicator: () => () => void;
}

/**
 * Error event payload from SlackConnector
 *
 * Note: No agentName — the connector is shared across agents.
 */
export interface SlackErrorEvent {
  error: Error;
}

/**
 * Logger interface for Slack operations
 */
interface SlackLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Minimal interface for a Slack connector
 */
interface ISlackConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): SlackConnectorState;
  uploadFile(params: {
    channelId: string;
    fileBuffer: Buffer;
    filename: string;
    message?: string;
  }): Promise<{ fileId: string }>;
  on(event: "message", listener: (payload: SlackMessageEvent) => void): this;
  on(event: "error", listener: (payload: SlackErrorEvent) => void): this;
  on(event: "ready", listener: (payload: { botUser: { id: string; username: string } }) => void): this;
  on(event: "disconnect", listener: (payload: { reason: string }) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Session manager interface for Slack (minimal for our needs)
 */
interface ISlackSessionManager {
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
 * Dynamically imported Slack module structure
 */
interface SlackModule {
  SlackConnector: new (options: {
    botToken: string;
    appToken: string;
    channelAgentMap: Map<string, string>;
    channelConfigs?: Map<string, { mode: "mention" | "auto"; contextMessages: number }>;
    sessionManagers: Map<string, ISlackSessionManager>;
    logger?: SlackLogger;
    stateDir?: string;
  }) => ISlackConnector;
  SessionManager: new (options: {
    agentName: string;
    stateDir: string;
    sessionExpiryHours?: number;
    logger?: SlackLogger;
  }) => ISlackSessionManager;
}

/**
 * Lazy import the Slack package to avoid hard dependency
 */
async function importSlackPackage(): Promise<SlackModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = (await import("@herdctl/slack" as string)) as unknown as SlackModule;
    return pkg;
  } catch {
    return null;
  }
}

// =============================================================================
// Streaming Responder (adapted for Slack mrkdwn)
// =============================================================================

interface StreamingResponderOptions {
  reply: (content: string) => Promise<void>;
  splitResponse: (text: string) => string[];
  logger: SlackLogger;
  agentName: string;
  minMessageInterval?: number;
  maxBufferSize?: number;
}

class StreamingResponder {
  private buffer: string = "";
  private lastSendTime: number = 0;
  private messagesSent: number = 0;
  private readonly reply: (content: string) => Promise<void>;
  private readonly splitResponse: (text: string) => string[];
  private readonly logger: SlackLogger;
  private readonly agentName: string;
  private readonly minMessageInterval: number;
  private readonly maxBufferSize: number;

  constructor(options: StreamingResponderOptions) {
    this.reply = options.reply;
    this.splitResponse = options.splitResponse;
    this.logger = options.logger;
    this.agentName = options.agentName;
    this.minMessageInterval = options.minMessageInterval ?? 1000;
    this.maxBufferSize = options.maxBufferSize ?? 3500; // Leave room for Slack's ~4K practical limit
  }

  async addMessageAndSend(content: string): Promise<void> {
    if (!content || content.trim().length === 0) {
      return;
    }

    this.buffer += content;
    await this.sendAll();
  }

  private async sendAll(): Promise<void> {
    if (this.buffer.trim().length === 0) {
      return;
    }

    const content = this.buffer.trim();
    this.buffer = "";

    const now = Date.now();
    const timeSinceLastSend = now - this.lastSendTime;
    if (timeSinceLastSend < this.minMessageInterval && this.lastSendTime > 0) {
      const waitTime = this.minMessageInterval - timeSinceLastSend;
      await this.sleep(waitTime);
    }

    const chunks = this.splitResponse(content);

    for (const chunk of chunks) {
      try {
        await this.reply(chunk);
        this.messagesSent++;
        this.lastSendTime = Date.now();
        this.logger.debug(`Streamed message to Slack`, {
          agentName: this.agentName,
          chunkLength: chunk.length,
          totalSent: this.messagesSent,
        });

        if (chunks.length > 1) {
          await this.sleep(500);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to send Slack message`, {
          agentName: this.agentName,
          error: errorMessage,
        });
        throw error;
      }
    }
  }

  async flush(): Promise<void> {
    await this.sendAll();
  }

  hasSentMessages(): boolean {
    return this.messagesSent > 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Slack Manager
// =============================================================================

/**
 * SlackManager handles Slack connections for agents
 *
 * Unlike DiscordManager which creates N connectors (one per agent),
 * SlackManager creates ONE connector shared across all Slack-enabled agents,
 * with channel→agent routing.
 */
export class SlackManager {
  private connector: ISlackConnector | null = null;
  private sessionManagers: Map<string, ISlackSessionManager> = new Map();
  private channelAgentMap: Map<string, string> = new Map();
  private channelConfigs: Map<string, { mode: "mention" | "auto"; contextMessages: number }> = new Map();
  private initialized: boolean = false;

  constructor(private ctx: FleetManagerContext) {}

  /**
   * Initialize the Slack connector for all configured agents
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

    // Try to import the slack package
    const slackPkg = await importSlackPackage();
    if (!slackPkg) {
      logger.debug("@herdctl/slack not installed, skipping Slack connector");
      return;
    }

    const { SlackConnector, SessionManager } = slackPkg;
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

    logger.info(`Initializing Slack connector for ${slackAgents.length} agent(s)`);

    // All agents share the same bot + app token.
    // Take the first agent's config for token resolution.
    const firstSlackConfig = slackAgents[0].chat.slack;
    if (!firstSlackConfig) {
      this.initialized = true;
      return;
    }

    const botToken = process.env[firstSlackConfig.bot_token_env];
    if (!botToken) {
      logger.warn(
        `Slack bot token not found in environment variable '${firstSlackConfig.bot_token_env}'`
      );
      this.initialized = true;
      return;
    }

    const appToken = process.env[firstSlackConfig.app_token_env];
    if (!appToken) {
      logger.warn(
        `Slack app token not found in environment variable '${firstSlackConfig.app_token_env}'`
      );
      this.initialized = true;
      return;
    }

    // Build channel→agent routing map and create session managers
    for (const agent of slackAgents) {
      const slackConfig = agent.chat.slack;
      if (!slackConfig) continue;

      // Create logger adapter for this agent
      const createAgentLogger = (prefix: string): SlackLogger => ({
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
        sessionExpiryHours: slackConfig.session_expiry_hours,
        logger: createAgentLogger(`[slack:${agent.name}:session]`),
      });

      this.sessionManagers.set(agent.name, sessionManager);

      // Map channels to this agent
      for (const channel of slackConfig.channels) {
        if (this.channelAgentMap.has(channel.id)) {
          logger.warn(
            `Channel ${channel.id} is already mapped to agent '${this.channelAgentMap.get(channel.id)}', ` +
              `overriding with agent '${agent.name}'`
          );
        }
        this.channelAgentMap.set(channel.id, agent.name);
        this.channelConfigs.set(channel.id, {
          mode: channel.mode ?? "mention",
          contextMessages: channel.context_messages ?? 10,
        });
      }

      logger.debug(`Configured Slack routing for agent '${agent.name}' with ${slackConfig.channels.length} channel(s)`);
    }

    // Create the single connector
    try {
      this.connector = new SlackConnector({
        botToken,
        appToken,
        channelAgentMap: this.channelAgentMap,
        channelConfigs: this.channelConfigs,
        sessionManagers: this.sessionManagers,
        stateDir,
        logger: {
          debug: (msg: string, data?: Record<string, unknown>) =>
            logger.debug(`[slack] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          info: (msg: string, data?: Record<string, unknown>) =>
            logger.info(`[slack] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          warn: (msg: string, data?: Record<string, unknown>) =>
            logger.warn(`[slack] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
          error: (msg: string, data?: Record<string, unknown>) =>
            logger.error(`[slack] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
        },
      });

      logger.debug(`Created Slack connector with ${this.channelAgentMap.size} channel mapping(s)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create Slack connector: ${errorMessage}`);
    }

    this.initialized = true;
    logger.info(
      `Slack manager initialized with ${this.sessionManagers.size} agent(s), ` +
        `${this.channelAgentMap.size} channel mapping(s)`
    );
  }

  /**
   * Connect the Slack connector and subscribe to events
   */
  async start(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (!this.connector) {
      logger.debug("No Slack connector to start");
      return;
    }

    logger.info("Starting Slack connector...");

    // Subscribe to events before connecting
    this.connector.on("message", (event: SlackMessageEvent) => {
      this.handleMessage(event.agentName, event).catch((error: unknown) => {
        this.handleError(event.agentName, error);
      });
    });

    this.connector.on("error", (event: SlackErrorEvent) => {
      this.handleError("slack", event.error);
    });

    try {
      await this.connector.connect();
      logger.info("Slack connector started");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to connect Slack: ${errorMessage}`);
    }
  }

  /**
   * Disconnect the Slack connector gracefully
   */
  async stop(): Promise<void> {
    const logger = this.ctx.getLogger();

    if (!this.connector) {
      logger.debug("No Slack connector to stop");
      return;
    }

    logger.info("Stopping Slack connector...");

    // Log session state before shutdown
    for (const [agentName, sessionManager] of this.sessionManagers) {
      try {
        const activeSessionCount = await sessionManager.getActiveSessionCount();
        if (activeSessionCount > 0) {
          logger.info(`Preserving ${activeSessionCount} active Slack session(s) for agent '${agentName}'`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get Slack session count for agent '${agentName}': ${errorMessage}`);
      }
    }

    try {
      await this.connector.disconnect();
      logger.info("Slack connector stopped");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error disconnecting Slack: ${errorMessage}`);
    }
  }

  /**
   * Get the connector (if any)
   */
  getConnector(): ISlackConnector | null {
    return this.connector;
  }

  /**
   * Check if the connector is connected
   */
  isConnected(): boolean {
    return this.connector?.isConnected() ?? false;
  }

  /**
   * Get the state of the connector
   */
  getState(): SlackConnectorState | null {
    return this.connector?.getState() ?? null;
  }

  /**
   * Get the channel→agent routing map
   */
  getChannelAgentMap(): Map<string, string> {
    return this.channelAgentMap;
  }

  /**
   * Check if a specific agent has Slack configured
   */
  hasAgent(agentName: string): boolean {
    return this.sessionManagers.has(agentName);
  }

  // ===========================================================================
  // Message Handling Pipeline
  // ===========================================================================

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

    // Get existing session for this channel
    const sessionManager = this.sessionManagers.get(agentName);
    let existingSessionId: string | null = null;
    if (sessionManager) {
      try {
        const existingSession = await sessionManager.getSession(event.metadata.channelId);
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
      }
    }

    // Create file sender definition for this message context
    let injectedMcpServers: Record<string, InjectedMcpServerDef> | undefined;
    const workingDir = resolveWorkingDirectory(agent);
    if (this.connector && workingDir) {
      const connector = this.connector;
      const fileSenderContext: FileSenderContext = {
        workingDirectory: workingDir,
        uploadFile: async (params) => {
          return connector.uploadFile({
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

    // Create streaming responder
    const streamer = new StreamingResponder({
      reply: event.reply,
      splitResponse: (text) => this.splitResponse(text),
      logger,
      agentName,
    });

    // Start processing indicator (hourglass emoji)
    const stopProcessing = event.startProcessingIndicator();
    let processingStopped = false;

    try {
      const fleetManager = emitter as unknown as {
        trigger: (
          agentName: string,
          scheduleName?: string,
          options?: {
            prompt?: string;
            resume?: string | null;
            injectedMcpServers?: Record<string, InjectedMcpServerDef>;
            onMessage?: (message: { type: string; content?: string; message?: { content?: unknown } }) => void | Promise<void>;
          }
        ) => Promise<import("./types.js").TriggerResult>;
      };

      const result = await fleetManager.trigger(agentName, undefined, {
        prompt: event.prompt,
        resume: existingSessionId,
        injectedMcpServers,
        onMessage: async (message) => {
          if (message.type === "assistant") {
            const content = this.extractMessageContent(message);
            if (content) {
              await streamer.addMessageAndSend(content);
            }
          }
        },
      });

      // Stop processing indicator
      if (!processingStopped) {
        stopProcessing();
        processingStopped = true;
      }

      // Flush remaining content
      await streamer.flush();

      logger.info(`Slack job completed: ${result.jobId} for agent '${agentName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`);

      // Fallback message if nothing was sent
      if (!streamer.hasSentMessages()) {
        if (result.success) {
          await event.reply("I've completed the task, but I don't have a specific response to share.");
        } else {
          const errorMessage = result.errorDetails?.message ?? result.error?.message ?? "An unknown error occurred";
          await event.reply(`*Error:* ${errorMessage}\n\nThe task could not be completed. Please check the logs for more details.`);
        }

        if (!processingStopped) {
          stopProcessing();
          processingStopped = true;
        }
      }

      // Store the SDK session ID for future conversation continuity
      if (sessionManager && result.sessionId && result.success) {
        const isNewSession = existingSessionId === null;
        try {
          await sessionManager.setSession(
            event.metadata.channelId,
            result.sessionId
          );
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
        }
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

      try {
        await event.reply(this.formatErrorMessage(err));
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }

      emitter.emit("slack:message:error", {
        agentName,
        channelId: event.metadata.channelId,
        messageTs: event.metadata.messageTs,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (!processingStopped) {
        stopProcessing();
      }
    }
  }

  /**
   * Extract text content from an SDK message
   */
  private extractMessageContent(message: {
    type: string;
    content?: string;
    message?: { content?: unknown };
  }): string | undefined {
    if (typeof message.content === "string" && message.content) {
      return message.content;
    }

    const apiMessage = message.message as { content?: unknown } | undefined;
    const content = apiMessage?.content;

    if (!content) return undefined;

    if (typeof content === "string") {
      return content;
    }

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
   * Handle errors from the Slack connector
   */
  private handleError(agentName: string, error: unknown): void {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Slack connector error for agent '${agentName}': ${errorMessage}`);

    emitter.emit("slack:error", {
      agentName,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // ===========================================================================
  // Response Formatting and Splitting
  // ===========================================================================

  private static readonly MAX_MESSAGE_LENGTH = 4000;

  formatErrorMessage(error: Error): string {
    return `*Error:* ${error.message}\n\nPlease try again or use \`!reset\` to start a new session.`;
  }

  splitResponse(text: string): string[] {
    const MAX_LENGTH = SlackManager.MAX_MESSAGE_LENGTH;

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

      const splitIndex = this.findNaturalBreak(remaining, MAX_LENGTH);
      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex);
    }

    return chunks;
  }

  private findNaturalBreak(text: string, maxLength: number): number {
    const searchEnd = Math.min(maxLength, text.length);

    const doubleNewline = text.lastIndexOf("\n\n", searchEnd);
    if (doubleNewline > 0 && doubleNewline > searchEnd - 500) {
      return doubleNewline + 2;
    }

    const singleNewline = text.lastIndexOf("\n", searchEnd);
    if (singleNewline > 0 && singleNewline > searchEnd - 200) {
      return singleNewline + 1;
    }

    const space = text.lastIndexOf(" ", searchEnd);
    if (space > 0 && space > searchEnd - 100) {
      return space + 1;
    }

    return searchEnd;
  }
}
