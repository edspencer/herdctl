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

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  type ChatConnectorLogger,
  ChatSessionManager,
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
  type FileSenderContext,
  getToolInputSummary,
  type SDKMessage,
  TOOL_EMOJIS,
} from "@herdctl/core";

import { DiscordConnector } from "./discord-connector.js";
import {
  buildErrorEmbed,
  buildResultSummaryEmbed,
  buildRunCardEmbed,
  buildStatusEmbed,
  buildToolResultEmbed,
} from "./embeds.js";
import { formatContextForPrompt } from "./mention-handler.js";
import { normalizeDiscordMessage } from "./message-normalizer.js";
import type {
  DiscordAttachmentInfo,
  DiscordConnectorEventMap,
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
 * Minimal text-channel shape used when constructing synthetic message events
 * (e.g. for /retry). Avoids coupling to the full discord.js Channel type.
 */
type SyntheticMessageRef = {
  edit: (content: string | DiscordReplyPayload) => Promise<void>;
  delete: () => Promise<void>;
};
type SyntheticTextChannel = {
  send: (content: string | DiscordReplyPayload) => Promise<SyntheticMessageRef>;
  sendTyping?: () => Promise<void>;
};

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
  private activeJobsByChannel: Map<string, string> = new Map();
  private lastPromptByChannel: Map<string, string> = new Map();
  private lastUsageByChannel: Map<
    string,
    {
      timestamp: string;
      numTurns?: number;
      durationMs?: number;
      totalCostUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
      isError?: boolean;
    }
  > = new Map();
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
          commandActions: {
            stopRun: (channelId: string) => this.stopChannelRun(agent.qualifiedName, channelId),
            retryRun: (channelId: string) => this.retryChannelRun(agent.qualifiedName, channelId),
            runSkill: (channelId: string, skillName: string, input?: string) =>
              this.runChannelSkill(agent.qualifiedName, channelId, skillName, input),
            listSkills: async () => this.discoverAgentSkills(agent),
            getUsage: async (channelId: string) =>
              this.getChannelUsage(agent.qualifiedName, channelId),
            getAgentConfig: async () => this.getAgentConfigSummary(agent),
            getSessionInfo: async (channelId: string) =>
              this.getChannelRunInfo(agent.qualifiedName, channelId),
          },
          commandRegistration: discordConfig.command_registration
            ? {
                scope: discordConfig.command_registration.scope,
                guildId: discordConfig.command_registration.guild_id,
              }
            : { scope: "global" },
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
    this.lastPromptByChannel.set(
      this.getChannelKey(qualifiedName, event.metadata.channelId),
      event.prompt,
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

    // Buffer for files uploaded by the agent via MCP tool.
    // Files are queued here and attached to the next answer message,
    // so they appear below the text (not as standalone messages above it).
    const pendingFiles: Array<{ buffer: Buffer; filename: string }> = [];

    // Create file sender definition for this message context
    let injectedMcpServers: Record<string, InjectedMcpServerDef> | undefined;
    const workingDir = this.resolveWorkingDirectory(agent);
    if (connector && workingDir) {
      const fileSenderContext: FileSenderContext = {
        workingDirectory: workingDir,
        uploadFile: async (params) => {
          // Queue the file — it will be attached to the next answer message
          pendingFiles.push({
            buffer: params.fileBuffer,
            filename: params.filename,
          });
          const fileId = `buffered-${randomUUID()}`;
          logger.debug(`Buffered file '${params.filename}' for attachment to next answer message`);
          return { fileId };
        },
      };
      const fileSenderDef = createFileSenderDef(fileSenderContext);
      injectedMcpServers = { [fileSenderDef.name]: fileSenderDef };
    }

    // Create streaming responder for incremental message delivery.
    // The reply closure drains pending files and attaches them to the message.
    const streamer = new StreamingResponder({
      reply: async (content: string) => {
        if (pendingFiles.length > 0) {
          const files = pendingFiles.splice(0);
          await event.reply({
            content,
            files: files.map((f) => ({ attachment: f.buffer, name: f.filename })),
          });
        } else {
          await event.reply(content);
        }
      },
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

    // Add acknowledgement reaction if configured (non-fatal — don't abort message handling)
    const ackEmoji = outputConfig.acknowledge_emoji;
    if (ackEmoji) {
      try {
        await event.addReaction(ackEmoji);
      } catch (reactionError) {
        logger.warn(`Failed to add ack reaction: ${(reactionError as Error).message}`);
      }
    }

    // Attachment state — declared here so the finally block can clean up
    let attachmentDownloadedPaths: string[] = [];
    const attachmentConfig = agent.chat?.discord?.attachments;

    // Progress embed state — declared here so the finally block can clean up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressState: {
      handle: { edit: (c: any) => Promise<void>; delete: () => Promise<void> } | null;
    } = { handle: null };
    const traceLines: string[] = [];

    const pushTraceLine = (line: string) => {
      traceLines.push(line);
      if (traceLines.length > 24) {
        traceLines.splice(0, traceLines.length - 24);
      }
    };

    try {
      // Handle voice messages: transcribe audio before triggering the agent
      let prompt = event.prompt;
      if (!existingSessionId && event.context.messages.length > 0) {
        const priorContext = formatContextForPrompt(event.context);
        if (priorContext) {
          prompt = [
            "Recent conversation context from this Discord channel:",
            priorContext,
            "",
            `Current user message: ${prompt}`,
          ].join("\n");
        }
      }

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
          const audioResponse = await fetch(event.metadata.voiceAttachmentUrl, {
            signal: AbortSignal.timeout(30_000),
          });
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

          prompt = `[Voice message transcription]: ${transcription.text}`;
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
      let sentAnswer = false;
      let streamedDeltaSinceFinal = false;

      // Progress indicator: track tool names for in-place-updating embed
      const toolNamesRun: string[] = [];
      let lastProgressUpdate = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let liveAnswerHandle: { edit: (c: any) => Promise<void> } | null = null;
      let liveAnswerText = "";
      let latestStatusText = "Preparing run…";

      const refreshRunCard = async (status: "running" | "success" | "error") => {
        if (!showProgressIndicator) {
          return;
        }
        const now = Date.now();
        if (status === "running" && now - lastProgressUpdate < 1500) {
          return;
        }
        lastProgressUpdate = now;
        const header =
          toolNamesRun.length > 0 ? `Running · ${toolNamesRun.join("  →  ")}` : "Running";
        const message = status === "running" ? `${header}\n${latestStatusText}` : latestStatusText;
        const embedPayload = {
          embeds: [
            buildRunCardEmbed({
              agentName: qualifiedName,
              status,
              message: message.length > 4000 ? `…${message.slice(-3997)}` : message,
              traceLines,
            }),
          ],
        };
        try {
          if (!progressState.handle) {
            progressState.handle = await event.replyWithRef(embedPayload);
          } else {
            await progressState.handle.edit(embedPayload);
          }
        } catch (progressError) {
          logger.warn(`Failed to update run card: ${(progressError as Error).message}`);
        }
      };

      const showToolResults = outputConfig.tool_results;
      const enableDeltaStreaming = assistantMessages === "all";

      // Execute job via FleetManager.trigger() through the context
      // Pass resume option for conversation continuity
      // The onMessage callback streams output incrementally to Discord
      const result = await this.ctx.trigger(qualifiedName, undefined, {
        triggerType: "discord",
        prompt,
        resume: existingSessionId,
        injectedMcpServers,
        onJobCreated: async (jobId) => {
          this.activeJobsByChannel.set(
            this.getChannelKey(qualifiedName, event.metadata.channelId),
            jobId,
          );
        },
        onMessage: async (message) => {
          for (const normalized of normalizeDiscordMessage(message as SDKMessage)) {
            if (normalized.kind === "assistant_delta") {
              if (!enableDeltaStreaming) {
                continue;
              }

              streamedDeltaSinceFinal = true;
              liveAnswerText += normalized.delta;
              if (!liveAnswerText.trim()) {
                continue;
              }

              const payload = { content: liveAnswerText };
              try {
                if (!liveAnswerHandle) {
                  liveAnswerHandle = await event.replyWithRef(payload);
                } else {
                  await liveAnswerHandle.edit(payload);
                }
                sentAnswer = true;
              } catch (deltaError) {
                logger.warn(`Failed delta streaming update: ${(deltaError as Error).message}`);
              }
              continue;
            }

            if (normalized.kind === "assistant_final") {
              for (const block of normalized.toolUses) {
                if (block.id) {
                  pendingToolUses.set(block.id, {
                    name: block.name,
                    input: block.input,
                    startTime: Date.now(),
                  });
                }

                if (block.name && showProgressIndicator) {
                  const emoji = TOOL_EMOJIS[block.name] ?? "\u{1F527}";
                  const displayName = `${emoji} ${block.name}`;
                  toolNamesRun.push(displayName);
                  if (toolNamesRun.length > 50) {
                    toolNamesRun.splice(0, toolNamesRun.length - 50);
                  }
                  const inputSummary = getToolInputSummary(block.name, block.input);
                  pushTraceLine(
                    `${emoji} ${block.name}${inputSummary ? ` · ${inputSummary.slice(0, 60)}` : ""}`,
                  );
                  latestStatusText = `Executing ${block.name}`;
                  await refreshRunCard("running");
                }
              }

              if (normalized.messageId && normalized.stopReason === null) {
                continue;
              }
              if (normalized.messageId) {
                if (deliveredAssistantIds.has(normalized.messageId)) {
                  continue;
                }
                deliveredAssistantIds.add(normalized.messageId);
              }

              const content = normalized.content;
              if (!content) {
                streamedDeltaSinceFinal = false;
                continue;
              }

              if (assistantMessages === "answers") {
                if (normalized.toolUses.length === 0) {
                  await streamer.addMessageAndSend(content);
                  sentAnswer = true;
                }
              } else if (streamedDeltaSinceFinal && enableDeltaStreaming) {
                // Sync final content into the live delta message to avoid duplicates.
                liveAnswerText = content;
                try {
                  if (!liveAnswerHandle) {
                    liveAnswerHandle = await event.replyWithRef({ content });
                  } else {
                    await liveAnswerHandle.edit({ content });
                  }
                  sentAnswer = true;
                } catch (syncError) {
                  logger.warn(
                    `Failed to sync final streamed answer: ${(syncError as Error).message}`,
                  );
                  await streamer.addMessageAndSend(content);
                  sentAnswer = true;
                }
              } else {
                await streamer.addMessageAndSend(content);
                sentAnswer = true;
              }
              streamedDeltaSinceFinal = false;
              continue;
            }

            if (normalized.kind === "tool_results" && showToolResults) {
              for (const toolResult of normalized.results) {
                const toolUse = toolResult.toolUseId
                  ? pendingToolUses.get(toolResult.toolUseId)
                  : undefined;
                if (toolResult.toolUseId) {
                  pendingToolUses.delete(toolResult.toolUseId);
                }
                const toolName = toolUse?.name ?? "Tool";
                const output = toolResult.output.trim();
                const preview = output.length > 0 ? output.replace(/\s+/g, " ").slice(0, 90) : "";
                pushTraceLine(
                  `${toolResult.isError ? "✖" : "✓"} ${toolName}${preview ? ` · ${preview}` : ""}`,
                );
                latestStatusText = `${toolResult.isError ? "Error from" : "Completed"} ${toolName}`;
                await refreshRunCard("running");

                // Oversized output is attached as a file instead of flooding chat.
                const maxOutputChars = outputConfig.tool_result_max_length ?? 900;
                if (output.length > maxOutputChars) {
                  await streamer.flush();
                  const filename = `${toolName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "tool"}-output.txt`;
                  const previewEmbed = buildToolResultEmbed({
                    toolUse: toolUse ?? null,
                    toolResult: {
                      output: output.slice(0, Math.min(300, maxOutputChars)),
                      isError: toolResult.isError,
                    },
                    agentName: qualifiedName,
                    maxOutputChars: Math.min(300, maxOutputChars),
                  });
                  await event.reply({
                    embeds: [previewEmbed],
                    files: [{ attachment: Buffer.from(output, "utf8"), name: filename }],
                  });
                  embedsSent++;
                }
              }
              continue;
            }

            if (normalized.kind === "system_status" && outputConfig.system_status) {
              latestStatusText =
                normalized.status === "compacting" ? "Compacting context…" : normalized.status;
              pushTraceLine(`ℹ ${latestStatusText}`);
              await refreshRunCard("running");
              continue;
            }

            if (normalized.kind === "tool_progress" && outputConfig.system_status) {
              latestStatusText = normalized.content;
              pushTraceLine(`ℹ ${normalized.content}`);
              await refreshRunCard("running");
              continue;
            }

            if (normalized.kind === "auth_status" && outputConfig.system_status) {
              latestStatusText = normalized.content;
              pushTraceLine(`${normalized.isError ? "✖" : "ℹ"} ${normalized.content}`);
              if (normalized.isError) {
                await streamer.flush();
                await event.reply({
                  embeds: [buildStatusEmbed(normalized.content, "error", qualifiedName)],
                });
                embedsSent++;
              } else {
                await refreshRunCard("running");
              }
              continue;
            }

            if (normalized.kind === "result") {
              if (normalized.resultText) {
                resultText = normalized.resultText;
              }
              this.lastUsageByChannel.set(
                this.getChannelKey(qualifiedName, event.metadata.channelId),
                {
                  timestamp: new Date().toISOString(),
                  numTurns: normalized.numTurns,
                  durationMs: normalized.durationMs,
                  totalCostUsd: normalized.totalCostUsd,
                  inputTokens: normalized.usage?.input_tokens,
                  outputTokens: normalized.usage?.output_tokens,
                  isError: normalized.isError,
                },
              );
              latestStatusText = normalized.isError ? "Task failed" : "Task complete";
              await refreshRunCard(normalized.isError ? "error" : "success");

              if (outputConfig.result_summary) {
                await streamer.flush();
                await event.reply({
                  embeds: [
                    buildResultSummaryEmbed({
                      agentName: qualifiedName,
                      isError: normalized.isError,
                      durationMs: normalized.durationMs,
                      numTurns: normalized.numTurns,
                      totalCostUsd: normalized.totalCostUsd,
                      usage: normalized.usage,
                    }),
                  ],
                });
                embedsSent++;
              }
              continue;
            }

            if (normalized.kind === "error" && outputConfig.errors) {
              await streamer.flush();
              await event.reply({
                embeds: [buildErrorEmbed(normalized.message, qualifiedName)],
              });
              embedsSent++;
            }
          }
        },
      });

      // Stop typing indicator immediately after SDK execution completes
      // This prevents the interval from firing during flush/session storage
      if (!typingStopped) {
        stopTyping();
        typingStopped = true;
      }

      // Fall back to SDK result text if no answer turns produced text
      if (!sentAnswer && !streamer.hasSentMessages() && resultText) {
        logger.debug("No answer turns produced text — using SDK result text as fallback");
        await streamer.addMessageAndSend(resultText);
        sentAnswer = true;
      }

      // Flush any remaining buffered content
      await streamer.flush();

      // Send any remaining buffered files that weren't attached to an answer.
      // This handles the case where the agent uploaded files but produced no text answer.
      if (pendingFiles.length > 0) {
        const files = pendingFiles.splice(0);
        logger.debug(`Sending ${files.length} remaining buffered file(s) as standalone message`);
        await event.reply({
          files: files.map((f) => ({ attachment: f.buffer, name: f.filename })),
        });
      }

      logger.debug(
        `Discord job completed: ${result.jobId} for agent '${qualifiedName}'${result.sessionId ? ` (session: ${result.sessionId})` : ""}`,
      );

      if (progressState.handle) {
        try {
          await progressState.handle.edit({
            embeds: [
              buildRunCardEmbed({
                agentName: qualifiedName,
                status: result.success ? "success" : "error",
                message: result.success ? "Task complete" : "Task failed",
                traceLines,
              }),
            ],
          });
        } catch (progressError) {
          logger.warn(`Failed to finalize run card: ${(progressError as Error).message}`);
        }
      }

      // If no text messages were sent, send an appropriate fallback.
      // When embedsSent > 0 but no text was delivered, the user saw tool/result embeds
      // but may have missed the final answer. Show a brief completion indicator.
      if (!sentAnswer && !streamer.hasSentMessages() && embedsSent === 0) {
        if (result.success) {
          await event.reply({
            embeds: [
              buildStatusEmbed(
                "Task completed — no additional output to share.",
                "info",
                qualifiedName,
              ),
            ],
          });
        } else {
          // Job failed without streaming any messages - send error details
          const errorMessage =
            result.errorDetails?.message ?? result.error?.message ?? "An unknown error occurred";
          await event.reply({
            embeds: [
              buildErrorEmbed(`${errorMessage}\n\nThe task could not be completed.`, qualifiedName),
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

      if (progressState.handle) {
        try {
          await progressState.handle.edit({
            embeds: [
              buildRunCardEmbed({
                agentName: qualifiedName,
                status: "error",
                message: `Task failed · ${err.message}`,
                traceLines,
              }),
            ],
          });
        } catch (progressError) {
          logger.warn(`Failed to finalize failed run card: ${(progressError as Error).message}`);
        }
      }

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
      this.activeJobsByChannel.delete(this.getChannelKey(qualifiedName, event.metadata.channelId));
      // Safety net: stop typing indicator if not already stopped
      // (Should already be stopped after sending messages, but this ensures cleanup on errors)
      if (!typingStopped) {
        stopTyping();
      }
      // Remove acknowledgement reaction now that processing is complete
      if (ackEmoji) {
        try {
          await event.removeReaction(ackEmoji);
        } catch (reactionError) {
          logger.warn(`Failed to remove ack reaction: ${(reactionError as Error).message}`);
        }
      }
      // Clean up downloaded attachment files if configured
      if (
        attachmentDownloadedPaths.length > 0 &&
        attachmentConfig?.cleanup_after_processing !== false
      ) {
        try {
          await DiscordManager.cleanupAttachments(
            attachmentDownloadedPaths,
            logger as ChatConnectorLogger,
          );
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup attachments: ${(cleanupError as Error).message}`);
        }
      }
    }
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

  private getChannelKey(qualifiedName: string, channelId: string): string {
    return `${qualifiedName}:${channelId}`;
  }

  private async stopChannelRun(
    qualifiedName: string,
    channelId: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const key = this.getChannelKey(qualifiedName, channelId);
    const jobId = this.activeJobsByChannel.get(key);
    if (!jobId) {
      return {
        success: false,
        message: "No active run found for this channel.",
      };
    }

    try {
      const fleetManager = this.ctx.getEmitter() as unknown as import("@herdctl/core").FleetManager;
      await fleetManager.cancelJob(jobId);
      this.activeJobsByChannel.delete(key);
      return {
        success: true,
        message: `Stop requested for job \`${jobId}\`.`,
        jobId,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to stop active run: ${(error as Error).message}`,
        jobId,
      };
    }
  }

  private async retryChannelRun(
    qualifiedName: string,
    channelId: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const key = this.getChannelKey(qualifiedName, channelId);
    const lastPrompt = this.lastPromptByChannel.get(key);
    if (!lastPrompt) {
      return {
        success: false,
        message: "No previous prompt found to retry in this channel.",
      };
    }
    return this.runChannelPrompt(qualifiedName, channelId, lastPrompt);
  }

  // ===========================================================================
  // Synthetic Event Helpers
  // ===========================================================================

  private toTextChannel(channel: { send?: unknown }): SyntheticTextChannel {
    return channel as unknown as SyntheticTextChannel;
  }

  /**
   * Build a DiscordMessageEvent from scratch for programmatic triggers
   * (e.g. /retry). This keeps the boilerplate in one place so any new
   * fields on DiscordMessageEvent only need updating here.
   */
  private createSyntheticMessageEvent(params: {
    qualifiedName: string;
    prompt: string;
    channelId: string;
    channel: { isDMBased?: () => boolean; guildId?: string };
    textChannel: SyntheticTextChannel;
    logger: { debug: (msg: string) => void };
  }): DiscordMessageEvent {
    const { qualifiedName, prompt, channelId, channel, textChannel, logger } = params;
    return {
      agentName: qualifiedName,
      prompt,
      context: {
        messages: [],
        prompt,
        wasMentioned: false,
      },
      metadata: {
        guildId:
          typeof channel.isDMBased === "function" && channel.isDMBased()
            ? null
            : typeof channel.guildId === "string"
              ? channel.guildId
              : null,
        channelId,
        messageId: `synthetic-${randomUUID()}`,
        userId: "system",
        username: "system",
        wasMentioned: false,
        mode: "auto" as const,
      },
      reply: async (content: string | DiscordReplyPayload): Promise<void> => {
        await textChannel.send(content);
      },
      replyWithRef: async (
        content: string | DiscordReplyPayload,
      ): Promise<{
        edit: (c: string | DiscordReplyPayload) => Promise<void>;
        delete: () => Promise<void>;
      }> => {
        const sent = await textChannel.send(content);
        return {
          edit: async (c: string | DiscordReplyPayload) => {
            await sent.edit(c);
          },
          delete: async () => {
            await sent.delete();
          },
        };
      },
      startTyping: (): (() => void) => {
        let typingInterval: ReturnType<typeof setInterval> | null = null;
        if (textChannel.sendTyping) {
          void textChannel.sendTyping().catch((err: unknown) => {
            logger.debug(`Synthetic typing indicator failed: ${(err as Error).message}`);
          });
          typingInterval = setInterval(() => {
            void textChannel.sendTyping?.().catch((err: unknown) => {
              logger.debug(`Synthetic typing refresh failed: ${(err as Error).message}`);
            });
          }, 8000);
        }
        return () => {
          if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
          }
        };
      },
      addReaction: async () => {},
      removeReaction: async () => {},
    } as DiscordMessageEvent;
  }

  private async getChannelRunInfo(
    qualifiedName: string,
    channelId: string,
  ): Promise<{ activeJobId?: string; lastPrompt?: string }> {
    const key = this.getChannelKey(qualifiedName, channelId);
    return {
      activeJobId: this.activeJobsByChannel.get(key),
      lastPrompt: this.lastPromptByChannel.get(key),
    };
  }

  private async getChannelUsage(
    qualifiedName: string,
    channelId: string,
  ): Promise<{
    timestamp: string;
    numTurns?: number;
    durationMs?: number;
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    isError?: boolean;
  } | null> {
    return this.lastUsageByChannel.get(this.getChannelKey(qualifiedName, channelId)) ?? null;
  }

  private async runChannelSkill(
    qualifiedName: string,
    channelId: string,
    skillName: string,
    input?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const instruction = [
      `Use the "${skillName}" skill to handle this request.`,
      "",
      input?.trim() ? input.trim() : "No additional input was provided.",
    ].join("\n");
    const result = await this.runChannelPrompt(qualifiedName, channelId, instruction);
    if (result.success) {
      return {
        ...result,
        message: `Skill \`${skillName}\` started. Output will be posted in this channel.`,
      };
    }
    return result;
  }

  private async runChannelPrompt(
    qualifiedName: string,
    channelId: string,
    prompt: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const logger = this.ctx.getLogger();
    const key = this.getChannelKey(qualifiedName, channelId);
    const activeJobId = this.activeJobsByChannel.get(key);
    if (activeJobId) {
      return {
        success: false,
        message: `A run is already active in this channel (\`${activeJobId}\`).`,
        jobId: activeJobId,
      };
    }

    const connector = this.connectors.get(qualifiedName);
    if (!connector?.client?.isReady()) {
      return {
        success: false,
        message: "Run cannot start because the Discord connector is not connected.",
      };
    }

    const channel = await connector.client.channels.fetch(channelId);
    if (
      !channel ||
      !("isTextBased" in channel) ||
      typeof channel.isTextBased !== "function" ||
      !channel.isTextBased() ||
      !("send" in channel) ||
      typeof channel.send !== "function"
    ) {
      return {
        success: false,
        message: "Run failed because this channel is not text-capable.",
      };
    }

    const textChannel = this.toTextChannel(channel);
    const syntheticEvent = this.createSyntheticMessageEvent({
      qualifiedName,
      prompt,
      channelId,
      channel,
      textChannel,
      logger,
    });

    this.lastPromptByChannel.set(key, prompt);
    void this.handleMessage(qualifiedName, syntheticEvent)
      .catch(async (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Background slash run failed for '${qualifiedName}': ${err.message}`);
        try {
          await textChannel.send(this.formatErrorMessage(err, qualifiedName));
        } catch (replyError) {
          logger.error(`Failed to send slash failure message: ${(replyError as Error).message}`);
        }
      })
      .finally(() => {
        this.activeJobsByChannel.delete(key);
      });

    return {
      success: true,
      message: "Run started. Output will be posted in this channel.",
    };
  }

  private async discoverAgentSkills(
    agent: ResolvedAgent,
  ): Promise<Array<{ name: string; description?: string }>> {
    const roots: string[] = [];
    if (agent.working_directory) {
      roots.push(
        typeof agent.working_directory === "string"
          ? agent.working_directory
          : agent.working_directory.root,
      );
    }
    roots.push(process.cwd());

    const codexHome = process.env.CODEX_HOME;
    if (codexHome) {
      roots.push(codexHome);
    } else {
      roots.push(join(homedir(), ".codex"));
    }

    const candidateDirs = roots.flatMap((root) => [
      join(root, ".codex", "skills"),
      join(root, "skills"),
    ]);
    const discovered = new Map<string, { name: string; description?: string }>();

    for (const dir of candidateDirs) {
      try {
        const entries = await readdir(resolve(dir), { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillName = entry.name;
          const skillPath = join(dir, skillName, "SKILL.md");
          try {
            const raw = await readFile(skillPath, "utf8");
            const lines = raw.split("\n").map((line) => line.trim());
            const description =
              lines.find((line) => line.length > 0 && !line.startsWith("#"))?.slice(0, 120) ??
              undefined;
            discovered.set(skillName, { name: skillName, description });
          } catch {
            // Ignore directories without readable SKILL.md
          }
        }
      } catch {
        // Directory does not exist or is unreadable; skip.
      }
    }

    return Array.from(discovered.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async getAgentConfigSummary(agent: ResolvedAgent): Promise<{
    runtime?: string;
    model?: string;
    permissionMode?: string;
    workingDirectory?: string;
    allowedTools?: string[];
    deniedTools?: string[];
    mcpServers?: string[];
  }> {
    return {
      runtime: agent.runtime,
      model: agent.model,
      permissionMode: agent.permission_mode,
      workingDirectory:
        typeof agent.working_directory === "string"
          ? agent.working_directory
          : agent.working_directory?.root,
      allowedTools: agent.allowed_tools,
      deniedTools: agent.denied_tools,
      mcpServers: agent.mcp_servers ? Object.keys(agent.mcp_servers) : [],
    };
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
          buildErrorEmbed(
            `${error.message}\n\nTry again or use \`/reset\` to start a new session.`,
            agentName,
          ),
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

    // Create one collision-resistant directory per message processing run.
    const messageDownloadDir = randomUUID();

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
          const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
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
          const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const downloadDir = join(workingDir, config.download_dir, messageDownloadDir);
          await mkdir(downloadDir, { recursive: true });
          const filePath = join(downloadDir, `${attachment.id}-${basename(attachment.name)}`);
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
        const parent = dirname(filePath);
        if (parent !== filePath && parent !== ".") {
          parentDirs.add(parent);
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
