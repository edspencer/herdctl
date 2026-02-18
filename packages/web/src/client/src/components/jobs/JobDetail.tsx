/**
 * JobDetail component
 *
 * Displays full metadata for a selected job.
 * Shown as a side panel when a job row is selected.
 */

import { Link } from "react-router";
import { X, ExternalLink, AlertCircle, Clock, Hash } from "lucide-react";
import { Card, StatusBadge, Spinner } from "../ui";
import type { JobSummary } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface JobDetailProps {
  /** Job ID (always present when panel is shown) */
  jobId: string;
  /** Full job data (may be null if loading or not found) */
  job: JobSummary | null;
  /** Loading state */
  loading: boolean;
  /** Close handler */
  onClose: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format duration between two timestamps
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
function formatFullTimestamp(timestamp?: string): string {
  if (!timestamp) return "-";

  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// =============================================================================
// Sub-Components
// =============================================================================

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}

function DetailRow({ label, children, mono = false }: DetailRowProps) {
  return (
    <div className="py-2 border-b border-herd-border last:border-b-0">
      <dt className="text-xs text-herd-muted font-medium uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className={`text-sm text-herd-fg ${mono ? "font-mono" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <Spinner size="md" />
      <p className="text-xs text-herd-muted">Loading job details...</p>
    </div>
  );
}

function NotFoundState({ jobId }: { jobId: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <AlertCircle className="w-8 h-8 text-herd-status-error" />
      <div>
        <p className="text-sm text-herd-fg font-medium">Job not found</p>
        <p className="text-xs text-herd-muted mt-1 font-mono">{jobId}</p>
      </div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function JobDetail({ jobId, job, loading, onClose }: JobDetailProps) {
  const isRunning = job?.status === "running";
  const duration = job ? formatDuration(job.startedAt, job.completedAt) : "-";

  return (
    <Card className="w-[320px] flex-shrink-0 self-start sticky top-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-herd-border">
        <h3 className="text-sm font-semibold text-herd-fg">Job Details</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-herd-hover rounded transition-colors"
          aria-label="Close job details"
        >
          <X className="w-4 h-4 text-herd-muted" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <LoadingState />
        ) : !job ? (
          <NotFoundState jobId={jobId} />
        ) : (
          <dl className="space-y-0">
            {/* Job ID */}
            <DetailRow label="Job ID" mono>
              <div className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-herd-muted flex-shrink-0" />
                <span className="text-xs break-all">{job.jobId}</span>
              </div>
            </DetailRow>

            {/* Agent */}
            <DetailRow label="Agent">
              <Link
                to={`/agents/${encodeURIComponent(job.agentName)}`}
                className="text-herd-primary hover:text-herd-primary-hover transition-colors"
              >
                {job.agentName}
              </Link>
            </DetailRow>

            {/* Status */}
            <DetailRow label="Status">
              <StatusBadge status={job.status} size="md" />
            </DetailRow>

            {/* Prompt */}
            <DetailRow label="Prompt">
              <p className="whitespace-pre-wrap break-words">{job.prompt}</p>
            </DetailRow>

            {/* Created */}
            <DetailRow label="Created" mono>
              {formatFullTimestamp(job.createdAt)}
            </DetailRow>

            {/* Started */}
            <DetailRow label="Started" mono>
              {formatFullTimestamp(job.startedAt)}
            </DetailRow>

            {/* Completed (if applicable) */}
            {job.completedAt && (
              <DetailRow label="Completed" mono>
                {formatFullTimestamp(job.completedAt)}
              </DetailRow>
            )}

            {/* Duration */}
            <DetailRow label="Duration" mono>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-herd-muted flex-shrink-0" />
                <span className={isRunning ? "text-herd-status-running" : ""}>
                  {duration}
                  {isRunning && " (running)"}
                </span>
              </div>
            </DetailRow>

            {/* Exit Code (if applicable) */}
            {job.exitCode !== undefined && (
              <DetailRow label="Exit Code" mono>
                <span
                  className={
                    job.exitCode === 0
                      ? "text-herd-status-running"
                      : "text-herd-status-error"
                  }
                >
                  {job.exitCode}
                </span>
              </DetailRow>
            )}

            {/* Error (if applicable) */}
            {job.error && (
              <DetailRow label="Error">
                <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-2 py-1.5 text-xs">
                  {job.error}
                </div>
              </DetailRow>
            )}
          </dl>
        )}
      </div>

      {/* Footer with actions */}
      {job && (
        <div className="px-4 py-3 border-t border-herd-border">
          <Link
            to={`/agents/${encodeURIComponent(job.agentName)}`}
            className="flex items-center justify-center gap-1.5 w-full bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Agent Output
          </Link>
        </div>
      )}
    </Card>
  );
}
