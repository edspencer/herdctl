/**
 * Web Chat Manager for @herdctl/web
 *
 * Manages chat sessions for the web platform using @herdctl/chat infrastructure.
 * Delegates read operations to SessionDiscoveryService from @herdctl/core.
 */

import { type ChatConnectorLogger, ChatSessionManager, extractMessageContent } from "@herdctl/chat";
import {
  type ChatMessage as CoreChatMessage,
  type SessionUsage as CoreSessionUsage,
  createLogger,
  type DirectoryGroup,
  type DiscoveredSession,
  extractToolResults,
  extractToolUseBlocks,
  type FleetManager,
  getToolInputSummary,
  JobExecutor,
  type ResolvedAgent,
  RuntimeFactory,
  type SessionDiscoveryService,
  SessionMetadataStore,
  type WebConfig,
} from "@herdctl/core";

const logger = createLogger("web:chat");

// =============================================================================
// Types
// =============================================================================

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
  toolCall?: ToolCallData;
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  /** Job ID for tracking the execution */
  jobId: string;
  /** SDK session ID (important for new chats to return to caller) */
  sessionId?: string;
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

/**
 * Token usage data for a session
 */
export interface SessionUsage {
  /** Last reported input tokens (best proxy for context window fill) */
  inputTokens: number;
  /** Number of API calls (assistant turns) in this session */
  turnCount: number;
  /** Whether any usage data was found */
  hasData: boolean;
}

// Re-export types from core for API consumers
export type { DirectoryGroup, DiscoveredSession };

// =============================================================================
// WebChatManager Implementation
// =============================================================================

/**
 * WebChatManager manages chat sessions for the web platform
 *
 * Delegates read operations (listing sessions, getting messages, usage) to
 * SessionDiscoveryService from @herdctl/core. Uses ChatSessionManager from
 * @herdctl/chat for session attribution.
 */
export class WebChatManager {
  private fleetManager: FleetManager | null = null;
  private stateDir: string | null = null;
  private discoveryService: SessionDiscoveryService | null = null;
  private metadataStore: SessionMetadataStore | null = null;
  private toolResults: boolean = true;
  private initialized: boolean = false;

  /** Per-agent session managers for attribution */
  private sessionManagers: Map<string, ChatSessionManager> = new Map();

  /**
   * Initialize the WebChatManager
   *
   * @param fleetManager - FleetManager instance for triggering jobs
   * @param stateDir - State directory (e.g., ".herdctl")
   * @param config - Web configuration from fleet config
   * @param discoveryService - Session discovery service for reading sessions
   */
  initialize(
    fleetManager: FleetManager,
    stateDir: string,
    config: WebConfig,
    discoveryService: SessionDiscoveryService,
  ): void {
    if (this.initialized) {
      return;
    }

    this.fleetManager = fleetManager;
    this.stateDir = stateDir;
    this.toolResults = config.tool_results ?? true;
    this.discoveryService = discoveryService;
    this.metadataStore = new SessionMetadataStore(stateDir);

    // Create session managers for each agent (for attribution)
    const agents = fleetManager.getAgents();
    for (const agent of agents) {
      this.createSessionManagerForAgent(agent.qualifiedName);
    }

    this.initialized = true;
    logger.info(`Web chat manager initialized with ${this.sessionManagers.size} agent(s)`);
  }

  /**
   * List sessions for an agent
   *
   * @param agentName - Name of the agent
   * @returns Array of discovered sessions
   */
  async listSessions(agentName: string, limit?: number): Promise<DiscoveredSession[]> {
    this.ensureInitialized();
    const agent = this.getAgentConfig(agentName);
    const workDir = this.getWorkingDirectory(agent);
    const dockerEnabled = agent.docker?.enabled ?? false;
    return this.discoveryService!.getAgentSessions(agentName, workDir, dockerEnabled, { limit });
  }

  /**
   * List recent sessions across all agents
   *
   * @param limit - Maximum number of sessions to return (default: 100)
   * @returns Array of discovered sessions sorted by mtime descending
   */
  async listAllRecentSessions(limit: number = 100): Promise<DiscoveredSession[]> {
    this.ensureInitialized();
    const agents = this.fleetManager!.getAgents();
    const agentList = agents.map((a) => ({
      name: a.qualifiedName,
      workingDirectory: this.getWorkingDirectoryFromResolved(a),
      dockerEnabled: a.docker?.enabled ?? false,
    }));
    const groups = await this.discoveryService!.getAllSessions(agentList, { limit });
    // Flatten and sort — getAllSessions already limited enrichment to top N
    const all = groups.flatMap((g) => g.sessions);
    all.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return all.slice(0, limit);
  }

  /**
   * Get all session groups for the /api/chat/all endpoint
   *
   * @returns Array of directory groups with sessions
   */
  async getAllSessionGroups(): Promise<DirectoryGroup[]> {
    this.ensureInitialized();
    const agents = this.fleetManager!.getAgents();
    const agentList = agents.map((a) => ({
      name: a.qualifiedName,
      workingDirectory: this.getWorkingDirectoryFromResolved(a),
      dockerEnabled: a.docker?.enabled ?? false,
    }));
    return this.discoveryService!.getAllSessions(agentList);
  }

