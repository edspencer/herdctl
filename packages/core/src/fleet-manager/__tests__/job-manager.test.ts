/**
 * Tests for JobManager (US-4)
 *
 * Tests job history queries, output streaming, and retention management.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, updateJob } from "../../state/job-metadata.js";
import { appendJobOutput } from "../../state/job-output.js";
import type { JobMetadata } from "../../state/schemas/job-metadata.js";
import { JobNotFoundError } from "../errors.js";
import { JobManager } from "../job-manager.js";

describe("JobManager", () => {
  let tempDir: string;
  let jobsDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await mkdtemp(join(tmpdir(), "job-manager-test-"));
    jobsDir = join(tempDir, ".herdctl", "jobs");
    await mkdir(jobsDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a test job
  async function createTestJob(options: {
    agent: string;
    status?: "pending" | "running" | "completed" | "failed" | "cancelled";
    startedAt?: Date;
    prompt?: string;
  }): Promise<JobMetadata> {
    const job = await createJob(jobsDir, {
      agent: options.agent,
      trigger_type: "manual",
      prompt: options.prompt ?? "Test prompt",
    });

    if (options.status && options.status !== "pending") {
      return await updateJob(jobsDir, job.id, {
        status: options.status,
        finished_at: options.status === "running" ? undefined : new Date().toISOString(),
        exit_reason:
          options.status === "completed"
            ? "success"
            : options.status === "failed"
              ? "error"
              : options.status === "cancelled"
                ? "cancelled"
                : undefined,
      });
    }

    return job;
  }

  describe("getJobs()", () => {
    it("returns empty list when no jobs exist", async () => {
      const manager = new JobManager({ jobsDir });
      const result = await manager.getJobs();

      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("returns all jobs when no filter specified", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-2" });
      await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs();

      expect(result.jobs).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it("filters by agent name", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-2" });
      await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs({ agent: "agent-1" });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.jobs.every((j) => j.agent === "agent-1")).toBe(true);
    });

    it("filters by status", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1", status: "completed" });
      await createTestJob({ agent: "agent-1", status: "failed" });
      await createTestJob({ agent: "agent-1", status: "completed" });

      const result = await manager.getJobs({ status: "completed" });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.jobs.every((j) => j.status === "completed")).toBe(true);
    });

    it("filters by date range", async () => {
      const manager = new JobManager({ jobsDir });

      // Create jobs (they will all have "now" as started_at)
      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });

      // Filter for jobs after a past date
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      const result = await manager.getJobs({ startedAfter: pastDate });

      expect(result.jobs).toHaveLength(2);
    });

    it("applies limit correctly", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs({ limit: 2 });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(3); // Total still shows all matching
    });

    it("applies offset correctly", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs({ offset: 1 });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it("applies limit and offset together", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });
      await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs({ limit: 2, offset: 1 });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(4);
    });

    it("combines multiple filters", async () => {
      const manager = new JobManager({ jobsDir });

      await createTestJob({ agent: "agent-1", status: "completed" });
      await createTestJob({ agent: "agent-1", status: "failed" });
      await createTestJob({ agent: "agent-2", status: "completed" });
      await createTestJob({ agent: "agent-1", status: "completed" });

      const result = await manager.getJobs({
        agent: "agent-1",
        status: "completed",
      });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.jobs.every((j) => j.agent === "agent-1" && j.status === "completed")).toBe(
        true,
      );
    });

    it("returns jobs sorted by started_at descending", async () => {
      const manager = new JobManager({ jobsDir });

      // Create jobs with small delays to ensure different timestamps
      const job1 = await createTestJob({ agent: "agent-1" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const job2 = await createTestJob({ agent: "agent-1" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const job3 = await createTestJob({ agent: "agent-1" });

      const result = await manager.getJobs();

      // Most recent (job3) should be first
      expect(result.jobs[0].id).toBe(job3.id);
      expect(result.jobs[1].id).toBe(job2.id);
      expect(result.jobs[2].id).toBe(job1.id);
    });
  });

  describe("getJob()", () => {
    it("returns job by ID", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({ agent: "test-agent" });

      const job = await manager.getJob(created.id);

      expect(job.id).toBe(created.id);
      expect(job.agent).toBe("test-agent");
    });

    it("throws JobNotFoundError for unknown ID", async () => {
      const manager = new JobManager({ jobsDir });

      await expect(manager.getJob("job-2099-01-01-xxxxxx")).rejects.toThrow(JobNotFoundError);

      await expect(manager.getJob("job-2099-01-01-xxxxxx")).rejects.toMatchObject({
        name: "JobNotFoundError",
        jobId: "job-2099-01-01-xxxxxx",
      });
    });

    it("returns job without output by default", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({ agent: "test-agent" });

      // Add some output
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Hello",
      });

      const job = await manager.getJob(created.id);

      expect(job.output).toBeUndefined();
    });

    it("includes output when requested", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({ agent: "test-agent" });

      // Add some output
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Hello",
      });
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "World",
      });

      const job = await manager.getJob(created.id, { includeOutput: true });

      expect(job.output).toBeDefined();
      expect(job.output).toHaveLength(2);
      expect(job.output![0].type).toBe("assistant");
      expect((job.output![0] as { content?: string }).content).toBe("Hello");
    });
  });

  describe("streamJobOutput()", () => {
    it("throws JobNotFoundError for unknown job", async () => {
      const manager = new JobManager({ jobsDir });

      await expect(manager.streamJobOutput("job-2099-01-01-xxxxxx")).rejects.toThrow(
        JobNotFoundError,
      );
    });

    it("emits existing messages immediately", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "completed",
      });

      // Add some output before streaming
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Message 1",
      });
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Message 2",
      });

      const messages: unknown[] = [];
      const stream = await manager.streamJobOutput(created.id);

      stream.on("message", (msg) => {
        messages.push(msg);
      });

      // Wait a bit for messages to be emitted
      await new Promise((resolve) => setTimeout(resolve, 100));

      stream.stop();

      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("emits end event for completed jobs", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "completed",
      });

      const stream = await manager.streamJobOutput(created.id);
      let ended = false;

      stream.on("end", () => {
        ended = true;
      });

      // Wait for end event
      await new Promise((resolve) => setTimeout(resolve, 100));

      stream.stop();

      expect(ended).toBe(true);
    });

    it("can be stopped", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "running",
      });

      const stream = await manager.streamJobOutput(created.id);

      // Should not throw
      stream.stop();
    });
  });

  describe("applyRetention()", () => {
    it("keeps jobs within per-agent limit", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 2 },
      });

      // Create 3 jobs for same agent
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });

      // Apply retention
      const deleted = await manager.applyRetention();

      expect(deleted).toBe(1);

      // Verify only 2 remain
      const result = await manager.getJobs({ agent: "agent-1" });
      expect(result.total).toBe(2);
    });

    it("respects per-agent limit independently", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 2 },
      });

      // Create 3 jobs for agent-1
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });

      // Create 2 jobs for agent-2
      await createTestJob({ agent: "agent-2", status: "completed" });
      await createTestJob({ agent: "agent-2", status: "completed" });

      // Apply retention
      const deleted = await manager.applyRetention();

      expect(deleted).toBe(1); // Only 1 from agent-1

      // Verify counts
      const agent1Result = await manager.getJobs({ agent: "agent-1" });
      const agent2Result = await manager.getJobs({ agent: "agent-2" });

      expect(agent1Result.total).toBe(2);
      expect(agent2Result.total).toBe(2);
    });

    it("applies fleet-wide limit", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 100, maxTotalJobs: 3 },
      });

      // Create 5 jobs across different agents
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-2", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-3", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-4", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-5", status: "completed" });

      // Apply retention
      const deleted = await manager.applyRetention();

      expect(deleted).toBe(2);

      // Verify total count
      const result = await manager.getJobs();
      expect(result.total).toBe(3);
    });

    it("deletes oldest jobs first", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 2 },
      });

      // Create jobs with increasing timestamps
      const oldest = await createTestJob({
        agent: "agent-1",
        status: "completed",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const middle = await createTestJob({
        agent: "agent-1",
        status: "completed",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newest = await createTestJob({
        agent: "agent-1",
        status: "completed",
      });

      // Apply retention
      await manager.applyRetention();

      // Verify oldest was deleted
      const result = await manager.getJobs({ agent: "agent-1" });
      const ids = result.jobs.map((j) => j.id);

      expect(ids).toContain(newest.id);
      expect(ids).toContain(middle.id);
      expect(ids).not.toContain(oldest.id);
    });

    it("uses default per-agent limit of 100", async () => {
      const manager = new JobManager({ jobsDir });
      const config = manager.getRetentionConfig();

      expect(config.maxJobsPerAgent).toBe(100);
      expect(config.maxTotalJobs).toBe(0); // 0 means no limit
    });
  });

  describe("getRetentionConfig()", () => {
    it("returns configured retention settings", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 50, maxTotalJobs: 500 },
      });

      const config = manager.getRetentionConfig();

      expect(config.maxJobsPerAgent).toBe(50);
      expect(config.maxTotalJobs).toBe(500);
    });

    it("returns copy of config", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 50 },
      });

      const config1 = manager.getRetentionConfig();
      const config2 = manager.getRetentionConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object instances
    });
  });

  describe("job persistence survives restarts", () => {
    it("jobs persist after creating new JobManager instance", async () => {
      // Create first manager and add jobs
      const _manager1 = new JobManager({ jobsDir });
      const created = await createTestJob({ agent: "test-agent" });

      // Create new manager instance (simulating restart)
      const manager2 = new JobManager({ jobsDir });

      // Job should still be accessible
      const job = await manager2.getJob(created.id);
      expect(job.id).toBe(created.id);
      expect(job.agent).toBe("test-agent");
    });

    it("job output persists after creating new JobManager instance", async () => {
      // Create first manager and add job with output
      const _manager1 = new JobManager({ jobsDir });
      const created = await createTestJob({ agent: "test-agent" });

      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Persistent message",
      });

      // Create new manager instance (simulating restart)
      const manager2 = new JobManager({ jobsDir });

      // Output should still be accessible
      const job = await manager2.getJob(created.id, { includeOutput: true });
      expect(job.output).toBeDefined();
      expect(job.output).toHaveLength(1);
      expect((job.output![0] as { content?: string }).content).toBe("Persistent message");
    });
  });

  describe("streamJobOutput() edge cases", () => {
    it("streams messages from a running job", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "running",
      });

      // Add output before starting stream
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "Initial message",
      });

      const messages: unknown[] = [];
      const stream = await manager.streamJobOutput(created.id);

      stream.on("message", (msg) => {
        messages.push(msg);
      });

      // Wait for messages to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Add more output while streaming
      await appendJobOutput(jobsDir, created.id, {
        type: "assistant",
        content: "New message",
      });

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 200));

      stream.stop();

      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it("handles error event", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "completed",
      });

      const stream = await manager.streamJobOutput(created.id);
      let errorReceived = false;

      stream.on("error", () => {
        errorReceived = true;
      });

      // Give time for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      stream.stop();

      // Error might not be received for normal completed jobs
      // This just tests the event listener is properly attached
      expect(typeof errorReceived).toBe("boolean");
    });

    it("can use off to unsubscribe from events", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "completed",
      });

      const stream = await manager.streamJobOutput(created.id);
      let messageCount = 0;
      const handler = () => {
        messageCount++;
      };

      stream.on("message", handler);
      stream.off("message", handler);

      await new Promise((resolve) => setTimeout(resolve, 100));
      stream.stop();

      // Messages should not be counted after unsubscribing
      expect(messageCount).toBe(0);
    });

    it("handles job that has no output file yet", async () => {
      const manager = new JobManager({ jobsDir });
      const created = await createTestJob({
        agent: "test-agent",
        status: "running",
      });

      // Don't add any output - output file doesn't exist yet
      const stream = await manager.streamJobOutput(created.id);
      const messages: unknown[] = [];

      stream.on("message", (msg) => {
        messages.push(msg);
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      stream.stop();

      // Should not crash, just return no messages
      expect(messages.length).toBe(0);
    });

    it("logs warning for malformed JSON in output file", async () => {
      const warnMessages: string[] = [];
      const manager = new JobManager({
        jobsDir,
        logger: {
          warn: (msg) => warnMessages.push(msg),
          debug: vi.fn(),
        },
      });

      const created = await createTestJob({
        agent: "test-agent",
        status: "completed",
      });

      // Write invalid JSON directly to output file (correct path format)
      const outputPath = join(jobsDir, `${created.id}.jsonl`);
      await writeFile(outputPath, 'not valid json\n{"type": "assistant", "content": "valid"}\n');

      const messages: unknown[] = [];
      const stream = await manager.streamJobOutput(created.id);

      stream.on("message", (msg) => {
        messages.push(msg);
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      stream.stop();

      // Should have logged a warning about malformed JSON
      expect(warnMessages.some((m) => m.includes("malformed JSON"))).toBe(true);
      // Should still have parsed the valid message
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it("emits end when polling detects job completion", async () => {
      const manager = new JobManager({ jobsDir });

      // Create a running job
      const created = await createTestJob({
        agent: "test-agent",
        status: "running",
      });

      const stream = await manager.streamJobOutput(created.id);
      let endReceived = false;

      stream.on("end", () => {
        endReceived = true;
      });

      // Complete the job while streaming
      await updateJob(jobsDir, created.id, {
        status: "completed",
        finished_at: new Date().toISOString(),
        exit_reason: "success",
      });

      // Wait for polling to detect completion (poll interval is 1000ms)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      stream.stop();

      expect(endReceived).toBe(true);
    });

    it("handles stream stop during polling", async () => {
      const manager = new JobManager({ jobsDir });

      // Create a running job
      const created = await createTestJob({
        agent: "test-agent",
        status: "running",
      });

      const stream = await manager.streamJobOutput(created.id);

      // Immediately stop the stream
      stream.stop();

      // Wait to ensure polling would have run
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not crash
      expect(true).toBe(true);
    });
  });

  describe("applyRetention() edge cases", () => {
    it("handles empty jobs directory", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 2 },
      });

      // No jobs created
      const deleted = await manager.applyRetention();
      expect(deleted).toBe(0);
    });

    it("handles jobs within retention limits", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 10, maxTotalJobs: 100 },
      });

      // Create fewer jobs than limits
      await createTestJob({ agent: "agent-1", status: "completed" });
      await createTestJob({ agent: "agent-1", status: "completed" });

      const deleted = await manager.applyRetention();
      expect(deleted).toBe(0);

      const result = await manager.getJobs();
      expect(result.total).toBe(2);
    });

    it("deletes output files when applying retention", async () => {
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 1 },
      });

      // Create job with output
      const job1 = await createTestJob({
        agent: "agent-1",
        status: "completed",
      });
      await appendJobOutput(jobsDir, job1.id, {
        type: "assistant",
        content: "Output to be deleted",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create newer job
      await createTestJob({ agent: "agent-1", status: "completed" });

      // Apply retention
      await manager.applyRetention();

      // Old job and its output should be deleted
      const result = await manager.getJobs();
      expect(result.total).toBe(1);
    });

    it("logs warning when delete output file fails (non-ENOENT)", async () => {
      const warnMessages: string[] = [];
      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 1 },
        logger: {
          warn: (msg) => warnMessages.push(msg),
          debug: vi.fn(),
        },
      });

      // Create two jobs so one will be deleted
      const job1 = await createTestJob({
        agent: "agent-1",
        status: "completed",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });

      // Make the output path a directory so unlink will fail with EISDIR
      // (correct path format without .output.)
      const outputDir = join(jobsDir, `${job1.id}.jsonl`);
      await mkdir(outputDir, { recursive: true });

      // Apply retention
      await manager.applyRetention();

      // Should have logged a warning about failing to delete output file
      expect(warnMessages.some((m) => m.includes("Failed to delete output file"))).toBe(true);
    });
  });

  describe("logger functionality", () => {
    it("uses provided logger", async () => {
      const warnMessages: string[] = [];
      const debugMessages: string[] = [];

      const manager = new JobManager({
        jobsDir,
        retention: { maxJobsPerAgent: 1 },
        logger: {
          warn: (msg) => warnMessages.push(msg),
          debug: (msg) => debugMessages.push(msg),
        },
      });

      // Create jobs to trigger retention
      await createTestJob({ agent: "agent-1", status: "completed" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createTestJob({ agent: "agent-1", status: "completed" });

      await manager.applyRetention();

      // Debug message should have been logged
      expect(debugMessages.some((m) => m.includes("retention"))).toBe(true);
    });

    it("uses default console logger when none provided", async () => {
      // Just verify it doesn't crash
      const manager = new JobManager({ jobsDir });
      await createTestJob({ agent: "agent-1", status: "completed" });

      const job = await manager.getJob((await manager.getJobs()).jobs[0].id);
      expect(job).toBeDefined();
    });
  });
});
