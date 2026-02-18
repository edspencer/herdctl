/**
 * Jobs slice for Zustand store
 *
 * Manages job history with pagination, filtering, and individual job details.
 */

import type { StateCreator } from "zustand";
import type { JobSummary, JobStatus } from "../lib/types";
import { fetchJobs, fetchJobById } from "../lib/api";

// =============================================================================
// Types
// =============================================================================

export interface JobsFilter {
  /** Filter by agent name */
  agentName?: string;
  /** Filter by job status */
  status?: JobStatus;
}

export interface JobsState {
  /** List of jobs for the current page/filter */
  jobs: JobSummary[];
  /** Total count of jobs matching the filter */
  totalJobs: number;
  /** Loading state for job list */
  jobsLoading: boolean;
  /** Error message for job list fetch */
  jobsError: string | null;
  /** Current filter settings */
  jobsFilter: JobsFilter;
  /** Current pagination offset */
  jobsOffset: number;
  /** Page size limit */
  jobsLimit: number;
  /** Currently selected job ID */
  selectedJobId: string | null;
  /** Full details of the selected job */
  selectedJob: JobSummary | null;
  /** Loading state for selected job fetch */
  selectedJobLoading: boolean;
}

export interface JobsActions {
  /** Fetch jobs with current filter and pagination */
  fetchJobs: () => Promise<void>;
  /** Fetch a single job's details */
  fetchJobDetail: (jobId: string) => Promise<void>;
  /** Update filter settings (also resets offset to 0) */
  setJobsFilter: (filter: Partial<JobsFilter>) => void;
  /** Update pagination offset */
  setJobsOffset: (offset: number) => void;
  /** Select a job by ID (or null to deselect) */
  selectJob: (jobId: string | null) => void;
  /** Clear all jobs state (useful when navigating away) */
  clearJobsState: () => void;
}

export type JobsSlice = JobsState & JobsActions;

// =============================================================================
// Constants
// =============================================================================

/** Default page size */
const DEFAULT_LIMIT = 20;

// =============================================================================
// Initial State
// =============================================================================

const initialJobsState: JobsState = {
  jobs: [],
  totalJobs: 0,
  jobsLoading: false,
  jobsError: null,
  jobsFilter: {},
  jobsOffset: 0,
  jobsLimit: DEFAULT_LIMIT,
  selectedJobId: null,
  selectedJob: null,
  selectedJobLoading: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createJobsSlice: StateCreator<JobsSlice, [], [], JobsSlice> = (
  set,
  get
) => ({
  ...initialJobsState,

  fetchJobs: async () => {
    const { jobsFilter, jobsOffset, jobsLimit } = get();

    set({ jobsLoading: true, jobsError: null });

    try {
      const response = await fetchJobs({
        limit: jobsLimit,
        offset: jobsOffset,
        agentName: jobsFilter.agentName,
        status: jobsFilter.status,
      });

      set({
        jobs: response.jobs,
        totalJobs: response.total,
        jobsLoading: false,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch jobs";
      set({
        jobsLoading: false,
        jobsError: message,
      });
    }
  },

  fetchJobDetail: async (jobId: string) => {
    set({ selectedJobLoading: true });

    try {
      const job = await fetchJobById(jobId);
      set({
        selectedJob: job,
        selectedJobId: jobId,
        selectedJobLoading: false,
      });
    } catch (error) {
      // On error, still set the selected job ID but clear the detail
      // This allows the UI to show a "not found" state
      set({
        selectedJob: null,
        selectedJobId: jobId,
        selectedJobLoading: false,
      });
    }
  },

  setJobsFilter: (filter: Partial<JobsFilter>) => {
    const currentFilter = get().jobsFilter;
    set({
      jobsFilter: { ...currentFilter, ...filter },
      jobsOffset: 0, // Reset to first page when filter changes
    });
  },

  setJobsOffset: (offset: number) => {
    set({ jobsOffset: offset });
  },

  selectJob: (jobId: string | null) => {
    if (jobId === null) {
      set({
        selectedJobId: null,
        selectedJob: null,
        selectedJobLoading: false,
      });
    } else {
      // First set the ID, then fetch the details
      set({ selectedJobId: jobId });
      get().fetchJobDetail(jobId);
    }
  },

  clearJobsState: () => {
    set(initialJobsState);
  },
});
