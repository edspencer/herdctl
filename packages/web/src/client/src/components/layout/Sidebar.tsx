/**
 * Sidebar component for @herdctl/web
 *
 * Contains:
 * - Fleet name header with connection status
 * - Agent sections with nested recent chats
 * - Navigation links (Dashboard, Jobs, Schedules)
 * - Quick stats bar showing agent counts
 */

import { useEffect, useMemo, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Briefcase,
  Calendar,
  Plus,
} from "lucide-react";
import { useFleet, useSidebarSessions, useChatActions } from "../../store";
import { formatRelativeTime } from "../../lib/format";
import { getAgentAvatar } from "../../lib/avatar";
import type { AgentInfo, ChatSession, ConnectionStatus } from "../../lib/types";

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

interface AgentSectionProps {
  agent: AgentInfo;
  sessions: ChatSession[];
  isActive: boolean;
  activeSessionId: string | null;
  onNavigate?: () => void;
  onNewChat: (agentName: string) => void;
}

function AgentSection({
  agent,
  sessions,
  isActive,
  activeSessionId,
  onNavigate,
  onNewChat,
}: AgentSectionProps) {
  return (
    <div>
      {/* Agent heading row */}
      <div className="flex items-center border-b border-herd-sidebar-border bg-herd-sidebar-hover">
        <Link
          to={`/agents/${agent.name}`}
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-colors min-w-0 ${
            isActive
              ? "text-herd-sidebar-fg"
              : "text-herd-sidebar-fg/80 hover:text-herd-sidebar-fg"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDotClass(agent.status)}`}
          />
          <img
            src={getAgentAvatar(agent.name)}
            alt=""
            className="w-5 h-5 rounded flex-shrink-0"
          />
          <span className="truncate">{agent.name}</span>
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNewChat(agent.name);
          }}
          className="flex-shrink-0 p-1.5 mr-1 rounded bg-herd-primary/80 text-white hover:bg-herd-primary transition-colors"
          title="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Recent chat sessions */}
      {sessions.length === 0 ? (
        <p className="text-[11px] text-herd-sidebar-muted/50 text-center py-3">No chats yet</p>
      ) : (
        <div className="mr-1 mt-0.5 space-y-0.5">
          {sessions.map((session) => {
            const isSessionActive = session.sessionId === activeSessionId;
            return (
              <Link
                key={session.sessionId}
                to={`/agents/${encodeURIComponent(agent.name)}/chat/${session.sessionId}`}
                onClick={onNavigate}
                className={`flex items-center justify-between gap-2 px-3 py-1 rounded text-xs transition-colors ${
                  isSessionActive
                    ? "text-herd-sidebar-fg bg-herd-sidebar-active"
                    : "text-herd-sidebar-muted hover:bg-herd-sidebar-hover hover:text-herd-sidebar-fg"
                }`}
              >
                <span className="truncate">
                  {session.preview || "New conversation"}
                </span>
                <span className="flex-shrink-0 text-herd-sidebar-muted/60 text-[10px]">
                  {formatRelativeTime(session.lastMessageAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
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
          ? "text-herd-sidebar-fg bg-herd-sidebar-active font-medium"
          : "text-herd-sidebar-muted hover:bg-herd-sidebar-hover hover:text-herd-sidebar-fg"
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
  const { sidebarSessions } = useSidebarSessions();
  const { createChatSession, fetchSidebarSessions } = useChatActions();
  const location = useLocation();
  const navigate = useNavigate();

  // Group agents by status
  const groupedAgents = useMemo(() => groupAgentsByStatus(agents), [agents]);

  // Combine all agents in display order
  const sortedAgents = useMemo(
    () => [...groupedAgents.running, ...groupedAgents.idle, ...groupedAgents.error],
    [groupedAgents]
  );

  // Fetch sidebar sessions when agents list changes
  const agentNames = useMemo(() => agents.map((a) => a.name), [agents]);
  useEffect(() => {
    if (agentNames.length > 0) {
      fetchSidebarSessions(agentNames);
    }
  }, [agentNames.join(","), fetchSidebarSessions]);

  // Check if current path matches agent
  const currentAgentName = location.pathname.startsWith("/agents/")
    ? location.pathname.split("/")[2]
    : null;

  // Check if current path is a chat session
  const activeSessionId = useMemo(() => {
    const match = location.pathname.match(/^\/agents\/[^/]+\/chat\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Handle new chat creation
  const handleNewChat = useCallback(
    async (agentName: string) => {
      const sessionId = await createChatSession(agentName);
      if (sessionId) {
        navigate(`/agents/${encodeURIComponent(agentName)}/chat/${sessionId}`);
        onNavigate?.();
      }
    },
    [createChatSession, navigate, onNavigate]
  );

  // Count stats
  const counts = fleetStatus?.counts ?? {
    runningAgents: 0,
    idleAgents: 0,
    errorAgents: 0,
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header section */}
      <div className="p-4 border-b border-herd-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/herdctl-logo.svg" alt="herdctl logo" className="w-7 h-7" />
            <h1 className="text-lg font-semibold text-herd-sidebar-fg">herdctl</h1>
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
        <div className="space-y-0.5">
          {sortedAgents.map((agent) => (
            <AgentSection
              key={agent.name}
              agent={agent}
              sessions={sidebarSessions[agent.name] ?? []}
              isActive={currentAgentName === agent.name}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
              onNewChat={handleNewChat}
            />
          ))}
          {sortedAgents.length === 0 && (
            <p className="text-xs text-herd-sidebar-muted px-3 py-2">No agents configured</p>
          )}
        </div>
      </div>

      {/* Navigation section */}
      <nav className="p-2 border-t border-herd-sidebar-border">
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
        </div>
      </nav>

      {/* Quick stats bar */}
      <div className="px-4 py-2 border-t border-herd-sidebar-border">
        <p className="text-xs text-herd-sidebar-muted">
          {counts.runningAgents} running{" "}
          <span className="text-herd-sidebar-muted/50">&middot;</span>{" "}
          {counts.idleAgents} idle{" "}
          <span className="text-herd-sidebar-muted/50">&middot;</span>{" "}
          {counts.errorAgents} errors
        </p>
      </div>
    </div>
  );
}
