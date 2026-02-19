/**
 * Agent REST API routes
 *
 * Provides endpoints for retrieving agent information.
 */

import type { FastifyInstance } from "fastify";
import type { FleetManager } from "@herdctl/core";

/**
 * Register agent-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 */
export function registerAgentRoutes(
  server: FastifyInstance,
  fleetManager: FleetManager
): void {
  /**
   * GET /api/agents
   *
   * Returns a list of all agents with their current status.
   * Each agent includes:
   * - Name, qualifiedName, and fleetPath
   * - Description
   * - Current status (idle, running, error)
   * - Current/last job IDs
   * - Schedule information
   * - Chat connector statuses
   */
  server.get("/api/agents", async (_request, reply) => {
    try {
      const agents = await fleetManager.getAgentInfo();
      return reply.send(agents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get agents: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/agents/:name
   *
   * Returns detailed information for a single agent.
   * The response includes `qualifiedName` and `fleetPath` fields.
   *
   * @param name - Agent qualified name (e.g., "herdctl.security-auditor") or local name (URL parameter)
   */
  server.get<{
    Params: { name: string };
  }>("/api/agents/:name", async (request, reply) => {
    try {
      const { name } = request.params;
      const agent = await fleetManager.getAgentInfoByName(name);
      return reply.send(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Check if it's a "not found" error
      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      return reply.status(500).send({
        error: `Failed to get agent: ${message}`,
        statusCode: 500,
      });
    }
  });
}
