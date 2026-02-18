/**
 * Schedule REST API routes
 *
 * Provides endpoints for retrieving schedule information.
 */

import type { FastifyInstance } from "fastify";
import type { FleetManager } from "@herdctl/core";

/**
 * Register schedule-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 */
export function registerScheduleRoutes(
  server: FastifyInstance,
  fleetManager: FleetManager
): void {
  /**
   * GET /api/schedules
   *
   * Returns all schedules across all agents.
   * Each schedule includes:
   * - Name and agent name
   * - Type (interval, cron, webhook, chat)
   * - Interval or cron expression
   * - Status (idle, running, disabled)
   * - Last run and next run timestamps
   */
  server.get("/api/schedules", async (_request, reply) => {
    try {
      const schedules = await fleetManager.getSchedules();
      return reply.send(schedules);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get schedules: ${message}`,
        statusCode: 500,
      });
    }
  });
}
