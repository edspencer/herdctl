/**
 * Sidebar component for @herdctl/web
 *
 * Contains:
 * - Fleet name header with connection status
 * - Agent sections grouped by fleet hierarchy with collapsible fleet sections
 * - Navigation links (Dashboard, Jobs, Schedules)
 * - Quick stats bar showing agent counts
 *
 * For single-fleet configs (all agents have fleetPath === []), renders
 * a flat agent list with no fleet grouping — identical to the pre-composition UI.
 */

import { useEffect, useMemo, useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Briefcase,
  Calendar,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useFleet, useSidebarSessions, useChatActions } from "../../store";
import { formatRelativeTime } from "../../lib/format";
import { getAgentAvatar } from "../../lib/avatar";
import type { AgentInfo, ChatSession, ConnectionStatus } from "../../lib/types";

// =============================================================================
// Fleet Grouping Types
// =============================================================================

/**
 * A node in the fleet hierarchy tree.
 * Each node represents either a fleet group or contains agents at that level.
 */
interface FleetTreeNode {
  /** Fleet segment name (e.g., "herdctl", "frontend") */
  name: string;
  /** Agents directly belonging to this fleet level */
  agents: AgentInfo[];
  /** Sub-fleet children */
  children: FleetTreeNode[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build a fleet hierarchy tree from a flat list of agents.
 *
 * Returns:
 * - `rootAgents`: agents with empty fleetPath (appear ungrouped)
 * - `fleetNodes`: top-level fleet grouping nodes
 */
function buildFleetTree(agents: AgentInfo[]): {
  rootAgents: AgentInfo[];
  fleetNodes: FleetTreeNode[];
} {
  const rootAgents: AgentInfo[] = [];
  const nodeMap = new Map<string, FleetTreeNode>();

  for (const agent of agents) {
    if (agent.fleetPath.length === 0) {
      rootAgents.push(agent);
      continue;
    }

    // Ensure all intermediate nodes exist
    for (let depth = 0; depth < agent.fleetPath.length; depth++) {
      const key = agent.fleetPath.slice(0, depth + 1).join(".");
      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          name: agent.fleetPath[depth],
          agents: [],
          children: [],
        });
      }

      // Link parent -> child
      if (depth > 0) {
        const parentKey = agent.fleetPath.slice(0, depth).join(".");
        const parent = nodeMap.get(parentKey)!;
        const child = nodeMap.get(key)!;
        if (!parent.children.includes(child)) {
          parent.children.push(child);
        }
      }
    }

    // Add agent to its deepest fleet node
    const leafKey = agent.fleetPath.join(".");
    nodeMap.get(leafKey)!.agents.push(agent);
  }

  // Collect top-level fleet nodes (those with only one segment in their key)
  const fleetNodes: FleetTreeNode[] = [];
  for (const [key, node] of nodeMap.entries()) {
    if (!key.includes(".")) {
      fleetNodes.push(node);
    }
  }

  return { rootAgents, fleetNodes };
}

/**
 * Check if any agents in this fleet hierarchy have the given status
 */
function hasFleetStatus(
  node: FleetTreeNode,
  status: AgentInfo["status"]
): boolean {
  if (node.agents.some((a) => a.status === status)) return true;
  return node.children.some((child) => hasFleetStatus(child, status));
}

/**
 * Count total agents in a fleet node (including all descendants)
 */
