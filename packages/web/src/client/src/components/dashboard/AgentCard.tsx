/**
 * AgentCard component
 *
 * Displays individual agent information in a card format.
 * Shows status, description, current job info, and connector badges.
 */

import { Eye, MessageSquare } from "lucide-react";
import { Link } from "react-router";
import type { AgentInfo } from "../../lib/types";
import { Card, StatusBadge } from "../ui";

// =============================================================================
// Connector Icons (inline SVGs from brand assets)
// =============================================================================

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
    </svg>
  );
}

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
  return `${text.slice(0, maxLength - 1)}\u2026`;
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
 * Get chat connector types (raw keys)
 */
function getConnectorTypes(agent: AgentInfo): string[] {
  if (!agent.chat) return [];
  return Object.keys(agent.chat);
}

/**
 * Connector badge config: icon, label, and color classes
 */
function getConnectorBadge(type: string): {
  label: string;
  icon: React.ReactNode | null;
  bgClass: string;
  textClass: string;
} {
  switch (type) {
    case "discord":
      return {
        label: "Discord",
        icon: <DiscordIcon className="w-3 h-3" />,
        bgClass: "bg-herd-discord/10",
        textClass: "text-herd-discord",
      };
    case "slack":
      return {
        label: "Slack",
        icon: <SlackIcon className="w-3 h-3" />,
        bgClass: "bg-herd-slack/10",
        textClass: "text-herd-slack",
      };
    default:
      return {
        label: type.charAt(0).toUpperCase() + type.slice(1),
        icon: null,
        bgClass: "bg-herd-hover",
        textClass: "text-herd-muted",
      };
  }
}

// =============================================================================
// Component
// =============================================================================

export function AgentCard({ agent }: AgentCardProps) {
  const connectorTypes = getConnectorTypes(agent);
  const nextRun = agent.status === "idle" ? getNextRunTime(agent) : null;

  return (
    <Card as="article" className="p-4 flex flex-col gap-3 transition-colors duration-150">
      {/* Header: Name and Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {agent.fleetPath.length > 0 && (
            <p className="text-[10px] text-herd-muted font-medium uppercase tracking-wide mb-0.5">
              {agent.fleetPath.join(" / ")}
            </p>
          )}
          <h3 className="text-sm font-medium text-herd-fg truncate">{agent.name}</h3>
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
            <p className="text-xs text-herd-muted font-mono truncate">Job active</p>
          </div>
        )}
        {agent.status === "idle" && (
          <div className="text-xs text-herd-muted">
            {nextRun ? (
              <span>{nextRun === "Due" ? "Next run due" : `Next run in ${nextRun}`}</span>
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
      {connectorTypes.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {connectorTypes.map((type) => {
            const badge = getConnectorBadge(type);
            return (
              <span
                key={type}
                className={`inline-flex items-center gap-1 text-[11px] font-medium ${badge.textClass} ${badge.bgClass} px-2 py-0.5 rounded`}
              >
                {badge.icon}
                {badge.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1 border-t border-herd-border mt-auto">
        <Link
          to={`/agents/${encodeURIComponent(agent.qualifiedName)}`}
          className="flex items-center gap-1.5 border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </Link>
        <Link
          to={`/agents/${encodeURIComponent(agent.qualifiedName)}/chat`}
          className="flex items-center gap-1.5 bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </Link>
      </div>
    </Card>
  );
}
