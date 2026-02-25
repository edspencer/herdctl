/**
 * SessionRow component
 *
 * Displays a single session within a directory group.
 * Shows origin badge, session name, relative timestamp, and resumable status.
 */

import { useNavigate } from "react-router";
import { adhocChatPath, agentChatPath, readOnlySessionPath } from "../../lib/paths";
import type { DiscoveredSession } from "../../lib/types";
import { OriginBadge } from "../ui/OriginBadge";

// =============================================================================
// Types
// =============================================================================

interface SessionRowProps {
  /** The session to display */
  session: DiscoveredSession;
  /** The agent name (if linked to a fleet agent) */
  agentName: string | undefined;
  /** The encoded working directory path (for navigation) */
  encodedPath: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a timestamp as relative time string.
 * Returns: "just now", "2m ago", "3h ago", "5d ago", or a date like "Jan 15"
 */
function formatRelativeTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// =============================================================================
// Component
// =============================================================================

export function SessionRow({ session, agentName, encodedPath }: SessionRowProps) {
  const navigate = useNavigate();

  // Compute display name with fallback chain
  const displayName =
    session.customName ?? session.autoName ?? session.preview ?? "Untitled session";

  // Compute relative timestamp
  const timestamp = formatRelativeTimestamp(session.mtime);

  // Click handler - navigate to appropriate chat view
  const handleClick = () => {
    if (agentName) {
      navigate(agentChatPath(agentName, session.sessionId));
    } else if (session.resumable) {
      navigate(adhocChatPath(encodedPath, session.sessionId));
    } else {
      navigate(readOnlySessionPath(encodedPath, session.sessionId));
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-3 px-3 py-2 hover:bg-herd-hover transition-colors cursor-pointer ${
        !session.resumable ? "opacity-60" : ""
      }`}
    >
      {/* Origin badge (icon only) */}
      <OriginBadge origin={session.origin} className="flex-shrink-0" />

      {/* Session name (truncated) */}
      <span className="flex-1 min-w-0 text-sm text-herd-fg truncate">{displayName}</span>

      {/* Read-only suffix for non-resumable sessions */}
      {!session.resumable && (
        <span className="flex-shrink-0 text-xs text-herd-muted">(read-only)</span>
      )}

      {/* Timestamp */}
      <span className="flex-shrink-0 text-xs text-herd-muted">{timestamp}</span>
    </div>
  );
}