  /**
   * Get messages for a session
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID (SDK session ID)
   * @returns Array of chat messages
   */
  async getSessionMessages(agentName: string, sessionId: string): Promise<ChatMessage[]> {
    this.ensureInitialized();
    const agent = this.getAgentConfig(agentName);
    const workDir = this.getWorkingDirectory(agent);
    const coreMessages = await this.discoveryService!.getSessionMessages(workDir, sessionId);
    // Transform core ChatMessage to web ChatMessage (same shape, just type cast)
    return coreMessages.map((m) => this.transformCoreMessage(m));
  }

  /**
   * Get usage data for a session
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID (SDK session ID)
   * @returns Session usage data
   */
  async getSessionUsage(agentName: string, sessionId: string): Promise<SessionUsage> {
    this.ensureInitialized();
    const agent = this.getAgentConfig(agentName);
    const workDir = this.getWorkingDirectory(agent);
    const usage = await this.discoveryService!.getSessionUsage(workDir, sessionId);
    return this.transformCoreUsage(usage);
  }

  /**
   * Rename a session with a custom name
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID (SDK session ID)
   * @param name - New custom name for the session
   */
  async renameSession(agentName: string, sessionId: string, name: string): Promise<void> {
    this.ensureInitialized();
    await this.metadataStore!.setCustomName(agentName, sessionId, name);
    logger.info(`Renamed session`, { agentName, sessionId, customName: name });
  }

