/**
 * Job REST API routes
 *
 * Provides endpoints for retrieving job information with pagination and filtering.
 */

import type { FastifyInstance } from "fastify";
import type { FleetManager, JobStatus, listJobs } from "@herdctl/core";

/**
 * Query parameters for listing jobs
 */
interface ListJobsQuery {
  /** Maximum number of jobs to return (default: 50, max: 100) */
  limit?: number;
  /** Number of jobs to skip for pagination (default: 0) */
  offset?: number;
  /** Filter by agent name */
  agentName?: string;
  /** Filter by job status */
  status?: JobStatus;
}

/**
 * Register job-related routes
 *
 * @param server - Fastify instance
 * @param fleetManager - FleetManager instance
 * @param listJobsFn - Function to list jobs from state directory
 */
export function registerJobRoutes(
  server: FastifyInstance,
  fleetManager: FleetManager,
  listJobsFn: typeof listJobs
): void {
  /**
   * GET /api/jobs
   *
   * Returns a paginated list of jobs with optional filtering.
   *
   * Query parameters:
   * - limit: Maximum number of jobs (default: 50, max: 100)
   * - offset: Number of jobs to skip (default: 0)
   * - agentName: Filter by agent name
   * - status: Filter by job status (pending, running, completed, failed, cancelled)
   */
  server.get<{
    Querystring: ListJobsQuery;
  }>("/api/jobs", async (request, reply) => {
    try {
      const { limit = 50, offset = 0, agentName, status } = request.query;

      // Validate and clamp limit
      const clampedLimit = Math.min(Math.max(1, limit), 100);
      const clampedOffset = Math.max(0, offset);

      // Get jobs directory from FleetManager's state directory
      const stateDir = fleetManager.getStateDir();
      const jobsDir = `${stateDir}/jobs`;

      // Build filter
      const filter: Parameters<typeof listJobsFn>[1] = {};
      if (agentName) {
        filter.agent = agentName;
      }
      if (status) {
        filter.status = status;
      }

      // List all matching jobs (listJobs already sorts by started_at desc)
      const result = await listJobsFn(jobsDir, filter);

      // Apply pagination
      const paginatedJobs = result.jobs.slice(
        clampedOffset,
        clampedOffset + clampedLimit
      );

      return reply.send({
        jobs: paginatedJobs,
        total: result.jobs.length,
        limit: clampedLimit,
        offset: clampedOffset,
        errors: result.errors,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to list jobs: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/jobs/:id
   *
   * Returns full metadata for a single job.
   *
   * @param id - Job ID (URL parameter)
   */
  server.get<{
    Params: { id: string };
  }>("/api/jobs/:id", async (request, reply) => {
    try {
      const { id } = request.params;

      // Import getJob dynamically to avoid circular dependencies
      const { getJob } = await import("@herdctl/core");

      // Get jobs directory from FleetManager's state directory
      const stateDir = fleetManager.getStateDir();
      const jobsDir = `${stateDir}/jobs`;

      const job = await getJob(jobsDir, id);

      if (!job) {
        return reply.status(404).send({
          error: `Job not found: ${id}`,
          statusCode: 404,
        });
      }

      return reply.send(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get job: ${message}`,
        statusCode: 500,
      });
    }
  });
}
