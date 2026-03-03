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

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type ChatConnectorLogger,
  ChatSessionManager,
  extractMessageContent,
  formatCompactNumber,
  StreamingResponder,
  splitMessage,
} from "@herdctl/chat";
import type {
  ChatManagerConnectorState,
  DiscordAttachments,
  FleetManagerContext,
  IChatManager,
  InjectedMcpServerDef,
  ResolvedAgent,
} from "@herdctl/core";
import {
  createFileSenderDef,
  extractToolResults,
  extractToolUseBlocks,
  type FileSenderContext,
  getToolInputSummary,
  TOOL_EMOJIS,
} from "@herdctl/core";

import { DiscordConnector } from "./discord-connector.js";
import type {
  DiscordAttachmentInfo,
  DiscordConnectorEventMap,
  DiscordReplyEmbed,
  DiscordReplyEmbedField,
  DiscordReplyPayload,
} from "./types.js";
import { transcribeAudio } from "./voice-transcriber.js";

// =============================================================================
// Constants
// =============================================================================

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
      result_summary: true,
      errors: true,
      typing_indicator: true,
      acknowledge_emoji: "👀",
      assistant_messages: "answers" as const,
      progress_indicator: true,
    };

    // Resolve output modes
    const assistantMessages = outputConfig.assistant_messages ?? "answers";
    const showProgressIndicator = outputConfig.progress_indicator !== false;

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
      reply: (content: string) => event.reply(content),
      logger: logger as ChatConnectorLogger,
      agentName: qualifiedName,
      maxMessageLength: 2000, // Discord's limit
      maxBufferSize: 1500,
      platformName: "Discord",
    });

    // Start typing indicator while processing (if not disabled via output.typing_indicator)
    const stopTyping = outputConfig.typing_indicator !== false ? event.startTyping() : () => {};

    // Track if we've stopped typing to avoid multiple calls
    let typingStopped = false;

    // Add acknowledgement reaction if configured
    const ackEmoji = outputConfig.acknowledge_emoji;
    if (ackEmoji) {
      await event.addReaction(ackEmoji);
    }

    // Attachment state — declared here so the finally block can clean up
    let attachmentDownloadedPaths: string[] = [];
    const attachmentConfig = agent.chat?.discord?.attachments;

    try {
      // Handle voice messages: transcribe audio before triggering the agent
      let prompt = event.prompt;
      const voiceConfig = agent.chat?.discord?.voice;
      if (event.metadata.isVoiceMessage) {
        if (!voiceConfig?.enabled) {
          await event.reply(
            "Voice messages are not enabled for this agent. Please send a text message instead.",
          );
          return;
        }

        const apiKey = process.env[voiceConfig.api_key_env ?? "OPENAI_API_KEY"];
        if (!apiKey) {
          logger.error(
            `Voice transcription API key not found in env var '${voiceConfig.api_key_env}'`,
          );
          await event.reply(
            "Voice transcription is misconfigured. Please contact an administrator.",
          );
          return;
        }

        if (!event.metadata.voiceAttachmentUrl) {
          await event.reply("Could not find audio attachment in voice message.");
          return;
        }

        try {
          logger.debug("Downloading voice message audio...");
          const audioResponse = await fetch(event.metadata.voiceAttachmentUrl);
          if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.status}`);
          }
          const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
          const filename = event.metadata.voiceAttachmentName ?? "voice-message.ogg";

          logger.debug("Transcribing voice message...");
          const transcription = await transcribeAudio(audioBuffer, filename, {
            apiKey,
            model: voiceConfig.model,
            language: voiceConfig.language,
          });

          prompt = transcription.text;
          logger.info(`Voice message transcribed: "${prompt.substring(0, 80)}..."`);
        } catch (transcribeError) {
          const errMsg =
            transcribeError instanceof Error ? transcribeError.message : String(transcribeError);
          logger.error(`Voice transcription failed: ${errMsg}`);
          await event.reply(`Failed to transcribe voice message: ${errMsg}`);
          return;
        }
      }

      // Handle file attachments: download, process, and prepend to prompt
      if (
        event.metadata.attachments &&
        event.metadata.attachments.length > 0 &&
        attachmentConfig?.enabled
      ) {
        const result = await DiscordManager.processAttachments(
          event.metadata.attachments,
          attachmentConfig,
          workingDir,
          logger as ChatConnectorLogger,
        );
        attachmentDownloadedPaths = result.downloadedPaths;

        if (result.skippedFiles.length > 0) {
          for (const skipped of result.skippedFiles) {
            logger.debug(`Skipped attachment ${skipped.name}: ${skipped.reason}`);
          }
        }

        if (result.promptSections.length > 0) {
          const attachmentBlock = [
            "The user sent the following file attachment(s) with their message:",
            "",
            ...result.promptSections,
            "",
            "---",
            "",
            `User message: ${prompt}`,
          ].join("\n");
          prompt = attachmentBlock;
        }
      }

      // Track pending tool_use blocks so we can pair them with results
      const pendingToolUses = new Map<
        string,
        { name: string; input?: unknown; startTime: number }
      >();
      let embedsSent = 0;

      // Deduplicate assistant messages by finalized snapshot. Claude Code can emit
      // intermediate snapshots (stop_reason: null) before the final assistant message.
      // We skip intermediates and deliver the first finalized snapshot per message.id.
      const deliveredAssistantIds = new Set<string>();

      // Capture the result text from the SDK's "result" message as a fallback
      // When all assistant messages are tool-only (no text), this is the last resort
      let resultText: string | undefined;

      // Progress indicator: track tool names for in-place-updating embed
      interface ProgressEmbedHandle {
        edit: (content: string | DiscordReplyPayload) => Promise<void>;
        delete: () => Promise<void>;
      }
      const toolNamesRun: string[] = [];
      let progressEmbedHandle: ProgressEmbedHandle | null = null;
      let lastProgressUpdate = 0;

      const showToolResults = outputConfig.tool_results;

      // Execute job via FleetManager.trigger() through the context
      // Pass resume option for conversation continuity
      // The onMessage callback streams output incrementally to Discord
      const result = await this.ctx.trigger(qualifiedName, undefined, {
        triggerType: "discord",
        prompt,
        resume: existingSessionId,
        injectedMcpServers,
        onMessage: async (message) => {
          // Extract text content from assistant messages and stream to Discord
          if (message.type === "assistant") {
            // Cast to the SDKMessage shape expected by extractMessageContent
            // The chat package's SDKMessage type expects a specific structure
            const sdkMessage = message as unknown as Parameters<typeof extractMessageContent>[0];

            // Always track tool_use blocks (even from duplicate messages)
            // so tool results can be paired correctly
            const toolUseBlocks = extractToolUseBlocks(sdkMessage);
            for (const block of toolUseBlocks) {
              if (block.id) {
                pendingToolUses.set(block.id, {
                  name: block.name,
                  input: block.input,
                  startTime: Date.now(),
                });
              }

              // Track tool names for progress indicator
              if (block.name && showProgressIndicator) {
                const emoji = TOOL_EMOJIS[block.name] ?? "\u{1F527}";
                const displayName = `${emoji} ${block.name}`;
                toolNamesRun.push(displayName);

                // Update progress embed (throttled to every 2s)
                const now = Date.now();
                if (now - lastProgressUpdate >= 2000) {
                  lastProgressUpdate = now;
                  const description = toolNamesRun.join("  \u2192  ");
                  const embedPayload = {
                    embeds: [
                      {
                        description:
                          description.length > 4000
                            ? `\u2026${description.slice(-3997)}`
                            : description,
                        color: DiscordManager.EMBED_COLOR_WORKING,
                        footer: DiscordManager.buildFooter(qualifiedName),
                      },
                    ],
                  };

                  try {
                    if (!progressEmbedHandle) {
                      progressEmbedHandle = await event.replyWithRef(embedPayload);
                    } else {
                      await progressEmbedHandle.edit(embedPayload);
                    }
                  } catch (progressError) {
                    logger.warn(
                      `Failed to update progress embed: ${(progressError as Error).message}`,
                    );
                  }
                }
              }
            }

            // Deduplicate assistant messages by message.id.
            // Claude Code emits multiple JSONL lines per turn with the same id:
            // intermediate snapshots (stop_reason: null) may lack text content,
            // while the final (stop_reason: "end_turn") has the complete response.
            // Skip intermediates, deliver and deduplicate finals.
            const messageId = (message as { message?: { id?: string } }).message?.id;
            const stopReason = (message as { message?: { stop_reason?: unknown } }).message
              ?.stop_reason;
            if (messageId && stopReason === null) {
              return; // Skip intermediate snapshot — text may be incomplete
            }
            if (messageId) {
              if (deliveredAssistantIds.has(messageId)) {
                return;
              }
              deliveredAssistantIds.add(messageId);
            }

            const content = extractMessageContent(sdkMessage);
            if (content) {
              if (assistantMessages === "answers") {
                // Only send turns with no tool_use blocks (answer turns)
                if (toolUseBlocks.length === 0) {
                  await streamer.addMessageAndSend(content);
                }
              } else {
                // "all" mode: send every turn with text
                await streamer.addMessageAndSend(content);
              }
            }
          }

          // Build and send embeds for tool results
          if (message.type === "user" && showToolResults) {
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
                qualifiedName,
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
                sysMessage.status === "compacting" ? "Compacting context\u2026" : sysMessage.status;
              await streamer.flush();
              await event.reply({
                embeds: [
                  {
                    description: statusText,
                    color: DiscordManager.EMBED_COLOR_SYSTEM,
                  },
                ],
              });
              embedsSent++;
            }
          }

          // Capture result text from the SDK "result" message as a fallback answer.
          // This covers cases where all assistant messages were tool-only (no text blocks).
          if (message.type === "result") {
            const resultMsg = message as { result?: string };
            if (typeof resultMsg.result === "string" && resultMsg.result.trim()) {
              resultText = resultMsg.result;
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
            const isError = resultMessage.is_error === true;

            // Build compact summary: "**Task complete** in 45s · 3 turns · $0.0045 · 15.7k tokens"
            const summaryParts: string[] = [];
            summaryParts.push(isError ? "**Task failed**" : "**Task complete**");
            if (resultMessage.duration_ms !== undefined) {
              summaryParts[0] += ` in ${DiscordManager.formatDuration(resultMessage.duration_ms)}`;
            }
            if (resultMessage.num_turns !== undefined) {
              summaryParts.push(
                `${resultMessage.num_turns} turn${resultMessage.num_turns !== 1 ? "s" : ""}`,
              );
            }
            if (resultMessage.total_cost_usd !== undefined) {
              summaryParts.push(`$${resultMessage.total_cost_usd.toFixed(4)}`);
            }
            if (resultMessage.usage) {
              const total =
                (resultMessage.usage.input_tokens ?? 0) + (resultMessage.usage.output_tokens ?? 0);
              summaryParts.push(`${formatCompactNumber(total)} tokens`);
            }

            await streamer.flush();
            await event.reply({
              embeds: [
                {
                  description: summaryParts.join(" \u00b7 "),
                  color: isError
                    ? DiscordManager.EMBED_COLOR_ERROR
                    : DiscordManager.EMBED_COLOR_SUCCESS,
                  footer: DiscordManager.buildFooter(qualifiedName),
                  timestamp: new Date().toISOString(),
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
                  description: `**Error:** ${errorText.length > 4000 ? errorText.substring(0, 4000) + "\u2026" : errorText}`,
                  color: DiscordManager.EMBED_COLOR_ERROR,
                  footer: DiscordManager.buildFooter(qualifiedName),
                  timestamp: new Date().toISOString(),
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

      // Clean up progress embed now that the job is done
      // Note: progressEmbedHandle is assigned inside the onMessage async callback,
      // so TypeScript's control flow analysis sees it as always null.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if ((progressEmbedHandle as unknown as ProgressEmbedHandle | null) !== null) {
        try {
          await progressEmbedHandle!.delete();
        } catch (progressError) {
          logger.warn(`Failed to delete progress embed: ${(progressError as Error).message}`);
        }
      }

      // Fall back to SDK result text if no answer turns produced text
      if (!streamer.hasSentMessages() && resultText) {
        logger.debug("No answer turns produced text — using SDK result text as fallback");
        await streamer.addMessageAndSend(resultText);
      }

      // Flush any remaining buffered content
      await streamer.flush();

      logger.debug(
        `Discord job completed: ${result.jobId} for agent '${qualifiedName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`,
      );

      // If no text messages were sent, send an appropriate fallback.
      // When embedsSent > 0 but no text was delivered, the user saw tool/result embeds
      // but may have missed the final answer. Show a brief completion indicator.
      if (!streamer.hasSentMessages() && embedsSent === 0) {
        if (result.success) {
          await event.reply({
            embeds: [
              {
                description: "Task completed \u2014 no additional output to share.",
                color: DiscordManager.EMBED_COLOR_SUCCESS,
                footer: DiscordManager.buildFooter(qualifiedName),
              },
            ],
          });
        } else {
          // Job failed without streaming any messages - send error details
          const errorMessage =
            result.errorDetails?.message ?? result.error?.message ?? "An unknown error occurred";
          await event.reply({
            embeds: [
              {
                description: `**Error:** ${errorMessage}\n\nThe task could not be completed.`,
                color: DiscordManager.EMBED_COLOR_ERROR,
                footer: DiscordManager.buildFooter(qualifiedName),
                timestamp: new Date().toISOString(),
              },
            ],
          });
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
        await event.reply(this.formatErrorMessage(err, qualifiedName));
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
      // Remove acknowledgement reaction now that processing is complete
      if (ackEmoji) {
        await event.removeReaction(ackEmoji);
      }
      // Clean up downloaded attachment files if configured
      if (
        attachmentDownloadedPaths.length > 0 &&
        attachmentConfig?.cleanup_after_processing !== false
      ) {
        await DiscordManager.cleanupAttachments(
          attachmentDownloadedPaths,
          logger as ChatConnectorLogger,
        );
      }
    }
  }

  // =============================================================================
  // Tool Embed Support
  // =============================================================================

  /** Maximum characters for tool output in Discord embed fields */
  private static readonly TOOL_OUTPUT_MAX_CHARS = 900;

  /** Embed colors */
  private static readonly EMBED_COLOR_BRAND = 0x5865f2; // Discord blurple (tool results)
  private static readonly EMBED_COLOR_WORKING = 0x8b5cf6; // Soft violet (progress)
  private static readonly EMBED_COLOR_SUCCESS = 0x22c55e; // Emerald (completion)
  private static readonly EMBED_COLOR_ERROR = 0xef4444; // Red (errors)
  private static readonly EMBED_COLOR_SYSTEM = 0x6b7280; // Cool gray (system status)
  private static readonly EMBED_COLOR_INFO = 0x3b82f6; // Sky blue (slash commands)

  /**
   * Build a consistent footer for Discord embeds
   */
  private static buildFooter(agentName: string): { text: string } {
    const shortName = agentName.includes(".") ? agentName.split(".").pop()! : agentName;
    return { text: `herdctl \u00b7 ${shortName}` };
  }

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
   * (output, error status) into a compact Discord embed with a
   * single-line description and optional output field.
   *
   * @param toolUse - The tool_use block info (name, input, startTime)
   * @param toolResult - The tool result (output, isError)
   * @param maxOutputChars - Maximum characters for output (defaults to TOOL_OUTPUT_MAX_CHARS)
   * @param agentName - Agent name for the embed footer
   */
  private buildToolEmbed(
    toolUse: { name: string; input?: unknown; startTime: number } | null,
    toolResult: { output: string; isError: boolean },
    maxOutputChars?: number,
    agentName?: string,
  ): DiscordReplyEmbed {
    const toolName = toolUse?.name ?? "Tool";
    const emoji = TOOL_EMOJIS[toolName] ?? "\u{1F527}"; // wrench fallback

    // Build compact description: "💻 **Bash** `> ls -la` — 2s"
    const parts: string[] = [`${emoji} **${toolName}**`];
    const inputSummary = toolUse ? getToolInputSummary(toolUse.name, toolUse.input) : undefined;
    if (inputSummary) {
      const prefix = toolName === "Bash" || toolName === "bash" ? "> " : "";
      const truncated =
        inputSummary.length > 120 ? inputSummary.substring(0, 120) + "\u2026" : inputSummary;
      parts.push(`\`${prefix}${truncated}\``);
    }
    if (toolUse) {
      const durationMs = Date.now() - toolUse.startTime;
      parts.push(`\u2014 ${DiscordManager.formatDuration(durationMs)}`);
    }

    // Build output field if non-empty
    const fields: DiscordReplyEmbedField[] = [];
    const trimmedOutput = toolResult.output.trim();
    if (trimmedOutput.length > 0) {
      const maxChars = maxOutputChars ?? DiscordManager.TOOL_OUTPUT_MAX_CHARS;
      let outputText = trimmedOutput;
      if (outputText.length > maxChars) {
        outputText =
          outputText.substring(0, maxChars) +
          `\n\u2026 ${trimmedOutput.length.toLocaleString()} chars total`;
      }
      const lang = toolName === "Bash" || toolName === "bash" ? "ansi" : "";
      fields.push({
        name: toolResult.isError ? "Error" : "Output",
        value: `\`\`\`${lang}\n${outputText}\n\`\`\``,
        inline: false,
      });
    }

    return {
      description: parts.join(" "),
      color: toolResult.isError
        ? DiscordManager.EMBED_COLOR_ERROR
        : DiscordManager.EMBED_COLOR_BRAND,
      fields: fields.length > 0 ? fields : undefined,
      footer: agentName ? DiscordManager.buildFooter(agentName) : undefined,
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
   * Returns an embed when agentName is provided, plain text otherwise.
   *
   * @param error - The error that occurred
   * @param agentName - Optional agent name for embed footer
   * @returns Formatted error message string or embed payload
   */
  formatErrorMessage(error: Error, agentName?: string): string | DiscordReplyPayload {
    if (agentName) {
      return {
        embeds: [
          {
            description: `**Error:** ${error.message}\n\nTry again or use \`/reset\` to start a new session.`,
            color: DiscordManager.EMBED_COLOR_ERROR,
            footer: DiscordManager.buildFooter(agentName),
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    return `**Error:** ${error.message}\n\nTry again or use \`/reset\` to start a new session.`;
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

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Resolve the agent's working directory to an absolute path string
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

  // ===========================================================================
  // Attachment Processing
  // ===========================================================================

  /** Maximum characters to inline for text/code file content */
  private static readonly TEXT_INLINE_MAX_CHARS = 50_000;

  /**
   * Check if a content type matches a MIME pattern (supports wildcards like "image/*")
   */
  private static matchesMimePattern(contentType: string, pattern: string): boolean {
    const ct = contentType.toLowerCase().split(";")[0].trim();
    const pat = pattern.toLowerCase().trim();
    if (pat === ct) return true;
    if (pat.endsWith("/*")) {
      const prefix = pat.slice(0, -1); // "image/*" → "image/"
      return ct.startsWith(prefix);
    }
    return false;
  }

  /**
   * Process file attachments: download, categorize, and prepare prompt sections.
   *
   * - Text/code files are inlined directly into the prompt
   * - Images and PDFs are saved to disk so the agent can use its Read tool
   *
   * Returns prompt sections to prepend, paths of downloaded files for cleanup,
   * and a list of skipped files with reasons.
   */
  private static async processAttachments(
    attachments: DiscordAttachmentInfo[],
    config: DiscordAttachments,
    workingDir: string | undefined,
    logger: ChatConnectorLogger,
  ): Promise<{
    promptSections: string[];
    downloadedPaths: string[];
    skippedFiles: { name: string; reason: string }[];
  }> {
    const promptSections: string[] = [];
    const downloadedPaths: string[] = [];
    const skippedFiles: { name: string; reason: string }[] = [];
    const maxBytes = config.max_file_size_mb * 1024 * 1024;

    // Limit to max_files_per_message
    const toProcess = attachments.slice(0, config.max_files_per_message);
    if (attachments.length > config.max_files_per_message) {
      const skipped = attachments.slice(config.max_files_per_message);
      for (const a of skipped) {
        skippedFiles.push({ name: a.name, reason: "exceeded max_files_per_message" });
      }
    }

    // Create timestamp directory for binary downloads
    const timestamp = Date.now().toString();

    for (const attachment of toProcess) {
      // Check allowed types
      const allowed = config.allowed_types.some((pattern) =>
        DiscordManager.matchesMimePattern(attachment.contentType, pattern),
      );
      if (!allowed) {
        skippedFiles.push({
          name: attachment.name,
          reason: `type ${attachment.contentType} not in allowed_types`,
        });
        continue;
      }

      // Check file size
      if (attachment.size > maxBytes) {
        skippedFiles.push({
          name: attachment.name,
          reason: `size ${attachment.size} exceeds ${config.max_file_size_mb}MB limit`,
        });
        continue;
      }

      try {
        if (attachment.category === "text") {
          // Text/code: download and inline
          const response = await fetch(attachment.url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          let text = await response.text();
          if (text.length > DiscordManager.TEXT_INLINE_MAX_CHARS) {
            text = `${text.substring(0, DiscordManager.TEXT_INLINE_MAX_CHARS)}\n... [truncated at ${DiscordManager.TEXT_INLINE_MAX_CHARS} chars]`;
          }
          promptSections.push(
            `--- File: ${attachment.name} (${attachment.contentType}) ---\n${text}\n--- End of ${attachment.name} ---`,
          );
        } else {
          // Image/PDF: download to disk
          if (!workingDir) {
            skippedFiles.push({
              name: attachment.name,
              reason: "no working_directory configured for binary attachments",
            });
            continue;
          }
          const response = await fetch(attachment.url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const downloadDir = join(workingDir, config.download_dir, timestamp);
          await mkdir(downloadDir, { recursive: true });
          const filePath = join(downloadDir, attachment.name);
          await writeFile(filePath, buffer);
          downloadedPaths.push(filePath);

          const typeLabel = attachment.category === "image" ? "Image" : "PDF";
          promptSections.push(
            `[${typeLabel} attached: ${filePath}] (Use the Read tool to view this file)`,
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to process attachment ${attachment.name}: ${errMsg}`);
        skippedFiles.push({
          name: attachment.name,
          reason: `download/processing failed: ${errMsg}`,
        });
      }
    }

    return { promptSections, downloadedPaths, skippedFiles };
  }

  /**
   * Clean up downloaded attachment files after processing
   */
  private static async cleanupAttachments(
    paths: string[],
    logger: ChatConnectorLogger,
  ): Promise<void> {
    const parentDirs = new Set<string>();
    for (const filePath of paths) {
      try {
        await rm(filePath);
        // Track parent directory for cleanup
        const lastSlash = filePath.lastIndexOf("/");
        if (lastSlash > 0) {
          parentDirs.add(filePath.substring(0, lastSlash));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.debug(`Failed to clean up attachment file ${filePath}: ${errMsg}`);
      }
    }
    // Try to remove empty timestamp directories
    for (const dir of parentDirs) {
      try {
        await rm(dir, { recursive: true });
      } catch {
        // Directory may not be empty or already removed — ignore
      }
    }
  }
}
