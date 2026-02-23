/**
 * Chat REST API routes
 *
 * Provides endpoints for managing chat sessions and messages.
 * Actual message streaming happens via WebSocket.
 */

import type { FleetManager } from "@herdctl/core";
import type { FastifyInstance } from "fastify";
import type { WebChatManager } from "../chat/index.js";

/**
 * Register chat-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 * @param chatManager - WebChatManager instance
 */
export function registerChatRoutes(
  server: FastifyInstance,
  fleetManager: FleetManager,
  chatManager: WebChatManager,
): void {
  /**
   * GET /api/chat/recent
   *
   * Returns recent chat sessions across all agents, sorted by lastMessageAt descending.
   *
   * @param limit - Optional limit (default: 100, max: 500)
   * @returns { sessions: WebChatSession[] }
   */
  server.get<{
    Querystring: { limit?: string };
  }>("/api/chat/recent", async (request, reply) => {
    try {
      // Parse and clamp the limit parameter
      let limit = 100;
      if (request.query.limit) {
        const parsedLimit = parseInt(request.query.limit, 10);
        if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 500);
        }
      }

      const sessions = await chatManager.listAllRecentSessions(limit);

      return reply.send({ sessions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to list recent sessions: ${message}`,
        statusCode: 500,
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
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Failed to read config",
      });
    }
  });

  /**
   * POST /api/chat/:agentName/sessions
   *
   * Create a new chat session for an agent.
   *
   * @returns { sessionId, createdAt }
   */
  server.post<{
    Params: { agentName: string };
  }>("/api/chat/:agentName/sessions", async (request, reply) => {
    try {
      const { agentName } = request.params;

      // Verify agent exists
      try {
        await fleetManager.getAgentInfoByName(agentName);
      } catch {
        return reply.status(404).send({
          error: `Agent not found: ${agentName}`,
          statusCode: 404,
        });
      }

      const session = await chatManager.createSession(agentName);

      return reply.status(201).send({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to create session: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions
   *
   * List all chat sessions for an agent.
   *
   * @returns { sessions: [{ sessionId, createdAt, lastMessageAt, messageCount, preview }] }
   */
  server.get<{
    Params: { agentName: string };
  }>("/api/chat/:agentName/sessions", async (request, reply) => {
    try {
      const { agentName } = request.params;

      // Verify agent exists
      try {
        await fleetManager.getAgentInfoByName(agentName);
      } catch {
        return reply.status(404).send({
          error: `Agent not found: ${agentName}`,
          statusCode: 404,
        });
      }

      const sessions = await chatManager.listSessions(agentName);

      return reply.send({ sessions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to list sessions: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions/:sessionId
   *
   * Get session details with message history.
   *
   * @returns { sessionId, messages, createdAt, lastMessageAt }
   */
  server.get<{
    Params: { agentName: string; sessionId: string };
  }>("/api/chat/:agentName/sessions/:sessionId", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;

      const session = await chatManager.getSession(agentName, sessionId);

      if (!session) {
        return reply.status(404).send({
          error: `Session not found: ${sessionId}`,
          statusCode: 404,
        });
      }

      return reply.send(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get session: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions/:sessionId/sdk-session
   *
   * Get the SDK session ID for a web chat session.
   * Used by the "Continue in Claude Code" feature.
   *
   * @returns { sdkSessionId: string | null }
   */
  server.get<{
    Params: { agentName: string; sessionId: string };
  }>("/api/chat/:agentName/sessions/:sessionId/sdk-session", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;
      const sdkSessionId = await chatManager.getSdkSessionId(agentName, sessionId);

      // Check if the agent runs in Docker — sessions created inside containers
      // can't be resumed from the host because Claude stores conversations
      // in ~/.claude/ which is container-local.
      const agents = fleetManager.getAgents();
      const agent = agents.find((a) => a.qualifiedName === agentName || a.name === agentName);
      const dockerEnabled = agent?.docker?.enabled ?? false;

      return reply.send({ sdkSessionId, dockerEnabled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get SDK session: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/chat/:agentName/sessions/:sessionId/usage
   *
   * Get token usage for a chat session by reading the Claude Code session file.
   *
   * @returns { inputTokens: number, turnCount: number, hasData: boolean }
   */
  server.get<{
    Params: { agentName: string; sessionId: string };
  }>("/api/chat/:agentName/sessions/:sessionId/usage", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;
      const usage = await chatManager.getSessionUsage(agentName, sessionId);
      return reply.send(usage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get session usage: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * DELETE /api/chat/:agentName/sessions/:sessionId
   *
   * Delete a chat session.
   *
   * @returns { deleted: true }
   */
  server.delete<{
    Params: { agentName: string; sessionId: string };
  }>("/api/chat/:agentName/sessions/:sessionId", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;

      const deleted = await chatManager.deleteSession(agentName, sessionId);

      if (!deleted) {
        return reply.status(404).send({
          error: `Session not found: ${sessionId}`,
          statusCode: 404,
        });
      }

      return reply.send({ deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to delete session: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * PATCH /api/chat/:agentName/sessions/:sessionId
   *
   * Update a chat session (currently supports renaming via customName).
   *
   * Request body: { name: string }
   * @returns { renamed: true }
   */
  server.patch<{
    Params: { agentName: string; sessionId: string };
    Body: { name: string };
  }>("/api/chat/:agentName/sessions/:sessionId", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;
      const { name } = request.body;

      if (!name || typeof name !== "string") {
        return reply.status(400).send({
          error: "Name is required",
          statusCode: 400,
        });
      }

      const renamed = await chatManager.renameSession(agentName, sessionId, name);

      if (!renamed) {
        return reply.status(404).send({
          error: `Session not found: ${sessionId}`,
          statusCode: 404,
        });
      }

      return reply.send({ renamed: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to rename session: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * POST /api/chat/:agentName/sessions/:sessionId/messages
   *
   * Send a message in a chat session. The actual response streams via WebSocket.
   *
   * Request body: { message: string }
   * @returns { jobId }
   */
  server.post<{
    Params: { agentName: string; sessionId: string };
    Body: { message: string };
  }>("/api/chat/:agentName/sessions/:sessionId/messages", async (request, reply) => {
    try {
      const { agentName, sessionId } = request.params;
      const { message } = request.body;

      if (!message || typeof message !== "string") {
        return reply.status(400).send({
          error: "Message is required",
          statusCode: 400,
        });
      }

      // Verify session exists
      const session = await chatManager.getSession(agentName, sessionId);
      if (!session) {
        return reply.status(404).send({
          error: `Session not found: ${sessionId}`,
          statusCode: 404,
        });
      }

      // Note: This endpoint just validates and returns immediately.
      // The actual message sending should be done via WebSocket (chat:send)
      // to enable streaming responses.
      //
      // However, we provide this REST endpoint for clients that want a simpler
      // request/response pattern without streaming.
      // In that case, we collect all chunks and return when complete.

      let response = "";
      const result = await chatManager.sendMessage(agentName, sessionId, message, (chunk) => {
        response += chunk;
      });

      if (!result.success) {
        return reply.status(500).send({
          error: result.error ?? "Failed to send message",
          statusCode: 500,
        });
      }

      return reply.send({
        jobId: result.jobId,
        response,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to send message: ${message}`,
        statusCode: 500,
      });
    }
  });
}
