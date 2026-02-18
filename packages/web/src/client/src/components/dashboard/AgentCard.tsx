/**
 * AgentCard component
 *
 * Displays individual agent information in a card format.
 * Shows status, description, current job info, and connector badges.
 */

import { Link } from "react-router";
import { MessageSquare, Eye } from "lucide-react";
import { Card, StatusBadge } from "../ui";
import type { AgentInfo } from "../../lib/types";

// =============================================================================
// Types
// =============================================================================

interface AgentCardProps {
  /** Agent information */
  agent: AgentInfo;
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
 * Format next run time from schedule
 */
function getNextRunTime(agent: AgentInfo): string | null {
  if (agent.schedules.length === 0) {
    return null;
  }

  // Find the earliest nextRunAt across all schedules
  const nextRuns = agent.schedules
    .filter((s) => s.nextRunAt)
    .map((s) => new Date(s.nextRunAt!).getTime());

  if (nextRuns.length === 0) {
    return null;
  }

  const earliest = Math.min(...nextRuns);
  const now = Date.now();
  const diffMs = earliest - now;

  if (diffMs < 0) {
    return "Due";
  }

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) {
    return "< 1m";
  }
  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

/**
 * Get chat connector type labels
 */
function getConnectorLabels(agent: AgentInfo): string[] {
  if (!agent.chat) return [];
  return Object.keys(agent.chat).map(
    (key) => key.charAt(0).toUpperCase() + key.slice(1)
  );
}

// =============================================================================
// Component
// =============================================================================

export function AgentCard({ agent }: AgentCardProps) {
  const connectorLabels = getConnectorLabels(agent);
  const nextRun = agent.status === "idle" ? getNextRunTime(agent) : null;

  return (
    <Card as="article" className="p-4 flex flex-col gap-3 transition-colors duration-150">
      {/* Header: Name and Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-herd-fg truncate">
            {agent.name}
          </h3>
          {agent.description && (
            <p className="text-xs text-herd-muted mt-0.5 line-clamp-2">
              {truncate(agent.description, 80)}
            </p>
          )}
        </div>
        <StatusBadge status={agent.status} size="sm" />
      </div>

      {/* Running job info or idle state */}
      <div className="min-h-[32px]">
        {agent.status === "running" && agent.currentJobId && (
          <div className="bg-herd-hover rounded-lg px-2 py-1.5">
            <p className="text-xs text-herd-muted font-mono truncate">
              Job active
            </p>
          </div>
        )}
        {agent.status === "idle" && (
          <div className="text-xs text-herd-muted">
            {nextRun ? (
              <span>Next run in {nextRun}</span>
            ) : (
              <span>No scheduled runs</span>
            )}
          </div>
        )}
        {agent.status === "error" && agent.errorMessage && (
          <div className="bg-herd-status-error/10 border border-herd-status-error/20 text-herd-status-error rounded-lg px-2 py-1.5">
            <p className="text-xs truncate">{truncate(agent.errorMessage, 60)}</p>
          </div>
        )}
      </div>

      {/* Connector badges */}
      {connectorLabels.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {connectorLabels.map((label) => (
            <span
              key={label}
              className="text-[11px] font-medium text-herd-muted bg-herd-hover px-2 py-0.5 rounded"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1 border-t border-herd-border mt-auto">
        <Link
          to={`/agents/${agent.name}`}
          className="flex items-center gap-1.5 text-herd-muted hover:text-herd-fg hover:bg-herd-hover rounded-lg px-3 py-1.5 text-xs transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </Link>
        <Link
          to={`/agents/${agent.name}/chat`}
          className="flex items-center gap-1.5 text-herd-muted hover:text-herd-fg hover:bg-herd-hover rounded-lg px-3 py-1.5 text-xs transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </Link>
      </div>
    </Card>
  );
}
