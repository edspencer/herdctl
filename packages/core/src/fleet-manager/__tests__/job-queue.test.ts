/**
 * Tests for JobQueue (US-10: Concurrency Control)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { JobQueue } from "../job-queue.js";
import type { QueuedJob, ScheduleSkipResult } from "../job-queue.js";

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue({
      defaultAgentConcurrency: 1,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  describe("constructor", () => {
    it("should use default concurrency of 1", () => {
      const q = new JobQueue();
      expect(q.getDefaultAgentConcurrency()).toBe(1);
    });

    it("should accept custom defaultAgentConcurrency", () => {
      const q = new JobQueue({ defaultAgentConcurrency: 3 });
      expect(q.getDefaultAgentConcurrency()).toBe(3);
    });

    it("should accept fleetConcurrency limit", () => {
      const q = new JobQueue({ fleetConcurrency: 10 });
      expect(q.getFleetConcurrency()).toBe(10);
    });

    it("should default fleetConcurrency to null", () => {
      expect(queue.getFleetConcurrency()).toBeNull();
    });
  });

  describe("setAgentConcurrency", () => {
    it("should set per-agent concurrency limit", () => {
      queue.setAgentConcurrency("agent-a", 5);
      expect(queue.getAgentConcurrency("agent-a")).toBe(5);
    });

    it("should throw if limit is less than 1", () => {
      expect(() => queue.setAgentConcurrency("agent-a", 0)).toThrow(
        "Concurrency limit must be >= 1"
      );
    });

    it("should use default for agents without specific limit", () => {
      queue.setAgentConcurrency("agent-a", 5);
      expect(queue.getAgentConcurrency("agent-b")).toBe(1);
    });
  });

  describe("checkCapacity", () => {
    it("should return canRun: true when no jobs running", () => {
      const result = queue.checkCapacity("agent-a");
      expect(result.canRun).toBe(true);
    });

    it("should return canRun: false when at agent capacity", () => {
      queue.markRunning("agent-a", "job-1");
      const result = queue.checkCapacity("agent-a");
      expect(result.canRun).toBe(false);
      expect(result.reason).toBe("agent_at_capacity");
    });

    it("should respect per-agent concurrency limits", () => {
      queue.setAgentConcurrency("agent-a", 2);
      queue.markRunning("agent-a", "job-1");

      const result = queue.checkCapacity("agent-a");
      expect(result.canRun).toBe(true);

      queue.markRunning("agent-a", "job-2");
      const result2 = queue.checkCapacity("agent-a");
      expect(result2.canRun).toBe(false);
      expect(result2.reason).toBe("agent_at_capacity");
    });

    it("should check fleet-wide capacity", () => {
      const q = new JobQueue({
        defaultAgentConcurrency: 2,
        fleetConcurrency: 2,
      });

      q.markRunning("agent-a", "job-1");
      q.markRunning("agent-b", "job-2");

      // Fleet is at capacity, even though agent-c has capacity
      const result = q.checkCapacity("agent-c");
      expect(result.canRun).toBe(false);
      expect(result.reason).toBe("fleet_at_capacity");
    });
  });

  describe("enqueue", () => {
    it("should return immediately if capacity available", () => {
      const result = queue.enqueue({ agentName: "agent-a" });
      expect(result).not.toBeNull();
      expect(result!.queued).toBe(false);
      expect(result!.jobId).toMatch(/^queued-/);
    });

    it("should queue job when at agent capacity", () => {
      queue.markRunning("agent-a", "job-1");
      const result = queue.enqueue({ agentName: "agent-a" });

      expect(result).not.toBeNull();
      expect(result!.queued).toBe(true);
      expect(result!.position).toBe(1);
      expect(result!.reason).toBe("agent_at_capacity");
    });

    it("should queue job when at fleet capacity", () => {
      const q = new JobQueue({ fleetConcurrency: 1 });
      q.markRunning("agent-a", "job-1");

      const result = q.enqueue({ agentName: "agent-b" });
      expect(result).not.toBeNull();
      expect(result!.queued).toBe(true);
      expect(result!.reason).toBe("fleet_at_capacity");
    });

    it("should NOT queue scheduled triggers - emit skip event instead", () => {
      queue.markRunning("agent-a", "job-1");
      const skipHandler = vi.fn();
      queue.on("schedule:skipped", skipHandler);

      const result = queue.enqueue({
        agentName: "agent-a",
        scheduleName: "hourly",
        isScheduled: true,
      });

      expect(result).toBeNull();
      expect(skipHandler).toHaveBeenCalledTimes(1);

      const skipResult: ScheduleSkipResult = skipHandler.mock.calls[0][0];
      expect(skipResult.agentName).toBe("agent-a");
      expect(skipResult.scheduleName).toBe("hourly");
      expect(skipResult.reason).toBe("agent_at_capacity");
    });

    it("should emit job:queued event when queued", () => {
      const handler = vi.fn();
      queue.on("job:queued", handler);
      queue.markRunning("agent-a", "job-1");

      queue.enqueue({ agentName: "agent-a" });

      expect(handler).toHaveBeenCalledTimes(1);
      const [job, position] = handler.mock.calls[0];
      expect(job.agentName).toBe("agent-a");
      expect(position).toBe(1);
    });
  });

  describe("dequeue", () => {
    it("should return null for empty queue", () => {
      expect(queue.dequeue("agent-a")).toBeNull();
    });

    it("should dequeue in FIFO order", () => {
      queue.markRunning("agent-a", "running-job");

      queue.enqueue({ agentName: "agent-a" });
      queue.enqueue({ agentName: "agent-a" });

      queue.markCompleted("agent-a", "running-job");

      const first = queue.dequeue("agent-a");
      const second = queue.dequeue("agent-a");

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.queuedAt < second!.queuedAt || first!.queuedAt === second!.queuedAt).toBe(true);
    });

    it("should emit job:dequeued event", () => {
      const handler = vi.fn();
      queue.on("job:dequeued", handler);

      queue.markRunning("agent-a", "running-job");
      queue.enqueue({ agentName: "agent-a" });

      queue.dequeue("agent-a");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("priority ordering", () => {
    it("should order by priority (lower number = higher priority)", () => {
      queue.markRunning("agent-a", "running-job");

      // Enqueue with different priorities
      queue.enqueue({ agentName: "agent-a", priority: 5 });
      queue.enqueue({ agentName: "agent-a", priority: 1 }); // Highest
      queue.enqueue({ agentName: "agent-a", priority: 10 }); // Lowest
      queue.enqueue({ agentName: "agent-a", priority: 3 });

      queue.markCompleted("agent-a", "running-job");

      const first = queue.dequeue("agent-a");
      const second = queue.dequeue("agent-a");
      const third = queue.dequeue("agent-a");
      const fourth = queue.dequeue("agent-a");

      expect(first!.priority).toBe(1);
      expect(second!.priority).toBe(3);
      expect(third!.priority).toBe(5);
      expect(fourth!.priority).toBe(10);
    });

    it("should maintain FIFO within same priority", () => {
      queue.markRunning("agent-a", "running-job");

      // Enqueue multiple with same priority
      const result1 = queue.enqueue({ agentName: "agent-a", priority: 5 });
      const result2 = queue.enqueue({ agentName: "agent-a", priority: 5 });
      const result3 = queue.enqueue({ agentName: "agent-a", priority: 5 });

      queue.markCompleted("agent-a", "running-job");

      const first = queue.dequeue("agent-a");
      const second = queue.dequeue("agent-a");
      const third = queue.dequeue("agent-a");

      expect(first!.id).toBe(result1!.jobId);
      expect(second!.id).toBe(result2!.jobId);
      expect(third!.id).toBe(result3!.jobId);
    });
  });

  describe("running job tracking", () => {
    it("should track running count per agent", () => {
      expect(queue.getRunningCount("agent-a")).toBe(0);

      queue.markRunning("agent-a", "job-1");
      expect(queue.getRunningCount("agent-a")).toBe(1);

      queue.markRunning("agent-a", "job-2");
      expect(queue.getRunningCount("agent-a")).toBe(2);
    });

    it("should track total running count", () => {
      expect(queue.getTotalRunningCount()).toBe(0);

      queue.markRunning("agent-a", "job-1");
      queue.markRunning("agent-b", "job-2");
      expect(queue.getTotalRunningCount()).toBe(2);
    });

    it("should decrement counts on completion", () => {
      queue.markRunning("agent-a", "job-1");
      queue.markCompleted("agent-a", "job-1");

      expect(queue.getRunningCount("agent-a")).toBe(0);
      expect(queue.getTotalRunningCount()).toBe(0);
    });

    it("should emit capacity:available on completion", () => {
      const handler = vi.fn();
      queue.on("capacity:available", handler);

      queue.markRunning("agent-a", "job-1");
      queue.markCompleted("agent-a", "job-1");

      expect(handler).toHaveBeenCalledWith("agent-a", 1);
    });

    it("should return running job IDs", () => {
      queue.markRunning("agent-a", "job-1");
      queue.markRunning("agent-a", "job-2");

      const ids = queue.getRunningJobIds("agent-a");
      expect(ids.has("job-1")).toBe(true);
      expect(ids.has("job-2")).toBe(true);
    });
  });

  describe("queue status", () => {
    it("should return agent queue status", () => {
      queue.setAgentConcurrency("agent-a", 3);
      queue.markRunning("agent-a", "job-1");
      queue.markRunning("agent-a", "job-2");
      queue.enqueue({ agentName: "agent-a" }); // This will be queued since running is at limit

      const status = queue.getAgentQueueStatus("agent-a");
      expect(status.agentName).toBe("agent-a");
      expect(status.runningCount).toBe(2);
      expect(status.maxConcurrent).toBe(3);
      // Since we have capacity (2/3), the job won't be queued
      expect(status.queuedCount).toBe(0);
    });

    it("should return overall queue status", () => {
      const q = new JobQueue({
        defaultAgentConcurrency: 2,
        fleetConcurrency: 5,
      });

      q.markRunning("agent-a", "job-1");
      q.markRunning("agent-b", "job-2");

      const status = q.getQueueStatus();
      expect(status.totalRunning).toBe(2);
      expect(status.fleetConcurrency).toBe(5);
      expect(status.defaultAgentConcurrency).toBe(2);
    });

    it("should return queue depth", () => {
      queue.markRunning("agent-a", "job-1");
      queue.enqueue({ agentName: "agent-a" });
      queue.enqueue({ agentName: "agent-a" });

      expect(queue.getQueueDepth("agent-a")).toBe(2);
      expect(queue.getTotalQueueDepth()).toBe(2);
    });
  });

  describe("peek", () => {
    it("should return null for empty queue", () => {
      expect(queue.peek("agent-a")).toBeNull();
    });

    it("should return next job without removing it", () => {
      queue.markRunning("agent-a", "job-1");
      queue.enqueue({ agentName: "agent-a" });

      const peeked = queue.peek("agent-a");
      expect(peeked).not.toBeNull();

      const peekedAgain = queue.peek("agent-a");
      expect(peekedAgain!.id).toBe(peeked!.id);
    });
  });

  describe("remove", () => {
    it("should remove a specific job from queue", () => {
      queue.markRunning("agent-a", "running");
      const result = queue.enqueue({ agentName: "agent-a" });

      expect(queue.remove(result!.jobId)).toBe(true);
      expect(queue.getQueueDepth("agent-a")).toBe(0);
    });

    it("should return false for non-existent job", () => {
      expect(queue.remove("non-existent")).toBe(false);
    });
  });

  describe("clear operations", () => {
    it("should clear all queued jobs", () => {
      queue.markRunning("agent-a", "r1");
      queue.markRunning("agent-b", "r2");
      queue.enqueue({ agentName: "agent-a" });
      queue.enqueue({ agentName: "agent-b" });

      queue.clearQueue();

      expect(queue.getTotalQueueDepth()).toBe(0);
      // Running jobs should not be affected
      expect(queue.getTotalRunningCount()).toBe(2);
    });

    it("should clear agent queue", () => {
      queue.markRunning("agent-a", "r1");
      queue.markRunning("agent-b", "r2");
      queue.enqueue({ agentName: "agent-a" });
      queue.enqueue({ agentName: "agent-b" });

      const cleared = queue.clearAgentQueue("agent-a");
      expect(cleared).toBe(1);
      expect(queue.getQueueDepth("agent-a")).toBe(0);
      expect(queue.getQueueDepth("agent-b")).toBe(1);
    });

    it("should reset all state", () => {
      queue.setAgentConcurrency("agent-a", 5);
      queue.markRunning("agent-a", "job-1");
      queue.markRunning("agent-a", "job-2");
      queue.enqueue({ agentName: "agent-a" });

      queue.reset();

      expect(queue.getTotalRunningCount()).toBe(0);
      expect(queue.getTotalQueueDepth()).toBe(0);
      expect(queue.getAgentConcurrency("agent-a")).toBe(1); // Back to default
    });
  });
});
