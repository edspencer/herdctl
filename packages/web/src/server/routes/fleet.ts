/**
 * Fleet status REST API routes
 *
 * Provides endpoints for retrieving fleet-level status information.
 */

import type { FastifyInstance } from "fastify";
import type { FleetManager } from "@herdctl/core";

/**
 * Register fleet-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 */
export function registerFleetRoutes(server: FastifyInstance, fleetManager: FleetManager): void {
  /**
   * GET /api/fleet/status
   *
   * Returns the current fleet status including:
   * - Fleet state (running, stopped, etc.)
   * - Uptime information
   * - Agent and job counts
   * - Scheduler state
   */
  server.get("/api/fleet/status", async (_request, reply) => {
    try {
      const status = await fleetManager.getFleetStatus();
      return reply.send(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get fleet status: ${message}`,
        statusCode: 500,
      });
    }
  });
}
