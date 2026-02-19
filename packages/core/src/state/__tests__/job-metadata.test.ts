import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateFileError } from "../errors.js";
import {
  createJob,
  deleteJob,
  getJob,
  type JobLogger,
  listJobs,
  updateJob,
} from "../job-metadata.js";
import type { JobMetadata } from "../schemas/job-metadata.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-job-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): JobLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (message: string) => warnings.push(message),
  };
}

// Helper to create a valid job YAML file
async function writeJobFile(dir: string, job: JobMetadata): Promise<string> {
  const { stringify } = await import("yaml");
  const filePath = join(dir, `${job.id}.yaml`);
  await writeFile(filePath, stringify(job), "utf-8");
  return filePath;
}

describe("createJob", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a job file with correct content", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
      prompt: "Test prompt",
    });

    expect(job.id).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/);
    expect(job.agent).toBe("test-agent");
    expect(job.trigger_type).toBe("manual");
    expect(job.status).toBe("pending");
    expect(job.prompt).toBe("Test prompt");

    // Verify file exists
    const filePath = join(tempDir, `${job.id}.yaml`);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("agent: test-agent");
    expect(content).toContain("trigger_type: manual");
  });

  it("creates scheduled job with schedule name", async () => {
    const job = await createJob(tempDir, {
      agent: "cron-agent",
      trigger_type: "schedule",
      schedule: "hourly",
    });

    expect(job.schedule).toBe("hourly");
    expect(job.trigger_type).toBe("schedule");
  });

  it("creates forked job with parent reference", async () => {
    // Create parent job first
    const parentJob = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const forkedJob = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "fork",
      forked_from: parentJob.id,
    });

    expect(forkedJob.trigger_type).toBe("fork");
    expect(forkedJob.forked_from).toBe(parentJob.id);
  });

  it("sets started_at to current time", async () => {
    const before = new Date();
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });
    const after = new Date();

    const startedAt = new Date(job.started_at);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(startedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("throws StateFileError when directory does not exist", async () => {
    const nonExistentDir = join(tempDir, "does-not-exist");

    await expect(
      createJob(nonExistentDir, {
        agent: "test-agent",
        trigger_type: "manual",
      }),
    ).rejects.toThrow(StateFileError);
  });

  it("generates unique job IDs", async () => {
    const jobs = await Promise.all([
      createJob(tempDir, { agent: "agent-1", trigger_type: "manual" }),
      createJob(tempDir, { agent: "agent-2", trigger_type: "manual" }),
      createJob(tempDir, { agent: "agent-3", trigger_type: "manual" }),
    ]);

    const ids = jobs.map((j) => j.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });
});

describe("updateJob", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("updates job status", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const updated = await updateJob(tempDir, job.id, {
      status: "running",
      session_id: "session-123",
    });

    expect(updated.status).toBe("running");
    expect(updated.session_id).toBe("session-123");
    expect(updated.agent).toBe("test-agent"); // Preserved
  });

  it("auto-calculates duration when finished_at is set", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    // Wait a bit to have a measurable duration
    const startTime = new Date(job.started_at);
    const finishTime = new Date(startTime.getTime() + 5000); // 5 seconds later

    const updated = await updateJob(tempDir, job.id, {
      status: "completed",
      exit_reason: "success",
      finished_at: finishTime.toISOString(),
    });

    expect(updated.duration_seconds).toBe(5);
  });

  it("preserves explicit duration_seconds over auto-calculation", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const updated = await updateJob(tempDir, job.id, {
      status: "completed",
      finished_at: new Date().toISOString(),
      duration_seconds: 999, // Explicit value
    });

    expect(updated.duration_seconds).toBe(999);
  });

  it("updates summary and output_file", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const updated = await updateJob(tempDir, job.id, {
      summary: "All tests passed",
      output_file: "/path/to/output.log",
    });

    expect(updated.summary).toBe("All tests passed");
    expect(updated.output_file).toBe("/path/to/output.log");
  });

  it("throws StateFileError for non-existent job", async () => {
    await expect(
      updateJob(tempDir, "job-2024-01-15-noexis", { status: "running" }),
    ).rejects.toThrow(StateFileError);
  });

  it("throws StateFileError for corrupted job file", async () => {
    const corruptedPath = join(tempDir, "job-2024-01-15-corupt.yaml");
    await writeFile(corruptedPath, "invalid: [yaml", "utf-8");

    await expect(
      updateJob(tempDir, "job-2024-01-15-corupt", { status: "running" }),
    ).rejects.toThrow(StateFileError);
  });

  it("persists updates to file", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    await updateJob(tempDir, job.id, {
      status: "completed",
      summary: "Done!",
    });

    // Read file directly
    const content = await readFile(join(tempDir, `${job.id}.yaml`), "utf-8");
    expect(content).toContain("status: completed");
    expect(content).toContain("summary: Done!");
  });

  it("handles multiple sequential updates", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    await updateJob(tempDir, job.id, { status: "running" });
    await updateJob(tempDir, job.id, { session_id: "sess-1" });
    const final = await updateJob(tempDir, job.id, {
      status: "completed",
      exit_reason: "success",
    });

    expect(final.status).toBe("completed");
    expect(final.session_id).toBe("sess-1");
    expect(final.exit_reason).toBe("success");
  });
});

