/**
 * Fleet slice tests
 *
 * Tests state transitions for fleet status, agents, and jobs
 * in the Zustand store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { createFleetSlice, type FleetSlice } from "../fleet-slice";

// =============================================================================
// Helpers
// =============================================================================

function createTestStore() {
  return create<FleetSlice>()((...args) => createFleetSlice(...args));
}

// =============================================================================
// Tests
// =============================================================================

describe("Fleet Slice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe("initial state", () => {
    it("has null fleet status", () => {
      expect(store.getState().fleetStatus).toBeNull();
    });

    it("has empty agents array", () => {
      expect(store.getState().agents).toEqual([]);
    });

    it("has empty recent jobs array", () => {
      expect(store.getState().recentJobs).toEqual([]);
    });

    it("has disconnected connection status", () => {
      expect(store.getState().connectionStatus).toBe("disconnected");
    });

    it("has null lastUpdated", () => {
      expect(store.getState().lastUpdated).toBeNull();
    });
  });

  describe("setFleetStatus", () => {
    it("updates fleet status", () => {
      const status = {
        state: "running" as const,
        uptimeSeconds: 60,
        initializedAt: "2025-01-01T00:00:00Z",
        startedAt: "2025-01-01T00:00:00Z",
        stoppedAt: null,
        counts: {
          totalAgents: 2,
          runningAgents: 1,
          idleAgents: 1,
          errorAgents: 0,
          totalSchedules: 3,
          runningSchedules: 1,
          runningJobs: 1,
        },
        scheduler: {
          status: "running" as const,
          checkCount: 5,
          triggerCount: 1,
          lastCheckAt: "2025-01-01T00:01:00Z",
          checkIntervalMs: 5000,
        },
      };

      store.getState().setFleetStatus(status);

      expect(store.getState().fleetStatus).toEqual(status);
      expect(store.getState().lastUpdated).not.toBeNull();
    });
  });

  describe("setAgents", () => {
    it("updates agents array", () => {
      const agents = [
        {
          name: "coder",
          qualifiedName: "coder",
          fleetPath: [] as string[],
          status: "running" as const,
          currentJobId: "job-1",
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      ];

      store.getState().setAgents(agents);

      expect(store.getState().agents).toEqual(agents);
      expect(store.getState().lastUpdated).not.toBeNull();
    });

    it("replaces existing agents", () => {
      store.getState().setAgents([
        {
          name: "old-agent",
          qualifiedName: "old-agent",
          fleetPath: [],
          status: "idle" as const,
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      ]);

      const newAgents = [
        {
          name: "new-agent",
          qualifiedName: "new-agent",
          fleetPath: [],
          status: "running" as const,
          currentJobId: "j1",
          lastJobId: null,
          maxConcurrent: 2,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 1,
          schedules: [],
        },
      ];

      store.getState().setAgents(newAgents);

      expect(store.getState().agents).toHaveLength(1);
      expect(store.getState().agents[0].name).toBe("new-agent");
    });
  });

  describe("updateAgent", () => {
    it("adds a new agent on agent:started", () => {
      const payload = {
        agent: {
          name: "coder",
          qualifiedName: "coder",
          fleetPath: [] as string[],
          status: "running" as const,
          currentJobId: "job-1",
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      };

      store.getState().updateAgent(payload);

      expect(store.getState().agents).toHaveLength(1);
      expect(store.getState().agents[0].name).toBe("coder");
      expect(store.getState().agents[0].qualifiedName).toBe("coder");
    });

    it("updates existing agent on agent:started using qualifiedName", () => {
      store.getState().setAgents([
        {
          name: "coder",
          qualifiedName: "herdctl.coder",
          fleetPath: ["herdctl"],
          status: "idle" as const,
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      ]);

      store.getState().updateAgent({
        agent: {
          name: "coder",
          qualifiedName: "herdctl.coder",
          fleetPath: ["herdctl"],
          status: "running" as const,
          currentJobId: "job-1",
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      });

      expect(store.getState().agents).toHaveLength(1);
      expect(store.getState().agents[0].status).toBe("running");
      expect(store.getState().agents[0].currentJobId).toBe("job-1");
    });

    it("updates agent on agent:stopped using qualifiedName", () => {
      store.getState().setAgents([
        {
          name: "coder",
          qualifiedName: "herdctl.coder",
          fleetPath: ["herdctl"],
          status: "running" as const,
          currentJobId: "job-1",
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      ]);

      store.getState().updateAgent({
        agentName: "herdctl.coder",
        reason: "completed",
      } as any);

      expect(store.getState().agents[0].status).toBe("idle");
      expect(store.getState().agents[0].currentJobId).toBeNull();
    });

    it("does nothing for stopped event with unknown agent", () => {
      store.getState().updateAgent({
        agentName: "nonexistent",
        reason: "completed",
      } as any);

      expect(store.getState().agents).toHaveLength(0);
    });
  });

  describe("addJob", () => {
    it("adds a new job to recent jobs", () => {
      store.getState().addJob({
        agentName: "coder",
        jobId: "job-1",
        prompt: "Fix bug",
      });

      const { recentJobs } = store.getState();
      expect(recentJobs).toHaveLength(1);
      expect(recentJobs[0].jobId).toBe("job-1");
      expect(recentJobs[0].agentName).toBe("coder");
      expect(recentJobs[0].status).toBe("running");
    });

    it("adds new jobs to the front", () => {
      store.getState().addJob({ agentName: "coder", jobId: "job-1", prompt: "First" });
      store.getState().addJob({ agentName: "coder", jobId: "job-2", prompt: "Second" });

      const { recentJobs } = store.getState();
      expect(recentJobs[0].jobId).toBe("job-2");
      expect(recentJobs[1].jobId).toBe("job-1");
    });

    it("limits to 50 recent jobs", () => {
      for (let i = 0; i < 55; i++) {
        store.getState().addJob({
          agentName: "coder",
          jobId: `job-${i}`,
          prompt: `Task ${i}`,
        });
      }

      expect(store.getState().recentJobs).toHaveLength(50);
      // Most recent should be first
      expect(store.getState().recentJobs[0].jobId).toBe("job-54");
    });
  });

  describe("completeJob", () => {
    it("marks a job as completed", () => {
      store.getState().addJob({ agentName: "coder", jobId: "job-1", prompt: "Task" });

      store.getState().completeJob({
        agentName: "coder",
        jobId: "job-1",
        exitCode: 0,
      });

      const { recentJobs } = store.getState();
      expect(recentJobs[0].status).toBe("completed");
      expect(recentJobs[0].exitCode).toBe(0);
      expect(recentJobs[0].completedAt).toBeDefined();
    });

    it("does nothing for unknown job", () => {
      store.getState().addJob({ agentName: "coder", jobId: "job-1", prompt: "Task" });

      store.getState().completeJob({
        agentName: "coder",
        jobId: "unknown",
        exitCode: 0,
      });

      expect(store.getState().recentJobs[0].status).toBe("running");
    });
  });

  describe("failJob", () => {
    it("marks a job as failed", () => {
      store.getState().addJob({ agentName: "coder", jobId: "job-1", prompt: "Task" });

      store.getState().failJob({
        agentName: "coder",
        jobId: "job-1",
        error: "Timeout exceeded",
      });

      const { recentJobs } = store.getState();
      expect(recentJobs[0].status).toBe("failed");
      expect(recentJobs[0].error).toBe("Timeout exceeded");
      expect(recentJobs[0].completedAt).toBeDefined();
    });

    it("does nothing for unknown job", () => {
      store.getState().failJob({
        agentName: "coder",
        jobId: "unknown",
        error: "Error",
      });

      expect(store.getState().recentJobs).toHaveLength(0);
    });
  });

  describe("cancelJob", () => {
    it("marks a job as cancelled", () => {
      store.getState().addJob({ agentName: "coder", jobId: "job-1", prompt: "Task" });

      store.getState().cancelJob({
        agentName: "coder",
        jobId: "job-1",
        reason: "User requested",
      });

      const { recentJobs } = store.getState();
      expect(recentJobs[0].status).toBe("cancelled");
      expect(recentJobs[0].error).toBe("User requested");
      expect(recentJobs[0].completedAt).toBeDefined();
    });

    it("does nothing for unknown job", () => {
      store.getState().cancelJob({
        agentName: "coder",
        jobId: "unknown",
        reason: "Cancelled",
      });

      expect(store.getState().recentJobs).toHaveLength(0);
    });
  });

  describe("setConnectionStatus", () => {
    it("updates connection status", () => {
      store.getState().setConnectionStatus("connected");
      expect(store.getState().connectionStatus).toBe("connected");

      store.getState().setConnectionStatus("reconnecting");
      expect(store.getState().connectionStatus).toBe("reconnecting");

      store.getState().setConnectionStatus("disconnected");
      expect(store.getState().connectionStatus).toBe("disconnected");
    });

    it("updates lastUpdated timestamp", () => {
      store.getState().setConnectionStatus("connected");
      expect(store.getState().lastUpdated).not.toBeNull();
    });
  });
});
