/**
 * StatusBadge component
 *
 * A status indicator with colored dot and label text.
 * Uses semantic herd-status-* color tokens.
 */

import type { AgentStatus, JobStatus } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

type Status = AgentStatus | JobStatus;

interface StatusBadgeProps {
  /** The status to display */
  status: Status;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the dot color class for a given status
 */
function getDotColorClass(status: Status): string {
  switch (status) {
    case "running":
      return "bg-herd-status-running animate-pulse";
    case "idle":
      return "bg-herd-status-idle";
    case "error":
      return "bg-herd-status-error";
    case "completed":
      return "bg-herd-status-running"; // green = success
    case "failed":
      return "bg-herd-status-error";
    case "cancelled":
      return "bg-herd-status-idle";
    case "pending":
      return "bg-herd-status-pending";
  }
}

/**
 * Get the text color class for a given status
 */
function getTextColorClass(status: Status): string {
  switch (status) {
    case "running":
      return "text-herd-status-running";
    case "idle":
      return "text-herd-status-idle";
    case "error":
      return "text-herd-status-error";
    case "completed":
      return "text-herd-status-running";
    case "failed":
      return "text-herd-status-error";
    case "cancelled":
      return "text-herd-status-idle";
    case "pending":
      return "text-herd-status-pending";
  }
}

/**
 * Get the display label for a status
 */
function getStatusLabel(status: Status): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// =============================================================================
// Component
// =============================================================================

export function StatusBadge({ status, size = "sm", className = "" }: StatusBadgeProps) {
  const dotSize = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${getTextColorClass(status)} ${className}`}
    >
      <span
        className={`${dotSize} rounded-full ${getDotColorClass(status)}`}
      />
      <span className={textSize}>{getStatusLabel(status)}</span>
    </span>
  );
}
