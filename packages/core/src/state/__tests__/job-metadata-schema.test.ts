import { describe, expect, it } from "vitest";
import {
  createJobMetadata,
  ExitReasonSchema,
  generateJobId,
  type JobMetadata,
  JobMetadataSchema,
  JobStatusSchema,
  TriggerTypeSchema,
} from "../schemas/job-metadata.js";

describe("JobStatusSchema", () => {
  it("accepts valid status values", () => {
    expect(JobStatusSchema.parse("pending")).toBe("pending");
    expect(JobStatusSchema.parse("running")).toBe("running");
    expect(JobStatusSchema.parse("completed")).toBe("completed");
    expect(JobStatusSchema.parse("failed")).toBe("failed");
    expect(JobStatusSchema.parse("cancelled")).toBe("cancelled");
  });

  it("rejects invalid status values", () => {
    expect(() => JobStatusSchema.parse("invalid")).toThrow();
    expect(() => JobStatusSchema.parse("")).toThrow();
    expect(() => JobStatusSchema.parse(123)).toThrow();
  });
});

describe("TriggerTypeSchema", () => {
  it("accepts valid trigger types", () => {
    expect(TriggerTypeSchema.parse("manual")).toBe("manual");
    expect(TriggerTypeSchema.parse("schedule")).toBe("schedule");
    expect(TriggerTypeSchema.parse("webhook")).toBe("webhook");
    expect(TriggerTypeSchema.parse("chat")).toBe("chat");
    expect(TriggerTypeSchema.parse("fork")).toBe("fork");
  });

  it("rejects invalid trigger types", () => {
    expect(() => TriggerTypeSchema.parse("auto")).toThrow();
    expect(() => TriggerTypeSchema.parse("")).toThrow();
  });
});

describe("ExitReasonSchema", () => {
  it("accepts valid exit reasons", () => {
    expect(ExitReasonSchema.parse("success")).toBe("success");
    expect(ExitReasonSchema.parse("error")).toBe("error");
    expect(ExitReasonSchema.parse("timeout")).toBe("timeout");
    expect(ExitReasonSchema.parse("cancelled")).toBe("cancelled");
    expect(ExitReasonSchema.parse("max_turns")).toBe("max_turns");
  });

  it("rejects invalid exit reasons", () => {
    expect(() => ExitReasonSchema.parse("unknown")).toThrow();
  });
});

