/**
 * Slack Connector
 *
 * Single Bolt App instance with channel→agent routing.
 * Uses Socket Mode for connection (no public URL needed).
 *
 * Key design differences from Discord:
 * - ONE connector shared across all agents (not N connectors)
 * - Channel→agent routing via channelAgentMap
 * - Thread-based conversations (threadTs as session key)
 * - Hourglass emoji reaction as typing indicator
 */

import { EventEmitter } from "node:events";
import type {
  SlackConnectorOptions,
  SlackConnectorState,
  SlackConnectionStatus,
  SlackConnectorLogger,
  SlackMessageEvent,
  ISlackConnector,
  ISlackSessionManager,
} from "./types.js";
import {
  shouldProcessMessage,
  processMessage,
  isBotMentioned,
} from "./message-handler.js";
import { AlreadyConnectedError, SlackConnectionError } from "./errors.js";
import { createDefaultSlackLogger } from "./logger.js";

// =============================================================================
// Slack Connector Implementation
// =============================================================================

export class SlackConnector extends EventEmitter implements ISlackConnector {
  private readonly botToken: string;
  private readonly appToken: string;
  private readonly channelAgentMap: Map<string, string>;
  private readonly sessionManagers: Map<string, ISlackSessionManager>;
  private readonly logger: SlackConnectorLogger;

  // Bolt App instance (dynamically imported)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app: any = null;

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

  // Track active threads (threadTs → agentName) for reply routing
  private activeThreads: Map<string, string> = new Map();

  constructor(options: SlackConnectorOptions) {
    super();

    this.botToken = options.botToken;
    this.appToken = options.appToken;
    this.channelAgentMap = options.channelAgentMap;
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

      this.emit("connected");
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

      this.status = "disconnected";
      this.disconnectedAt = new Date().toISOString();

      this.logger.info("Disconnected from Slack");
      this.emit("disconnected");
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
    return this.status === "connected";
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
  // Event Handlers
  // ===========================================================================

  private registerEventHandlers(): void {
    if (!this.app) return;

    // Handle @mentions — starts new thread conversations
    this.app.event("app_mention", async ({ event, say }: { event: AppMentionEvent; say: SayFn }) => {
      this.messagesReceived++;

      if (!this.botUserId) return;

      // Find which agent handles this channel
      const agentName = this.channelAgentMap.get(event.channel);
      if (!agentName) {
        this.messagesIgnored++;
        this.logger.debug("Ignoring mention in unconfigured channel", {
          channel: event.channel,
        });
        return;
      }

      const prompt = processMessage(event.text, this.botUserId);
      if (!prompt) {
        this.messagesIgnored++;
        return;
      }

      // Thread timestamp: use existing thread or create from this message
      const threadTs = event.thread_ts ?? event.ts;

      // Track this thread for future reply routing
      this.activeThreads.set(threadTs, agentName);

      const messageEvent = this.buildMessageEvent(
        agentName,
        prompt,
        event.channel,
        threadTs,
        event.ts,
        event.user,
        true,
        say
      );

      this.emit("message", messageEvent);
    });

    // Handle thread replies — continues existing conversations
    this.app.event("message", async ({ event, say }: { event: MessageEvent; say: SayFn }) => {
      // Only process thread replies
      if (!event.thread_ts) return;

      this.messagesReceived++;

      if (!this.botUserId) return;

      // Ignore bot messages
      if (!shouldProcessMessage(event, this.botUserId)) {
        this.messagesIgnored++;
        return;
      }

      // Check if this thread is an active conversation
      const agentName = this.activeThreads.get(event.thread_ts);
      if (!agentName) {
        // Could also be in a channel we know about — check channel routing
        const channelAgent = this.channelAgentMap.get(event.channel);
        if (!channelAgent) {
          this.messagesIgnored++;
          return;
        }

        // Check if the bot was mentioned (to start tracking this thread)
        if (
          typeof event.text === "string" &&
          isBotMentioned(event.text, this.botUserId)
        ) {
          this.activeThreads.set(event.thread_ts, channelAgent);
        } else {
          // Thread reply in a known channel but bot wasn't mentioned
          // and we're not tracking this thread — check if we have a session
          const sessionManager = this.sessionManagers.get(channelAgent);
          if (sessionManager) {
            const session = await sessionManager.getSession(event.thread_ts);
            if (session) {
              // We have a session — track and process
              this.activeThreads.set(event.thread_ts, channelAgent);
            } else {
              this.messagesIgnored++;
              return;
            }
          } else {
            this.messagesIgnored++;
            return;
          }
        }
      }

      const resolvedAgent =
        this.activeThreads.get(event.thread_ts) ??
        this.channelAgentMap.get(event.channel);

      if (!resolvedAgent) {
        this.messagesIgnored++;
        return;
      }

      const prompt = processMessage(
        event.text ?? "",
        this.botUserId
      );

      if (!prompt) {
        this.messagesIgnored++;
        return;
      }

      const messageEvent = this.buildMessageEvent(
        resolvedAgent,
        prompt,
        event.channel,
        event.thread_ts,
        event.ts,
        event.user ?? "",
        isBotMentioned(event.text ?? "", this.botUserId),
        say
      );

      this.emit("message", messageEvent);
    });
  }

  // ===========================================================================
  // Message Building
  // ===========================================================================

  private buildMessageEvent(
    agentName: string,
    prompt: string,
    channelId: string,
    threadTs: string,
    messageTs: string,
    userId: string,
    wasMentioned: boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any
  ): SlackMessageEvent {
    const reply = async (content: string): Promise<void> => {
      await say({
        text: content,
        thread_ts: threadTs,
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
        threadTs,
        messageTs,
        userId,
        wasMentioned,
      },
      reply,
      startProcessingIndicator,
    };
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
