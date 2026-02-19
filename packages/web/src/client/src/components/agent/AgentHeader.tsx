/**
 * AgentHeader component
 *
 * Header section at top of agent detail page showing:
 * - Agent name and status
 * - Description, model, permission mode, working directory
 * - Action buttons (Trigger Job, Chat)
 */

import { Cpu, FolderOpen, MessageSquare, Play, Shield } from "lucide-react";
import { Link } from "react-router";
import { getAgentAvatar } from "../../lib/avatar";
import type { AgentInfo } from "../../lib/types";
import { StatusBadge } from "../ui";

// =============================================================================
// Types
// =============================================================================

interface AgentHeaderProps {
  /** Agent information */
  agent: AgentInfo;
}

// =============================================================================
// Component
// =============================================================================

export function AgentHeader({ agent }: AgentHeaderProps) {
  const encodedName = encodeURIComponent(agent.qualifiedName);

  return (
    <div className="flex items-start gap-4">
      {/* Avatar — stretches to match content height */}
      <img
        src={getAgentAvatar(agent.name)}
        alt=""
        className="w-14 h-14 rounded-full shrink-0 sm:w-16 sm:h-16"
      />

      {/* Content area */}
      <div className="flex flex-col gap-3 min-w-0 flex-1">
        {/* Top row: Name, status, and actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* Fleet path breadcrumb (shown when agent belongs to a sub-fleet) */}
            {agent.fleetPath.length > 0 && (
              <p className="text-[11px] text-herd-muted font-medium uppercase tracking-wide mb-0.5">
                {agent.fleetPath.join(" / ")}
              </p>
            )}
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-herd-fg">{agent.name}</h1>
              <StatusBadge status={agent.status} size="md" />
            </div>
            {agent.description && (
              <p className="text-xs text-herd-muted mt-1">{agent.description}</p>
            )}
          </div>

          {/* Action buttons — hidden on small screens, visible on md+ */}
          <div className="hidden sm:flex gap-2 shrink-0">
            <button
              disabled
              className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Trigger Job (coming soon)"
            >
              <Play className="w-3.5 h-3.5" />
              Trigger Job
            </button>
            <Link
              to={`/agents/${encodedName}/chat`}
              className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
            </Link>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-herd-muted">
          {agent.model && (
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span className="font-mono">{agent.model}</span>
            </div>
          )}
          {agent.permission_mode && (
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>{agent.permission_mode}</span>
            </div>
          )}
          {agent.working_directory && (
            <div
              className="flex items-center gap-1.5 min-w-0 max-w-[300px]"
              title={agent.working_directory}
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono truncate">{agent.working_directory}</span>
            </div>
          )}
        </div>

        {/* Action buttons — visible on small screens only */}
        <div className="flex sm:hidden gap-2">
          <button
            disabled
            className="bg-herd-primary hover:bg-herd-primary-hover text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Trigger Job (coming soon)"
          >
            <Play className="w-3.5 h-3.5" />
            Trigger Job
          </button>
          <Link
            to={`/agents/${encodedName}/chat`}
            className="border border-herd-border hover:bg-herd-hover text-herd-fg rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
