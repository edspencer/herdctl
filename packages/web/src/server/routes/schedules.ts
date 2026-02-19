/**
 * Schedule REST API routes
 *
 * Provides endpoints for retrieving and managing schedule information,
 * including triggering agents and enabling/disabling schedules.
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

  /**
   * POST /api/agents/:name/trigger
   *
   * Triggers a job for the specified agent.
   * Optionally targets a specific schedule and/or overrides the prompt.
   *
   * @param name - Agent name (URL parameter)
   * @body scheduleName - Optional schedule name to trigger
   * @body prompt - Optional prompt override
   */
  server.post<{
    Params: { name: string };
    Body: { scheduleName?: string; prompt?: string };
  }>("/api/agents/:name/trigger", async (request, reply) => {
    try {
      const { name } = request.params;
      const { scheduleName, prompt } = request.body ?? {};
      const result = await fleetManager.trigger(name, scheduleName, { prompt });
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      return reply.status(500).send({
        error: `Failed to trigger agent: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * POST /api/schedules/:agentName/:scheduleName/enable
   *
   * Enables a disabled schedule.
   *
   * @param agentName - Agent name (URL parameter)
   * @param scheduleName - Schedule name (URL parameter)
   */
  server.post<{
    Params: { agentName: string; scheduleName: string };
  }>("/api/schedules/:agentName/:scheduleName/enable", async (request, reply) => {
    try {
      const { agentName, scheduleName } = request.params;
      const schedule = await fleetManager.enableSchedule(agentName, scheduleName);
      return reply.send(schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      return reply.status(500).send({
        error: `Failed to enable schedule: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * POST /api/schedules/:agentName/:scheduleName/disable
   *
   * Disables an active schedule.
   *
   * @param agentName - Agent name (URL parameter)
   * @param scheduleName - Schedule name (URL parameter)
   */
  server.post<{
    Params: { agentName: string; scheduleName: string };
  }>("/api/schedules/:agentName/:scheduleName/disable", async (request, reply) => {
    try {
      const { agentName, scheduleName } = request.params;
      const schedule = await fleetManager.disableSchedule(agentName, scheduleName);
      return reply.send(schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      return reply.status(500).send({
        error: `Failed to disable schedule: ${message}`,
        statusCode: 500,
      });
    }
  });
}
