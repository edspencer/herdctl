/**
 * Slack Connector
 *
 * Single Bolt App instance with channel->agent routing.
 * Uses Socket Mode for connection (no public URL needed).
 *
 * Key design:
 * - ONE connector shared across all agents (not N connectors)
 * - Channel->agent routing via channelAgentMap
 * - Channel-based conversations (channelId as session key, matching Discord)
 * - Hourglass emoji reaction as typing indicator
 */

import { EventEmitter } from "node:events";
import type {
  SlackConnectorOptions,
  SlackConnectorState,
  SlackConnectionStatus,
  SlackConnectorLogger,
  SlackMessageEvent,
  SlackChannelConfig,
  SlackFileUploadParams,
  ISlackConnector,
  ISlackSessionManager,
  SlackConnectorEventMap,
  SlackConnectorEventName,
} from "./types.js";
import {
  shouldProcessMessage,
  processMessage,
  isBotMentioned,
} from "./message-handler.js";
import {
  CommandHandler,
  helpCommand,
  resetCommand,
  statusCommand,
} from "./commands/index.js";
import { markdownToMrkdwn } from "./formatting.js";
import { AlreadyConnectedError, SlackConnectionError } from "./errors.js";
import { createDefaultSlackLogger } from "./logger.js";

// =============================================================================
// Slack Connector Implementation
// =============================================================================

export class SlackConnector extends EventEmitter implements ISlackConnector {
  private readonly botToken: string;
  private readonly appToken: string;
  private readonly channelAgentMap: Map<string, string>;
  private readonly channelConfigs: Map<string, SlackChannelConfig>;
  private readonly sessionManagers: Map<string, ISlackSessionManager>;
  private readonly logger: SlackConnectorLogger;

  // Bolt App instance (dynamically imported)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app: any = null;

  // Command handler for prefix commands (!help, !reset, !status)
  private commandHandler: CommandHandler | null = null;

  // Connection state
  private status: SlackConnectionStatus = "disconnected";
  private connectedAt: string | null = null;
  private disconnectedAt: string | null = null;
  private reconnectAttempts: number = 0;
  private lastError: string | null = null;
  private botUserId: string | null = null;
  private botUsername: string | null = null;

  // Message stats
  private messagesReceived: number = 0;
  private messagesSent: number = 0;
  private messagesIgnored: number = 0;

  constructor(options: SlackConnectorOptions) {
    super();

    this.botToken = options.botToken;
    this.appToken = options.appToken;
    this.channelAgentMap = options.channelAgentMap;
    this.channelConfigs = options.channelConfigs ?? new Map();
    this.sessionManagers = options.sessionManagers;
    this.logger = options.logger ?? createDefaultSlackLogger();
  }

