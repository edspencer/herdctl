/**
 * RecentJobs component
 *
 * Displays a paginated table of recent jobs with agent, prompt, status, and time.
 */

import { useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "../ui";
import type { JobSummary } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface RecentJobsProps {
  /** List of recent jobs (most recent first) */
  jobs: JobSummary[];
  /** Number of jobs per page */
  pageSize?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Truncate text to a maximum length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "\u2026";
}

/**
 * Format a timestamp to relative time (e.g., "2m ago", "1h ago")
 */
function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = new Date(isoTimestamp).getTime();
  const now = Date.now();
  const diffMs = now - timestamp;

  if (diffMs < 0) {
    return "Just now";
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) {
    return "Just now";
  }

  const diffMins = Math.floor(diffSeconds / 60);
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

// =============================================================================
// Component
// =============================================================================

export function RecentJobs({ jobs, pageSize = 10 }: RecentJobsProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(jobs.length / pageSize);
  const start = page * pageSize;
  const displayedJobs = jobs.slice(start, start + pageSize);

  return (
    <div>
      {/* Section heading with count */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-herd-fg">
          Recent Jobs
          <span className="text-herd-muted font-normal ml-1.5">
            ({jobs.length})
          </span>
        </h2>
      </div>

      {displayedJobs.length === 0 ? (
        <p className="text-xs text-herd-muted py-4">No recent jobs</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-herd-border text-xs text-herd-muted font-medium uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Agent</th>
                  <th className="text-left py-2 px-3">Prompt</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-herd-border">
                {displayedJobs.map((job) => (
                  <tr
                    key={job.jobId}
                    className="hover:bg-herd-hover transition-colors"
                  >
                    <td className="py-2 px-3 text-herd-fg">
                      <Link
                        to={`/agents/${encodeURIComponent(job.agentName)}`}
                        className="hover:text-herd-primary transition-colors"
                      >
                        {job.agentName}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-herd-muted font-mono text-xs max-w-[200px]">
                      <span className="block truncate">
                        {truncate(job.prompt, 50)}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={job.status} size="sm" />
                    </td>
                    <td className="py-2 px-3 text-herd-muted text-xs whitespace-nowrap">
                      {formatRelativeTime(job.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-herd-border">
              <span className="text-[11px] text-herd-muted">
                {start + 1}&ndash;{Math.min(start + pageSize, jobs.length)} of {jobs.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1 rounded hover:bg-herd-hover text-herd-muted hover:text-herd-fg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-herd-muted px-1">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1 rounded hover:bg-herd-hover text-herd-muted hover:text-herd-fg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