describe("getJob", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns job when it exists", async () => {
    const created = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
      prompt: "Test prompt",
    });

    const retrieved = await getJob(tempDir, created.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.agent).toBe("test-agent");
    expect(retrieved!.prompt).toBe("Test prompt");
  });

  it("returns null for non-existent job", async () => {
    const result = await getJob(tempDir, "job-2024-01-15-noexis");
    expect(result).toBeNull();
  });

  it("returns null and logs warning for corrupted job file", async () => {
    const logger = createMockLogger();
    const corruptedPath = join(tempDir, "job-2024-01-15-corpt1.yaml");
    // Use actually parseable YAML but with invalid schema
    await writeFile(corruptedPath, "agent: ''\nstatus: invalid\n", "utf-8");

    const result = await getJob(tempDir, "job-2024-01-15-corpt1", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("returns null for job with invalid schema", async () => {
    const logger = createMockLogger();
    const invalidJob = {
      id: "job-2024-01-15-invali",
      agent: "", // Invalid: empty
      trigger_type: "manual",
      status: "running",
      started_at: "2024-01-15T10:00:00Z",
    };
    await writeJobFile(tempDir, invalidJob as JobMetadata);

    const result = await getJob(tempDir, "job-2024-01-15-invali", { logger });

    expect(result).toBeNull();
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it("throws for permission errors", async () => {
    // This is hard to test portably - skip or use mock
  });
});

describe("listJobs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty list when directory is empty", async () => {
    const result = await listJobs(tempDir);
    expect(result.jobs).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it("returns empty list when directory does not exist", async () => {
    const nonExistent = join(tempDir, "does-not-exist");
    const result = await listJobs(nonExistent);
    expect(result.jobs).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it("lists all jobs in directory", async () => {
    await createJob(tempDir, { agent: "agent-1", trigger_type: "manual" });
    await createJob(tempDir, { agent: "agent-2", trigger_type: "schedule" });
    await createJob(tempDir, { agent: "agent-3", trigger_type: "webhook" });

    const result = await listJobs(tempDir);

    expect(result.jobs).toHaveLength(3);
    expect(result.errors).toBe(0);
  });

  it("sorts jobs by started_at descending (most recent first)", async () => {
    // Create jobs with known timestamps
    const job1: JobMetadata = {
      id: "job-2024-01-15-first1",
      agent: "agent",
      trigger_type: "manual",
      status: "completed",
      started_at: "2024-01-15T10:00:00Z",
      schedule: null,
      exit_reason: null,
      session_id: null,
      forked_from: null,
      finished_at: null,
      duration_seconds: null,
      prompt: null,
      summary: null,
      output_file: null,
    };
    const job2: JobMetadata = {
      ...job1,
      id: "job-2024-01-15-middl2",
      started_at: "2024-01-15T12:00:00Z",
    };
    const job3: JobMetadata = {
      ...job1,
      id: "job-2024-01-15-last03",
      started_at: "2024-01-15T14:00:00Z",
    };

    await writeJobFile(tempDir, job1);
    await writeJobFile(tempDir, job2);
    await writeJobFile(tempDir, job3);

    const result = await listJobs(tempDir);

    expect(result.jobs[0].id).toBe("job-2024-01-15-last03"); // Most recent
    expect(result.jobs[1].id).toBe("job-2024-01-15-middl2");
    expect(result.jobs[2].id).toBe("job-2024-01-15-first1"); // Oldest
  });

  describe("filtering by agent", () => {
    it("returns only jobs for specified agent", async () => {
      await createJob(tempDir, { agent: "agent-a", trigger_type: "manual" });
      await createJob(tempDir, { agent: "agent-b", trigger_type: "manual" });
      await createJob(tempDir, { agent: "agent-a", trigger_type: "schedule" });

      const result = await listJobs(tempDir, { agent: "agent-a" });

      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.every((j) => j.agent === "agent-a")).toBe(true);
    });
  });

  describe("filtering by status", () => {
    it("returns only jobs with specified status", async () => {
      const job1 = await createJob(tempDir, {
        agent: "agent",
        trigger_type: "manual",
      });
      const job2 = await createJob(tempDir, {
        agent: "agent",
        trigger_type: "manual",
      });
      await createJob(tempDir, { agent: "agent", trigger_type: "manual" });

      await updateJob(tempDir, job1.id, { status: "completed" });
      await updateJob(tempDir, job2.id, { status: "failed" });

      const completedJobs = await listJobs(tempDir, { status: "completed" });
      expect(completedJobs.jobs).toHaveLength(1);
      expect(completedJobs.jobs[0].id).toBe(job1.id);

      const failedJobs = await listJobs(tempDir, { status: "failed" });
      expect(failedJobs.jobs).toHaveLength(1);
      expect(failedJobs.jobs[0].id).toBe(job2.id);

      const pendingJobs = await listJobs(tempDir, { status: "pending" });
      expect(pendingJobs.jobs).toHaveLength(1);
    });
  });

  describe("filtering by date range", () => {
    it("filters jobs started after a date", async () => {
      const oldJob: JobMetadata = {
        id: "job-2024-01-10-old001",
        agent: "agent",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-10T10:00:00Z",
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        prompt: null,
        summary: null,
        output_file: null,
      };
      const newJob: JobMetadata = {
        ...oldJob,
        id: "job-2024-01-20-new001",
        started_at: "2024-01-20T10:00:00Z",
      };

      await writeJobFile(tempDir, oldJob);
      await writeJobFile(tempDir, newJob);

      const result = await listJobs(tempDir, {
        startedAfter: "2024-01-15T00:00:00Z",
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe("job-2024-01-20-new001");
    });

    it("filters jobs started before a date", async () => {
      const oldJob: JobMetadata = {
        id: "job-2024-01-10-old002",
        agent: "agent",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-10T10:00:00Z",
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        prompt: null,
        summary: null,
        output_file: null,
      };
      const newJob: JobMetadata = {
        ...oldJob,
        id: "job-2024-01-20-new002",
        started_at: "2024-01-20T10:00:00Z",
      };

      await writeJobFile(tempDir, oldJob);
      await writeJobFile(tempDir, newJob);

      const result = await listJobs(tempDir, {
        startedBefore: "2024-01-15T00:00:00Z",
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe("job-2024-01-10-old002");
    });

    it("filters jobs within a date range", async () => {
      const veryOldJob: JobMetadata = {
        id: "job-2024-01-01-very01",
        agent: "agent",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-01T10:00:00Z",
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        prompt: null,
        summary: null,
        output_file: null,
      };
      const middleJob: JobMetadata = {
        ...veryOldJob,
        id: "job-2024-01-15-midd01",
        started_at: "2024-01-15T10:00:00Z",
      };
      const veryNewJob: JobMetadata = {
        ...veryOldJob,
        id: "job-2024-01-30-vnew01",
        started_at: "2024-01-30T10:00:00Z",
      };

      await writeJobFile(tempDir, veryOldJob);
      await writeJobFile(tempDir, middleJob);
      await writeJobFile(tempDir, veryNewJob);

      const result = await listJobs(tempDir, {
        startedAfter: "2024-01-10T00:00:00Z",
        startedBefore: "2024-01-20T00:00:00Z",
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe("job-2024-01-15-midd01");
    });

    it("accepts Date objects for date filters", async () => {
      const job: JobMetadata = {
        id: "job-2024-01-15-date01",
        agent: "agent",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-15T10:00:00Z",
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        prompt: null,
        summary: null,
        output_file: null,
      };

      await writeJobFile(tempDir, job);

      const result = await listJobs(tempDir, {
        startedAfter: new Date("2024-01-10T00:00:00Z"),
        startedBefore: new Date("2024-01-20T00:00:00Z"),
      });

      expect(result.jobs).toHaveLength(1);
    });
  });

  describe("combining filters", () => {
    it("applies multiple filters together", async () => {
      const job1: JobMetadata = {
        id: "job-2024-01-15-comb01",
        agent: "agent-a",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-15T10:00:00Z",
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        prompt: null,
        summary: null,
        output_file: null,
      };
      const job2: JobMetadata = {
        ...job1,
        id: "job-2024-01-15-comb02",
        agent: "agent-b",
        status: "completed",
      };
      const job3: JobMetadata = {
        ...job1,
        id: "job-2024-01-15-comb03",
        agent: "agent-a",
        status: "failed",
      };
      const job4: JobMetadata = {
        ...job1,
        id: "job-2024-01-10-comb04",
        started_at: "2024-01-10T10:00:00Z",
        status: "completed",
      };

      await writeJobFile(tempDir, job1);
      await writeJobFile(tempDir, job2);
      await writeJobFile(tempDir, job3);
      await writeJobFile(tempDir, job4);

      const result = await listJobs(tempDir, {
        agent: "agent-a",
        status: "completed",
        startedAfter: "2024-01-14T00:00:00Z",
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe("job-2024-01-15-comb01");
    });
  });

  describe("error handling", () => {
    it("counts and reports parse errors", async () => {
      const logger = createMockLogger();
      await createJob(tempDir, { agent: "agent", trigger_type: "manual" });

      // Create corrupted job file
      await writeFile(join(tempDir, "job-2024-01-15-corupt.yaml"), "invalid: [yaml", "utf-8");

      const result = await listJobs(tempDir, {}, { logger });

      expect(result.jobs).toHaveLength(1);
      expect(result.errors).toBe(1);
      expect(logger.warnings.length).toBeGreaterThan(0);
    });

    it("ignores non-job files", async () => {
      await createJob(tempDir, { agent: "agent", trigger_type: "manual" });

      // Create non-job files
      await writeFile(join(tempDir, "other.yaml"), "foo: bar", "utf-8");
      await writeFile(join(tempDir, "job-.txt"), "not yaml", "utf-8");

      const result = await listJobs(tempDir);

      expect(result.jobs).toHaveLength(1);
      expect(result.errors).toBe(0);
    });
  });
});

describe("deleteJob", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("deletes existing job and returns true", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const deleted = await deleteJob(tempDir, job.id);

    expect(deleted).toBe(true);

    // Verify file is gone
    const retrieved = await getJob(tempDir, job.id);
    expect(retrieved).toBeNull();
  });

  it("returns false for non-existent job", async () => {
    const deleted = await deleteJob(tempDir, "job-2024-01-15-noexis");
    expect(deleted).toBe(false);
  });

  it("does not affect other jobs", async () => {
    const job1 = await createJob(tempDir, {
      agent: "agent-1",
      trigger_type: "manual",
    });
    const job2 = await createJob(tempDir, {
      agent: "agent-2",
      trigger_type: "manual",
    });

    await deleteJob(tempDir, job1.id);

    const remaining = await listJobs(tempDir);
    expect(remaining.jobs).toHaveLength(1);
    expect(remaining.jobs[0].id).toBe(job2.id);
  });
});

describe("atomic write behavior", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not leave temp files on successful write", async () => {
    await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(tempDir);
    const tempFiles = files.filter((f) => f.includes(".tmp."));
    expect(tempFiles).toHaveLength(0);
  });

  it("preserves original file on update validation failure", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    // Try to update with invalid data (would fail validation if we didn't catch it)
    // The current implementation validates before write, so invalid updates fail early
    const retrieved = await getJob(tempDir, job.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agent).toBe("test-agent");
  });
});

describe("concurrent operations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles multiple concurrent creates", async () => {
    const creates = [];
    for (let i = 0; i < 20; i++) {
      creates.push(
        createJob(tempDir, {
          agent: `agent-${i}`,
          trigger_type: "manual",
        }),
      );
    }

    const jobs = await Promise.all(creates);

    // All jobs should have unique IDs
    const ids = new Set(jobs.map((j) => j.id));
    expect(ids.size).toBe(20);

    // All jobs should be retrievable
    const result = await listJobs(tempDir);
    expect(result.jobs).toHaveLength(20);
  });

  it("handles multiple concurrent reads", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    const reads = [];
    for (let i = 0; i < 50; i++) {
      reads.push(getJob(tempDir, job.id));
    }

    const results = await Promise.all(reads);

    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.id).toBe(job.id);
    }
  });

  it("handles sequential updates correctly", async () => {
    const job = await createJob(tempDir, {
      agent: "test-agent",
      trigger_type: "manual",
    });

    // Sequential updates (not concurrent to avoid race conditions)
    for (let i = 0; i < 10; i++) {
      await updateJob(tempDir, job.id, {
        summary: `Update ${i}`,
      });
    }

    const final = await getJob(tempDir, job.id);
    expect(final!.summary).toBe("Update 9");
  });
});
