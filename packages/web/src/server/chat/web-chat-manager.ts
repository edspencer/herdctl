/**
 * Web Chat Manager for @herdctl/web
 *
 * Manages chat sessions for the web platform using @herdctl/chat infrastructure.
 * Each web session maps to a unique conversation thread with an agent.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ChatConnectorLogger,
  ChatSessionManager,
  extractMessageContent,
  extractToolResults,
  extractToolUseBlocks,
  getToolInputSummary,
} from "@herdctl/chat";
import { createLogger, type FleetManager, type WebConfig } from "@herdctl/core";

const logger = createLogger("web:chat");

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a web chat session
 */
export interface WebChatSession {
  /** Unique session identifier */
  sessionId: string;
  /** Agent this session is for */
  agentName: string;
  /** ISO timestamp when the session was created */
  createdAt: string;
  /** ISO timestamp of the last message */
  lastMessageAt: string;
  /** Number of messages in this session */
  messageCount: number;
  /** Preview of the last message */
  preview?: string;
  /** Custom name set by user (takes precedence over preview) */
  customName?: string;
}

/**
 * A single chat message
 */
export interface ChatMessage {
  /** Role of the sender */
  role: "user" | "assistant" | "tool";
  /** Message content */
  content: string;
  /** ISO timestamp of the message */
  timestamp: string;
  /** Tool call data (only when role is "tool") */
  toolCall?: {
    toolName: string;
    inputSummary?: string;
    output: string;
    isError: boolean;
    durationMs?: number;
  };
}

/**
 * Session details with full message history
 */
export interface WebChatSessionDetails extends WebChatSession {
  /** All messages in this session */
  messages: ChatMessage[];
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  /** Job ID for tracking the execution */
  jobId: string;
  /** Whether the message was queued successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Callback for receiving streaming chunks
 */
export type OnChunkCallback = (chunk: string) => void | Promise<void>;

/**
 * Structured tool call data sent to the client
 */
export interface ToolCallData {
  /** Tool name (e.g., "Bash", "Read", "Write") */
  toolName: string;
  /** Human-readable summary of tool input */
  inputSummary?: string;
  /** Tool output (may be truncated) */
  output: string;
  /** Whether the tool returned an error */
  isError: boolean;
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Callback for receiving tool call results
 */
export type OnToolCallCallback = (toolCall: ToolCallData) => void | Promise<void>;

/**
 * Callback for signaling a message boundary between distinct assistant turns
 */
export type OnBoundaryCallback = () => void | Promise<void>;

// =============================================================================
// WebChatManager Implementation
// =============================================================================

/**
 * WebChatManager manages chat sessions for the web platform
 *
 * Uses ChatSessionManager from @herdctl/chat for per-agent session management.
 * Message history is stored in JSON files at `.herdctl/web/chat-history/<agent>/<session>.json`
 */
export class WebChatManager {
  private fleetManager: FleetManager | null = null;
  private stateDir: string | null = null;
  private sessionExpiryHours: number = 24;
  private toolResults: boolean = true;
  private initialized: boolean = false;

  /** Per-agent session managers */
  private sessionManagers: Map<string, ChatSessionManager> = new Map();

  /** In-memory session metadata cache (agentName -> sessionId -> metadata) */
  private sessionMetadata: Map<string, Map<string, WebChatSession>> = new Map();

  /**
   * Initialize the WebChatManager
   *
   * @param fleetManager - FleetManager instance for triggering jobs
   * @param stateDir - State directory (e.g., ".herdctl")
   * @param config - Web configuration from fleet config
   */
  async initialize(fleetManager: FleetManager, stateDir: string, config: WebConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.fleetManager = fleetManager;
    this.stateDir = stateDir;
    this.sessionExpiryHours = config.session_expiry_hours ?? 24;
    this.toolResults = config.tool_results ?? true;

    // Get fleet config to find all agents
    const fleetConfig = await fleetManager.getConfig();
    if (!fleetConfig) {
      logger.warn("No fleet config available, chat manager initialized without agents");
      this.initialized = true;
      return;
    }

    // Create session managers for each agent
    for (const agent of fleetConfig.agents) {
      await this.createSessionManagerForAgent(agent.name);
    }

    // Ensure chat history directories exist
    await this.ensureChatHistoryDir();

    this.initialized = true;
    logger.info(`Web chat manager initialized with ${this.sessionManagers.size} agent(s)`);
  }