function countFleetAgents(node: FleetTreeNode): number {
  let count = node.agents.length;
  for (const child of node.children) {
    count += countFleetAgents(child);
  }
  return count;
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

/**
 * Determine aggregate status dot class for a fleet node
 */
function getFleetStatusDotClass(node: FleetTreeNode): string {
  if (hasFleetStatus(node, "error")) return "bg-herd-status-error";
  if (hasFleetStatus(node, "running"))
    return "bg-herd-status-running animate-pulse";
  return "bg-herd-status-idle";
}

// =============================================================================
// Sub-Components
// =============================================================================

interface AgentRowProps {
  agent: AgentInfo;
  sessions: ChatSession[];
  isActive: boolean;
  activeSessionId: string | null;
  onNavigate?: () => void;
  onNewChat: (qualifiedName: string) => void;
  indent?: number;
}

function AgentRow({
  agent,
  sessions,
  isActive,
  activeSessionId,
  onNavigate,
  onNewChat,
  indent = 0,
}: AgentRowProps) {
  const paddingLeft = indent > 0 ? `${indent * 16 + 12}px` : undefined;

  return (
    <div>
      {/* Agent heading row */}
      <div className="flex items-center border-b border-herd-sidebar-border bg-herd-sidebar-hover">
        <Link
          to={`/agents/${encodeURIComponent(agent.qualifiedName)}`}
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-2 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-colors min-w-0 ${
            isActive
              ? "text-herd-sidebar-fg"
              : "text-herd-sidebar-fg/80 hover:text-herd-sidebar-fg"
          }`}
          style={paddingLeft ? { paddingLeft } : { paddingLeft: "12px" }}
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
            onNewChat(agent.qualifiedName);
          }}
          className="flex-shrink-0 p-1.5 mr-1 rounded bg-herd-primary/80 text-white hover:bg-herd-primary transition-colors"
          title="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Recent chat sessions */}
      {sessions.length === 0 ? (
        <p className="text-[11px] text-herd-sidebar-muted/50 text-center py-3">
          No chats yet
        </p>
      ) : (
        <div className="mr-1 mt-0.5 space-y-1">
          {sessions.map((session) => {
            const isSessionActive = session.sessionId === activeSessionId;
            return (
              <Link
                key={session.sessionId}
                to={`/agents/${encodeURIComponent(agent.qualifiedName)}/chat/${session.sessionId}`}
                onClick={onNavigate}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded text-sm transition-colors ${
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

interface FleetSectionProps {
  node: FleetTreeNode;
  sidebarSessions: Record<string, ChatSession[]>;
  currentAgentQualifiedName: string | null;
  activeSessionId: string | null;
  onNavigate?: () => void;
  onNewChat: (qualifiedName: string) => void;
  depth?: number;
  expandedFleets: Set<string>;
  toggleFleet: (fleetKey: string) => void;
  fleetKeyPrefix?: string;
}

function FleetSection({
  node,
  sidebarSessions,
  currentAgentQualifiedName,
  activeSessionId,
  onNavigate,
  onNewChat,
  depth = 0,
  expandedFleets,
  toggleFleet,
  fleetKeyPrefix = "",
}: FleetSectionProps) {
  const fleetKey = fleetKeyPrefix ? `${fleetKeyPrefix}.${node.name}` : node.name;
  const isExpanded = expandedFleets.has(fleetKey);
  const agentCount = countFleetAgents(node);
  const statusDotClass = getFleetStatusDotClass(node);

  return (
    <div>
      {/* Fleet header (clickable to expand/collapse) */}
      <button
        type="button"
        onClick={() => toggleFleet(fleetKey)}
        className="w-full flex items-center gap-2 py-2 rounded-lg text-xs font-medium text-herd-sidebar-muted hover:text-herd-sidebar-fg hover:bg-herd-sidebar-hover transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform flex-shrink-0 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass}`}
        />
        <span className="truncate font-semibold uppercase tracking-wide">
          {node.name}
        </span>
        <span className="text-[11px] text-herd-sidebar-muted/60 ml-auto mr-2">
          {agentCount}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div>
          {/* Direct agents in this fleet */}
          {node.agents.map((agent) => (
            <AgentRow
              key={agent.qualifiedName}
              agent={agent}
              sessions={sidebarSessions[agent.qualifiedName] ?? []}
              isActive={currentAgentQualifiedName === agent.qualifiedName}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
              onNewChat={onNewChat}
              indent={depth + 1}
            />
          ))}

          {/* Sub-fleet children */}
          {node.children.map((child) => (
            <FleetSection
              key={child.name}
              node={child}
              sidebarSessions={sidebarSessions}
              currentAgentQualifiedName={currentAgentQualifiedName}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
              onNewChat={onNewChat}
              depth={depth + 1}
              expandedFleets={expandedFleets}
              toggleFleet={toggleFleet}
              fleetKeyPrefix={fleetKey}
            />
          ))}
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

  // Track which fleet sections are expanded (default: all expanded)
  const [expandedFleets, setExpandedFleets] = useState<Set<string>>(new Set());

  // Build fleet hierarchy tree
  const { rootAgents, fleetNodes } = useMemo(
    () => buildFleetTree(agents),
    [agents]
  );

  // Determine if we have any fleet grouping
  const hasFleetGrouping = fleetNodes.length > 0;

  // Auto-expand all fleet nodes when agents change and we first see fleet grouping
  useEffect(() => {
    if (hasFleetGrouping && expandedFleets.size === 0) {
      const allKeys = new Set<string>();
      function collectKeys(nodes: FleetTreeNode[], prefix: string) {
        for (const node of nodes) {
          const key = prefix ? `${prefix}.${node.name}` : node.name;
          allKeys.add(key);
          collectKeys(node.children, key);
        }
      }
      collectKeys(fleetNodes, "");
      setExpandedFleets(allKeys);
    }
  }, [hasFleetGrouping, fleetNodes]);

  const toggleFleet = useCallback((fleetKey: string) => {
    setExpandedFleets((prev) => {
      const next = new Set(prev);
      if (next.has(fleetKey)) {
        next.delete(fleetKey);
      } else {
        next.add(fleetKey);
      }
      return next;
    });
  }, []);

  // Fetch sidebar sessions when agents list changes (use qualifiedName)
  const agentQualifiedNames = useMemo(
    () => agents.map((a) => a.qualifiedName),
    [agents]
  );
  useEffect(() => {
    if (agentQualifiedNames.length > 0) {
      fetchSidebarSessions(agentQualifiedNames);
    }
  }, [agentQualifiedNames.join(","), fetchSidebarSessions]);

  // Extract current agent qualified name from the URL path
  const currentAgentQualifiedName = useMemo(() => {
    if (!location.pathname.startsWith("/agents/")) return null;
    // The qualified name is the second path segment, which may contain dots
    // Path format: /agents/{qualifiedName}/...
    const rest = location.pathname.slice("/agents/".length);
    const slashIndex = rest.indexOf("/");
    const encoded = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest;
    return decodeURIComponent(encoded);
  }, [location.pathname]);

  // Check if current path is a chat session
  const activeSessionId = useMemo(() => {
    const match = location.pathname.match(/\/chat\/(.+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Handle new chat creation
  const handleNewChat = useCallback(
    async (qualifiedName: string) => {
      const sessionId = await createChatSession(qualifiedName);
      if (sessionId) {
        navigate(
          `/agents/${encodeURIComponent(qualifiedName)}/chat/${sessionId}`
        );
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
            <img
              src="/herdctl-logo.svg"
              alt="herdctl logo"
              className="w-7 h-7"
            />
            <h1 className="text-lg font-semibold text-herd-sidebar-fg">
              herdctl
            </h1>
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
          {/* Fleet-grouped agents */}
          {fleetNodes.map((node) => (
            <FleetSection
              key={node.name}
              node={node}
              sidebarSessions={sidebarSessions}
              currentAgentQualifiedName={currentAgentQualifiedName}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
              onNewChat={handleNewChat}
              expandedFleets={expandedFleets}
              toggleFleet={toggleFleet}
            />
          ))}

          {/* Root-level agents (no fleet grouping) */}
          {rootAgents.map((agent) => (
            <AgentRow
              key={agent.qualifiedName}
              agent={agent}
              sessions={sidebarSessions[agent.qualifiedName] ?? []}
              isActive={currentAgentQualifiedName === agent.qualifiedName}
              activeSessionId={activeSessionId}
              onNavigate={onNavigate}
              onNewChat={handleNewChat}
            />
          ))}

          {agents.length === 0 && (
            <p className="text-xs text-herd-sidebar-muted px-3 py-2">
              No agents configured
            </p>
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
