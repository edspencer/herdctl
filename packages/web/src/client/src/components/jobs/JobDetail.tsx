/**
 * JobDetail component
 *
 * Displays full metadata for a selected job with action buttons
 * for cancel, fork, and CLI command copying.
 * Shown as a side panel when a job row is selected.
 */

import { useState, useCallback } from "react";
import { Link } from "react-router";
import {
  X,
  ExternalLink,
  AlertCircle,
  Clock,
  Hash,
  Copy,
  Check,
  GitFork,
  StopCircle,
} from "lucide-react";
import { Card, StatusBadge, Spinner } from "../ui";
import { cancelJob as apiCancelJob, forkJob as apiForkJob } from "../../lib/api";
import { useJobsActions } from "../../store";
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

/**
 * Small icon button for copying text to clipboard with "Copied!" feedback
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: silently fail if clipboard API is not available
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 hover:bg-herd-hover text-herd-muted hover:text-herd-fg rounded-lg px-2 py-1 text-xs font-medium transition-colors"
      title={label}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-herd-status-running" />
          <span className="text-herd-status-running">Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

/**
 * Cancel button with inline confirmation step
 */
function CancelButton({ jobId, onCancelled }: { jobId: string; onCancelled: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    setError(null);
    try {
      await apiCancelJob(jobId);
      onCancelled();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel";
      setError(message);
      setCancelling(false);
      setConfirming(false);
    }
  }, [jobId, onCancelled]);

  if (error) {
    return (
      <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-2 py-1.5 text-xs">
        {error}
      </div>
    );
  }

  if (cancelling) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-herd-muted">
        <Spinner size="sm" />
        Cancelling...
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-herd-muted">Are you sure?</span>
        <button
          onClick={handleCancel}
          className="bg-herd-status-error hover:bg-herd-status-error/80 text-white rounded-lg px-2 py-1 text-xs font-medium transition-colors"
        >
          Cancel Job
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-2 py-1 text-xs font-medium transition-colors"
        >
          Keep Running
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="bg-herd-status-error hover:bg-herd-status-error/80 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
    >
      <StopCircle className="w-3.5 h-3.5" />
      Cancel Job
    </button>
  );
}

/**
 * Fork button with optional prompt override popover
 */
function ForkButton({ jobId, onForked }: { jobId: string; onForked: (newJobId: string) => void }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFork = useCallback(async () => {
    setForking(true);
    setError(null);
    try {
      const result = await apiForkJob(jobId, {
        prompt: prompt.trim() || undefined,
      });
      onForked(result.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fork";
      setError(message);
      setForking(false);
    }
  }, [jobId, prompt, onForked]);

  if (error) {
    return (
      <div className="space-y-2">
        <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-2 py-1.5 text-xs">
          {error}
        </div>
        <button
          onClick={() => { setError(null); setShowPrompt(false); }}
          className="hover:bg-herd-hover text-herd-muted hover:text-herd-fg rounded-lg px-2 py-1 text-xs font-medium transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (forking) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-herd-muted">
        <Spinner size="sm" />
        Forking...
      </div>
    );
  }

  if (showPrompt) {
    return (
      <div className="space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Override prompt (optional)..."
          rows={2}
          className="bg-herd-input-bg border border-herd-border rounded-lg px-3 py-2 text-xs text-herd-fg placeholder:text-herd-muted focus:outline-none focus:border-herd-primary/60 transition-colors w-full resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handleFork}
            className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-2 py-1 text-xs font-medium transition-colors flex items-center gap-1"
          >
            <GitFork className="w-3 h-3" />
            Fork
          </button>
          <button
            onClick={() => { setShowPrompt(false); setPrompt(""); }}
            className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-2 py-1 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowPrompt(true)}
      className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
    >
      <GitFork className="w-3.5 h-3.5" />
      Fork Job
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function JobDetail({ jobId, job, loading, onClose }: JobDetailProps) {
  const { selectJob, fetchJobs } = useJobsActions();

  const isRunning = job?.status === "running" || job?.status === "pending";
  const isFinished = job?.status === "completed" || job?.status === "failed" || job?.status === "cancelled";
  const duration = job ? formatDuration(job.startedAt, job.completedAt) : "-";

  const handleCancelled = useCallback(() => {
    // Refetch to get updated status (WebSocket will also update)
    fetchJobs().catch(() => {});
  }, [fetchJobs]);

  const handleForked = useCallback(
    (newJobId: string) => {
      // Select the newly forked job and refetch list
      selectJob(newJobId);
      fetchJobs().catch(() => {});
    },
    [selectJob, fetchJobs]
  );

  // Build CLI commands
  const resumeCommand = job?.sessionId
    ? job.workspace
      ? `cd ${job.workspace} && claude --resume ${job.sessionId}`
      : `claude --resume ${job.sessionId}`
    : "";
  const triggerCommand = job
    ? `herdctl trigger ${job.agentName}${job.prompt ? ` --prompt "${job.prompt.replace(/"/g, '\\"')}"` : ""}`
    : "";

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

      {/* Actions */}
      {job && (
        <div className="px-4 py-3 border-t border-herd-border space-y-3">
          {/* Cancel (running jobs only) */}
          {isRunning && (
            <CancelButton jobId={job.jobId} onCancelled={handleCancelled} />
          )}

          {/* Fork (finished jobs only) */}
          {isFinished && (
            <ForkButton jobId={job.jobId} onForked={handleForked} />
          )}

          {/* View Agent Output */}
          <Link
            to={`/agents/${encodeURIComponent(job.agentName)}`}
            className="flex items-center justify-center gap-1.5 w-full bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Agent Output
          </Link>

          {/* Copy CLI Commands */}
          <div className="border-t border-herd-border pt-2 space-y-1">
            <p className="text-xs text-herd-muted font-medium uppercase tracking-wide mb-1">
              CLI Commands
            </p>
            {resumeCommand && (
              <CopyButton text={resumeCommand} label="Copy Resume Command" />
            )}
            <CopyButton text={triggerCommand} label="Copy Trigger Command" />
          </div>
        </div>
      )}
    </Card>
  );
}
