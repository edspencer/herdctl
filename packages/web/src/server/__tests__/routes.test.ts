/**
 * REST API route tests for @herdctl/web
 *
 * Tests the Fastify routes using fastify.inject() for isolated testing
 * without needing a real server or network connections.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerFleetRoutes } from "../routes/fleet.js";
import { registerAgentRoutes } from "../routes/agents.js";
import { registerJobRoutes } from "../routes/jobs.js";
import { registerScheduleRoutes } from "../routes/schedules.js";

// =============================================================================
// Mock FleetManager
// =============================================================================

function createMockFleetManager() {
  return {
    getFleetStatus: vi.fn(),
    getAgentInfo: vi.fn(),
    getAgentInfoByName: vi.fn(),
    getSchedules: vi.fn(),
    trigger: vi.fn(),
    enableSchedule: vi.fn(),
    disableSchedule: vi.fn(),
    cancelJob: vi.fn(),
    forkJob: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    getStateDir: vi.fn().mockReturnValue("/tmp/test-state"),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// =============================================================================
// Fleet Routes
// =============================================================================

describe("Fleet Routes", () => {
  let server: FastifyInstance;
  let mockFM: ReturnType<typeof createMockFleetManager>;

  beforeEach(async () => {
    server = Fastify();
    mockFM = createMockFleetManager();
    registerFleetRoutes(server, mockFM as any);
    await server.ready();
  });

  describe("GET /api/fleet/status", () => {
    it("returns fleet status", async () => {
      const mockStatus = {
        state: "running",
        uptimeSeconds: 120,
        initializedAt: "2025-01-01T00:00:00Z",
        startedAt: "2025-01-01T00:00:00Z",
        stoppedAt: null,
        counts: {
          totalAgents: 2,
          runningAgents: 1,
          idleAgents: 1,
          errorAgents: 0,
          totalJobs: 5,
          runningJobs: 1,
          completedJobs: 3,
          failedJobs: 1,
        },
        scheduler: {
          status: "running",
          checkCount: 10,
          triggerCount: 2,
          lastCheckAt: "2025-01-01T00:02:00Z",
          checkIntervalMs: 5000,
        },
      };

      mockFM.getFleetStatus.mockResolvedValue(mockStatus);

      const response = await server.inject({
        method: "GET",
        url: "/api/fleet/status",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockStatus);
      expect(mockFM.getFleetStatus).toHaveBeenCalledOnce();
    });

    it("returns 500 when FleetManager throws", async () => {
      mockFM.getFleetStatus.mockRejectedValue(new Error("Internal failure"));

      const response = await server.inject({
        method: "GET",
        url: "/api/fleet/status",
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toContain("Internal failure");
      expect(body.statusCode).toBe(500);
    });
  });
});

// =============================================================================
// Agent Routes
// =============================================================================

describe("Agent Routes", () => {
  let server: FastifyInstance;
  let mockFM: ReturnType<typeof createMockFleetManager>;

  beforeEach(async () => {
    server = Fastify();
    mockFM = createMockFleetManager();
    registerAgentRoutes(server, mockFM as any);
    await server.ready();
  });

  describe("GET /api/agents", () => {
    it("returns agent list", async () => {
      const mockAgents = [
        {
          name: "coder",
          status: "running",
          currentJobId: "job-1",
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 2,
          schedules: [],
        },
        {
          name: "reviewer",
          status: "idle",
          currentJobId: null,
          lastJobId: "job-2",
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 1,
          schedules: [],
        },
      ];

      mockFM.getAgentInfo.mockResolvedValue(mockAgents);

      const response = await server.inject({
        method: "GET",
        url: "/api/agents",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockAgents);
      expect(mockFM.getAgentInfo).toHaveBeenCalledOnce();
    });

    it("returns 500 when FleetManager throws", async () => {
      mockFM.getAgentInfo.mockRejectedValue(new Error("DB error"));

      const response = await server.inject({
        method: "GET",
        url: "/api/agents",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("DB error");
    });
  });

  describe("GET /api/agents/:name", () => {
    it("returns a single agent", async () => {
      const mockAgent = {
        name: "coder",
        status: "running",
        currentJobId: "job-1",
        lastJobId: null,
        maxConcurrent: 1,
        runningCount: 1,
        errorMessage: null,
        scheduleCount: 0,
        schedules: [],
      };

      mockFM.getAgentInfoByName.mockResolvedValue(mockAgent);

      const response = await server.inject({
        method: "GET",
        url: "/api/agents/coder",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockAgent);
      expect(mockFM.getAgentInfoByName).toHaveBeenCalledWith("coder");
    });

    it("returns 404 when agent not found", async () => {
      mockFM.getAgentInfoByName.mockRejectedValue(
        new Error("Agent not found: unknown-agent")
      );

      const response = await server.inject({
        method: "GET",
        url: "/api/agents/unknown-agent",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().statusCode).toBe(404);
    });

    it("returns 500 for unexpected errors", async () => {
      mockFM.getAgentInfoByName.mockRejectedValue(
        new Error("Unexpected error")
      );

      const response = await server.inject({
        method: "GET",
        url: "/api/agents/coder",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Unexpected error");
    });
  });
});

// =============================================================================
// Job Routes
// =============================================================================

describe("Job Routes", () => {
  let server: FastifyInstance;
  let mockFM: ReturnType<typeof createMockFleetManager>;
  let mockListJobs: Mock;

  beforeEach(async () => {
    server = Fastify();
    mockFM = createMockFleetManager();
    mockListJobs = vi.fn();
    registerJobRoutes(server, mockFM as any, mockListJobs as any);
    await server.ready();
  });

  describe("GET /api/jobs", () => {
    it("returns paginated jobs", async () => {
      const mockJobs = [
        {
          id: "job-1",
          agent: "coder",
          prompt: "Fix bug",
          status: "completed",
          started_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "job-2",
          agent: "reviewer",
          prompt: "Review PR",
          status: "running",
          started_at: "2025-01-01T00:01:00Z",
        },
      ];

      mockListJobs.mockResolvedValue({ jobs: mockJobs, errors: [] });

      const response = await server.inject({
        method: "GET",
        url: "/api/jobs",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.jobs).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it("respects limit and offset query params", async () => {
      const manyJobs = Array.from({ length: 10 }, (_, i) => ({
        id: `job-${i}`,
        agent: "coder",
        prompt: `Task ${i}`,
        status: "completed",
        started_at: "2025-01-01T00:00:00Z",
      }));

      mockListJobs.mockResolvedValue({ jobs: manyJobs, errors: [] });

      const response = await server.inject({
        method: "GET",
        url: "/api/jobs?limit=3&offset=2",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.jobs).toHaveLength(3);
      expect(body.jobs[0].jobId).toBe("job-2");
      expect(body.total).toBe(10);
      expect(body.limit).toBe(3);
      expect(body.offset).toBe(2);
    });

    it("clamps limit to max 100", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: [] });

      const response = await server.inject({
        method: "GET",
        url: "/api/jobs?limit=999",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().limit).toBe(100);
    });

    it("passes filter params to listJobs", async () => {
      mockListJobs.mockResolvedValue({ jobs: [], errors: [] });

      await server.inject({
        method: "GET",
        url: "/api/jobs?agentName=coder&status=running",
      });

      expect(mockListJobs).toHaveBeenCalledWith(
        "/tmp/test-state/jobs",
        { agent: "coder", status: "running" }
      );
    });

    it("returns 500 on error", async () => {
      mockListJobs.mockRejectedValue(new Error("Disk error"));

      const response = await server.inject({
        method: "GET",
        url: "/api/jobs",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Disk error");
    });
  });

  describe("POST /api/jobs/:id/cancel", () => {
    it("cancels a job successfully", async () => {
      const mockResult = {
        jobId: "job-1",
        success: true,
        terminationType: "graceful",
        canceledAt: "2025-01-01T00:05:00Z",
      };

      mockFM.cancelJob.mockResolvedValue(mockResult);

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/job-1/cancel",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResult);
      expect(mockFM.cancelJob).toHaveBeenCalledWith("job-1");
    });

    it("returns 404 when job not found", async () => {
      mockFM.cancelJob.mockRejectedValue(new Error("Job not found: missing"));

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/missing/cancel",
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 500 on unexpected error", async () => {
      mockFM.cancelJob.mockRejectedValue(new Error("Process kill failed"));

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/job-1/cancel",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Process kill failed");
    });
  });

  describe("POST /api/jobs/:id/fork", () => {
    it("forks a job successfully", async () => {
      const mockResult = {
        jobId: "job-2",
        forkedFromJobId: "job-1",
        agentName: "coder",
        startedAt: "2025-01-01T00:06:00Z",
      };

      mockFM.forkJob.mockResolvedValue(mockResult);

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/job-1/fork",
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResult);
      expect(mockFM.forkJob).toHaveBeenCalledWith("job-1", undefined);
    });

    it("passes prompt override when provided", async () => {
      mockFM.forkJob.mockResolvedValue({
        jobId: "job-3",
        forkedFromJobId: "job-1",
        agentName: "coder",
        startedAt: "2025-01-01T00:07:00Z",
        prompt: "New prompt",
      });

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/job-1/fork",
        payload: { prompt: "New prompt" },
      });

      expect(response.statusCode).toBe(200);
      expect(mockFM.forkJob).toHaveBeenCalledWith("job-1", { prompt: "New prompt" });
    });

    it("returns 404 when original job not found", async () => {
      mockFM.forkJob.mockRejectedValue(new Error("Job not found: missing"));

      const response = await server.inject({
        method: "POST",
        url: "/api/jobs/missing/fork",
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// =============================================================================
// Schedule Routes
// =============================================================================

describe("Schedule Routes", () => {
  let server: FastifyInstance;
  let mockFM: ReturnType<typeof createMockFleetManager>;

  beforeEach(async () => {
    server = Fastify();
    mockFM = createMockFleetManager();
    registerScheduleRoutes(server, mockFM as any);
    await server.ready();
  });

  describe("GET /api/schedules", () => {
    it("returns schedule list", async () => {
      const mockSchedules = [
        {
          name: "daily-review",
          agentName: "reviewer",
          type: "cron",
          cron: "0 9 * * *",
          status: "idle",
          lastRunAt: null,
          nextRunAt: "2025-01-02T09:00:00Z",
          runCount: 0,
        },
        {
          name: "hourly-check",
          agentName: "coder",
          type: "interval",
          interval: "1h",
          status: "running",
          lastRunAt: "2025-01-01T08:00:00Z",
          nextRunAt: "2025-01-01T09:00:00Z",
          runCount: 5,
        },
      ];

      mockFM.getSchedules.mockResolvedValue(mockSchedules);

      const response = await server.inject({
        method: "GET",
        url: "/api/schedules",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockSchedules);
      expect(mockFM.getSchedules).toHaveBeenCalledOnce();
    });

    it("returns 500 when FleetManager throws", async () => {
      mockFM.getSchedules.mockRejectedValue(new Error("Scheduler error"));

      const response = await server.inject({
        method: "GET",
        url: "/api/schedules",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Scheduler error");
    });
  });

  describe("POST /api/agents/:name/trigger", () => {
    it("triggers an agent successfully", async () => {
      const mockResult = {
        jobId: "job-1",
        agentName: "coder",
        scheduleName: null,
        startedAt: "2025-01-01T00:00:00Z",
      };

      mockFM.trigger.mockResolvedValue(mockResult);

      const response = await server.inject({
        method: "POST",
        url: "/api/agents/coder/trigger",
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResult);
      expect(mockFM.trigger).toHaveBeenCalledWith("coder", undefined, { prompt: undefined });
    });

    it("passes schedule name and prompt", async () => {
      mockFM.trigger.mockResolvedValue({
        jobId: "job-2",
        agentName: "coder",
        scheduleName: "daily-review",
        startedAt: "2025-01-01T00:00:00Z",
        prompt: "Custom task",
      });

      const response = await server.inject({
        method: "POST",
        url: "/api/agents/coder/trigger",
        payload: { scheduleName: "daily-review", prompt: "Custom task" },
      });

      expect(response.statusCode).toBe(200);
      expect(mockFM.trigger).toHaveBeenCalledWith(
        "coder",
        "daily-review",
        { prompt: "Custom task" }
      );
    });

    it("returns 404 when agent not found", async () => {
      mockFM.trigger.mockRejectedValue(
        new Error("Agent not found: missing")
      );

      const response = await server.inject({
        method: "POST",
        url: "/api/agents/missing/trigger",
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 500 on unexpected error", async () => {
      mockFM.trigger.mockRejectedValue(new Error("Queue full"));

      const response = await server.inject({
        method: "POST",
        url: "/api/agents/coder/trigger",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("Queue full");
    });
  });

  describe("POST /api/schedules/:agentName/:scheduleName/enable", () => {
    it("enables a schedule", async () => {
      const mockSchedule = {
        name: "daily-review",
        agentName: "reviewer",
        type: "cron",
        status: "idle",
      };

      mockFM.enableSchedule.mockResolvedValue(mockSchedule);

      const response = await server.inject({
        method: "POST",
        url: "/api/schedules/reviewer/daily-review/enable",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockSchedule);
      expect(mockFM.enableSchedule).toHaveBeenCalledWith("reviewer", "daily-review");
    });

    it("returns 404 when schedule not found", async () => {
      mockFM.enableSchedule.mockRejectedValue(
        new Error("Schedule not found: nonexistent")
      );

      const response = await server.inject({
        method: "POST",
        url: "/api/schedules/reviewer/nonexistent/enable",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /api/schedules/:agentName/:scheduleName/disable", () => {
    it("disables a schedule", async () => {
      const mockSchedule = {
        name: "daily-review",
        agentName: "reviewer",
        type: "cron",
        status: "disabled",
      };

      mockFM.disableSchedule.mockResolvedValue(mockSchedule);

      const response = await server.inject({
        method: "POST",
        url: "/api/schedules/reviewer/daily-review/disable",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockSchedule);
      expect(mockFM.disableSchedule).toHaveBeenCalledWith("reviewer", "daily-review");
    });

    it("returns 404 when schedule not found", async () => {
      mockFM.disableSchedule.mockRejectedValue(
        new Error("Schedule not found: nonexistent")
      );

      const response = await server.inject({
        method: "POST",
        url: "/api/schedules/reviewer/nonexistent/disable",
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 500 on unexpected error", async () => {
      mockFM.disableSchedule.mockRejectedValue(new Error("State save failed"));

      const response = await server.inject({
        method: "POST",
        url: "/api/schedules/reviewer/daily-review/disable",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("State save failed");
    });
  });
});
