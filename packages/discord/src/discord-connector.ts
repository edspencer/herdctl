/**
 * DiscordConnector - Connects an agent to Discord
 *
 * Each agent has its own DiscordConnector instance with its own bot identity.
 * The connector uses discord.js v14 to connect to the Discord gateway and
 * handles connection lifecycle events.
 */

import { EventEmitter } from "events";
import {
  Client,
  GatewayIntentBits,
  Events,
  type ClientOptions,
  type Message,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
  type ThreadChannel,
  type Interaction,
} from "discord.js";
import { RESTEvents, type RateLimitData } from "@discordjs/rest";
import type { AgentConfig, AgentChatDiscord, FleetManager } from "@herdctl/core";
import type {
  DiscordConnectorOptions,
  DiscordConnectorState,
  DiscordConnectionStatus,
  DiscordConnectorLogger,
  IDiscordConnector,
  DiscordConnectorEventMap,
  DiscordConnectorEventName,
} from "./types.js";
import {
  DiscordConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
} from "./errors.js";
import {
  ErrorHandler,
  USER_ERROR_MESSAGES,
  withRetry,
} from "./error-handler.js";
import {
  shouldProcessMessage,
  buildConversationContext,
  type TextBasedChannel,
} from "./mention-handler.js";
import {
  checkDMUserFilter,
  resolveChannelConfig,
  DEFAULT_DM_CONTEXT_MESSAGES,
} from "./auto-mode-handler.js";
import { CommandManager, type ICommandManager } from "./commands/index.js";
import type { ISessionManager } from "./session-manager/index.js";
import { DiscordLogger, createLoggerFromConfig } from "./logger.js";

/**
 * DiscordConnector class - Connects a single agent to Discord
 *
 * Each agent has its own connector instance with:
 * - Its own discord.js Client
 * - Its own bot token and identity
 * - Connection lifecycle management
 * - Event emission for monitoring
 *
 * @example
 * ```typescript
 * const connector = new DiscordConnector({
 *   agentConfig,
 *   discordConfig: agentConfig.chat.discord,
 *   botToken: process.env.MY_BOT_TOKEN,
 *   fleetManager,
 * });
 *
 * await connector.connect();
 * console.log(`Connected as ${connector.getState().botUser?.username}`);
 *
 * // Later...
 * await connector.disconnect();
 * ```
 */
