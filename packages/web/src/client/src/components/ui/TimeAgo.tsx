/**
 * TimeAgo component
 *
 * Displays a relative time string (e.g., "Updated just now", "Updated 2m ago")
 * that auto-refreshes periodically.
 */

import { useEffect, useState } from "react";

// =============================================================================
// Types
// =============================================================================

interface TimeAgoProps {
  /** ISO timestamp string to display relative to */
  timestamp: string | null;
  /** Prefix text (e.g., "Updated") */
  prefix?: string;
  /** Refresh interval in ms. Default: 30000 (30 seconds) */
  refreshInterval?: number;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a timestamp as relative time
 * @returns String like "just now", "1m ago", "5h ago", "2d ago"
 */
function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) {
    return "never";
  }

  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  // Handle future timestamps or very recent
  if (diffMs < 0 || diffMs < 5000) {
    return "just now";
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

// =============================================================================
// Component
// =============================================================================

export function TimeAgo({
  timestamp,
  prefix = "Updated",
  refreshInterval = 30000,
  className = "",
}: TimeAgoProps) {
  const [, setTick] = useState(0);

  // Auto-refresh the display
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  const relativeTime = formatRelativeTime(timestamp);

  return (
    <span className={`text-xs text-herd-muted ${className}`}>
      {prefix} {relativeTime}
    </span>
  );
}