  // ===========================================================================
  // ISlackConnector Implementation
  // ===========================================================================

  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      throw new AlreadyConnectedError();
    }

    this.status = "connecting";
    this.logger.info("Connecting to Slack via Socket Mode...");

    try {
      // Dynamically import @slack/bolt
      const { App } = await import("@slack/bolt");

      this.app = new App({
        token: this.botToken,
        appToken: this.appToken,
        socketMode: true,
      });

      // Register event handlers
      this.registerEventHandlers();

      // Start the app
      await this.app.start();

      // Get bot info
      const authResult = await this.app.client.auth.test();
      this.botUserId = authResult.user_id as string;
      this.botUsername = authResult.user as string;

      // Initialize command handler with built-in commands
      this.commandHandler = new CommandHandler({ logger: this.logger });
      this.commandHandler.registerCommand(helpCommand);
      this.commandHandler.registerCommand(resetCommand);
      this.commandHandler.registerCommand(statusCommand);

      this.status = "connected";
      this.connectedAt = new Date().toISOString();
      this.disconnectedAt = null;
      this.reconnectAttempts = 0;
      this.lastError = null;

      this.logger.info("Connected to Slack", {
        botUserId: this.botUserId,
        botUsername: this.botUsername,
        channelCount: this.channelAgentMap.size,
      });

      this.emit("ready", {
        botUser: {
          id: this.botUserId!,
          username: this.botUsername ?? "unknown",
        },
      });

      // Clean up expired sessions on startup (matching Discord behavior)
      for (const [agentName, sessionManager] of this.sessionManagers) {
        try {
          const cleaned = await sessionManager.cleanupExpiredSessions();
          if (cleaned > 0) {
            this.logger.info(`Cleaned ${cleaned} expired session(s) for agent '${agentName}'`);
          }
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup sessions for agent '${agentName}'`, {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    } catch (error) {
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : String(error);

      this.logger.error("Failed to connect to Slack", {
        error: this.lastError,
      });

      throw new SlackConnectionError(
        `Failed to connect to Slack: ${this.lastError}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  async disconnect(): Promise<void> {
    if (
      this.status === "disconnected" ||
      this.status === "disconnecting"
    ) {
      return;
    }

    this.status = "disconnecting";
    this.logger.info("Disconnecting from Slack...");

    try {
      if (this.app) {
        await this.app.stop();
        this.app = null;
      }

      this.commandHandler = null;
      this.status = "disconnected";
      this.disconnectedAt = new Date().toISOString();

      this.logger.info("Disconnected from Slack", {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        messagesIgnored: this.messagesIgnored,
      });
      this.emit("disconnect", { reason: "Intentional disconnect" });
    } catch (error) {
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : String(error);

      this.logger.error("Error disconnecting from Slack", {
        error: this.lastError,
      });
    }
  }

  isConnected(): boolean {
    return this.status === "connected" && this.app !== null;
  }

  getState(): SlackConnectorState {
    return {
      status: this.status,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      botUser: this.botUserId
        ? {
            id: this.botUserId,
            username: this.botUsername ?? "unknown",
          }
        : null,
      messageStats: {
        received: this.messagesReceived,
        sent: this.messagesSent,
        ignored: this.messagesIgnored,
      },
    };
  }

  // ===========================================================================
  // File Upload
  // ===========================================================================

  async uploadFile(params: SlackFileUploadParams): Promise<{ fileId: string }> {
    if (!this.app?.client) {
      throw new Error("Cannot upload file: not connected to Slack");
    }

    const response = await this.app.client.files.uploadV2({
      channel_id: params.channelId,
      file: params.fileBuffer,
      filename: params.filename,
      initial_comment: params.message ?? "",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileId = (response as any).files?.[0]?.id ?? "unknown";
    this.logger.info("File uploaded to Slack", {
      fileId,
      filename: params.filename,
      channelId: params.channelId,
      size: params.fileBuffer.length,
    });

    return { fileId };
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  private registerEventHandlers(): void {
    if (!this.app) return;

    // Handle @mentions
    this.app.event("app_mention", async ({ event, say }: { event: AppMentionEvent; say: SayFn }) => {
      this.messagesReceived++;

      if (!this.botUserId) return;

      // Find which agent handles this channel
      const agentName = this.channelAgentMap.get(event.channel);
      if (!agentName) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: "unknown",
          reason: "not_configured",
          channelId: event.channel,
          messageTs: event.ts,
        });
        this.logger.debug("Ignoring mention in unconfigured channel", {
          channel: event.channel,
        });
        return;
      }

      const prompt = processMessage(event.text, this.botUserId);
      if (!prompt) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName,
          reason: "empty_prompt",
          channelId: event.channel,
          messageTs: event.ts,
        });
        return;
      }

      // Check for prefix commands before processing as a message
      const wasCommand = await this.tryExecuteCommand(
        prompt, agentName, event.channel, event.user, say
      );
      if (wasCommand) return;

      const messageEvent = this.buildMessageEvent(
        agentName,
        prompt,
        event.channel,
        event.ts,
        event.user,
        true,
        say
      );

      this.emit("message", messageEvent);
    });

    // Handle all messages — thread replies AND top-level channel messages
    this.app.event("message", async ({ event, say }: { event: MessageEvent; say: SayFn }) => {
      this.messagesReceived++;

      if (!this.botUserId) return;

      // Ignore bot messages and own messages
      if (!shouldProcessMessage(event, this.botUserId)) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: "unknown",
          reason: "bot_message",
          channelId: event.channel,
          messageTs: event.ts,
        });
        this.logger.debug("Skipping bot/own message", {
          channel: event.channel,
          botId: event.bot_id,
          user: event.user,
        });
        return;
      }

      // Skip @mentions — handled by the app_mention handler above
      if (
        typeof event.text === "string" &&
        isBotMentioned(event.text, this.botUserId)
      ) {
        this.logger.debug("Skipping @mention message (handled by app_mention)", {
          channel: event.channel,
          ts: event.ts,
        });
        return;
      }

      // Resolve agent for this channel
      const resolvedAgent = this.channelAgentMap.get(event.channel);

      if (!resolvedAgent) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: "unknown",
          reason: "no_agent_resolved",
          channelId: event.channel,
          messageTs: event.ts,
        });
        this.logger.debug("No agent resolved for message", {
          channel: event.channel,
        });
        return;
      }

      // For top-level messages (no thread_ts), check channel mode
      if (!event.thread_ts) {
        const channelConfig = this.channelConfigs.get(event.channel);
        const mode = channelConfig?.mode ?? "mention";
        if (mode === "mention") {
          this.messagesIgnored++;
          this.emit("messageIgnored", {
            agentName: resolvedAgent,
            reason: "not_configured",
            channelId: event.channel,
            messageTs: event.ts,
          });
          this.logger.debug("Ignoring top-level message in mention-mode channel", {
            channel: event.channel,
            agent: resolvedAgent,
            mode,
          });
          return;
        }

        this.logger.debug("Top-level channel message (auto mode)", {
          channel: event.channel,
          agent: resolvedAgent,
          ts: event.ts,
        });
      }

      const prompt = processMessage(event.text ?? "", this.botUserId);

      if (!prompt) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: resolvedAgent,
          reason: "empty_prompt",
          channelId: event.channel,
          messageTs: event.ts,
        });
        return;
      }

      // Check for prefix commands before processing as a message
      const wasCommand = await this.tryExecuteCommand(
        prompt, resolvedAgent, event.channel, event.user ?? "", say
      );
      if (wasCommand) return;

      const messageEvent = this.buildMessageEvent(
        resolvedAgent,
        prompt,
        event.channel,
        event.ts,
        event.user ?? "",
        false,
        say
      );

      this.emit("message", messageEvent);
    });
  }

  // ===========================================================================
  // Command Handling
  // ===========================================================================

  /**
   * Try to execute a prefix command. Returns true if a command was handled.
   */
  private async tryExecuteCommand(
    prompt: string,
    agentName: string,
    channelId: string,
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any
  ): Promise<boolean> {
    if (!this.commandHandler || !this.commandHandler.isCommand(prompt)) {
      return false;
    }

    const sessionManager = this.sessionManagers.get(agentName);
    if (!sessionManager) {
      return false;
    }

    const executed = await this.commandHandler.executeCommand(prompt, {
      agentName,
      channelId,
      userId,
      reply: async (content: string) => {
        await say({ text: content });
      },
      sessionManager,
      connectorState: this.getState(),
    });

    if (executed) {
      const commandName = prompt.trim().slice(1).split(/\s+/)[0];
      this.logger.info("Command executed", {
        command: commandName,
        agentName,
        channelId,
      });
      this.emit("commandExecuted", {
        agentName,
        commandName,
        userId,
        channelId,
      });
    }

    return executed;
  }

  // ===========================================================================
  // Message Building
  // ===========================================================================

  private buildMessageEvent(
    agentName: string,
    prompt: string,
    channelId: string,
    messageTs: string,
    userId: string,
    wasMentioned: boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any
  ): SlackMessageEvent {
    const reply = async (content: string): Promise<void> => {
      await say({
        text: markdownToMrkdwn(content),
      });
      this.messagesSent++;
    };

    const startProcessingIndicator = (): (() => void) => {
      // Add hourglass reaction while processing
      if (this.app?.client) {
        this.app.client.reactions
          .add({
            channel: channelId,
            name: "hourglass_flowing_sand",
            timestamp: messageTs,
          })
          .catch(() => {
            // Ignore reaction errors — not critical
          });
      }

      return () => {
        // Remove hourglass reaction when done
        if (this.app?.client) {
          this.app.client.reactions
            .remove({
              channel: channelId,
              name: "hourglass_flowing_sand",
              timestamp: messageTs,
            })
            .catch(() => {
              // Ignore reaction errors — not critical
            });
        }
      };
    };

    return {
      agentName,
      prompt,
      metadata: {
        channelId,
        messageTs,
        userId,
        wasMentioned,
      },
      reply,
      startProcessingIndicator,
    };
  }

  // ===========================================================================
  // Type-Safe Event Emitter Overrides
  // ===========================================================================

  override emit<K extends SlackConnectorEventName>(
    event: K,
    payload: SlackConnectorEventMap[K]
  ): boolean {
    return super.emit(event, payload);
  }

  override on<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this {
    return super.on(event, listener);
  }

  override once<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this {
    return super.once(event, listener);
  }

  override off<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void
  ): this {
    return super.off(event, listener);
  }
}

// =============================================================================
// Internal Slack Event Types (subset of Bolt types)
// =============================================================================

interface AppMentionEvent {
  type: "app_mention";
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
}

interface MessageEvent {
  type: "message";
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts: string;
  channel: string;
  thread_ts?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SayFn = (message: any) => Promise<any>;