export class DiscordConnector
  extends EventEmitter
  implements IDiscordConnector
{
  private readonly _agentConfig: AgentConfig;
  private readonly _discordConfig: AgentChatDiscord;
  private readonly _botToken: string;
  private readonly _fleetManager: FleetManager;
  private readonly _logger: DiscordConnectorLogger;
  private readonly _sessionManager: ISessionManager;
  private readonly _errorHandler: ErrorHandler;
  private _client: Client | null = null;
  private _commandManager: ICommandManager | null = null;
  private _status: DiscordConnectionStatus = "disconnected";
  private _connectedAt: string | null = null;
  private _disconnectedAt: string | null = null;
  private _reconnectAttempts: number = 0;
  private _lastError: string | null = null;
  private _botUser: DiscordConnectorState["botUser"] = null;

  // Rate limit tracking
  private _rateLimitCount: number = 0;
  private _lastRateLimitAt: string | null = null;
  private _rateLimitResetTime: number = 0;
  private _rateLimitResetTimer: ReturnType<typeof setTimeout> | null = null;

  // Message count tracking for standard logging
  private _messagesReceived: number = 0;
  private _messagesSent: number = 0;
  private _messagesIgnored: number = 0;

  constructor(options: DiscordConnectorOptions) {
    super();

    this._agentConfig = options.agentConfig;
    this._discordConfig = options.discordConfig;
    this._botToken = options.botToken;
    this._fleetManager = options.fleetManager;
    this._sessionManager = options.sessionManager;

    // Create logger from config if not provided
    this._logger =
      options.logger ?? createLoggerFromConfig(options.agentConfig.name, options.discordConfig);

    // Initialize error handler for user-friendly error messages
    this._errorHandler = new ErrorHandler({
      logger: this._logger,
      agentName: options.agentConfig.name,
    });

    // Validate token is provided
    if (!this._botToken || this._botToken.trim() === "") {
      throw new InvalidTokenError(
        this.agentName,
        "Bot token cannot be empty"
      );
    }
  }

  /**
   * Get the session manager instance
   */
  get sessionManager(): ISessionManager {
    return this._sessionManager;
  }

  /**
   * Get the command manager instance (available after connect)
   */
  get commandManager(): ICommandManager | null {
    return this._commandManager;
  }

  /**
   * Name of the agent this connector is for
   */
  get agentName(): string {
    return this._agentConfig.name;
  }

  /**
   * Get the discord.js Client instance (for testing)
   */
  get client(): Client | null {
    return this._client;
  }

  /**
   * Connect to Discord gateway
   *
   * Creates a new discord.js Client and connects to the gateway.
   * Registers event handlers for connection lifecycle events.
   *
   * @throws AlreadyConnectedError if already connected
   * @throws DiscordConnectionError on connection failure
   */
  async connect(): Promise<void> {
    // Check if already connected or connecting
    if (
      this._status === "connected" ||
      this._status === "connecting"
    ) {
      throw new AlreadyConnectedError(this.agentName);
    }

    this._status = "connecting";
    this._lastError = null;
    this._logger.info("Connecting to Discord...");

    try {
      // Create client with necessary intents
      const clientOptions: ClientOptions = {
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
      };

      this._client = new Client(clientOptions);

      // Set up event handlers before connecting
      this._setupEventHandlers();

      // Connect to Discord
      await this._client.login(this._botToken);

      // Note: The 'ready' event handler will update status to 'connected'
    } catch (error) {
      this._status = "error";
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this._lastError = errorMessage;
      this._logger.error("Connection failed", { error: errorMessage });

      // Clean up client on failure
      if (this._client) {
        this._client.destroy();
        this._client = null;
      }

      throw new DiscordConnectionError(this.agentName, errorMessage, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Disconnect from Discord gateway
   *
   * Performs graceful shutdown by destroying the client.
   * Does not throw on failure - logs errors and completes.
   */
  async disconnect(): Promise<void> {
    if (this._status === "disconnected" || this._status === "disconnecting") {
      this._logger.debug("Already disconnected or disconnecting");
      return;
    }

    this._status = "disconnecting";
    this._logger.info("Disconnecting from Discord...");

    try {
      if (this._client) {
        this._client.destroy();
        this._client = null;
      }

      // Clear rate limit timer on disconnect
      if (this._rateLimitResetTimer) {
        clearTimeout(this._rateLimitResetTimer);
        this._rateLimitResetTimer = null;
      }

      this._commandManager = null;
      this._status = "disconnected";
      this._disconnectedAt = new Date().toISOString();
      this._botUser = null;
      this._rateLimitResetTime = 0;

      // Log session stats on disconnect (standard level)
      this._logger.info("Disconnected from Discord", {
        messagesReceived: this._messagesReceived,
        messagesSent: this._messagesSent,
        messagesIgnored: this._messagesIgnored,
        rateLimitsEncountered: this._rateLimitCount,
      });
    } catch (error) {
      // Log but don't throw - we want graceful shutdown
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this._logger.error("Error during disconnect", { error: errorMessage });
      this._status = "disconnected";
      this._disconnectedAt = new Date().toISOString();
      this._client = null;
      this._commandManager = null;
      this._botUser = null;
      // Clear rate limit timer on error path too
      if (this._rateLimitResetTimer) {
        clearTimeout(this._rateLimitResetTimer);
        this._rateLimitResetTimer = null;
      }
      this._rateLimitResetTime = 0;
    }
  }

  /**
   * Check if currently connected to Discord
   *
   * @returns true if connected and ready, false otherwise
   */
  isConnected(): boolean {
    return this._status === "connected" && this._client !== null;
  }

  /**
   * Get current connector state
   *
   * @returns Current state including connection status and metadata
   */
  getState(): DiscordConnectorState {
    return {
      status: this._status,
      connectedAt: this._connectedAt,
      disconnectedAt: this._disconnectedAt,
      reconnectAttempts: this._reconnectAttempts,
      lastError: this._lastError,
      botUser: this._botUser,
      rateLimits: {
        totalCount: this._rateLimitCount,
        lastRateLimitAt: this._lastRateLimitAt,
        isRateLimited: this._rateLimitResetTime > 0,
        currentResetTime: this._rateLimitResetTime,
      },
      messageStats: {
        received: this._messagesReceived,
        sent: this._messagesSent,
        ignored: this._messagesIgnored,
      },
    };
  }

  /**
   * Set up event handlers for the discord.js client
   */
  private _setupEventHandlers(): void {
    if (!this._client) return;

    // Ready event - connection established
    this._client.once(Events.ClientReady, async (client) => {
      this._status = "connected";
      this._connectedAt = new Date().toISOString();
      this._reconnectAttempts = 0;
      this._botUser = {
        id: client.user.id,
        username: client.user.username,
        discriminator: client.user.discriminator,
      };

      this._logger.info("Connected to Discord", {
        username: client.user.username,
        id: client.user.id,
      });

      // Set presence if configured
      this._setPresence();

      // Initialize and register slash commands
      await this._initializeCommands();

      // Emit ready event
      const payload: DiscordConnectorEventMap["ready"] = {
        agentName: this.agentName,
        botUser: this._botUser,
      };
      this.emit("ready", payload);
    });

    // Disconnect event - connection lost
    this._client.on(Events.ShardDisconnect, (event) => {
      // Only handle if we weren't intentionally disconnecting
      if (this._status !== "disconnecting") {
        this._logger.warn("Disconnected from Discord", {
          code: event.code,
        });

        // Emit disconnect event
        const payload: DiscordConnectorEventMap["disconnect"] = {
          agentName: this.agentName,
          code: event.code,
          reason: "Shard disconnected",
        };
        this.emit("disconnect", payload);
      }
    });

    // Reconnecting event - discord.js auto-reconnect
    this._client.on(Events.ShardReconnecting, () => {
      this._status = "reconnecting";
      this._reconnectAttempts++;
      this._logger.info("Reconnecting to Discord...", {
        attempt: this._reconnectAttempts,
      });

      // Emit reconnecting event
      const payload: DiscordConnectorEventMap["reconnecting"] = {
        agentName: this.agentName,
        attempt: this._reconnectAttempts,
      };
      this.emit("reconnecting", payload);
    });

    // Resume event - successfully reconnected
    this._client.on(Events.ShardResume, () => {
      this._status = "connected";
      this._logger.info("Reconnected to Discord");

      // Emit reconnected event
      const payload: DiscordConnectorEventMap["reconnected"] = {
        agentName: this.agentName,
      };
      this.emit("reconnected", payload);
    });

    // Error event
    this._client.on(Events.Error, (error) => {
      this._lastError = error.message;
      this._logger.error("Discord client error", { error: error.message });

      // Emit error event
      const payload: DiscordConnectorEventMap["error"] = {
        agentName: this.agentName,
        error,
      };
      this.emit("error", payload);
    });

    // Warn event
    this._client.on(Events.Warn, (message) => {
      this._logger.warn("Discord client warning", { message });
    });

    // Debug event (only log if verbose)
    if (this._discordConfig.log_level === "verbose") {
      this._client.on(Events.Debug, (message) => {
        this._logger.debug("Discord debug", { message });
      });
    }

    // Rate limit event - discord.js handles rate limits automatically
    // We emit events for monitoring and logging purposes
    this._client.rest.on(RESTEvents.RateLimited, (rateLimitData: RateLimitData) => {
      this._handleRateLimit(rateLimitData);
    });

    // Message create event - handle incoming messages
    this._client.on(Events.MessageCreate, (message) => {
      this._handleMessage(message).catch(async (error) => {
        // Use error handler for detailed logging and user-friendly messages
        const userMessage = this._errorHandler.handleError(
          error,
          "handling message"
        );

        // Attempt to reply with user-friendly error if we can
        try {
          const channel = message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel;
          if ("send" in channel) {
            await channel.send(userMessage);
          }
        } catch (replyError) {
          // Log but don't escalate - we tried our best
          this._logger.debug("Could not send error reply to channel", {
            error: replyError instanceof Error ? replyError.message : String(replyError),
          });
        }
      });
    });

    // Interaction create event - handle slash commands
    this._client.on(Events.InteractionCreate, (interaction) => {
      this._handleInteraction(interaction).catch((error) => {
        // Use error handler for detailed logging
        this._errorHandler.handleError(error, "handling interaction");
      });
    });
  }

  /**
   * Initialize and register slash commands
   */
  private async _initializeCommands(): Promise<void> {
    if (!this._client) {
      this._logger.warn("Cannot initialize commands: client not available");
      return;
    }

    try {
      this._commandManager = new CommandManager({
        agentName: this.agentName,
        client: this._client,
        botToken: this._botToken,
        sessionManager: this._sessionManager,
        getConnectorState: () => this.getState(),
        logger: this._logger,
      });

      await this._commandManager.registerCommands();
      this._logger.info("Slash commands registered successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this._logger.error("Failed to register slash commands", {
        error: errorMessage,
      });
      // Don't throw - command registration failure shouldn't prevent connection
    }
  }

  /**
   * Handle an incoming interaction (slash command)
   */
  private async _handleInteraction(interaction: Interaction): Promise<void> {
    // Only handle chat input (slash) commands
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!this._commandManager) {
      this._logger.warn("Received command but command manager not initialized");
      await interaction.reply({
        content: "Commands are not available at this time.",
        ephemeral: true,
      });
      return;
    }

    await this._commandManager.handleInteraction(interaction);

    // Emit commandExecuted event
    const payload: DiscordConnectorEventMap["commandExecuted"] = {
      agentName: this.agentName,
      commandName: interaction.commandName,
      userId: interaction.user.id,
      channelId: interaction.channelId,
    };
    this.emit("commandExecuted", payload);
  }

  /**
   * Handle an incoming message
   *
   * Determines if the message should be processed based on channel configuration
   * and mention mode settings. If the message should be processed, builds
   * conversation context and emits a 'message' event.
   *
   * For DMs:
   * - DMs default to auto mode (no mention required)
   * - Allowlist/blocklist filtering is applied
   *
   * For guild channels:
   * - Mode is determined by channel configuration
   * - Only configured channels are processed
   */
  private async _handleMessage(message: Message): Promise<void> {
    // Ignore messages from bots (including self)
    if (message.author.bot) {
      return;
    }

    // Get bot user ID
    const botUserId = this._botUser?.id;
    if (!botUserId) {
      this._logger.warn("Received message but bot user ID is not available");
      return;
    }

    const isDM = !message.guildId;

    // For DMs, check user filtering (allowlist/blocklist)
    if (isDM) {
      const dmConfig = this._discordConfig.dm;
      const filterResult = checkDMUserFilter(message.author.id, dmConfig);

      if (!filterResult.allowed) {
        this._messagesIgnored++;
        const payload: DiscordConnectorEventMap["messageIgnored"] = {
          agentName: this.agentName,
          reason: filterResult.reason === "dm_disabled" ? "not_configured" : "not_configured",
          channelId: message.channel.id,
          messageId: message.id,
        };
        this.emit("messageIgnored", payload);

        this._logger.debug("DM filtered", {
          userId: message.author.id,
          reason: filterResult.reason,
        });
        return;
      }
    }

    // Get channel configuration using the new resolver
    const resolvedConfig = resolveChannelConfig(
      message.channel.id,
      message.guildId,
      this._discordConfig.guilds,
      this._discordConfig.dm
    );

    if (!resolvedConfig) {
      // Channel not configured for this agent
      this._messagesIgnored++;
      const payload: DiscordConnectorEventMap["messageIgnored"] = {
        agentName: this.agentName,
        reason: isDM ? "not_configured" : "unknown_channel",
        channelId: message.channel.id,
        messageId: message.id,
      };
      this.emit("messageIgnored", payload);
      return;
    }

    const { mode, contextMessages, guildId } = resolvedConfig;

    // Check if message should be processed based on mode
    if (!shouldProcessMessage(message, botUserId, mode)) {
      this._messagesIgnored++;
      const payload: DiscordConnectorEventMap["messageIgnored"] = {
        agentName: this.agentName,
        reason: "not_mentioned",
        channelId: message.channel.id,
        messageId: message.id,
      };
      this.emit("messageIgnored", payload);
      return;
    }

    // Build conversation context
    const channel = message.channel as TextBasedChannel;
    const context = await buildConversationContext(
      message,
      channel,
      botUserId,
      {
        maxMessages: contextMessages,
        includeBotMessages: true,
        prioritizeUserMessages: true,
      }
    );

    // Track message received
    this._messagesReceived++;

    // Log at info level for standard mode (message counts)
    this._logger.info("Message received", {
      channelId: message.channel.id,
      userId: message.author.id,
      isDM,
      mode,
      totalReceived: this._messagesReceived,
    });

    // More detailed debug logging for verbose mode
    this._logger.debug("Processing message details", {
      channelId: message.channel.id,
      messageId: message.id,
      mode,
      isDM,
      wasMentioned: context.wasMentioned,
      contextMessageCount: context.messages.length,
    });

    // Create reply function for this channel that tracks sent messages
    const reply = async (content: string): Promise<void> => {
      // TextBasedChannel is a union type that includes channels with send() method
      const textChannel = channel as TextChannel | DMChannel | NewsChannel | ThreadChannel;
      await textChannel.send(content);
      this._messagesSent++;
      this._logger.info("Message sent", {
        channelId: message.channel.id,
        totalSent: this._messagesSent,
      });
    };

    // Emit message event
    const payload: DiscordConnectorEventMap["message"] = {
      agentName: this.agentName,
      prompt: context.prompt,
      context,
      metadata: {
        guildId,
        channelId: message.channel.id,
        messageId: message.id,
        userId: message.author.id,
        username: message.author.username,
        wasMentioned: context.wasMentioned,
        mode,
      },
      reply,
    };
    this.emit("message", payload);
  }

  /**
   * Set bot presence based on configuration
   */
  private _setPresence(): void {
    if (!this._client?.user || !this._discordConfig.presence) {
      return;
    }

    const { activity_type, activity_message } = this._discordConfig.presence;

    if (activity_type && activity_message) {
      const activityTypeMap = {
        playing: 0,
        streaming: 1,
        listening: 2,
        watching: 3,
        competing: 5,
      } as const;

      this._client.user.setActivity(activity_message, {
        type: activityTypeMap[activity_type],
      });

      this._logger.debug("Set presence", {
        activity_type,
        activity_message,
      });
    }
  }

  /**
   * Handle rate limit events from discord.js REST client
   *
   * Discord.js automatically queues and retries requests when rate limited.
   * This method tracks rate limit occurrences and emits events for monitoring.
   */
  private _handleRateLimit(rateLimitData: RateLimitData): void {
    // Update rate limit tracking state
    this._rateLimitCount++;
    this._lastRateLimitAt = new Date().toISOString();
    this._rateLimitResetTime = rateLimitData.timeToReset;

    // Clear any existing reset timer
    if (this._rateLimitResetTimer) {
      clearTimeout(this._rateLimitResetTimer);
    }

    // Set timer to clear rate limit status when it resets
    this._rateLimitResetTimer = setTimeout(() => {
      this._rateLimitResetTime = 0;
      this._rateLimitResetTimer = null;
    }, rateLimitData.timeToReset);

    // Log at standard level (info) as per acceptance criteria
    this._logger.info("Rate limited by Discord API", {
      route: rateLimitData.route,
      method: rateLimitData.method,
      timeToReset: rateLimitData.timeToReset,
      limit: rateLimitData.limit,
      global: rateLimitData.global,
      hash: rateLimitData.hash,
    });

    // Emit rate limit event for FleetManager tracking
    const payload: DiscordConnectorEventMap["rateLimit"] = {
      agentName: this.agentName,
      timeToReset: rateLimitData.timeToReset,
      limit: rateLimitData.limit,
      method: rateLimitData.method,
      hash: rateLimitData.hash,
      route: rateLimitData.route,
      global: rateLimitData.global,
    };
    this.emit("rateLimit", payload);
  }

  /**
   * Type-safe event emitter methods
   */
  override emit<K extends DiscordConnectorEventName>(
    event: K,
    payload: DiscordConnectorEventMap[K]
  ): boolean {
    return super.emit(event, payload);
  }

  override on<K extends DiscordConnectorEventName>(
    event: K,
    listener: (payload: DiscordConnectorEventMap[K]) => void
  ): this {
    return super.on(event, listener);
  }

  override once<K extends DiscordConnectorEventName>(
    event: K,
    listener: (payload: DiscordConnectorEventMap[K]) => void
  ): this {
    return super.once(event, listener);
  }

  override off<K extends DiscordConnectorEventName>(
    event: K,
    listener: (payload: DiscordConnectorEventMap[K]) => void
  ): this {
    return super.off(event, listener);
  }
}
