/**
 * Tests for the incremental job index backing `listJobs`.
 *
 * These cover the performance contract (don't re-read files whose contents the
 * caller will not receive) as well as the correctness properties that contract
 * must not break: fresh records, correct invalidation, and error accounting.
 */

import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Count every job-file read that reaches the filesystem layer, so tests can
// assert on how much work a listing actually performs.
const reads = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("../utils/reads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/reads.js")>();
  return {
    ...actual,
    safeReadYaml: (filePath: string, options?: unknown) => {
      reads.paths.push(filePath);
      return actual.safeReadYaml(filePath, options as never);
    },
  };
});

const { clearJobIndexCache } = await import("../job-index.js");
const { createJob, listJobs, updateJob } = await import("../job-metadata.js");
const { stringify } = await import("yaml");

type JobLogger = import("../job-metadata.js").JobLogger;
type JobMetadata = import("../schemas/job-metadata.js").JobMetadata;

function createMockLogger(): JobLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => warnings.push(message) };
}

/** Names of job files read since the last {@link resetReads}. */
function jobFilesRead(): string[] {
  return reads.paths.filter((p) => p.includes("job-")).map((p) => p.split("/").pop() as string);
}

function resetReads(): void {
  reads.paths.length = 0;
}

describe("listJobs job index", () => {
  let tempDir: string;

  beforeEach(async () => {
    const baseDir = join(
      tmpdir(),
      `herdctl-job-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(baseDir, { recursive: true });
    tempDir = await realpath(baseDir);
    clearJobIndexCache();
    resetReads();
  });

  afterEach(async () => {
    clearJobIndexCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Create `count` jobs for `agent`, each with a distinct started_at. */
  async function seed(agent: string, count: number, hourOffset = 0): Promise<void> {
    for (let i = 0; i < count; i++) {
      const job: JobMetadata = {
        id: `job-2024-01-15-${agent.slice(0, 1)}${String(i).padStart(5, "0")}`,
        agent,
        trigger_type: "manual",
        status: "completed",
        started_at: new Date(Date.UTC(2024, 0, 15, hourOffset + i)).toISOString(),
        schedule: null,
        exit_reason: null,
        session_id: null,
        forked_from: null,
        finished_at: null,
        duration_seconds: null,
        // Large field: the thing we do not want to parse needlessly.
        prompt: "x".repeat(4096),
        summary: null,
        output_file: null,
      };
      await writeFile(join(tempDir, `${job.id}.yaml`), stringify(job), "utf-8");
    }
  }

  describe("re-reading", () => {
    it("does not re-read job files that the filter excludes", async () => {
      await seed("wanted", 2);
      await seed("unwanted", 18, 12);

      // Cold pass: every file must be read once to build the index.
      await listJobs(tempDir, { agent: "wanted" });
      expect(new Set(jobFilesRead()).size).toBe(20);

      // Warm pass: only the two matching records are needed.
      resetReads();
      const result = await listJobs(tempDir, { agent: "wanted" });

      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.every((j) => j.agent === "wanted")).toBe(true);
      expect(jobFilesRead()).toHaveLength(2);
      expect(jobFilesRead().every((f) => f.startsWith("job-2024-01-15-w"))).toBe(true);
    });

    it("does not re-read job files beyond the requested limit", async () => {
      await seed("agent", 20);

      await listJobs(tempDir);
      resetReads();

      const result = await listJobs(tempDir, { limit: 3 });

      expect(result.jobs).toHaveLength(3);
      expect(jobFilesRead()).toHaveLength(3);
    });

    it("re-reads a job file after it changes", async () => {
      const job = await createJob(tempDir, { agent: "agent", trigger_type: "manual" });
      await listJobs(tempDir);

      await updateJob(tempDir, job.id, { status: "completed", summary: "done" });

      const result = await listJobs(tempDir);
      expect(result.jobs[0].status).toBe("completed");
      expect(result.jobs[0].summary).toBe("done");
    });

    it("picks up jobs created after the first listing", async () => {
      await seed("agent", 2);
      expect((await listJobs(tempDir)).jobs).toHaveLength(2);

      await createJob(tempDir, { agent: "agent", trigger_type: "manual" });

      expect((await listJobs(tempDir)).jobs).toHaveLength(3);
    });

    it("forgets jobs whose files have been deleted", async () => {
      await seed("agent", 3);
      await listJobs(tempDir);

      await rm(join(tempDir, "job-2024-01-15-a00001.yaml"));

      const result = await listJobs(tempDir);
      expect(result.jobs).toHaveLength(2);
      expect(result.errors).toBe(0);
    });

    it("returns freshly parsed records rather than shared cached objects", async () => {
      await seed("agent", 2);

      const first = await listJobs(tempDir);
      const second = await listJobs(tempDir);

      expect(second.jobs[0]).toEqual(first.jobs[0]);
      expect(second.jobs[0]).not.toBe(first.jobs[0]);
    });
  });

  describe("pagination", () => {
    beforeEach(async () => {
      await seed("agent", 5);
    });

    it("applies limit after sorting by started_at descending", async () => {
      const result = await listJobs(tempDir, { limit: 2 });

      expect(result.jobs.map((j) => j.id)).toEqual([
        "job-2024-01-15-a00004",
        "job-2024-01-15-a00003",
      ]);
    });

    it("applies offset", async () => {
      const result = await listJobs(tempDir, { offset: 3 });

      expect(result.jobs.map((j) => j.id)).toEqual([
        "job-2024-01-15-a00001",
        "job-2024-01-15-a00000",
      ]);
    });

    it("applies limit and offset together", async () => {
      const result = await listJobs(tempDir, { limit: 2, offset: 1 });

      expect(result.jobs.map((j) => j.id)).toEqual([
        "job-2024-01-15-a00003",
        "job-2024-01-15-a00002",
      ]);
    });

    it("reports the pre-pagination match count as total", async () => {
      await seed("other", 2, 12);

      const result = await listJobs(tempDir, { agent: "agent", limit: 1 });

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(5);
    });

    it("ignores non-positive limit and offset", async () => {
      expect((await listJobs(tempDir, { limit: 0 })).jobs).toHaveLength(5);
      expect((await listJobs(tempDir, { offset: -1 })).jobs).toHaveLength(5);
    });
  });

  describe("error accounting", () => {
    it("keeps counting and reporting corrupt files on cached listings", async () => {
      await seed("agent", 1);
      await writeFile(join(tempDir, "job-2024-01-15-corupt.yaml"), "invalid: [yaml", "utf-8");

      const cold = createMockLogger();
      const coldResult = await listJobs(tempDir, {}, { logger: cold });
      expect(coldResult.jobs).toHaveLength(1);
      expect(coldResult.errors).toBe(1);
      expect(cold.warnings).toHaveLength(1);

      const warm = createMockLogger();
      const warmResult = await listJobs(tempDir, {}, { logger: warm });
      expect(warmResult.jobs).toHaveLength(1);
      expect(warmResult.errors).toBe(1);
      expect(warm.warnings).toEqual(cold.warnings);
    });

    it("counts corrupt files even when they cannot match the filter", async () => {
      await seed("agent", 1);
      await writeFile(join(tempDir, "job-2024-01-15-corupt.yaml"), "invalid: [yaml", "utf-8");

      const result = await listJobs(tempDir, { agent: "agent", limit: 1 });

      expect(result.jobs).toHaveLength(1);
      expect(result.errors).toBe(1);
    });

    it("recovers once a corrupt file is repaired", async () => {
      await writeFile(join(tempDir, "job-2024-01-15-corupt.yaml"), "invalid: [yaml", "utf-8");
      expect((await listJobs(tempDir)).errors).toBe(1);

      await seed("agent", 0);
      const job: JobMetadata = {
        id: "job-2024-01-15-corupt",
        agent: "agent",
        trigger_type: "manual",
        status: "completed",
        started_at: "2024-01-15T10:00:00.000Z",
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
      await writeFile(join(tempDir, "job-2024-01-15-corupt.yaml"), stringify(job), "utf-8");

      const result = await listJobs(tempDir);
      expect(result.errors).toBe(0);
      expect(result.jobs).toHaveLength(1);
    });
  });
});