  /**
   * Create a new chat session for an agent
   *
   * @param agentName - Name of the agent
   * @returns Session info with sessionId and createdAt
   */
  async createSession(agentName: string): Promise<WebChatSession> {
    this.ensureInitialized();

    // Ensure we have a session manager for this agent
    let sessionManager = this.sessionManagers.get(agentName);
    if (!sessionManager) {
      sessionManager = await this.createSessionManagerForAgent(agentName);
    }

    // Generate a unique session UUID for the web session
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    // Create session metadata
    const session: WebChatSession = {
      sessionId,
      agentName,
      createdAt: now,
      lastMessageAt: now,
      messageCount: 0,
    };

    // Store in metadata cache
    let agentSessions = this.sessionMetadata.get(agentName);
    if (!agentSessions) {
      agentSessions = new Map();
      this.sessionMetadata.set(agentName, agentSessions);
    }
    agentSessions.set(sessionId, session);

    // Initialize empty message history file
    await this.saveMessageHistory(agentName, sessionId, []);

    // Register in ChatSessionManager using sessionId as the channelId
    // (For web, each session is its own "channel")
    await sessionManager.setSession(sessionId, sessionId);

    logger.info(`Created web chat session`, { agentName, sessionId });

    return session;
  }

  /**
   * List all sessions for an agent
   *
   * @param agentName - Name of the agent
   * @returns Array of session summaries
   */
  async listSessions(agentName: string): Promise<WebChatSession[]> {
    this.ensureInitialized();

    // Load sessions from disk if not in cache
    await this.loadSessionsFromDisk(agentName);

    const agentSessions = this.sessionMetadata.get(agentName);
    if (!agentSessions) {
      return [];
    }

    // Return sessions sorted by lastMessageAt (most recent first)
    const sessions = Array.from(agentSessions.values());
    sessions.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );

    return sessions;
  }

  /**
   * Get session details with message history
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID
   * @returns Session details with messages, or null if not found
   */
  async getSession(agentName: string, sessionId: string): Promise<WebChatSessionDetails | null> {
    this.ensureInitialized();

    // Load sessions from disk if not in cache
    await this.loadSessionsFromDisk(agentName);

    const agentSessions = this.sessionMetadata.get(agentName);
    const session = agentSessions?.get(sessionId);

    if (!session) {
      return null;
    }

    // Load message history
    const messages = await this.loadMessageHistory(agentName, sessionId);

    return {
      ...session,
      messages,
    };
  }

  /**
   * Delete a session
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID
   * @returns true if deleted, false if not found
   */
  async deleteSession(agentName: string, sessionId: string): Promise<boolean> {
    this.ensureInitialized();

    const agentSessions = this.sessionMetadata.get(agentName);
    if (!agentSessions?.has(sessionId)) {
      return false;
    }

    // Remove from metadata cache
    agentSessions.delete(sessionId);

    // Delete message history file
    await this.deleteMessageHistory(agentName, sessionId);

    // Clear from ChatSessionManager
    const sessionManager = this.sessionManagers.get(agentName);
    if (sessionManager) {
      await sessionManager.clearSession(sessionId);
    }

    logger.info(`Deleted web chat session`, { agentName, sessionId });

    return true;
  }

  /**
   * Rename a session with a custom name
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID
   * @param customName - New custom name for the session
   * @returns true if renamed, false if not found
   */
  async renameSession(agentName: string, sessionId: string, customName: string): Promise<boolean> {
    this.ensureInitialized();

    // Load sessions from disk if not in cache
    await this.loadSessionsFromDisk(agentName);

    const agentSessions = this.sessionMetadata.get(agentName);
    const session = agentSessions?.get(sessionId);

    if (!session) {
      return false;
    }

    // Update custom name in metadata
    session.customName = customName;

    // Persist to disk by re-saving the message history with updated metadata
    const messages = await this.loadMessageHistory(agentName, sessionId);
    await this.saveMessageHistoryWithMetadata(agentName, sessionId, messages, session);

    logger.info(`Renamed web chat session`, { agentName, sessionId, customName });

    return true;
  }

