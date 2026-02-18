/**
 * Sidebar component for @herdctl/web
 *
 * Contains:
 * - Fleet name header with connection status
 * - Agent list grouped by status (running, idle, error)
 * - Navigation links (Dashboard, Jobs, Schedules, Settings)
 * - Quick stats bar showing agent counts
 */

import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Briefcase,
  Calendar,
  Settings,
} from "lucide-react";
import { useFleet } from "../../store";
import type { AgentInfo, ConnectionStatus } from "../../lib/types";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Group agents by status: running first, then idle, then error
 */
function groupAgentsByStatus(agents: AgentInfo[]): {
  running: AgentInfo[];
  idle: AgentInfo[];
  error: AgentInfo[];
} {
  const running: AgentInfo[] = [];
  const idle: AgentInfo[] = [];
  const error: AgentInfo[] = [];

  for (const agent of agents) {
    switch (agent.status) {
      case "running":
        running.push(agent);
        break;
      case "idle":
        idle.push(agent);
        break;
      case "error":
        error.push(agent);
        break;
    }
  }

  return { running, idle, error };
}

/**
 * Get status dot color class
 */
function getStatusDotClass(status: AgentInfo["status"]): string {
  switch (status) {
    case "running":
      return "bg-herd-status-running animate-pulse";
    case "idle":
      return "bg-herd-status-idle";
    case "error":
      return "bg-herd-status-error";
  }
}

/**
 * Get connection status dot color class
 */
function getConnectionDotClass(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-herd-status-running";
    case "reconnecting":
      return "bg-herd-status-pending animate-pulse";
    case "disconnected":
      return "bg-herd-status-idle";
  }
}

// =============================================================================
// Sub-Components
// =============================================================================

interface AgentItemProps {
  agent: AgentInfo;
  isActive: boolean;
  onNavigate?: () => void;
}

function AgentItem({ agent, isActive, onNavigate }: AgentItemProps) {
  return (
    <Link
      to={`/agents/${agent.name}`}
      onClick={onNavigate}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
          ? "text-herd-fg bg-herd-active font-medium"
          : "text-herd-muted hover:bg-herd-hover hover:text-herd-fg"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotClass(agent.status)}`}
      />
      <span className="truncate">{agent.name}</span>
    </Link>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onNavigate?: () => void;
}

function NavItem({ to, icon, label, isActive, onNavigate }: NavItemProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
          ? "text-herd-fg bg-herd-active font-medium"
          : "text-herd-muted hover:bg-herd-hover hover:text-herd-fg"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

// =============================================================================
// Main Component
// =============================================================================

interface SidebarProps {
  /** Called when a navigation item is clicked (used to close mobile overlay) */
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps = {}) {
  const { agents, connectionStatus, fleetStatus } = useFleet();
  const location = useLocation();

  // Group agents by status
  const groupedAgents = useMemo(() => groupAgentsByStatus(agents), [agents]);

  // Combine all agents in display order
  const sortedAgents = useMemo(
    () => [...groupedAgents.running, ...groupedAgents.idle, ...groupedAgents.error],
    [groupedAgents]
  );

  // Check if current path matches agent
  const currentAgentName = location.pathname.startsWith("/agents/")
    ? location.pathname.split("/")[2]
    : null;

  // Count stats
  const counts = fleetStatus?.counts ?? {
    runningAgents: 0,
    idleAgents: 0,
    errorAgents: 0,
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header section */}
      <div className="p-4 border-b border-herd-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/herdctl-logo.svg" alt="herdctl logo" className="w-7 h-7" />
            <h1 className="text-lg font-semibold text-herd-fg">herdctl</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${getConnectionDotClass(connectionStatus)}`}
            />
          </div>
        </div>
      </div>

      {/* Agent list section (scrollable) */}
      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {sortedAgents.map((agent) => (
            <AgentItem
              key={agent.name}
              agent={agent}
              isActive={currentAgentName === agent.name}
              onNavigate={onNavigate}
            />
          ))}
          {sortedAgents.length === 0 && (
            <p className="text-xs text-herd-muted px-3 py-2">No agents configured</p>
          )}
        </div>
      </div>

      {/* Navigation section */}
      <nav className="p-2 border-t border-herd-border">
        <div className="space-y-1">
          <NavItem
            to="/"
            icon={<LayoutDashboard className="w-4 h-4" />}
            label="Dashboard"
            isActive={location.pathname === "/"}
            onNavigate={onNavigate}
          />
          <NavItem
            to="/jobs"
            icon={<Briefcase className="w-4 h-4" />}
            label="Jobs"
            isActive={location.pathname === "/jobs"}
            onNavigate={onNavigate}
          />
          <NavItem
            to="/schedules"
            icon={<Calendar className="w-4 h-4" />}
            label="Schedules"
            isActive={location.pathname === "/schedules"}
            onNavigate={onNavigate}
          />
          <NavItem
            to="/settings"
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            isActive={location.pathname === "/settings"}
            onNavigate={onNavigate}
          />
        </div>
      </nav>

      {/* Quick stats bar */}
      <div className="px-4 py-2 border-t border-herd-border">
        <p className="text-xs text-herd-muted">
          {counts.runningAgents} running{" "}
          <span className="text-herd-muted/50">&middot;</span>{" "}
          {counts.idleAgents} idle{" "}
          <span className="text-herd-muted/50">&middot;</span>{" "}
          {counts.errorAgents} errors
        </p>
      </div>
    </div>
  );
}
