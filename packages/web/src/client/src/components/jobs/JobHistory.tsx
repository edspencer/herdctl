/**
 * JobHistory component
 *
 * Displays a paginated, filterable table of job history.
 * Used both for fleet-wide job history (/jobs) and per-agent job tabs.
 */

import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { History, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useJobs, useJobsActions, useSelectedJob } from "../../store";
import { Card, StatusBadge, Spinner } from "../ui";
import { JobDetail } from "./JobDetail";
import type { JobStatus, JobSummary } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface JobHistoryProps {
  /** Optional agent name to pre-filter for agent-specific views */
  agentName?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format duration between two timestamps
 * Returns human-readable duration like "2m 15s", "45s", "1h 3m"
 */
function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "-";

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 0) return "-";

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return "-";

  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Truncate prompt text for table display
 */
function truncatePrompt(prompt: string, maxLength: number = 60): string {
  if (prompt.length <= maxLength) return prompt;
  return prompt.slice(0, maxLength).trim() + "...";
}

// =============================================================================
// Sub-Components
// =============================================================================

const STATUS_OPTIONS: Array<{ value: JobStatus | "all"; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

interface FiltersProps {
  agentFilter: string;
  statusFilter: JobStatus | undefined;
  onAgentFilterChange: (value: string) => void;
  onStatusFilterChange: (value: JobStatus | undefined) => void;
  showAgentFilter: boolean;
}

function Filters({
  agentFilter,
  statusFilter,
  onAgentFilterChange,
  onStatusFilterChange,
  showAgentFilter,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {showAgentFilter && (
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-herd-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by agent..."
            value={agentFilter}
            onChange={(e) => onAgentFilterChange(e.target.value)}
            className="bg-herd-input-bg border border-herd-border rounded-lg pl-9 pr-8 py-2 text-sm text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors w-full"
          />
          {agentFilter && (
            <button
              onClick={() => onAgentFilterChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-herd-hover rounded transition-colors"
              aria-label="Clear agent filter"
            >
              <X className="w-3.5 h-3.5 text-herd-muted" />
            </button>
          )}
        </div>
      )}
      <select
        value={statusFilter ?? "all"}
        onChange={(e) => {
          const value = e.target.value;
          onStatusFilterChange(value === "all" ? undefined : (value as JobStatus));
        }}
        className="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-sm text-herd-fg focus:outline-none focus:border-herd-primary/60 transition-colors min-w-[140px]"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

function Pagination({
  offset,
  limit,
  total,
  onPrevious,
  onNext,
}: PaginationProps) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-herd-border">
      <span className="text-xs text-herd-muted">
        Showing {start}-{end} of {total}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrevious}
          disabled={!canPrevious}
          className="flex items-center gap-1 border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="flex items-center gap-1 border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

interface JobRowProps {
  job: JobSummary;
  showAgent: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function JobRow({ job, showAgent, isSelected, onSelect }: JobRowProps) {
  const isRunning = job.status === "running";
  const duration = formatDuration(job.startedAt, job.completedAt);

  return (
    <tr
      onClick={onSelect}
      className={`
        hover:bg-herd-hover transition-colors cursor-pointer
        ${isSelected ? "bg-herd-primary-muted" : ""}
      `}
    >
      {showAgent && (
        <td className="py-2 px-3 text-herd-fg">
          <Link
            to={`/agents/${encodeURIComponent(job.agentName)}`}
            onClick={(e) => e.stopPropagation()}
            className="text-herd-primary hover:text-herd-primary-hover transition-colors"
          >
            {job.agentName}
          </Link>
        </td>
      )}
      <td className="py-2 px-3 text-herd-fg" title={job.prompt}>
        {truncatePrompt(job.prompt)}
      </td>
      <td className="py-2 px-3">
        <StatusBadge status={job.status} />
      </td>
      <td className="py-2 px-3 text-herd-muted text-xs">
        {formatTimestamp(job.startedAt)}
      </td>
      <td className="py-2 px-3 text-herd-muted text-xs font-mono">
        {isRunning ? (
          <span className="text-herd-status-running">{duration}</span>
        ) : (
          duration
        )}
      </td>
    </tr>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <History className="w-12 h-12 text-herd-muted" />
      <div>
        <p className="text-sm text-herd-fg font-medium">No jobs found</p>
        <p className="text-xs text-herd-muted mt-1">
          {hasFilters
            ? "Try adjusting your filters to see more results"
            : "Jobs will appear here once agents start running tasks"}
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-3 py-2 text-xs mb-4 flex items-center justify-between">
      <span>{message}</span>
      <button
        onClick={onRetry}
        className="hover:underline font-medium ml-4"
      >
        Retry
      </button>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function JobHistory({ agentName }: JobHistoryProps) {
  const { jobs, totalJobs, jobsLoading, jobsError, jobsFilter, jobsOffset, jobsLimit } =
    useJobs();
  const { fetchJobs, setJobsFilter, setJobsOffset, selectJob, clearJobsState } =
    useJobsActions();
  const { selectedJobId, selectedJob, selectedJobLoading } = useSelectedJob();

  // Determine if we're in agent-specific mode
  const isAgentView = !!agentName;

  // Initialize filter with agent name if provided
  useEffect(() => {
    // Clear state when component mounts with different agent
    clearJobsState();
    if (agentName) {
      setJobsFilter({ agentName });
    }
  }, [agentName, clearJobsState, setJobsFilter]);

  // Fetch jobs when filter or offset changes
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, jobsFilter, jobsOffset]);

  // Check if any filters are active
  const hasFilters = useMemo(() => {
    return !!(jobsFilter.agentName || jobsFilter.status);
  }, [jobsFilter]);

  // Handlers
  const handleAgentFilterChange = (value: string) => {
    setJobsFilter({ agentName: value || undefined });
  };

  const handleStatusFilterChange = (value: JobStatus | undefined) => {
    setJobsFilter({ status: value });
  };

  const handlePrevious = () => {
    const newOffset = Math.max(0, jobsOffset - jobsLimit);
    setJobsOffset(newOffset);
  };

  const handleNext = () => {
    const newOffset = jobsOffset + jobsLimit;
    if (newOffset < totalJobs) {
      setJobsOffset(newOffset);
    }
  };

  const handleSelectJob = (jobId: string) => {
    // Toggle selection if clicking the same job
    if (selectedJobId === jobId) {
      selectJob(null);
    } else {
      selectJob(jobId);
    }
  };

  const handleCloseDetail = () => {
    selectJob(null);
  };

  // Show loading spinner on initial load only
  if (jobsLoading && jobs.length === 0 && !jobsError) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Spinner size="lg" />
          <p className="text-sm text-herd-muted">Loading job history...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Main job list */}
      <Card className="p-4 flex-1 min-w-0">
        {/* Header with title and loading indicator */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-herd-fg">
            {isAgentView ? "Job History" : "All Jobs"}
          </h2>
          {jobsLoading && jobs.length > 0 && (
            <Spinner size="sm" />
          )}
        </div>

        {/* Error banner */}
        {jobsError && (
          <ErrorBanner message={jobsError} onRetry={fetchJobs} />
        )}

        {/* Filters */}
        <Filters
          agentFilter={isAgentView ? "" : jobsFilter.agentName ?? ""}
          statusFilter={jobsFilter.status}
          onAgentFilterChange={handleAgentFilterChange}
          onStatusFilterChange={handleStatusFilterChange}
          showAgentFilter={!isAgentView}
        />

        {/* Table or empty state */}
        {jobs.length === 0 && !jobsLoading ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-herd-border text-xs text-herd-muted font-medium uppercase tracking-wide">
                    {!isAgentView && (
                      <th className="text-left py-2 px-3">Agent</th>
                    )}
                    <th className="text-left py-2 px-3">Prompt</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Started</th>
                    <th className="text-left py-2 px-3">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-herd-border">
                  {jobs.map((job) => (
                    <JobRow
                      key={job.jobId}
                      job={job}
                      showAgent={!isAgentView}
                      isSelected={selectedJobId === job.jobId}
                      onSelect={() => handleSelectJob(job.jobId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <Pagination
              offset={jobsOffset}
              limit={jobsLimit}
              total={totalJobs}
              onPrevious={handlePrevious}
              onNext={handleNext}
            />
          </>
        )}
      </Card>

      {/* Job detail panel */}
      {selectedJobId && (
        <JobDetail
          jobId={selectedJobId}
          job={selectedJob}
          loading={selectedJobLoading}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}
