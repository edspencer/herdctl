/**
 * Discord Manager Module
 *
 * Manages Discord connectors for agents that have `chat.discord` configured.
 * This module is responsible for:
 * - Creating one DiscordConnector instance per Discord-enabled agent
 * - Managing connector lifecycle (start/stop)
 * - Providing access to connectors for status queries
 *
 * @module manager
 */

import {
  type ChatConnectorLogger,
  ChatSessionManager,
  extractMessageContent,
  extractToolResults,
  extractToolUseBlocks,
  getToolInputSummary,
  StreamingResponder,
  splitMessage,
  TOOL_EMOJIS,
} from "@herdctl/chat";
import type {
  ChatManagerConnectorState,
  FleetManagerContext,
  IChatManager,
  ResolvedAgent,
} from "@herdctl/core";

import { DiscordConnector } from "./discord-connector.js";
import type {
  DiscordConnectorEventMap,
  DiscordReplyEmbed,
  DiscordReplyEmbedField,
} from "./types.js";

// =============================================================================
// Discord Manager
// =============================================================================

/**
 * Message event payload from DiscordConnector
 */
type DiscordMessageEvent = DiscordConnectorEventMap["message"];

/**
 * Error event payload from DiscordConnector
 */
type DiscordErrorEvent = DiscordConnectorEventMap["error"];

/**
 * DiscordManager handles Discord connections for agents
 *
 * This class encapsulates the creation and lifecycle management of
 * DiscordConnector instances for agents that have Discord chat configured.
 *
 * Implements IChatManager so FleetManager can interact with it through
 * the generic chat manager interface.
 */
export class DiscordManager implements IChatManager {
  private connectors: Map<string, DiscordConnector> = new Map();
  private initialized: boolean = false;

  constructor(private ctx: FleetManagerContext) {}

  /**
   * Initialize Discord connectors for all configured agents
   *
   * This method:
   * 1. Iterates through agents to find those with Discord configured
   * 2. Creates a DiscordConnector for each Discord-enabled agent
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

    const stateDir = this.ctx.getStateDir();

    // Find agents with Discord configured
    const discordAgents = config.agents.filter(
      (
        agent,
      ): agent is ResolvedAgent & {
        chat: { discord: NonNullable<ResolvedAgent["chat"]>["discord"] };
      } => agent.chat?.discord !== undefined,
    );

    if (discordAgents.length === 0) {
      logger.debug("No agents with Discord configured");
      this.initialized = true;
      return;
    }

    logger.debug(`Initializing Discord connectors for ${discordAgents.length} agent(s)`);

    for (const agent of discordAgents) {
      try {
        const discordConfig = agent.chat.discord;
        if (!discordConfig) continue;

        // Get bot token from environment variable
        const botToken = process.env[discordConfig.bot_token_env];
        if (!botToken) {
          logger.warn(
            `Discord bot token not found in environment variable '${discordConfig.bot_token_env}' for agent '${agent.qualifiedName}'`,
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

        // Create session manager for this agent (keyed by qualifiedName)
        const sessionManager = new ChatSessionManager({
          platform: "discord",
          agentName: agent.qualifiedName,
          stateDir,
          sessionExpiryHours: discordConfig.session_expiry_hours,
          logger: createAgentLogger(`[discord:${agent.qualifiedName}:session]`),
        });

        // Create the connector
        // Pass FleetManager (via ctx.getEmitter() which returns FleetManager instance)
        const connector = new DiscordConnector({
          agentConfig: agent,
          discordConfig,
          botToken,
          // The context's getEmitter() returns the FleetManager instance
          fleetManager: this.ctx.getEmitter() as unknown as import("@herdctl/core").FleetManager,
          sessionManager,
          stateDir,
          logger: createAgentLogger(`[discord:${agent.qualifiedName}]`),
        });

        this.connectors.set(agent.qualifiedName, connector);
        logger.debug(`Created Discord connector for agent '${agent.qualifiedName}'`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          `Failed to create Discord connector for agent '${agent.qualifiedName}': ${errorMessage}`,
        );
        // Continue with other agents - don't fail the whole initialization
      }
    }

    this.initialized = true;
    logger.debug(`Discord manager initialized with ${this.connectors.size} connector(s)`);
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

    logger.debug(`Starting ${this.connectors.size} Discord connector(s)...`);

    const connectPromises: Promise<void>[] = [];

    for (const [qualifiedName, connector] of this.connectors) {
      // Subscribe to connector events before connecting
      connector.on("message", (event: DiscordMessageEvent) => {
        this.handleMessage(qualifiedName, event).catch((error: unknown) => {
          this.handleError(qualifiedName, error);
        });
      });

      connector.on("error", (event: DiscordErrorEvent) => {
        this.handleError(qualifiedName, event.error);
      });

      connectPromises.push(
        connector.connect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to connect Discord for agent '${qualifiedName}': ${errorMessage}`);
          // Don't re-throw - we want to continue connecting other agents
        }),
      );
    }

    await Promise.all(connectPromises);

    const connectedCount = Array.from(this.connectors.values()).filter((c) =>
      c.isConnected(),
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

    logger.debug(`Stopping ${this.connectors.size} Discord connector(s)...`);

    // Log session state before shutdown (sessions are already persisted to disk)
    for (const [qualifiedName, connector] of this.connectors) {
      try {
        const activeSessionCount = await connector.sessionManager.getActiveSessionCount();
        if (activeSessionCount > 0) {
          logger.debug(
            `Preserving ${activeSessionCount} active session(s) for agent '${qualifiedName}'`,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get session count for agent '${qualifiedName}': ${errorMessage}`);
        // Continue with shutdown - this is just informational logging
      }
    }

    const disconnectPromises: Promise<void>[] = [];

    for (const [qualifiedName, connector] of this.connectors) {
      disconnectPromises.push(
        connector.disconnect().catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error disconnecting Discord for agent '${qualifiedName}': ${errorMessage}`);
          // Don't re-throw - graceful shutdown should continue
        }),
      );
    }

    await Promise.all(disconnectPromises);
    logger.debug("All Discord connectors stopped");
  }

  /**
   * Get a connector for a specific agent
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns The DiscordConnector instance, or undefined if not found
   */
  getConnector(qualifiedName: string): DiscordConnector | undefined {
    return this.connectors.get(qualifiedName);
  }