describe("JobMetadataSchema", () => {
  const validJob: JobMetadata = {
    id: "job-2024-01-15-abc123",
    agent: "test-agent",
    schedule: null,
    trigger_type: "manual",
    status: "running",
    exit_reason: null,
    session_id: "session-123",
    forked_from: null,
    started_at: "2024-01-15T10:30:00Z",
    finished_at: null,
    duration_seconds: null,
    prompt: "Test prompt",
    summary: null,
    output_file: null,
  };

  describe("id validation", () => {
    it("accepts valid job ID format", () => {
      const job = { ...validJob, id: "job-2024-12-31-xyz789" };
      const result = JobMetadataSchema.parse(job);
      expect(result.id).toBe("job-2024-12-31-xyz789");
    });

    it("rejects invalid job ID formats", () => {
      expect(() => JobMetadataSchema.parse({ ...validJob, id: "invalid-id" })).toThrow();
      expect(() => JobMetadataSchema.parse({ ...validJob, id: "job-2024-1-15-abc123" })).toThrow(); // single digit month
      expect(() => JobMetadataSchema.parse({ ...validJob, id: "job-2024-01-15-abc12" })).toThrow(); // 5 char random
      expect(() => JobMetadataSchema.parse({ ...validJob, id: "job-2024-01-15-ABC123" })).toThrow(); // uppercase
    });
  });

  describe("agent validation", () => {
    it("accepts non-empty agent names", () => {
      const job = { ...validJob, agent: "my-agent" };
      const result = JobMetadataSchema.parse(job);
      expect(result.agent).toBe("my-agent");
    });

    it("rejects empty agent name", () => {
      expect(() => JobMetadataSchema.parse({ ...validJob, agent: "" })).toThrow();
    });
  });

  describe("schedule field", () => {
    it("accepts string schedule name", () => {
      const job = { ...validJob, schedule: "hourly" };
      const result = JobMetadataSchema.parse(job);
      expect(result.schedule).toBe("hourly");
    });

    it("accepts null schedule", () => {
      const job = { ...validJob, schedule: null };
      const result = JobMetadataSchema.parse(job);
      expect(result.schedule).toBeNull();
    });

    it("accepts undefined schedule", () => {
      const { schedule, ...jobWithoutSchedule } = validJob;
      const result = JobMetadataSchema.parse(jobWithoutSchedule);
      expect(result.schedule).toBeUndefined();
    });
  });

  describe("forked_from validation", () => {
    it("accepts valid forked_from job ID", () => {
      const job = { ...validJob, forked_from: "job-2024-01-14-def456" };
      const result = JobMetadataSchema.parse(job);
      expect(result.forked_from).toBe("job-2024-01-14-def456");
    });

    it("rejects invalid forked_from job ID", () => {
      expect(() => JobMetadataSchema.parse({ ...validJob, forked_from: "invalid" })).toThrow();
    });

    it("accepts null forked_from", () => {
      const job = { ...validJob, forked_from: null };
      const result = JobMetadataSchema.parse(job);
      expect(result.forked_from).toBeNull();
    });
  });

  describe("duration_seconds validation", () => {
    it("accepts positive duration", () => {
      const job = { ...validJob, duration_seconds: 120 };
      const result = JobMetadataSchema.parse(job);
      expect(result.duration_seconds).toBe(120);
    });

    it("accepts zero duration", () => {
      const job = { ...validJob, duration_seconds: 0 };
      const result = JobMetadataSchema.parse(job);
      expect(result.duration_seconds).toBe(0);
    });

    it("rejects negative duration", () => {
      expect(() => JobMetadataSchema.parse({ ...validJob, duration_seconds: -1 })).toThrow();
    });

    it("accepts null duration", () => {
      const job = { ...validJob, duration_seconds: null };
      const result = JobMetadataSchema.parse(job);
      expect(result.duration_seconds).toBeNull();
    });
  });

  describe("complete job parsing", () => {
    it("parses a complete running job", () => {
      const result = JobMetadataSchema.parse(validJob);
      expect(result).toEqual(validJob);
    });

    it("parses a completed job with all fields", () => {
      const completedJob: JobMetadata = {
        id: "job-2024-01-15-abc123",
        agent: "test-agent",
        schedule: "hourly",
        trigger_type: "schedule",
        status: "completed",
        exit_reason: "success",
        session_id: "session-456",
        forked_from: null,
        started_at: "2024-01-15T10:30:00Z",
        finished_at: "2024-01-15T10:35:00Z",
        duration_seconds: 300,
        prompt: "Run the tests",
        summary: "All tests passed",
        output_file: "/path/to/output.log",
      };
      const result = JobMetadataSchema.parse(completedJob);
      expect(result).toEqual(completedJob);
    });

    it("parses a failed job", () => {
      const failedJob: JobMetadata = {
        id: "job-2024-01-15-xyz789",
        agent: "test-agent",
        schedule: null,
        trigger_type: "manual",
        status: "failed",
        exit_reason: "error",
        session_id: "session-789",
        forked_from: null,
        started_at: "2024-01-15T10:30:00Z",
        finished_at: "2024-01-15T10:32:00Z",
        duration_seconds: 120,
        prompt: "Deploy to production",
        summary: "Deployment failed due to network error",
        output_file: "/path/to/error.log",
      };
      const result = JobMetadataSchema.parse(failedJob);
      expect(result.status).toBe("failed");
      expect(result.exit_reason).toBe("error");
    });

    it("parses a forked job", () => {
      const forkedJob: JobMetadata = {
        id: "job-2024-01-15-fork01",
        agent: "test-agent",
        schedule: null,
        trigger_type: "fork",
        status: "running",
        exit_reason: null,
        session_id: "session-fork",
        forked_from: "job-2024-01-15-abc123",
        started_at: "2024-01-15T11:00:00Z",
        finished_at: null,
        duration_seconds: null,
        prompt: "Continue the previous work",
        summary: null,
        output_file: null,
      };
      const result = JobMetadataSchema.parse(forkedJob);
      expect(result.trigger_type).toBe("fork");
      expect(result.forked_from).toBe("job-2024-01-15-abc123");
    });
  });
});