  /**
   * Send a message and trigger agent execution
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID
   * @param message - User message text
   * @param onChunk - Callback for streaming response chunks
   * @param onToolCall - Optional callback for tool call results
   * @returns Result with jobId
   */
  async sendMessage(
    agentName: string,
    sessionId: string,
    message: string,
    onChunk: OnChunkCallback,
    onToolCall?: OnToolCallCallback,
    onBoundary?: OnBoundaryCallback,
  ): Promise<SendMessageResult> {
    this.ensureInitialized();

    if (!this.fleetManager) {
      return {
        jobId: "",
        success: false,
        error: "Fleet manager not available",
      };
    }

    // Load sessions from disk if not in cache
    await this.loadSessionsFromDisk(agentName);

    const agentSessions = this.sessionMetadata.get(agentName);
    const session = agentSessions?.get(sessionId);

    if (!session) {
      return {
        jobId: "",
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    // Get existing SDK session ID for conversation continuity
    const sessionManager = this.sessionManagers.get(agentName);
    let existingSdkSessionId: string | undefined;

    if (sessionManager) {
      const existingSession = await sessionManager.getSession(sessionId);
      if (existingSession && existingSession.sessionId !== sessionId) {
        // The session manager stores the SDK session ID, not our web session ID
        existingSdkSessionId = existingSession.sessionId;
        logger.debug(`Resuming SDK session`, {
          agentName,
          sessionId,
          sdkSessionId: existingSdkSessionId,
        });
      }
    }

    // Load message history and add user message
    const messages = await this.loadMessageHistory(agentName, sessionId);
    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    messages.push(userMessage);
    await this.saveMessageHistory(agentName, sessionId, messages);

    // Update session metadata
    session.lastMessageAt = userMessage.timestamp;
    session.messageCount = messages.length;
    session.preview = message.substring(0, 100);

    // Accumulate assistant response
    let assistantContent = "";

    try {
      // Track pending tool_use blocks so we can pair them with results
      const pendingToolUses = new Map<
        string,
        { name: string; input?: unknown; startTime: number }
      >();

      // Trigger job via FleetManager
      const result = await this.fleetManager.trigger(agentName, undefined, {
        triggerType: "web",
        prompt: message,
        resume: existingSdkSessionId,
        onMessage: async (sdkMessage) => {
          // Extract text content from assistant messages
          if (sdkMessage.type === "assistant") {
            const castMessage = sdkMessage as Parameters<typeof extractMessageContent>[0];
            const content = extractMessageContent(castMessage);
            if (content) {
              // If we already have accumulated assistant content, this is a new
              // assistant turn. Flush the previous content as a separate message
              // and signal a boundary to the client.
              if (assistantContent && onBoundary) {
                messages.push({
                  role: "assistant",
                  content: assistantContent,
                  timestamp: new Date().toISOString(),
                });
                assistantContent = "";
                await onBoundary();
              }
              assistantContent += content;
              // Send chunk to client
              await onChunk(content);
            }

            // Track tool_use blocks for pairing with results later
            const toolUseBlocks = extractToolUseBlocks(castMessage);
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

          // Send tool results to client
          if (sdkMessage.type === "user" && this.toolResults && onToolCall) {
            const userMessage = sdkMessage as {
              type: string;
              message?: { content?: unknown };
              tool_use_result?: unknown;
            };
            const toolResultsList = extractToolResults(userMessage);

            // Flush accumulated assistant text as its own message before tool calls
            // so that text before and after tools doesn't merge into one bubble
            if (toolResultsList.length > 0 && assistantContent) {
              messages.push({
                role: "assistant",
                content: assistantContent,
                timestamp: new Date().toISOString(),
              });
              assistantContent = "";
            }

            for (const toolResult of toolResultsList) {
              // Look up the matching tool_use for name, input, and timing
              const toolUse = toolResult.toolUseId
                ? pendingToolUses.get(toolResult.toolUseId)
                : undefined;
              if (toolResult.toolUseId) {
                pendingToolUses.delete(toolResult.toolUseId);
              }

              const toolName = toolUse?.name ?? "Tool";
              const durationMs = toolUse ? Date.now() - toolUse.startTime : undefined;
              const inputSummary = toolUse
                ? getToolInputSummary(toolUse.name, toolUse.input)
                : undefined;

              const toolCallData: ToolCallData = {
                toolName,
                inputSummary,
                output: toolResult.output,
                isError: toolResult.isError,
                durationMs,
              };

              // Persist tool call message to history
              messages.push({
                role: "tool",
                content: toolResult.output,
                timestamp: new Date().toISOString(),
                toolCall: toolCallData,
              });

              await onToolCall(toolCallData);
            }
          }
        },
      });

      // Store assistant message if we got any content
      if (assistantContent) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: assistantContent,
          timestamp: new Date().toISOString(),
        };
        messages.push(assistantMessage);

        // Update session metadata
        session.lastMessageAt = assistantMessage.timestamp;
        session.preview = assistantContent.substring(0, 100);
      }

      // Always save history (captures tool call messages even if no assistant text)
      session.messageCount = messages.length;
      await this.saveMessageHistory(agentName, sessionId, messages);

      // Store SDK session ID for future conversation continuity
      if (sessionManager && result.sessionId && result.success) {
        await sessionManager.setSession(sessionId, result.sessionId);
        logger.debug(`Stored SDK session`, {
          agentName,
          sessionId,
          sdkSessionId: result.sessionId,
        });
      }

      return {
        jobId: result.jobId,
        success: result.success,
        error: result.error?.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send message`, { agentName, sessionId, error: errorMessage });

      return {
        jobId: "",
        success: false,
        error: errorMessage,
      };
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Ensure the manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("WebChatManager not initialized. Call initialize() first.");
    }
  }

  /**
   * Create a session manager for an agent
   */
  private async createSessionManagerForAgent(agentName: string): Promise<ChatSessionManager> {
    const chatLogger: ChatConnectorLogger = {
      debug: (msg: string, data?: Record<string, unknown>) =>
        logger.debug(`[${agentName}] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
      info: (msg: string, data?: Record<string, unknown>) =>
        logger.info(`[${agentName}] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
      warn: (msg: string, data?: Record<string, unknown>) =>
        logger.warn(`[${agentName}] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
      error: (msg: string, data?: Record<string, unknown>) =>
        logger.error(`[${agentName}] ${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
    };

    const sessionManager = new ChatSessionManager({
      platform: "web",
      agentName,
      stateDir: this.stateDir!,
      sessionExpiryHours: this.sessionExpiryHours,
      logger: chatLogger,
    });

    this.sessionManagers.set(agentName, sessionManager);
    logger.debug(`Created session manager for agent`, { agentName });

    return sessionManager;
  }

  /**
   * Get the chat history directory path
   */
  private getChatHistoryDir(agentName: string): string {
    return join(this.stateDir!, "web", "chat-history", agentName);
  }

  /**
   * Get the message history file path for a session
   */
  private getMessageHistoryPath(agentName: string, sessionId: string): string {
    return join(this.getChatHistoryDir(agentName), `${sessionId}.json`);
  }

  /**
   * Ensure chat history directories exist
   */
  private async ensureChatHistoryDir(): Promise<void> {
    const baseDir = join(this.stateDir!, "web", "chat-history");
    await mkdir(baseDir, { recursive: true });
  }

  /**
   * Load message history from disk
   */
  private async loadMessageHistory(agentName: string, sessionId: string): Promise<ChatMessage[]> {
    const filePath = this.getMessageHistoryPath(agentName, sessionId);

    try {
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content) as { messages: ChatMessage[] };
      return data.messages ?? [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      logger.warn(`Failed to load message history`, {
        agentName,
        sessionId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Save message history to disk with optional metadata
   */
  private async saveMessageHistoryWithMetadata(
    agentName: string,
    sessionId: string,
    messages: ChatMessage[],
    session?: WebChatSession,
  ): Promise<void> {
    const filePath = this.getMessageHistoryPath(agentName, sessionId);
    const dir = dirname(filePath);

    await mkdir(dir, { recursive: true });

    const data = {
      sessionId,
      agentName,
      messages,
      updatedAt: new Date().toISOString(),
      customName: session?.customName,
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Save message history to disk
   */
  private async saveMessageHistory(
    agentName: string,
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    // Get session metadata to preserve customName if it exists
    const agentSessions = this.sessionMetadata.get(agentName);
    const session = agentSessions?.get(sessionId);
    await this.saveMessageHistoryWithMetadata(agentName, sessionId, messages, session);
  }

  /**
   * Delete message history file
   */
  private async deleteMessageHistory(agentName: string, sessionId: string): Promise<void> {
    const filePath = this.getMessageHistoryPath(agentName, sessionId);

    try {
      await unlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        logger.warn(`Failed to delete message history`, {
          agentName,
          sessionId,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Load sessions from disk into metadata cache
   */
  private async loadSessionsFromDisk(agentName: string): Promise<void> {
    // Skip if already loaded
    if (this.sessionMetadata.has(agentName)) {
      return;
    }

    const dir = this.getChatHistoryDir(agentName);
    const agentSessions = new Map<string, WebChatSession>();

    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const sessionId = file.slice(0, -5); // Remove .json
        const filePath = join(dir, file);

        try {
          const content = await readFile(filePath, "utf-8");
          const data = JSON.parse(content) as {
            sessionId: string;
            agentName: string;
            messages: ChatMessage[];
            updatedAt: string;
            customName?: string;
          };

          const messages = data.messages ?? [];
          const lastMessage = messages[messages.length - 1];
          const firstMessage = messages[0];

          agentSessions.set(sessionId, {
            sessionId,
            agentName,
            createdAt: firstMessage?.timestamp ?? data.updatedAt,
            lastMessageAt: lastMessage?.timestamp ?? data.updatedAt,
            messageCount: messages.length,
            preview: lastMessage?.content?.substring(0, 100),
            customName: data.customName,
          });
        } catch (error) {
          logger.warn(`Failed to load session file`, {
            agentName,
            sessionId,
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        logger.warn(`Failed to read chat history directory`, {
          agentName,
          error: (error as Error).message,
        });
      }
    }

    this.sessionMetadata.set(agentName, agentSessions);
  }
}
