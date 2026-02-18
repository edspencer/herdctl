/**
 * Jobs slice tests
 *
 * Tests state transitions for job listing, filtering, and selection
 * in the Zustand store.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import { createJobsSlice, type JobsSlice } from "../jobs-slice";

// Mock the API module
vi.mock("../../lib/api", () => ({
  fetchJobs: vi.fn(),
  fetchJobById: vi.fn(),
}));

import { fetchJobs, fetchJobById } from "../../lib/api";

// =============================================================================
// Helpers
// =============================================================================

function createTestStore() {
  return create<JobsSlice>()((...args) => createJobsSlice(...args));
}

// =============================================================================
// Tests
// =============================================================================

describe("Jobs Slice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has empty jobs array", () => {
      expect(store.getState().jobs).toEqual([]);
    });

    it("has zero total", () => {
      expect(store.getState().totalJobs).toBe(0);
    });

    it("is not loading", () => {
      expect(store.getState().jobsLoading).toBe(false);
    });

    it("has no error", () => {
      expect(store.getState().jobsError).toBeNull();
    });

    it("has empty filter", () => {
      expect(store.getState().jobsFilter).toEqual({});
    });

    it("has zero offset", () => {
      expect(store.getState().jobsOffset).toBe(0);
    });

    it("has default limit of 20", () => {
      expect(store.getState().jobsLimit).toBe(20);
    });

    it("has no selected job", () => {
      expect(store.getState().selectedJobId).toBeNull();
      expect(store.getState().selectedJob).toBeNull();
      expect(store.getState().selectedJobLoading).toBe(false);
    });
  });

  describe("fetchJobs", () => {
    it("fetches jobs and updates state", async () => {
      const mockJobs = [
        { jobId: "job-1", agentName: "coder", prompt: "Fix bug", status: "completed", createdAt: "2025-01-01T00:00:00Z" },
        { jobId: "job-2", agentName: "reviewer", prompt: "Review PR", status: "running", createdAt: "2025-01-01T00:01:00Z" },
      ];

      (fetchJobs as any).mockResolvedValue({
        jobs: mockJobs,
        total: 2,
        limit: 20,
        offset: 0,
      });

      await store.getState().fetchJobs();

      expect(store.getState().jobs).toEqual(mockJobs);
      expect(store.getState().totalJobs).toBe(2);
      expect(store.getState().jobsLoading).toBe(false);
      expect(store.getState().jobsError).toBeNull();
    });

    it("passes filter and pagination params", async () => {
      (fetchJobs as any).mockResolvedValue({ jobs: [], total: 0, limit: 20, offset: 0 });

      store.getState().setJobsFilter({ agentName: "coder", status: "running" as any });
      store.getState().setJobsOffset(10);

      await store.getState().fetchJobs();

      expect(fetchJobs).toHaveBeenCalledWith({
        limit: 20,
        offset: 10,
        agentName: "coder",
        status: "running",
      });
    });

    it("handles fetch error", async () => {
      (fetchJobs as any).mockRejectedValue(new Error("Network error"));

      await store.getState().fetchJobs();

      expect(store.getState().jobsLoading).toBe(false);
      expect(store.getState().jobsError).toBe("Network error");
      expect(store.getState().jobs).toEqual([]);
    });
  });

  describe("setJobsFilter", () => {
    it("updates filter", () => {
      store.getState().setJobsFilter({ agentName: "coder" });
      expect(store.getState().jobsFilter).toEqual({ agentName: "coder" });
    });

    it("merges with existing filter", () => {
      store.getState().setJobsFilter({ agentName: "coder" });
      store.getState().setJobsFilter({ status: "running" as any });
      expect(store.getState().jobsFilter).toEqual({ agentName: "coder", status: "running" });
    });

    it("resets offset to 0 when filter changes", () => {
      store.getState().setJobsOffset(20);
      expect(store.getState().jobsOffset).toBe(20);

      store.getState().setJobsFilter({ agentName: "coder" });
      expect(store.getState().jobsOffset).toBe(0);
    });
  });

  describe("setJobsOffset", () => {
    it("updates offset", () => {
      store.getState().setJobsOffset(40);
      expect(store.getState().jobsOffset).toBe(40);
    });
  });

  describe("selectJob", () => {
    it("sets selectedJobId to null and clears state", () => {
      store.getState().selectJob(null);

      expect(store.getState().selectedJobId).toBeNull();
      expect(store.getState().selectedJob).toBeNull();
      expect(store.getState().selectedJobLoading).toBe(false);
    });

    it("sets selectedJobId when given a job ID", () => {
      // Mock fetchJobById so it doesn't reject unhandled
      (fetchJobById as any).mockResolvedValue({
        jobId: "job-1",
        agentName: "coder",
        prompt: "Task",
        status: "completed",
        createdAt: "2025-01-01T00:00:00Z",
      });

      store.getState().selectJob("job-1");

      expect(store.getState().selectedJobId).toBe("job-1");
    });
  });

  describe("fetchJobDetail", () => {
    it("fetches job details and updates state", async () => {
      const mockJob = {
        jobId: "job-1",
        agentName: "coder",
        prompt: "Fix bug",
        status: "completed" as const,
        createdAt: "2025-01-01T00:00:00Z",
        exitCode: 0,
      };

      (fetchJobById as any).mockResolvedValue(mockJob);

      await store.getState().fetchJobDetail("job-1");

      expect(store.getState().selectedJob).toEqual(mockJob);
      expect(store.getState().selectedJobId).toBe("job-1");
      expect(store.getState().selectedJobLoading).toBe(false);
    });

    it("clears selected job on fetch error", async () => {
      (fetchJobById as any).mockRejectedValue(new Error("Not found"));

      await store.getState().fetchJobDetail("missing-job");

      expect(store.getState().selectedJob).toBeNull();
      expect(store.getState().selectedJobId).toBe("missing-job");
      expect(store.getState().selectedJobLoading).toBe(false);
    });
  });

  describe("clearJobsState", () => {
    it("resets all state to initial values", async () => {
      // Populate state first
      (fetchJobs as any).mockResolvedValue({
        jobs: [{ jobId: "j1", agentName: "a", prompt: "p", status: "running", createdAt: "2025-01-01" }],
        total: 1,
        limit: 20,
        offset: 0,
      });
      await store.getState().fetchJobs();
      store.getState().setJobsFilter({ agentName: "coder" });

      // Now clear
      store.getState().clearJobsState();

      expect(store.getState().jobs).toEqual([]);
      expect(store.getState().totalJobs).toBe(0);
      expect(store.getState().jobsLoading).toBe(false);
      expect(store.getState().jobsError).toBeNull();
      expect(store.getState().jobsFilter).toEqual({});
      expect(store.getState().jobsOffset).toBe(0);
      expect(store.getState().selectedJobId).toBeNull();
      expect(store.getState().selectedJob).toBeNull();
    });
  });
});