describe("generateJobId", () => {
  it("generates ID with correct format", () => {
    const date = new Date("2024-03-15T10:30:00Z");
    const id = generateJobId(date, () => "abc123");
    expect(id).toBe("job-2024-03-15-abc123");
  });

  it("pads single-digit months", () => {
    const date = new Date("2024-01-05T10:30:00Z");
    const id = generateJobId(date, () => "def456");
    expect(id).toBe("job-2024-01-05-def456");
  });

  it("pads single-digit days", () => {
    const date = new Date("2024-12-09T10:30:00Z");
    const id = generateJobId(date, () => "ghi789");
    expect(id).toBe("job-2024-12-09-ghi789");
  });

  it("uses current date by default", () => {
    const id = generateJobId(undefined, () => "xyz000");
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    expect(id).toBe(`job-${year}-${month}-${day}-xyz000`);
  });

  it("pads short random strings", () => {
    const date = new Date("2024-01-15T10:30:00Z");
    const id = generateJobId(date, () => "ab");
    expect(id).toBe("job-2024-01-15-ab0000");
  });

  it("truncates long random strings to 6 characters", () => {
    const date = new Date("2024-01-15T10:30:00Z");
    const id = generateJobId(date, () => "abcdefghij");
    expect(id).toBe("job-2024-01-15-abcdef");
  });

  it("generates unique IDs with default random function", () => {
    const date = new Date("2024-01-15T10:30:00Z");
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateJobId(date));
    }
    expect(ids.size).toBe(100);
  });

  it("generates valid IDs that pass schema validation", () => {
    for (let i = 0; i < 10; i++) {
      const id = generateJobId();
      expect(() =>
        JobMetadataSchema.parse({
          id,
          agent: "test",
          trigger_type: "manual",
          status: "pending",
          started_at: new Date().toISOString(),
        }),
      ).not.toThrow();
    }
  });
});

describe("createJobMetadata", () => {
  it("creates job with required fields", () => {
    const job = createJobMetadata(
      {
        agent: "my-agent",
        trigger_type: "manual",
      },
      () => "job-2024-01-15-abc123",
    );

    expect(job.id).toBe("job-2024-01-15-abc123");
    expect(job.agent).toBe("my-agent");
    expect(job.trigger_type).toBe("manual");
    expect(job.status).toBe("pending");
    expect(job.started_at).toBeDefined();
  });

  it("creates job with optional fields", () => {
    const job = createJobMetadata(
      {
        agent: "my-agent",
        trigger_type: "schedule",
        schedule: "hourly",
        prompt: "Run the build",
      },
      () => "job-2024-01-15-def456",
    );

    expect(job.schedule).toBe("hourly");
    expect(job.prompt).toBe("Run the build");
  });

  it("creates forked job with parent reference", () => {
    const job = createJobMetadata(
      {
        agent: "my-agent",
        trigger_type: "fork",
        forked_from: "job-2024-01-14-parent",
      },
      () => "job-2024-01-15-child1",
    );

    expect(job.trigger_type).toBe("fork");
    expect(job.forked_from).toBe("job-2024-01-14-parent");
  });

  it("sets default null values for optional fields", () => {
    const job = createJobMetadata(
      {
        agent: "my-agent",
        trigger_type: "manual",
      },
      () => "job-2024-01-15-xyz789",
    );

    expect(job.schedule).toBeNull();
    expect(job.exit_reason).toBeNull();
    expect(job.session_id).toBeNull();
    expect(job.forked_from).toBeNull();
    expect(job.finished_at).toBeNull();
    expect(job.duration_seconds).toBeNull();
    expect(job.prompt).toBeNull();
    expect(job.summary).toBeNull();
    expect(job.output_file).toBeNull();
  });

  it("generates valid ISO timestamp for started_at", () => {
    const job = createJobMetadata(
      {
        agent: "my-agent",
        trigger_type: "manual",
      },
      () => "job-2024-01-15-abc123",
    );

    const timestamp = new Date(job.started_at);
    expect(timestamp.getTime()).toBeGreaterThan(0);
    expect(job.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("creates valid job that passes schema validation", () => {
    const job = createJobMetadata({
      agent: "my-agent",
      trigger_type: "webhook",
      prompt: "Handle the webhook payload",
    });

    expect(() => JobMetadataSchema.parse(job)).not.toThrow();
  });

  it("uses default ID generator when not provided", () => {
    const job = createJobMetadata({
      agent: "my-agent",
      trigger_type: "manual",
    });

    expect(job.id).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/);
  });
});