  /**
   * Get all connector names
   *
   * @returns Array of agent qualified names that have Discord connectors
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
    return Array.from(this.connectors.values()).filter((c) => c.isConnected()).length;
  }

  /**
   * Check if the manager has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if a specific agent has a Discord connector
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns true if the agent has a Discord connector
   */
  hasConnector(qualifiedName: string): boolean {
    return this.connectors.has(qualifiedName);
  }

  /**
   * Check if a specific agent has a connector (alias for hasConnector)
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns true if the agent has a connector
   */
  hasAgent(qualifiedName: string): boolean {
    return this.connectors.has(qualifiedName);
  }

  /**
   * Get the state of a connector for a specific agent
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns The connector state, or undefined if not found
   */
  getState(qualifiedName: string): ChatManagerConnectorState | undefined {
    const connector = this.connectors.get(qualifiedName);
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
   * Handle an incoming Discord message
   *
   * This method:
   * 1. Gets or creates a session for the channel
   * 2. Builds job context from the message
   * 3. Executes the job via trigger
   * 4. Sends the response back to Discord
   *
   * @param qualifiedName - Qualified name of the agent handling the message
   * @param event - The Discord message event
   */
  private async handleMessage(qualifiedName: string, event: DiscordMessageEvent): Promise<void> {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    logger.info(
      `Discord message for agent '${qualifiedName}': ${event.prompt.substring(0, 50)}...`,
    );

    // Get the agent configuration (lookup by qualifiedName)
    const config = this.ctx.getConfig();
    const agent = config?.agents.find((a) => a.qualifiedName === qualifiedName);

    if (!agent) {
      logger.error(`Agent '${qualifiedName}' not found in configuration`);
      try {
        await event.reply("Sorry, I'm not properly configured. Please contact an administrator.");
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }
      return;
    }

    // Get output configuration (with defaults)
    const outputConfig = agent.chat?.discord?.output ?? {
      tool_results: true,
      tool_result_max_length: 900,
      system_status: true,
      result_summary: false,
      errors: true,
    };

    // Get existing session for this channel (for conversation continuity)
    const connector = this.connectors.get(qualifiedName);
    let existingSessionId: string | undefined;
    if (connector) {
      try {
        const existingSession = await connector.sessionManager.getSession(event.metadata.channelId);
        if (existingSession) {
          existingSessionId = existingSession.sessionId;
          logger.debug(
            `Resuming session for channel ${event.metadata.channelId}: ${existingSessionId}`,
          );
        } else {
          logger.debug(
            `No existing session for channel ${event.metadata.channelId}, starting new conversation`,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to get session: ${errorMessage}`);
        // Continue processing - session failure shouldn't block message handling
      }
    }

    // Create streaming responder for incremental message delivery
    const streamer = new StreamingResponder({
      reply: (content: string) => event.reply(content),
      logger: logger as ChatConnectorLogger,
      agentName: qualifiedName,
      maxMessageLength: 2000, // Discord's limit
      maxBufferSize: 1500,
      platformName: "Discord",
    });

    // Start typing indicator while processing
    const stopTyping = event.startTyping();

    // Track if we've stopped typing to avoid multiple calls
    let typingStopped = false;

    try {
      // Track pending tool_use blocks so we can pair them with results
      const pendingToolUses = new Map<
        string,
        { name: string; input?: unknown; startTime: number }
      >();
      let embedsSent = 0;

      // Execute job via FleetManager.trigger() through the context
      // Pass resume option for conversation continuity
      // The onMessage callback streams output incrementally to Discord
      const result = await this.ctx.trigger(qualifiedName, undefined, {
        triggerType: "discord",
        prompt: event.prompt,
        resume: existingSessionId,
        onMessage: async (message) => {
          // Extract text content from assistant messages and stream to Discord
          if (message.type === "assistant") {
            // Cast to the SDKMessage shape expected by extractMessageContent
            // The chat package's SDKMessage type expects a specific structure
            const sdkMessage = message as unknown as Parameters<typeof extractMessageContent>[0];
            const content = extractMessageContent(sdkMessage);
            if (content) {
              // Each assistant message is a complete turn - send immediately
              await streamer.addMessageAndSend(content);
            }

            // Track tool_use blocks for pairing with results later
            const toolUseBlocks = extractToolUseBlocks(sdkMessage);
            for (const block of toolUseBlocks) {
              if (block.id) {
                pendingToolUses.set(block.id, {
                  name: block.name,
                  input: block.input,
                  startTime: Date.now(),
                });
              }
            }
          }

          // Build and send embeds for tool results
          if (message.type === "user" && outputConfig.tool_results) {
            // Cast to the shape expected by extractToolResults
            const userMessage = message as {
              type: string;
              message?: { content?: unknown };
              tool_use_result?: unknown;
            };
            const toolResults = extractToolResults(userMessage);
            for (const toolResult of toolResults) {
              // Look up the matching tool_use for name, input, and timing
              const toolUse = toolResult.toolUseId
                ? pendingToolUses.get(toolResult.toolUseId)
                : undefined;
              if (toolResult.toolUseId) {
                pendingToolUses.delete(toolResult.toolUseId);
              }

              const embed = this.buildToolEmbed(
                toolUse ?? null,
                toolResult,
                outputConfig.tool_result_max_length,
              );

              // Flush any buffered text before sending embed to preserve ordering
              await streamer.flush();
              await event.reply({ embeds: [embed] });
              embedsSent++;
            }
          }

          // Show system status messages (e.g., "compacting context...")
          if (message.type === "system" && outputConfig.system_status) {
            const sysMessage = message as { subtype?: string; status?: string | null };
            if (sysMessage.subtype === "status" && sysMessage.status) {
              const statusText =
                sysMessage.status === "compacting"
                  ? "Compacting context..."
                  : `Status: ${sysMessage.status}`;
              await streamer.flush();
              await event.reply({
                embeds: [
                  {
                    title: "\u2699\uFE0F System",
                    description: statusText,
                    color: DiscordManager.EMBED_COLOR_SYSTEM,
                  },
                ],
              });
              embedsSent++;
            }
          }

          // Show result summary embed (cost, tokens, turns)
          if (message.type === "result" && outputConfig.result_summary) {
            const resultMessage = message as {
              is_error?: boolean;
              duration_ms?: number;
              total_cost_usd?: number;
              num_turns?: number;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            const fields: DiscordReplyEmbedField[] = [];

            if (resultMessage.duration_ms !== undefined) {
              fields.push({
                name: "Duration",
                value: DiscordManager.formatDuration(resultMessage.duration_ms),
                inline: true,
              });
            }

            if (resultMessage.num_turns !== undefined) {
              fields.push({
                name: "Turns",
                value: String(resultMessage.num_turns),
                inline: true,
              });
            }

            if (resultMessage.total_cost_usd !== undefined) {
              fields.push({
                name: "Cost",
                value: `$${resultMessage.total_cost_usd.toFixed(4)}`,
                inline: true,
              });
            }

            if (resultMessage.usage) {
              const inputTokens = resultMessage.usage.input_tokens ?? 0;
              const outputTokens = resultMessage.usage.output_tokens ?? 0;
              fields.push({
                name: "Tokens",
                value: `${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`,
                inline: true,
              });
            }

            const isError = resultMessage.is_error === true;
            await streamer.flush();
            await event.reply({
              embeds: [
                {
                  title: isError ? "\u274C Task Failed" : "\u2705 Task Complete",
                  color: isError
                    ? DiscordManager.EMBED_COLOR_ERROR
                    : DiscordManager.EMBED_COLOR_SUCCESS,
                  fields,
                },
              ],
            });
            embedsSent++;
          }

          // Show SDK error messages
          if (message.type === "error" && outputConfig.errors) {
            const errorText =
              typeof message.content === "string" ? message.content : "An unknown error occurred";
            await streamer.flush();
            await event.reply({
              embeds: [
                {
                  title: "\u274C Error",
                  description:
                    errorText.length > 4000 ? `${errorText.substring(0, 4000)}...` : errorText,
                  color: DiscordManager.EMBED_COLOR_ERROR,
                },
              ],
            });
            embedsSent++;
          }
        },
      });

      // Stop typing indicator immediately after SDK execution completes
      // This prevents the interval from firing during flush/session storage
      if (!typingStopped) {
        stopTyping();
        typingStopped = true;
      }

      // Flush any remaining buffered content
      await streamer.flush();

      logger.debug(
        `Discord job completed: ${result.jobId} for agent '${qualifiedName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`,
      );

      // If no messages were sent (text or embeds), send an appropriate fallback
      if (!streamer.hasSentMessages() && embedsSent === 0) {
        if (result.success) {
          await event.reply(
            "I've completed the task, but I don't have a specific response to share.",
          );
        } else {
          // Job failed without streaming any messages - send error details
          const errorMessage =
            result.errorDetails?.message ?? result.error?.message ?? "An unknown error occurred";
          await event.reply(
            `\u274C **Error:** ${errorMessage}\n\nThe task could not be completed. Please check the logs for more details.`,
          );
        }

        // Stop typing after sending fallback message (if not already stopped)
        if (!typingStopped) {
          stopTyping();
          typingStopped = true;
        }
      }

      // Store the SDK session ID for future conversation continuity
      // Only store if the job succeeded - failed jobs may return invalid session IDs
      if (connector && result.sessionId && result.success) {
        try {
          await connector.sessionManager.setSession(event.metadata.channelId, result.sessionId);
          logger.debug(
            `Stored session ${result.sessionId} for channel ${event.metadata.channelId}`,
          );
        } catch (sessionError) {
          const errorMessage =
            sessionError instanceof Error ? sessionError.message : String(sessionError);
          logger.warn(`Failed to store session: ${errorMessage}`);
          // Don't fail the message handling for session storage failure
        }
      } else if (connector && result.sessionId && !result.success) {
        logger.debug(
          `Not storing session ${result.sessionId} for channel ${event.metadata.channelId} - job failed`,
        );
      }

      // Emit event for tracking
      emitter.emit("discord:message:handled", {
        agentName: qualifiedName,
        channelId: event.metadata.channelId,
        messageId: event.metadata.messageId,
        jobId: result.jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Discord message handling failed for agent '${qualifiedName}': ${err.message}`);

      // Send user-friendly error message using the formatted error method
      try {
        await event.reply(this.formatErrorMessage(err));
      } catch (replyError) {
        logger.error(`Failed to send error reply: ${(replyError as Error).message}`);
      }

      // Emit error event for tracking
      emitter.emit("discord:message:error", {
        agentName: qualifiedName,
        channelId: event.metadata.channelId,
        messageId: event.metadata.messageId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      // Safety net: stop typing indicator if not already stopped
      // (Should already be stopped after sending messages, but this ensures cleanup on errors)
      if (!typingStopped) {
        stopTyping();
      }
    }
  }

  // =============================================================================
  // Tool Embed Support
  // =============================================================================

  /** Maximum characters for tool output in Discord embed fields */
  private static readonly TOOL_OUTPUT_MAX_CHARS = 900;

  /** Embed colors */
  private static readonly EMBED_COLOR_DEFAULT = 0x5865f2; // Discord blurple
  private static readonly EMBED_COLOR_ERROR = 0xef4444; // Red
  private static readonly EMBED_COLOR_SYSTEM = 0x95a5a6; // Gray
  private static readonly EMBED_COLOR_SUCCESS = 0x57f287; // Green

  /**
   * Format duration in milliseconds to a human-readable string
   */
  private static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  /**
   * Build a Discord embed for a tool call result
   *
   * Combines the tool_use info (name, input) with the tool_result
   * (output, error status) into a compact Discord embed.
   *
   * @param toolUse - The tool_use block info (name, input, startTime)
   * @param toolResult - The tool result (output, isError)
   * @param maxOutputChars - Maximum characters for output (defaults to TOOL_OUTPUT_MAX_CHARS)
   */
  private buildToolEmbed(
    toolUse: { name: string; input?: unknown; startTime: number } | null,
    toolResult: { output: string; isError: boolean },
    maxOutputChars?: number,
  ): DiscordReplyEmbed {
    const toolName = toolUse?.name ?? "Tool";
    const emoji = TOOL_EMOJIS[toolName] ?? "\u{1F527}"; // wrench fallback
    const isError = toolResult.isError;

    // Build description from input summary
    const inputSummary = toolUse ? getToolInputSummary(toolUse.name, toolUse.input) : undefined;
    let description: string | undefined;
    if (inputSummary) {
      if (toolName === "Bash" || toolName === "bash") {
        description = `\`> ${inputSummary}\``;
      } else {
        description = `\`${inputSummary}\``;
      }
    }

    // Build inline fields
    const fields: DiscordReplyEmbedField[] = [];

    if (toolUse) {
      const durationMs = Date.now() - toolUse.startTime;
      fields.push({
        name: "Duration",
        value: DiscordManager.formatDuration(durationMs),
        inline: true,
      });
    }

    const outputLength = toolResult.output.length;
    fields.push({
      name: "Output",
      value:
        outputLength >= 1000
          ? `${(outputLength / 1000).toFixed(1)}k chars`
          : `${outputLength} chars`,
      inline: true,
    });

    // Add truncated output as a field if non-empty
    const trimmedOutput = toolResult.output.trim();
    if (trimmedOutput.length > 0) {
      const maxChars = maxOutputChars ?? DiscordManager.TOOL_OUTPUT_MAX_CHARS;
      let outputText = trimmedOutput;
      if (outputText.length > maxChars) {
        outputText =
          outputText.substring(0, maxChars) +
          `\n... (${outputLength.toLocaleString()} chars total)`;
      }
      fields.push({
        name: isError ? "Error" : "Result",
        value: `\`\`\`\n${outputText}\n\`\`\``,
        inline: false,
      });
    }

    return {
      title: `${emoji} ${toolName}`,
      description,
      color: isError ? DiscordManager.EMBED_COLOR_ERROR : DiscordManager.EMBED_COLOR_DEFAULT,
      fields,
    };
  }

  /**
   * Handle errors from Discord connectors
   *
   * Logs errors without crashing the connector
   *
   * @param qualifiedName - Qualified name of the agent that encountered the error
   * @param error - The error that occurred
   */
  private handleError(qualifiedName: string, error: unknown): void {
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Discord connector error for agent '${qualifiedName}': ${errorMessage}`);

    // Emit error event for monitoring
    emitter.emit("discord:error", {
      agentName: qualifiedName,
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
    return `\u274C **Error**: ${error.message}\n\nPlease try again or use \`/reset\` to start a new session.`;
  }

  /**
   * Split a response into chunks that fit Discord's 2000 character limit
   *
   * Uses the shared splitMessage utility from @herdctl/chat.
   *
   * @param text - The text to split
   * @returns Array of text chunks, each under 2000 characters
   */
  splitResponse(text: string): string[] {
    const result = splitMessage(text, { maxLength: DiscordManager.MAX_MESSAGE_LENGTH });
    return result.chunks;
  }

  /**
   * Send a response to Discord, splitting if necessary
   *
   * @param reply - The reply function from the message event
   * @param content - The content to send
   */
  async sendResponse(reply: (content: string) => Promise<void>, content: string): Promise<void> {
    const chunks = this.splitResponse(content);

    for (const chunk of chunks) {
      await reply(chunk);
    }
  }
}
