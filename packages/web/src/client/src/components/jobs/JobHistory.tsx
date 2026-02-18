/**
 * JobHistory component
 *
 * Displays a paginated, filterable table of job history.
 * Used both for fleet-wide job history (/jobs) and per-agent job tabs.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  History,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Play,
  Terminal,
  CalendarClock,
  Globe,
  Webhook,
  MessageSquare,
  GitFork,
} from "lucide-react";
import { useJobs, useJobsActions, useSelectedJob } from "../../store";
import { Card, StatusBadge, Spinner } from "../ui";
import { JobDetail } from "./JobDetail";
import { TriggerJobModal } from "./TriggerJobModal";
import type { JobStatus, JobSummary, TriggerType } from "../../lib/types";

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

/**
 * Small Discord icon
 */
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/**
 * Small Slack icon
 */
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

/**
 * Get trigger type icon for table display
 */
function TriggerTypeIcon({ type }: { type?: TriggerType }) {
  const t = type ?? "manual";
  const iconClass = "w-3.5 h-3.5";

  const map: Record<string, { icon: React.ReactNode; label: string }> = {
    discord: { icon: <DiscordIcon className={iconClass} />, label: "Discord" },
    slack: { icon: <SlackIcon className={iconClass} />, label: "Slack" },
    web: { icon: <Globe className={iconClass} />, label: "Web Chat" },
    manual: { icon: <Terminal className={iconClass} />, label: "Manual" },
    schedule: { icon: <CalendarClock className={iconClass} />, label: "Schedule" },
    webhook: { icon: <Webhook className={iconClass} />, label: "Webhook" },
    chat: { icon: <MessageSquare className={iconClass} />, label: "Chat" },
    fork: { icon: <GitFork className={iconClass} />, label: "Fork" },
  };

  const { icon, label } = map[t] ?? map.manual;

  return (
    <span className="text-herd-muted" title={label}>
      {icon}
    </span>
  );
}

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
      <td className="py-2 px-1 text-center w-8">
        <TriggerTypeIcon type={job.triggerType} />
      </td>
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

  const [triggerModalOpen, setTriggerModalOpen] = useState(false);

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
    // Handle the promise to avoid React error #185 (unhandled rejection)
    fetchJobs().catch(() => {
      // Error is already handled in fetchJobs, which sets jobsError
      // This catch block just prevents unhandled promise rejection
    });
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
        {/* Header with title, trigger button, and loading indicator */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-herd-fg">
            {isAgentView ? "Job History" : "All Jobs"}
          </h2>
          <div className="flex items-center gap-2">
            {jobsLoading && jobs.length > 0 && (
              <Spinner size="sm" />
            )}
            <button
              onClick={() => setTriggerModalOpen(true)}
              className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Trigger Job
            </button>
          </div>
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
                    <th className="text-center py-2 px-1 w-8" title="Source" />
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

      {/* Trigger Job Modal */}
      <TriggerJobModal
        isOpen={triggerModalOpen}
        onClose={() => {
          setTriggerModalOpen(false);
          // Refetch jobs to show newly triggered job
          fetchJobs().catch(() => {});
        }}
        preSelectedAgent={agentName}
      />
    </div>
  );
}
