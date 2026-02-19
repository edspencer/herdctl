/**
 * Job REST API routes
 *
 * Provides endpoints for retrieving job information with pagination and filtering,
 * as well as job control actions (cancel, fork).
 */

import type { FastifyInstance } from "fastify";
import type { FleetManager, JobStatus, listJobs, ResolvedAgent } from "@herdctl/core";
import { createLogger, resolveWorkingDirectory } from "@herdctl/core";

const logger = createLogger("web:jobs");

/**
 * Map a core Job object (snake_case) to a client-friendly JobSummary (camelCase)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJobToSummary(job: any, agents: ResolvedAgent[]): Record<string, unknown> {
  const agent = agents.find((a) => a.qualifiedName === job.agent);
  const workspace = agent ? resolveWorkingDirectory(agent) : undefined;

  return {
    jobId: job.id,
    agentName: job.agent,
    prompt: job.prompt ?? "",
    status: job.status,
    createdAt: job.started_at,
    startedAt: job.started_at,
    completedAt: job.finished_at ?? undefined,
    exitCode: job.exit_reason === "success" ? 0 : job.exit_reason === "error" ? 1 : undefined,
    error: undefined,
    sessionId: job.session_id ?? undefined,
    triggerType: job.trigger_type ?? "manual",
    workspace,
  };
}

/**
 * Query parameters for listing jobs
 */
interface ListJobsQuery {
  /** Maximum number of jobs to return (default: 50, max: 100) */
  limit?: number;
  /** Number of jobs to skip for pagination (default: 0) */
  offset?: number;
  /** Filter by agent qualified name (e.g., "herdctl.security-auditor") */
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
  listJobsFn: typeof listJobs,
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
      const paginatedJobs = result.jobs.slice(clampedOffset, clampedOffset + clampedLimit);

      const agents = fleetManager.getAgents();
      return reply.send({
        jobs: paginatedJobs.map((j) => mapJobToSummary(j, agents)),
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

      const agents = fleetManager.getAgents();
      return reply.send(mapJobToSummary(job, agents));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        error: `Failed to get job: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * POST /api/jobs/:id/cancel
   *
   * Cancels a running job.
   *
   * @param id - Job ID (URL parameter)
   * @returns CancelJobResult
   */
  server.post<{
    Params: { id: string };
  }>("/api/jobs/:id/cancel", async (request, reply) => {
    try {
      const { id } = request.params;
      logger.info("Cancelling job", { jobId: id });

      const result = await fleetManager.cancelJob(id);

      logger.info("Job cancelled", { jobId: id, terminationType: result.terminationType });
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      logger.error("Failed to cancel job", { error: message });
      return reply.status(500).send({
        error: `Failed to cancel job: ${message}`,
        statusCode: 500,
      });
    }
  });

  /**
   * POST /api/jobs/:id/fork
   *
   * Forks an existing job, creating a new job based on its configuration.
   * Optionally accepts a prompt override.
   *
   * @param id - Job ID to fork (URL parameter)
   * @body prompt - Optional prompt override for the forked job
   * @returns ForkJobResult
   */
  server.post<{
    Params: { id: string };
    Body: { prompt?: string };
  }>("/api/jobs/:id/fork", async (request, reply) => {
    try {
      const { id } = request.params;
      const { prompt } = request.body ?? {};

      const modifications = prompt ? { prompt } : undefined;
      logger.info("Forking job", { jobId: id, hasPromptOverride: !!prompt });

      const result = await fleetManager.forkJob(id, modifications);

      logger.info("Job forked", { originalJobId: id, newJobId: result.jobId });
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("not found")) {
        return reply.status(404).send({
          error: message,
          statusCode: 404,
        });
      }

      logger.error("Failed to fork job", { error: message });
      return reply.status(500).send({
        error: `Failed to fork job: ${message}`,
        statusCode: 500,
      });
    }
  });
}
