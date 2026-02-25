/**
 * Chat REST API routes
 *
 * Provides endpoints for managing chat sessions and messages.
 * Actual message streaming happens via WebSocket.
 */

import { createLogger, type FleetManager, type SessionDiscoveryService } from "@herdctl/core";
import type { FastifyInstance } from "fastify";
import type { WebChatManager } from "../chat/index.js";

const logger = createLogger("ChatRoutes");

/**
 * Register chat-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 * @param chatManager - WebChatManager instance
 * @param discoveryService - SessionDiscoveryService for direct session access
 */
export function registerChatRoutes(
  server: FastifyInstance,
  fleetManager: FleetManager,
  chatManager: WebChatManager,
  discoveryService: SessionDiscoveryService,
): void {
  /** Transform a DiscoveredSession into the ChatSession shape the frontend expects */
  function toFrontendSession(session: {
    sessionId: string;
    mtime: string;
    origin: string;
    resumable: boolean;
    customName?: string;
    autoName?: string;
    preview?: string;
  }): {
    sessionId: string;
    createdAt: string;
    lastMessageAt: string;
    messageCount: number;
    preview: string;
    customName?: string;
    autoName?: string;
    origin: string;
    resumable: boolean;
  } {
    return {
      sessionId: session.sessionId,
      createdAt: session.mtime,
      lastMessageAt: session.mtime,
      messageCount: 0,
      preview: session.preview ?? "",
      customName: session.customName,
      autoName: session.autoName,
      origin: session.origin,
      resumable: session.resumable,
    };
  }

  /** Transform a DiscoveredSession into the RecentChatSession shape (includes agentName) */
  function toRecentFrontendSession(session: {
    sessionId: string;
    mtime: string;
    origin: string;
    resumable: boolean;
    customName?: string;
    autoName?: string;
    preview?: string;
    agentName?: string;
    workingDirectory: string;
  }): ReturnType<typeof toFrontendSession> & { agentName: string; encodedPath?: string } {
    return {
      ...toFrontendSession(session),
      agentName: session.agentName ?? "",
      // Include encodedPath for unattributed sessions so frontend can route to read-only view
      ...(!session.agentName
        ? { encodedPath: session.workingDirectory.replace(/[/\\]/g, "-") }
        : {}),
    };
  }

  /**
   * GET /api/chat/recent
   *
   * Returns recent chat sessions across all agents, sorted by lastMessageAt descending.
   *
   * @param limit - Optional limit (default: 100)
   * @returns { sessions: DiscoveredSession[] }
   */
  server.get("/api/chat/recent", async (request, reply) => {
    const { limit = 100 } = request.query as { limit?: number };
    try {
      const sessions = await chatManager.listAllRecentSessions(limit);
      return { sessions: sessions.map(toRecentFrontendSession) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to list recent sessions", { error: message });
      return reply.status(500).send({
        error: `Failed to list recent sessions: ${message}`,
      });
    }
  });

  /**
   * GET /api/chat/config
   *
   * Returns chat-related configuration defaults from the fleet config.
   *
   * @returns { message_grouping, tool_results }
   */
  server.get("/api/chat/config", async (_request, reply) => {
    try {
      const resolvedConfig = fleetManager.getConfig();
      const webConfig = resolvedConfig?.fleet?.web;
      return reply.send({
        message_grouping: webConfig?.message_grouping ?? "separate",
        tool_results: webConfig?.tool_results ?? true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to read config", { error: message });
      return reply.status(500).send({
        error: `Failed to read config: ${message}`,
      });
    }
  });

  /**
   * GET /api/chat/all
   *
   * Returns all sessions grouped by working directory.
   *
   * @param limit - Maximum number of directory groups (default: 20)
   * @param sessionsPerGroup - Maximum sessions per group (default: 10)
   * @returns { groups: DirectoryGroup[], totalGroups: number }
   */
  server.get("/api/chat/all", async (request, reply) => {
    const { limit = 20, sessionsPerGroup = 10 } = request.query as {
      limit?: number;
      sessionsPerGroup?: number;
    };
    try {
      const groups = await chatManager.getAllSessionGroups();

      // Apply pagination
      const limitedGroups = groups.slice(0, limit).map((group) => ({
        ...group,
        sessions: group.sessions.slice(0, sessionsPerGroup),
      }));

      return {
        groups: limitedGroups,
        totalGroups: groups.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get all session groups", { error: message });
      return reply.status(500).send({
        error: `Failed to get all session groups: ${message}`,
      });
    }
  });

  /**
   * GET /api/chat/all/:encodedPath
   *
   * Expand a single directory group to get more sessions.
   *
   * @param encodedPath - URL-encoded path identifier for the directory
   * @param limit - Maximum sessions to return (default: 50)
   * @param offset - Number of sessions to skip (default: 0)
   * @returns { group: DirectoryGroup }
   */
  server.get("/api/chat/all/:encodedPath", async (request, reply) => {
    const { encodedPath } = request.params as { encodedPath: string };
    const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };

    try {
      const groups = await chatManager.getAllSessionGroups();
      const group = groups.find((g) => g.encodedPath === encodedPath);

      if (!group) {
        return reply.status(404).send({ error: `Directory not found: ${encodedPath}` });
      }

      return {
        group: {
          ...group,
          sessions: group.sessions.slice(offset, offset + limit),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get directory group", { error: message, encodedPath });
      return reply.status(500).send({
        error: `Failed to get directory group: ${message}`,
      });
    }
  });

  /**
   * GET /api/chat/sessions/by-path/:encodedPath/:sessionId
   *
   * Get messages for a session by its encoded directory path.
   * Used for sessions not attributed to any fleet agent (read-only view).
   *
   * @returns { messages: ChatMessage[], metadata: SessionMetadata }
   */
  server.get("/api/chat/sessions/by-path/:encodedPath/:sessionId", async (request, reply) => {
    const { encodedPath, sessionId } = request.params as { encodedPath: string; sessionId: string };

    try {
      // Look up the working directory from the groups
      const groups = await chatManager.getAllSessionGroups();
      const group = groups.find((g) => g.encodedPath === encodedPath);

      if (!group) {
        return reply.status(404).send({ error: `Directory not found: ${encodedPath}` });
      }

      const [messages, metadata] = await Promise.all([
        discoveryService.getSessionMessages(group.workingDirectory, sessionId),
        discoveryService.getSessionMetadata(group.workingDirectory, sessionId),
      ]);

      return reply.send({
        messages,
        metadata: {
          gitBranch: metadata.gitBranch,
          claudeCodeVersion: metadata.claudeCodeVersion,
          preview: metadata.firstMessagePreview,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get session by path", { error: message, encodedPath, sessionId });
      return reply.status(404).send({ error: `Session not found: ${sessionId}` });
    }
  });

  /**
   * GET /api/chat/sessions/by-path/:encodedPath/:sessionId/usage
   *
   * Get token usage for an ad hoc session by its encoded directory path.
   *
   * @returns { inputTokens: number, turnCount: number, hasData: boolean }
   */
  server.get("/api/chat/sessions/by-path/:encodedPath/:sessionId/usage", async (request, reply) => {
    const { encodedPath, sessionId } = request.params as { encodedPath: string; sessionId: string };

    try {
      const groups = await chatManager.getAllSessionGroups();
      const group = groups.find((g) => g.encodedPath === encodedPath);

      if (!group) {
        return reply.status(404).send({ error: `Directory not found: ${encodedPath}` });
      }

      const usage = await chatManager.getAdhocSessionUsage(group.workingDirectory, sessionId);
      return reply.send(usage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get ad hoc session usage", {
        error: message,
        encodedPath,
        sessionId,
      });
      return reply.status(500).send({ error: `Failed to get session usage: ${message}` });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions
   *
   * List all chat sessions for an agent.
   *
   * @returns { sessions: DiscoveredSession[] }
   */
  server.get("/api/chat/:agentName/sessions", async (request, reply) => {
    const { agentName } = request.params as { agentName: string };
    const { limit } = request.query as { limit?: number };

    // Validate agent exists
    try {
      await fleetManager.getAgentInfoByName(agentName);
    } catch {
      return reply.status(404).send({ error: `Agent not found: ${agentName}` });
    }

    try {
      const parsedLimit = limit ? Number(limit) : undefined;
      const sessions = await chatManager.listSessions(agentName, parsedLimit);
      return { sessions: sessions.map(toFrontendSession) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to list sessions", { error: message, agentName });
      return reply.status(500).send({
        error: `Failed to list sessions: ${message}`,
      });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions/:sessionId
   *
   * Get messages and metadata for a session.
   *
   * @returns { messages: ChatMessage[], metadata: SessionMetadata }
   */
  server.get("/api/chat/:agentName/sessions/:sessionId", async (request, reply) => {
    const { agentName, sessionId } = request.params as { agentName: string; sessionId: string };

    // Validate agent exists and get config
    let agentConfig: Awaited<ReturnType<typeof fleetManager.getAgentInfoByName>>;
    try {
      agentConfig = await fleetManager.getAgentInfoByName(agentName);
    } catch {
      return reply.status(404).send({ error: `Agent not found: ${agentName}` });
    }

    // Get working directory from agent config
    const workingDirectory = agentConfig.working_directory ?? "/tmp/unknown";

    try {
      const [messages, metadata] = await Promise.all([
        chatManager.getSessionMessages(agentName, sessionId),
        discoveryService.getSessionMetadata(workingDirectory, sessionId),
      ]);

      return reply.send({
        messages,
        metadata: {
          gitBranch: metadata.gitBranch,
          claudeCodeVersion: metadata.claudeCodeVersion,
          preview: metadata.firstMessagePreview,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get session messages", { error: message, agentName, sessionId });
      return reply.status(404).send({ error: `Session not found: ${sessionId}` });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions/:sessionId/usage
   *
   * Get token usage for a chat session.
   *
   * @returns { inputTokens: number, turnCount: number, hasData: boolean }
   */
  server.get("/api/chat/:agentName/sessions/:sessionId/usage", async (request, reply) => {
    const { agentName, sessionId } = request.params as { agentName: string; sessionId: string };

    // Validate agent exists
    try {
      await fleetManager.getAgentInfoByName(agentName);
    } catch {
      return reply.status(404).send({ error: `Agent not found: ${agentName}` });
    }

    try {
      const usage = await chatManager.getSessionUsage(agentName, sessionId);
      return usage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to get session usage", { error: message, agentName, sessionId });
      return reply.status(500).send({
        error: `Failed to get session usage: ${message}`,
      });
    }
  });

  /**
   * PATCH /api/chat/:agentName/sessions/:sessionId
   *
   * Rename a chat session with a custom name.
   *
   * Request body: { customName: string }
   * @returns { success: true }
   */
  server.patch("/api/chat/:agentName/sessions/:sessionId", async (request, reply) => {
    const { agentName, sessionId } = request.params as { agentName: string; sessionId: string };
    const { customName } = request.body as { customName?: string };

    // Validate agent exists
    try {
      await fleetManager.getAgentInfoByName(agentName);
    } catch {
      return reply.status(404).send({ error: `Agent not found: ${agentName}` });
    }

    if (!customName || typeof customName !== "string") {
      return reply.status(400).send({ error: "customName is required" });
    }

    try {
      await chatManager.renameSession(agentName, sessionId, customName);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to rename session", { error: message, agentName, sessionId });
      return reply.status(500).send({
        error: `Failed to rename session: ${message}`,
      });
    }
  });

  /**
   * POST /api/chat/:agentName/messages
   *
   * Send a message to an agent. Creates a new session if sessionId is not provided.
   * The actual response can also stream via WebSocket for real-time updates.
   *
   * Request body: { message: string, sessionId?: string }
   * @returns { jobId, sessionId, success, response, error? }
   */
  server.post("/api/chat/:agentName/messages", async (request, reply) => {
    const { agentName } = request.params as { agentName: string };
    const { message, sessionId } = request.body as { message: string; sessionId?: string };

    // Validate agent exists
    try {
      await fleetManager.getAgentInfoByName(agentName);
    } catch {
      return reply.status(404).send({ error: `Agent not found: ${agentName}` });
    }

    if (!message || typeof message !== "string") {
      return reply.status(400).send({ error: "message is required" });
    }

    try {
      // Collect response chunks into full response
      let fullResponse = "";
      const result = await chatManager.sendMessage(
        agentName,
        sessionId ?? null,
        message,
        async (chunk) => {
          fullResponse += chunk;
        },
      );

      return {
        jobId: result.jobId,
        sessionId: result.sessionId,
        success: result.success,
        response: fullResponse,
        error: result.error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to send message", { error: message, agentName, sessionId });
      return reply.status(500).send({
        error: `Failed to send message: ${message}`,
      });
    }
  });
}
