/**
 * Slack Connector
 *
 * Single-agent Bolt App instance for Slack integration.
 * Uses Socket Mode for connection (no public URL needed).
 *
 * Key design:
 * - ONE connector per agent (matching Discord's pattern)
 * - Channel-based conversations (channelId as session key)
 * - Hourglass emoji reaction as typing indicator
 */

import { EventEmitter } from "node:events";
import type { IChatSessionManager, DMConfig } from "@herdctl/chat";
import { checkDMUserFilter, getDMMode, isDMEnabled } from "@herdctl/chat";
import type {
  SlackConnectorOptions,
  SlackConnectorState,
  SlackConnectionStatus,
  SlackConnectorLogger,
  SlackMessageEvent,
  SlackChannelConfig,
  SlackFileUploadParams,
  ISlackConnector,
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
  public readonly agentName: string;
  public readonly sessionManager: IChatSessionManager;

  private readonly botToken: string;
  private readonly appToken: string;
  private readonly channels: Map<string, SlackChannelConfig>;
  private readonly dmConfig: Partial<DMConfig> | undefined;
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

    this.agentName = options.agentName;
    this.sessionManager = options.sessionManager;
    this.botToken = options.botToken;
    this.appToken = options.appToken;

    // Build channels map from array (keyed by channel ID for fast lookup)
    this.channels = new Map();
    for (const channel of options.channels) {
      this.channels.set(channel.id, channel);
    }

    this.dmConfig = options.dm;
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
    this.logger.debug("Connecting to Slack via Socket Mode...");

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

      // Set bot presence to active so it appears online (requires users:write scope)
      await this.app.client.users.setPresence({ presence: "auto" }).catch(() => {
        this.logger.debug("Could not set presence (missing users:write scope)");
      });

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
        agentName: this.agentName,
        channelCount: this.channels.size,
      });

      this.emit("ready", {
        agentName: this.agentName,
        botUser: {
          id: this.botUserId!,
          username: this.botUsername ?? "unknown",
        },
      });

      // Clean up expired sessions on startup (matching Discord behavior)
      try {
        const cleaned = await this.sessionManager.cleanupExpiredSessions();
        if (cleaned > 0) {
          this.logger.info(`Cleaned ${cleaned} expired session(s) for agent '${this.agentName}'`);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to cleanup sessions for agent '${this.agentName}'`, {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
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
      this.emit("disconnect", { agentName: this.agentName, reason: "Intentional disconnect" });
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

      const isDM = isSlackDM(event.channel);

      // For DMs, check DM filtering; for channels, check channel config
      if (isDM) {
        const filterResult = this.checkDMAccess(event.channel, event.ts, event.user);
        if (!filterResult) return;
      } else if (!this.channels.has(event.channel)) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: this.agentName,
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
          agentName: this.agentName,
          reason: "empty_prompt",
          channelId: event.channel,
          messageTs: event.ts,
        });
        return;
      }

      // Check for prefix commands before processing as a message
      const wasCommand = await this.tryExecuteCommand(
        prompt, event.channel, event.user, say
      );
      if (wasCommand) return;

      const messageEvent = this.buildMessageEvent(
        prompt,
        event.channel,
        event.ts,
        event.user,
        true,
        isDM,
        say
      );

      this.emit("message", messageEvent);
    });

    // Handle all messages — thread replies AND top-level channel messages AND DMs
    this.app.event("message", async ({ event, say }: { event: MessageEvent; say: SayFn }) => {
      this.messagesReceived++;

      if (!this.botUserId) return;

      // Ignore bot messages and own messages
      if (!shouldProcessMessage(event, this.botUserId)) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: this.agentName,
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

      const isDM = isSlackDM(event.channel);

      // For DMs, check DM filtering; for channels, check channel config
      if (isDM) {
        const filterResult = this.checkDMAccess(event.channel, event.ts, event.user ?? "");
        if (!filterResult) return;

        // DMs always use "auto" mode from DM config (no mention required)
        const mode = getDMMode(this.dmConfig);
        if (mode === "mention") {
          // In mention mode, DMs without a mention are ignored
          // (the app_mention handler above processes mentions)
          this.messagesIgnored++;
          this.emit("messageIgnored", {
            agentName: this.agentName,
            reason: "not_configured",
            channelId: event.channel,
            messageTs: event.ts,
          });
          this.logger.debug("Ignoring DM in mention mode (no mention)", {
            channel: event.channel,
          });
          return;
        }
      } else {
        // Channel message — check channel config
        if (!this.channels.has(event.channel)) {
          this.messagesIgnored++;
          this.emit("messageIgnored", {
            agentName: this.agentName,
            reason: "not_configured",
            channelId: event.channel,
            messageTs: event.ts,
          });
          this.logger.debug("No channel config for message", {
            channel: event.channel,
          });
          return;
        }

        // For top-level messages (no thread_ts), check channel mode
        if (!event.thread_ts) {
          const channelConfig = this.channels.get(event.channel);
          const mode = channelConfig?.mode ?? "mention";
          if (mode === "mention") {
            this.messagesIgnored++;
            this.emit("messageIgnored", {
              agentName: this.agentName,
              reason: "not_configured",
              channelId: event.channel,
              messageTs: event.ts,
            });
            this.logger.debug("Ignoring top-level message in mention-mode channel", {
              channel: event.channel,
              agent: this.agentName,
              mode,
            });
            return;
          }

          this.logger.debug("Top-level channel message (auto mode)", {
            channel: event.channel,
            agent: this.agentName,
            ts: event.ts,
          });
        }
      }

      const prompt = processMessage(event.text ?? "", this.botUserId);

      if (!prompt) {
        this.messagesIgnored++;
        this.emit("messageIgnored", {
          agentName: this.agentName,
          reason: "empty_prompt",
          channelId: event.channel,
          messageTs: event.ts,
        });
        return;
      }

      // Check for prefix commands before processing as a message
      const wasCommand = await this.tryExecuteCommand(
        prompt, event.channel, event.user ?? "", say
      );
      if (wasCommand) return;

      const messageEvent = this.buildMessageEvent(
        prompt,
        event.channel,
        event.ts,
        event.user ?? "",
        false,
        isDM,
        say
      );

      this.emit("message", messageEvent);
    });
  }

  /**
   * Check if a DM is allowed based on DM config (enabled, allowlist, blocklist).
   * Returns true if the DM should be processed, false if it was filtered.
   * Emits messageIgnored events when filtered.
   */
  private checkDMAccess(channelId: string, messageTs: string, userId: string): boolean {
    if (!isDMEnabled(this.dmConfig)) {
      this.messagesIgnored++;
      this.emit("messageIgnored", {
        agentName: this.agentName,
        reason: "dm_disabled",
        channelId,
        messageTs,
      });
      this.logger.debug("DM ignored (DMs disabled)", { channel: channelId });
      return false;
    }

    const filterResult = checkDMUserFilter(userId, this.dmConfig);
    if (!filterResult.allowed) {
      this.messagesIgnored++;
      this.emit("messageIgnored", {
        agentName: this.agentName,
        reason: "dm_filtered",
        channelId,
        messageTs,
      });
      this.logger.debug("DM filtered", {
        userId,
        reason: filterResult.reason,
      });
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Command Handling
  // ===========================================================================

  /**
   * Try to execute a prefix command. Returns true if a command was handled.
   */
  private async tryExecuteCommand(
    prompt: string,
    channelId: string,
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any
  ): Promise<boolean> {
    if (!this.commandHandler || !this.commandHandler.isCommand(prompt)) {
      return false;
    }

    const executed = await this.commandHandler.executeCommand(prompt, {
      agentName: this.agentName,
      channelId,
      userId,
      reply: async (content: string) => {
        await say({ text: content });
      },
      sessionManager: this.sessionManager,
      connectorState: this.getState(),
    });

    if (executed) {
      const commandName = prompt.trim().slice(1).split(/\s+/)[0];
      this.logger.info("Command executed", {
        command: commandName,
        agentName: this.agentName,
        channelId,
      });
      this.emit("commandExecuted", {
        agentName: this.agentName,
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
    prompt: string,
    channelId: string,
    messageTs: string,
    userId: string,
    wasMentioned: boolean,
    isDM: boolean,
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
      agentName: this.agentName,
      prompt,
      metadata: {
        channelId,
        messageTs,
        userId,
        wasMentioned,
        isDM,
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
// DM Detection
// =============================================================================

/**
 * Check if a Slack channel ID is a DM (IM) channel.
 * Slack DM channel IDs use a 'D' prefix (e.g., D069C7QFK).
 */
function isSlackDM(channelId: string): boolean {
  return channelId.startsWith("D");
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