  /**
   * Send a message and trigger agent execution
   *
   * @param agentName - Name of the agent
   * @param sessionId - Session ID (SDK session ID), or null for new chat
   * @param message - User message text
   * @param onChunk - Callback for streaming response chunks
   * @param onToolCall - Optional callback for tool call results
   * @param onBoundary - Optional callback for message boundary signals
   * @returns Result with jobId and sessionId
   */
  async sendMessage(
    agentName: string,
    sessionId: string | null,
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

    // Accumulate assistant response for boundary detection
    let assistantContent = "";

    try {
      // Track pending tool_use blocks so we can pair them with results
      const pendingToolUses = new Map<
        string,
        { name: string; input?: unknown; startTime: number }
      >();

      // Trigger job via FleetManager
      // If sessionId is null, this is a new chat - pass null to resume
      // If sessionId is provided, it's already the SDK session ID - use it directly
      const result = await this.fleetManager.trigger(agentName, undefined, {
        triggerType: "web",
        prompt: message,
        resume: sessionId,
        onMessage: async (sdkMessage) => {
          // Extract text content from assistant messages
          if (sdkMessage.type === "assistant") {
            const castMessage = sdkMessage as Parameters<typeof extractMessageContent>[0];
            const content = extractMessageContent(castMessage);
            if (content) {
              // If we already have accumulated assistant content, this is a new
              // assistant turn. Flush the previous content and signal a boundary.
              if (assistantContent && onBoundary) {
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

            // Flush accumulated assistant text before tool calls
            // so that text before and after tools doesn't merge
            if (toolResultsList.length > 0 && assistantContent) {
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

              await onToolCall(toolCallData);
            }
          }
        },
      });

      // Store attribution for this session
      const sessionManager = this.sessionManagers.get(agentName);
      if (sessionManager && result.sessionId && result.success) {
        // channelId = sessionId = SDK session ID (they're the same now)
        await sessionManager.setSession(result.sessionId, result.sessionId);
        logger.debug(`Stored session attribution`, {
          agentName,
          sdkSessionId: result.sessionId,
        });
      }

      return {
        jobId: result.jobId,
        sessionId: result.sessionId,
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
  // Ad Hoc Session Methods (for unattributed sessions)
  // ===========================================================================

  /**
   * Build a minimal synthetic agent for ad hoc execution
   *
   * Ad hoc sessions bypass FleetManager.trigger() and use RuntimeFactory + JobExecutor directly.
   * This creates a minimal ResolvedAgent with CLI runtime for resuming unattributed sessions.
   */
  private buildAdhocAgent(workingDirectory: string, sessionId: string): ResolvedAgent {
    const shortId = sessionId.slice(0, 8);
    return {
      name: `adhoc-${shortId}`,
      qualifiedName: `__adhoc__.${shortId}`,
      configPath: "",
      fleetPath: [],
      working_directory: workingDirectory,
      runtime: "cli",
      permission_mode: "default",
    } as ResolvedAgent;
  }

  /**
   * Send a message to an ad hoc session (not attributed to any fleet agent)
   *
   * Uses RuntimeFactory + JobExecutor directly, bypassing FleetManager.trigger().
   * The CLI runtime executes `claude --resume <sessionId>` in the session's working directory.
   *
   * @param workingDirectory - Working directory where the session exists
   * @param sessionId - Session ID to resume
   * @param message - User message text
   * @param onChunk - Callback for streaming response chunks
   * @param onToolCall - Optional callback for tool call results
   * @param onBoundary - Optional callback for message boundary signals
   * @returns Result with jobId and sessionId
   */
  async sendAdhocMessage(
    workingDirectory: string,
    sessionId: string,
    message: string,
    onChunk: OnChunkCallback,
    onToolCall?: OnToolCallCallback,
    onBoundary?: OnBoundaryCallback,
  ): Promise<SendMessageResult> {
    this.ensureInitialized();

    const agent = this.buildAdhocAgent(workingDirectory, sessionId);
    const runtime = RuntimeFactory.create(agent, { stateDir: this.stateDir! });
    const executor = new JobExecutor(runtime, { logger });

    let assistantContent = "";
    const pendingToolUses = new Map<string, { name: string; input?: unknown; startTime: number }>();

    try {
      const result = await executor.execute({
        agent,
        prompt: message,
        stateDir: this.stateDir!,
        triggerType: "web",
        resume: sessionId,
        onMessage: async (sdkMessage) => {
          // Extract text content from assistant messages
          if (sdkMessage.type === "assistant") {
            const castMessage = sdkMessage as Parameters<typeof extractMessageContent>[0];
            const content = extractMessageContent(castMessage);
            if (content) {
              // If we already have accumulated assistant content, this is a new
              // assistant turn. Flush the previous content and signal a boundary.
              if (assistantContent && onBoundary) {
                assistantContent = "";
                await onBoundary();
              }
              assistantContent += content;
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

            // Flush accumulated assistant text before tool calls
            if (toolResultsList.length > 0 && assistantContent) {
              assistantContent = "";
            }

            for (const toolResult of toolResultsList) {
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

              await onToolCall(toolCallData);
            }
          }
        },
      });

      return {
        jobId: result.jobId,
        sessionId: result.sessionId,
        success: result.success,
        error: result.error?.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send ad hoc message`, {
        workingDirectory,
        sessionId,
        error: errorMessage,
      });

      return {
        jobId: "",
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get messages for an ad hoc session by working directory
   *
   * @param workingDirectory - Working directory where the session exists
   * @param sessionId - Session ID
   * @returns Array of chat messages
   */
  async getAdhocSessionMessages(
    workingDirectory: string,
    sessionId: string,
  ): Promise<ChatMessage[]> {
    this.ensureInitialized();
    const coreMessages = await this.discoveryService!.getSessionMessages(
      workingDirectory,
      sessionId,
    );
    return coreMessages.map((m) => this.transformCoreMessage(m));
  }

  /**
   * Get usage data for an ad hoc session by working directory
   *
   * @param workingDirectory - Working directory where the session exists
   * @param sessionId - Session ID
   * @returns Session usage data
   */
  async getAdhocSessionUsage(workingDirectory: string, sessionId: string): Promise<SessionUsage> {
    this.ensureInitialized();
    const usage = await this.discoveryService!.getSessionUsage(workingDirectory, sessionId);
    return this.transformCoreUsage(usage);
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
   * Create a session manager for an agent (for attribution)
   */
  private createSessionManagerForAgent(agentName: string): ChatSessionManager {
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
      sessionExpiryHours: 24, // Default expiry for attribution
      logger: chatLogger,
    });

    this.sessionManagers.set(agentName, sessionManager);
    logger.debug(`Created session manager for agent`, { agentName });

    return sessionManager;
  }

  /**
   * Get agent configuration by name
   */
  private getAgentConfig(agentName: string): ResolvedAgent {
    const agents = this.fleetManager!.getAgents();
    const agent = agents.find((a) => a.qualifiedName === agentName || a.name === agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }
    return agent;
  }

  /**
   * Get working directory from agent config
   */
  private getWorkingDirectory(agent: ResolvedAgent): string {
    const workDir = agent.working_directory;
    if (typeof workDir === "string") return workDir;
    if (workDir?.root) return workDir.root;
    throw new Error(`Agent ${agent.qualifiedName} has no working directory`);
  }

  /**
   * Get working directory with fallback for agents without one
   */
  private getWorkingDirectoryFromResolved(agent: ResolvedAgent): string {
    const workDir = agent.working_directory;
    if (typeof workDir === "string") return workDir;
    if (workDir?.root) return workDir.root;
    return "/tmp/unknown"; // fallback for agents without working directory
  }

  /**
   * Transform core ChatMessage to web ChatMessage
   */
  private transformCoreMessage(msg: CoreChatMessage): ChatMessage {
    const result: ChatMessage = {
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    };

    if (msg.toolCall) {
      result.toolCall = {
        toolName: msg.toolCall.toolName,
        inputSummary: msg.toolCall.inputSummary,
        output: msg.toolCall.output,
        isError: msg.toolCall.isError,
        durationMs: msg.toolCall.durationMs,
      };
    }

    return result;
  }

  /**
   * Transform core SessionUsage to web SessionUsage
   */
  private transformCoreUsage(usage: CoreSessionUsage): SessionUsage {
    return {
      inputTokens: usage.inputTokens,
      turnCount: usage.turnCount,
      hasData: usage.hasData,
    };
  }
}
